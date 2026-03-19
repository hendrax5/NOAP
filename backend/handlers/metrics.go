package handlers

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
)

type MetricQuery struct {
	DeviceID uint `query:"device_id"`
}

func GetICMPMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.QueryInt("device_id")
	timeRange := c.Query("range", "1h")

	var interval string
	switch timeRange {
	case "6h":
		interval = "6 HOUR"
	case "24h":
		interval = "24 HOUR"
	case "7d":
		interval = "7 DAY"
	case "30d":
		interval = "30 DAY"
	case "365d":
		interval = "365 DAY"
	default:
		interval = "1 HOUR"
	}

	query := fmt.Sprintf(`SELECT toUnixTimestamp(timestamp) * 1000 as ts, latency_ms, packet_loss_pct FROM metrics_icmp WHERE tenant_id = ? AND device_id = ? AND timestamp >= now() - INTERVAL %s ORDER BY timestamp DESC LIMIT 500`, interval)
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(deviceID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var ts uint64
		var latency float32
		var loss float32
		if err := rows.Scan(&ts, &latency, &loss); err == nil {
			results = append(results, map[string]interface{}{"ts": ts, "latency": latency, "loss": loss})
		}
	}
	// Reverse to get chronological order for charts
	for i, j := 0, len(results)-1; i < j; i, j = i+1, j-1 {
		results[i], results[j] = results[j], results[i]
	}
	return c.JSON(results)
}

func GetSystemMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.QueryInt("device_id")
	timeRange := c.Query("range", "1h")

	var interval string
	switch timeRange {
	case "6h":
		interval = "6 HOUR"
	case "24h":
		interval = "24 HOUR"
	case "7d":
		interval = "7 DAY"
	case "30d":
		interval = "30 DAY"
	case "365d":
		interval = "365 DAY"
	default:
		interval = "1 HOUR"
	}

	query := fmt.Sprintf(`SELECT toUnixTimestamp(timestamp) * 1000 as ts, cpu_util_pct, mem_util_pct, sys_uptime FROM metrics_snmp_system WHERE tenant_id = ? AND device_id = ? AND timestamp >= now() - INTERVAL %s ORDER BY timestamp DESC LIMIT 500`, interval)
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(deviceID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var ts uint64
		var cpu float32
		var mem float32
		var uptime uint64
		if err := rows.Scan(&ts, &cpu, &mem, &uptime); err == nil {
			results = append(results, map[string]interface{}{"ts": ts, "cpu": cpu, "mem": mem, "uptime": uptime})
		}
	}
	for i, j := 0, len(results)-1; i < j; i, j = i+1, j-1 {
		results[i], results[j] = results[j], results[i]
	}
	return c.JSON(results)
}

func GetInterfaceMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.QueryInt("device_id")

	query := `SELECT interface_name, in_bps, out_bps, rx_dbm, tx_dbm, errors, oper_status FROM metrics_snmp_interfaces WHERE tenant_id = ? AND device_id = ? ORDER BY timestamp DESC LIMIT 10`
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(deviceID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	seen := make(map[string]bool)
	for rows.Next() {
		var name string
		var inB, outB uint64
		var rx, tx float32
		var errs uint32
		var operStatus uint8
		if err := rows.Scan(&name, &inB, &outB, &rx, &tx, &errs, &operStatus); err == nil {
			if !seen[name] {
				results = append(results, map[string]interface{}{
					"interface": name, "in_bps": inB, "out_bps": outB, "rx_dbm": rx, "tx_dbm": tx, "errors": errs, "oper_status": operStatus,
				})
				seen[name] = true
			}
		}
	}
	return c.JSON(results)
}

func GetInterfaceTrafficSparklines(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.QueryInt("device_id")
	timeRange := c.Query("range", "1h")

	var interval string
	switch timeRange {
	case "6h":
		interval = "6 HOUR"
	case "24h":
		interval = "24 HOUR"
	case "7d":
		interval = "7 DAY"
	case "30d":
		interval = "30 DAY"
	case "365d":
		interval = "365 DAY"
	default:
		interval = "1 HOUR"
	}

	query := fmt.Sprintf(`SELECT interface_id, toUnixTimestamp(timestamp) * 1000 as ts, in_bps, out_bps FROM metrics_snmp_interfaces WHERE tenant_id = ? AND device_id = ? AND timestamp >= now() - INTERVAL %s ORDER BY timestamp ASC`, interval)
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(deviceID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	results := make(map[uint32][]map[string]interface{})
	for rows.Next() {
		var ifId uint32
		var ts uint64
		var inB, outB uint64
		if err := rows.Scan(&ifId, &ts, &inB, &outB); err == nil {
			inMbps := float64(inB) / 1000000.0
			outMbps := float64(outB) / 1000000.0
			if results[ifId] == nil {
				results[ifId] = []map[string]interface{}{}
			}
			results[ifId] = append(results[ifId], map[string]interface{}{"ts": ts, "in_mbps": inMbps, "out_mbps": outMbps})
		}
	}

	// Keep only the last 500 data points per interface
	for k, arr := range results {
		if len(arr) > 500 {
			results[k] = arr[len(arr)-500:]
		}
	}
	return c.JSON(results)
}

func GetOpticalTrafficSparklines(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.QueryInt("device_id")
	timeRange := c.Query("range", "1h")

	var interval string
	switch timeRange {
	case "6h":
		interval = "6 HOUR"
	case "24h":
		interval = "24 HOUR"
	case "7d":
		interval = "7 DAY"
	case "30d":
		interval = "30 DAY"
	case "365d":
		interval = "365 DAY"
	default:
		interval = "1 HOUR"
	}

	query := fmt.Sprintf(`SELECT interface_id, toUnixTimestamp(timestamp) * 1000 as ts, rx_dbm, tx_dbm FROM metrics_snmp_interfaces WHERE tenant_id = ? AND device_id = ? AND timestamp >= now() - INTERVAL %s ORDER BY timestamp ASC`, interval)
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(deviceID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	results := make(map[uint32][]map[string]interface{})
	for rows.Next() {
		var ifId uint32
		var ts uint64
		var rx, tx float32
		if err := rows.Scan(&ifId, &ts, &rx, &tx); err == nil {
			if results[ifId] == nil {
				results[ifId] = []map[string]interface{}{}
			}
			results[ifId] = append(results[ifId], map[string]interface{}{"ts": ts, "rx_dbm": rx, "tx_dbm": tx})
		}
	}

	for k, arr := range results {
		if len(arr) > 500 {
			results[k] = arr[len(arr)-500:]
		}
	}
	return c.JSON(results)
}

func GetDashboardMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var tenantCount int64
	var deviceCount int64

	database.DB.Model(&models.Tenant{}).Count(&tenantCount)
	database.DB.Model(&models.Device{}).Where("tenant_id = ?", tenantID).Count(&deviceCount)

	// Real alert count: devices with last-seen > 5 min ago (down devices).
	var alertCount int64
	database.DB.Model(&models.Device{}).
		Where("tenant_id = ? AND last_seen < NOW() - INTERVAL '5 minutes'", tenantID).
		Count(&alertCount)

	// Real total bandwidth: sum bytes from metrics_flow over last 5 minutes.
	// Returns bytes/s average. Falls back to 0 when ClickHouse is unavailable.
	totalBandwidth := "N/A"
	if database.CH != nil {
		var totalBytes uint64
		rows, err := database.CH.Query(
			context.Background(),
			`SELECT sum(bytes) / 300 FROM metrics_flow
			 WHERE tenant_id = ?
			   AND timestamp >= now() - INTERVAL 5 MINUTE`,
			uint32(tenantID),
		)
		if err == nil {
			rows.Next()
			rows.Scan(&totalBytes) //nolint:errcheck — read-only scan, zero value is safe
			rows.Close()
			// Format as Mbps or Gbps.
			bps := float64(totalBytes) * 8 // bytes/s → bits/s
			switch {
			case bps >= 1e9:
				totalBandwidth = fmt.Sprintf("%.2f Gbps", bps/1e9)
			case bps >= 1e6:
				totalBandwidth = fmt.Sprintf("%.2f Mbps", bps/1e6)
			case bps >= 1e3:
				totalBandwidth = fmt.Sprintf("%.1f Kbps", bps/1e3)
			default:
				totalBandwidth = fmt.Sprintf("%.0f bps", bps)
			}
		}
	}

	type TenantHealth struct {
		Name        string `json:"name"`
		Code        string `json:"code"`
		Status      string `json:"status"`
		DeviceCount int    `json:"device_count"`
		Uptime      string `json:"uptime"`
	}
	var healths []TenantHealth

	var tenants []models.Tenant
	database.DB.Find(&tenants)
	for _, t := range tenants {
		var dCount int64
		var downCount int64
		database.DB.Model(&models.Device{}).Where("tenant_id = ?", t.ID).Count(&dCount)
		database.DB.Model(&models.Device{}).
			Where("tenant_id = ? AND last_seen < NOW() - INTERVAL '5 minutes'", t.ID).
			Count(&downCount)

		status := "Healthy"
		if dCount == 0 {
			status = "Warning"
		} else if downCount > 0 {
			status = "Degraded"
		}

		// Uptime % = up devices / total.
		uptimeStr := "N/A"
		if dCount > 0 {
			pct := float64(dCount-downCount) / float64(dCount) * 100
			uptimeStr = fmt.Sprintf("%.2f%%", pct)
		}

		code := t.Name
		if len(t.Name) >= 2 {
			code = t.Name[:2]
		}

		healths = append(healths, TenantHealth{
			Name:        t.Name,
			Code:        code,
			Status:      status,
			DeviceCount: int(dCount),
			Uptime:      uptimeStr,
		})
	}

	return c.JSON(fiber.Map{
		"total_tenants":   tenantCount,
		"active_devices":  deviceCount,
		"critical_alerts": alertCount,
		"total_bandwidth": totalBandwidth,
		"tenant_health":   healths,
	})
}
