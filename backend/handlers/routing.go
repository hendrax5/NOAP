package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
)

func GetBGPMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON([]map[string]interface{}{
			{"peer_ip": "192.168.100.1", "state": "ESTABLISHED", "uptime_seconds": 2592000, "prefixes_received": 850100, "prefixes_advertised": 200, "description": "ISP Upstream", "ts": time.Now().Unix() * 1000},
			{"peer_ip": "10.0.0.5", "state": "IDLE", "uptime_seconds": 0, "prefixes_received": 0, "prefixes_advertised": 0, "description": "", "ts": time.Now().Unix() * 1000},
		})
	}

	// Optional device filter (e.g. ?device_id=3)
	deviceFilter := ""
	deviceArgs := []interface{}{tenantID}
	if did := c.Query("device_id"); did != "" {
		deviceFilter = "AND device_id = ?"
		deviceArgs = append(deviceArgs, did)
	}

	query := `
		SELECT peer_ip,
		       argMax(state, timestamp)               AS state,
		       argMax(uptime_seconds, timestamp)      AS uptime_seconds,
		       argMax(prefixes_received, timestamp)   AS prefixes_received,
		       argMax(prefixes_advertised, timestamp) AS prefixes_advertised,
		       argMax(description, timestamp)         AS description,
		       toUnixTimestamp(max(timestamp)) * 1000 AS ts
		FROM metrics_bgp_peers
		WHERE tenant_id = ? ` + deviceFilter + `
		GROUP BY peer_ip
		ORDER BY peer_ip
	`
	rows, err := database.CH.Query(c.Context(), query, deviceArgs...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch BGP metrics", "details": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var peerIP, state, description string
		var uptime, prefixesRx, prefixesTx uint32
		var ts uint64
		if err := rows.Scan(&peerIP, &state, &uptime, &prefixesRx, &prefixesTx, &description, &ts); err == nil {
			results = append(results, map[string]interface{}{
				"peer_ip":             peerIP,
				"state":               state,
				"uptime_seconds":      uptime,
				"prefixes_received":   prefixesRx,
				"prefixes_advertised": prefixesTx,
				"description":         description,
				"ts":                  ts,
			})
		}
	}
	return c.JSON(results)
}

// GetBGPHistory returns the last N rows from metrics_bgp_peers for a given peer,
// useful for drawing prefix-count history charts. Query params: peer_ip (required),
// device_id (optional), limit (optional, default 100, max 1000).
func GetBGPHistory(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	peerIP := c.Query("peer_ip")
	if peerIP == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "peer_ip query param required"})
	}

	limit := 100
	if l := c.QueryInt("limit", 100); l > 0 && l <= 1000 {
		limit = l
	}

	if database.CH == nil {
		// Return stub data when ClickHouse is unavailable
		now := time.Now()
		var stub []map[string]interface{}
		for i := 0; i < 5; i++ {
			stub = append(stub, map[string]interface{}{
				"peer_ip":             peerIP,
				"state":               "ESTABLISHED",
				"uptime_seconds":      uint32(i * 60),
				"prefixes_received":   uint32(850000 + i*100),
				"prefixes_advertised": uint32(200 + i),
				"ts":                  now.Add(time.Duration(-i) * time.Minute).Unix() * 1000,
			})
		}
		return c.JSON(stub)
	}

	deviceFilter := ""
	args := []interface{}{tenantID, peerIP}
	if did := c.Query("device_id"); did != "" {
		deviceFilter = "AND device_id = ?"
		args = append(args, did)
	}
	args = append(args, limit)

	query := `
		SELECT peer_ip, state, uptime_seconds, prefixes_received, prefixes_advertised,
		       toUnixTimestamp(timestamp) * 1000 AS ts
		FROM metrics_bgp_peers
		WHERE tenant_id = ? AND peer_ip = ? ` + deviceFilter + `
		ORDER BY timestamp DESC
		LIMIT ?
	`
	rows, err := database.CH.Query(c.Context(), query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch BGP history", "details": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var peerIP2, state string
		var uptime, prefixesRx, prefixesTx uint32
		var ts uint64
		if err := rows.Scan(&peerIP2, &state, &uptime, &prefixesRx, &prefixesTx, &ts); err == nil {
			results = append(results, map[string]interface{}{
				"peer_ip":             peerIP2,
				"state":               state,
				"uptime_seconds":      uptime,
				"prefixes_received":   prefixesRx,
				"prefixes_advertised": prefixesTx,
				"ts":                  ts,
			})
		}
	}
	return c.JSON(results)
}


func GetMPLSMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON([]map[string]interface{}{
			{"lsp_name": "LSP-CORE-EAST", "state": "UP", "active_path": "PRIMARY", "ts": time.Now().Unix() * 1000},
			{"lsp_name": "LSP-CORE-WEST", "state": "UP", "active_path": "SECONDARY_BACKUP", "ts": time.Now().Unix() * 1000},
		})
	}

	query := `
		SELECT lsp_name, argMax(state, timestamp) as state, argMax(active_path, timestamp) as active_path, toUnixTimestamp(max(timestamp)) * 1000 as ts
		FROM metrics_mpls_lsp
		WHERE tenant_id = ?
		GROUP BY lsp_name
		ORDER BY lsp_name
	`
	rows, err := database.CH.Query(c.Context(), query, tenantID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch MPLS metrics", "details": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var lsp, state, path string
		var ts uint64
		if err := rows.Scan(&lsp, &state, &path, &ts); err == nil {
			results = append(results, map[string]interface{}{
				"lsp_name":    lsp,
				"state":       state,
				"active_path": path,
				"ts":          ts,
			})
		}
	}
	return c.JSON(results)
}
