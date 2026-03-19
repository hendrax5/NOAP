package handlers

import (
	"fmt"
	"log"
	"math/rand"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
)

// ── Allowed dimensions (whitelist for SQL injection safety) ──────────────
var allowedDimensions = map[string]bool{
	"src_ip": true, "dst_ip": true,
	"src_port": true, "dst_port": true,
	"protocol": true, "app": true,
	"src_asn": true, "dst_asn": true,
	"src_asn_name": true, "dst_asn_name": true,
	"src_country": true, "dst_country": true,
	"src_city": true, "dst_city": true,
	"in_if": true, "out_if": true,
	"flow_type": true, "next_hop": true,
	"vlan_id": true, "tos": true,
}

// time-range strings → ClickHouse intervals + Go durations
var timeRangeMap = map[string]string{
	"5m":  "5 MINUTE",
	"15m": "15 MINUTE",
	"1h":  "1 HOUR",
	"6h":  "6 HOUR",
	"24h": "24 HOUR",
	"7d":  "7 DAY",
	"30d": "30 DAY",
	"90d": "90 DAY",
}

// parseLookback converts our time-range key to a Go duration for FlowTable.
func parseLookback(tr string) time.Duration {
	switch tr {
	case "5m":
		return 5 * time.Minute
	case "15m":
		return 15 * time.Minute
	case "1h":
		return time.Hour
	case "6h":
		return 6 * time.Hour
	case "24h":
		return 24 * time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	case "30d":
		return 30 * 24 * time.Hour
	case "90d":
		return 90 * 24 * time.Hour
	default:
		return time.Hour
	}
}

// bucketExpr returns the ClickHouse bucket expression for the given time
// range and timestamp column (which differs per rollup table).
func bucketExpr(tr, tsCol string) string {
	switch tr {
	case "5m", "15m":
		return fmt.Sprintf("toStartOfMinute(%s)", tsCol)
	case "1h", "6h":
		return fmt.Sprintf("toStartOfFiveMinutes(%s)", tsCol)
	case "24h":
		return fmt.Sprintf("toStartOfFifteenMinutes(%s)", tsCol)
	default: // 7d, 30d, 90d
		return fmt.Sprintf("toStartOfHour(%s)", tsCol)
	}
}

// ── Request body ────────────────────────────────────────────────────────
type FlowQueryRequest struct {
	Dimensions []string `json:"dimensions"` // GROUP BY columns
	Metric     string   `json:"metric"`     // "bytes" or "packets"
	TimeRange  string   `json:"time_range"` // "5m","15m","1h","6h","24h","7d"
	Limit      int      `json:"limit"`      // top N
	Filter     string   `json:"filter"`     // optional simple WHERE fragment
}

// ── Response types ──────────────────────────────────────────────────────
type FlowQueryRow struct {
	Dimensions map[string]interface{} `json:"dimensions"`
	Value      uint64                 `json:"value"`
}

type FlowQueryBucket struct {
	Bucket string            `json:"bucket"`
	Series map[string]uint64 `json:"series"`
}

type FlowQueryResponse struct {
	Rows       []FlowQueryRow    `json:"rows"`
	TimeSeries []FlowQueryBucket `json:"time_series"`
}

// ── Simple filter sanitiser ─────────────────────────────────────────────
// Only allow patterns like: column = 'value' [AND|OR column = 'value' ...]
var safeFilterRe = regexp.MustCompile(`^[a-z_]+\s*=\s*'[^']*'(\s+(AND|OR)\s+[a-z_]+\s*=\s*'[^']*')*$`)

func sanitiseFilter(f string) (string, bool) {
	f = strings.TrimSpace(f)
	if f == "" {
		return "", true
	}
	if !safeFilterRe.MatchString(f) {
		return "", false
	}
	// additionally verify every column name in the filter is in the whitelist
	parts := regexp.MustCompile(`([a-z_]+)\s*=`).FindAllStringSubmatch(f, -1)
	for _, p := range parts {
		if !allowedDimensions[p[1]] {
			return "", false
		}
	}
	return f, true
}

// ────────────────────────────────────────────────────────────────────────
// FlowQuery — flexible query endpoint (Phase 6)
// POST /metrics/flows/query
// ────────────────────────────────────────────────────────────────────────

func FlowQuery(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req FlowQueryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// defaults
	if len(req.Dimensions) == 0 {
		req.Dimensions = []string{"protocol"}
	}
	if req.Metric != "packets" {
		req.Metric = "bytes"
	}
	if _, ok := timeRangeMap[req.TimeRange]; !ok {
		req.TimeRange = "1h"
	}
	if req.Limit <= 0 || req.Limit > 50 {
		req.Limit = 10
	}

	// validate dimensions
	for _, d := range req.Dimensions {
		if !allowedDimensions[d] {
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("Invalid dimension: %s", d)})
		}
	}

	// validate filter
	safeFilter, ok := sanitiseFilter(req.Filter)
	if !ok {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filter expression"})
	}

	// ── Mock data when ClickHouse is not connected ──
	if database.CH == nil {
		return c.JSON(buildMockResponse(req))
	}

	// ── Real ClickHouse queries ──
	interval := timeRangeMap[req.TimeRange]
	lookback := parseLookback(req.TimeRange)
	table, tsCol := database.FlowTable(lookback)

	dimCols := strings.Join(req.Dimensions, ", ")
	filterClause := ""
	if safeFilter != "" {
		filterClause = " AND " + safeFilter
	}

	// 1) aggregated rows — top N
	rowQuery := fmt.Sprintf(`
		SELECT %s, sum(%s) as total
		FROM %s
		WHERE tenant_id = ? AND %s >= now() - INTERVAL %s%s
		GROUP BY %s
		ORDER BY total DESC
		LIMIT %d
	`, dimCols, req.Metric, table, tsCol, interval, filterClause, dimCols, req.Limit)

	rows, err := database.CH.Query(c.Context(), rowQuery, tenantID)
	if err != nil {
		log.Println("FlowQuery rows error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Query failed"})
	}
	defer rows.Close()

	var result FlowQueryResponse
	topKeys := make(map[string]bool)

	for rows.Next() {
		vals := make([]interface{}, len(req.Dimensions)+1)
		ptrs := make([]interface{}, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		dimMap := make(map[string]interface{})
		var keyParts []string
		for i, d := range req.Dimensions {
			dimMap[d] = vals[i]
			keyParts = append(keyParts, fmt.Sprintf("%v", vals[i]))
		}
		key := strings.Join(keyParts, "/")
		topKeys[key] = true

		var total uint64
		switch v := vals[len(vals)-1].(type) {
		case uint64:
			total = v
		case int64:
			total = uint64(v)
		case float64:
			total = uint64(v)
		}

		result.Rows = append(result.Rows, FlowQueryRow{
			Dimensions: dimMap,
			Value:      total,
		})
	}

	// 2) time series — bucketed, only for top-N keys
	bExpr := bucketExpr(req.TimeRange, tsCol)
	tsQuery := fmt.Sprintf(`
		SELECT %s AS bucket, %s, sum(%s) as total
		FROM %s
		WHERE tenant_id = ? AND %s >= now() - INTERVAL %s%s
		GROUP BY bucket, %s
		ORDER BY bucket ASC, total DESC
	`, bExpr, dimCols, req.Metric, table, tsCol, interval, filterClause, dimCols)

	tsRows, err := database.CH.Query(c.Context(), tsQuery, tenantID)
	if err != nil {
		log.Println("FlowQuery timeseries error:", err)
		// return rows without time series
		return c.JSON(result)
	}
	defer tsRows.Close()

	bucketIdx := make(map[string]int)
	for tsRows.Next() {
		vals := make([]interface{}, len(req.Dimensions)+2) // bucket + dims + total
		ptrs := make([]interface{}, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := tsRows.Scan(ptrs...); err != nil {
			continue
		}

		bucket := fmt.Sprintf("%v", vals[0])
		var keyParts []string
		for i := 1; i <= len(req.Dimensions); i++ {
			keyParts = append(keyParts, fmt.Sprintf("%v", vals[i]))
		}
		key := strings.Join(keyParts, "/")

		if !topKeys[key] {
			continue
		}

		var total uint64
		switch v := vals[len(vals)-1].(type) {
		case uint64:
			total = v
		case int64:
			total = uint64(v)
		case float64:
			total = uint64(v)
		}

		idx, exists := bucketIdx[bucket]
		if !exists {
			idx = len(result.TimeSeries)
			bucketIdx[bucket] = idx
			result.TimeSeries = append(result.TimeSeries, FlowQueryBucket{
				Bucket: bucket,
				Series: make(map[string]uint64),
			})
		}
		result.TimeSeries[idx].Series[key] = total
	}

	return c.JSON(result)
}

// ── Mock response builder ───────────────────────────────────────────────
func buildMockResponse(req FlowQueryRequest) FlowQueryResponse {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	// mock dimension values
	mockVals := map[string][]string{
		"protocol":     {"TCP", "UDP", "ICMP"},
		"app":          {"HTTPS", "HTTP", "DNS", "SSH", "MySQL", "SMTP-Submit"},
		"src_ip":       {"10.0.0.1", "10.0.0.2", "192.168.1.100", "172.16.0.5"},
		"dst_ip":       {"8.8.8.8", "1.1.1.1", "52.20.0.1", "13.64.0.1"},
		"src_country":  {"US", "DE", "JP", "GB", "BR"},
		"dst_country":  {"US", "DE", "JP", "GB", "AU"},
		"dst_asn_name": {"Google", "Cloudflare", "Amazon AWS", "Microsoft Azure", "Meta"},
		"src_asn_name": {"Internal", "Upstream-A", "Upstream-B"},
		"flow_type":    {"IPv4", "IPv6"},
	}

	// pick values for each dimension
	type combo struct {
		dims map[string]interface{}
		key  string
	}
	var combos []combo

	// generate combinations (simplified: just iterate first dimension)
	dim0 := req.Dimensions[0]
	vals0 := mockVals[dim0]
	if vals0 == nil {
		vals0 = []string{"val-1", "val-2", "val-3"}
	}
	for _, v0 := range vals0 {
		if len(req.Dimensions) > 1 {
			dim1 := req.Dimensions[1]
			vals1 := mockVals[dim1]
			if vals1 == nil {
				vals1 = []string{"x", "y"}
			}
			// pair first dim val with one or two second-dim vals
			for j := 0; j < 1+rng.Intn(2) && j < len(vals1); j++ {
				dm2 := map[string]interface{}{dim0: v0, dim1: vals1[j]}
				combos = append(combos, combo{dims: dm2, key: v0 + "/" + vals1[j]})
			}
		} else {
			dm := map[string]interface{}{dim0: v0}
			combos = append(combos, combo{dims: dm, key: v0})
		}
	}
	// limit to req.Limit
	if len(combos) > req.Limit {
		combos = combos[:req.Limit]
	}

	// rows with descending values
	var resp FlowQueryResponse
	baseValue := uint64(200_000_000)
	for i, cb := range combos {
		val := baseValue - uint64(i)*uint64(20_000_000+rng.Intn(15_000_000))
		if val < 1_000_000 {
			val = uint64(1_000_000 + rng.Intn(5_000_000))
		}
		resp.Rows = append(resp.Rows, FlowQueryRow{
			Dimensions: cb.dims,
			Value:      val,
		})
	}

	// time series — 12 buckets
	for b := 0; b < 12; b++ {
		ts := FlowQueryBucket{
			Bucket: fmt.Sprintf("t-%dm", (12-b)*5),
			Series: make(map[string]uint64),
		}
		for i, cb := range combos {
			base := float64(resp.Rows[i].Value) / 12.0
			jitter := base * (0.7 + rng.Float64()*0.6)
			ts.Series[cb.key] = uint64(jitter)
		}
		resp.TimeSeries = append(resp.TimeSeries, ts)
	}

	return resp
}
