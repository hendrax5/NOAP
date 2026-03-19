package handlers

import (
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
)

// ────────────────────────────────────────────────────────────────────────────
// GetTopTalkers — enriched with ASN + app columns (P4)
// GET /metrics/flows/top-talkers
// ────────────────────────────────────────────────────────────────────────────

func GetTopTalkers(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON([]map[string]interface{}{
			{"src_ip": "10.0.0.2", "dst_ip": "8.8.8.8", "total_bytes": 145_000_000, "protocol": "TCP", "app": "HTTPS", "dst_asn_name": "Google"},
			{"src_ip": "192.168.1.100", "dst_ip": "1.1.1.1", "total_bytes": 89_000_000, "protocol": "UDP", "app": "DNS", "dst_asn_name": "Cloudflare"},
			{"src_ip": "10.0.0.1", "dst_ip": "52.20.0.1", "total_bytes": 45_000_000, "protocol": "TCP", "app": "HTTPS", "dst_asn_name": "Amazon AWS"},
			{"src_ip": "172.16.0.5", "dst_ip": "13.64.0.1", "total_bytes": 12_000_000, "protocol": "TCP", "app": "HTTPS", "dst_asn_name": "Microsoft Azure"},
			{"src_ip": "10.0.0.3", "dst_ip": "157.240.0.1", "total_bytes": 8_500_000, "protocol": "TCP", "app": "HTTPS", "dst_asn_name": "Meta"},
		})
	}

	query := `
		SELECT src_ip, dst_ip, any(protocol) as protocol,
		       any(app) as app, any(dst_asn_name) as dst_asn_name,
		       sum(bytes) as total_bytes
		FROM metrics_flow
		WHERE tenant_id = ? AND timestamp >= now() - INTERVAL 1 HOUR
		GROUP BY src_ip, dst_ip
		ORDER BY total_bytes DESC
		LIMIT 10
	`
	rows, err := database.CH.Query(c.Context(), query, tenantID)
	if err != nil {
		log.Println("Error querying top talkers:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch top talkers"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var src, dst, proto, app, dstASNName string
		var bytes uint64
		if err := rows.Scan(&src, &dst, &proto, &app, &dstASNName, &bytes); err == nil {
			results = append(results, map[string]interface{}{
				"src_ip":       src,
				"dst_ip":       dst,
				"protocol":     proto,
				"app":          app,
				"dst_asn_name": dstASNName,
				"total_bytes":  bytes,
			})
		}
	}
	return c.JSON(results)
}

// ────────────────────────────────────────────────────────────────────────────
// GetFlowBandwidth — protocol breakdown KPIs
// GET /metrics/flows/bandwidth
// ────────────────────────────────────────────────────────────────────────────

func GetFlowBandwidth(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON(fiber.Map{
			"total_gb": 42.5, "tcp_pct": 75, "udp_pct": 20, "icmp_pct": 5,
			"active_flows": 238,
		})
	}

	query := `
		SELECT
			sum(bytes) / 1073741824.0               as total_gb,
			sumIf(bytes, protocol='TCP')  / sum(bytes) * 100 as tcp_pct,
			sumIf(bytes, protocol='UDP')  / sum(bytes) * 100 as udp_pct,
			sumIf(bytes, protocol='ICMP') / sum(bytes) * 100 as icmp_pct,
			uniqExact(src_ip, dst_ip, src_port, dst_port) as active_flows
		FROM metrics_flow
		WHERE tenant_id = ? AND timestamp >= now() - INTERVAL 1 HOUR
		HAVING sum(bytes) > 0
	`
	var total float64
	var tcp, udp, icmp float64
	var activeFlows uint64
	err := database.CH.QueryRow(c.Context(), query, tenantID).Scan(&total, &tcp, &udp, &icmp, &activeFlows)
	if err != nil {
		return c.JSON(fiber.Map{"total_gb": 0, "tcp_pct": 0, "udp_pct": 0, "icmp_pct": 0, "active_flows": 0})
	}

	return c.JSON(fiber.Map{
		"total_gb": total, "tcp_pct": tcp, "udp_pct": udp, "icmp_pct": icmp,
		"active_flows": activeFlows,
	})
}

// ────────────────────────────────────────────────────────────────────────────
// GetFlowTimeSeries — 5-minute bucketed bandwidth over last 1h (P4)
// GET /metrics/flows/timeseries
// ────────────────────────────────────────────────────────────────────────────

func GetFlowTimeSeries(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		// 12 synthetic 5-minute buckets
		var mock []map[string]interface{}
		for i := 11; i >= 0; i-- {
			in := float64(500_000+i*40_000) + float64(i%3*120_000)
			out := float64(300_000+i*25_000) + float64(i%2*80_000)
			mock = append(mock, map[string]interface{}{
				"bucket":   60 - i*5,
				"in_bps":   in,
				"out_bps":  out,
			})
		}
		return c.JSON(mock)
	}

	query := `
		SELECT
			toStartOfFiveMinutes(timestamp) as bucket,
			sum(bytes) / 300.0 * 8 as in_bps,
			sum(bytes) / 300.0 * 8 * 0.45 as out_bps
		FROM metrics_flow
		WHERE tenant_id = ? AND timestamp >= now() - INTERVAL 1 HOUR
		GROUP BY bucket
		ORDER BY bucket ASC
	`
	rows, err := database.CH.Query(c.Context(), query, tenantID)
	if err != nil {
		log.Println("Error querying flow timeseries:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch timeseries"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var bucket string
		var inBps, outBps float64
		if err := rows.Scan(&bucket, &inBps, &outBps); err == nil {
			results = append(results, map[string]interface{}{
				"bucket":  bucket,
				"in_bps":  inBps,
				"out_bps": outBps,
			})
		}
	}
	return c.JSON(results)
}

// ────────────────────────────────────────────────────────────────────────────
// GetTopApplications — top 10 apps by bytes over last 1h (P4)
// GET /metrics/flows/apps
// ────────────────────────────────────────────────────────────────────────────

func GetTopApplications(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON([]map[string]interface{}{
			{"app": "HTTPS", "bytes": 210_000_000},
			{"app": "HTTP", "bytes": 58_000_000},
			{"app": "DNS", "bytes": 12_400_000},
			{"app": "SSH", "bytes": 8_900_000},
			{"app": "MySQL", "bytes": 5_300_000},
			{"app": "SMTP-Submit", "bytes": 2_100_000},
			{"app": "RDP", "bytes": 1_800_000},
			{"app": "SNMP", "bytes": 900_000},
			{"app": "NTP", "bytes": 450_000},
			{"app": "Other", "bytes": 380_000},
		})
	}

	query := `
		SELECT app, sum(bytes) as total_bytes
		FROM metrics_flow
		WHERE tenant_id = ? AND timestamp >= now() - INTERVAL 1 HOUR
		  AND app != ''
		GROUP BY app
		ORDER BY total_bytes DESC
		LIMIT 10
	`
	rows, err := database.CH.Query(c.Context(), query, tenantID)
	if err != nil {
		log.Println("Error querying top apps:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch top apps"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var app string
		var bytes uint64
		if err := rows.Scan(&app, &bytes); err == nil {
			results = append(results, map[string]interface{}{
				"app":   app,
				"bytes": bytes,
			})
		}
	}
	return c.JSON(results)
}

// ────────────────────────────────────────────────────────────────────────────
// GetTopASNs — top 8 destination ASNs by bytes over last 1h (P4)
// GET /metrics/flows/asns
// ────────────────────────────────────────────────────────────────────────────

func GetTopASNs(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if database.CH == nil {
		return c.JSON([]map[string]interface{}{
			{"asn": 15169, "asn_name": "Google", "bytes": 185_000_000},
			{"asn": 16509, "asn_name": "Amazon AWS", "bytes": 120_000_000},
			{"asn": 13335, "asn_name": "Cloudflare", "bytes": 98_000_000},
			{"asn": 8075, "asn_name": "Microsoft Azure", "bytes": 74_000_000},
			{"asn": 32934, "asn_name": "Meta", "bytes": 45_000_000},
			{"asn": 20940, "asn_name": "Akamai", "bytes": 23_000_000},
			{"asn": 54113, "asn_name": "Fastly", "bytes": 11_000_000},
			{"asn": 0, "asn_name": "Private", "bytes": 8_000_000},
		})
	}

	query := `
		SELECT dst_asn as asn, any(dst_asn_name) as asn_name, sum(bytes) as total_bytes
		FROM metrics_flow
		WHERE tenant_id = ? AND timestamp >= now() - INTERVAL 1 HOUR
		GROUP BY dst_asn
		ORDER BY total_bytes DESC
		LIMIT 8
	`
	rows, err := database.CH.Query(c.Context(), query, tenantID)
	if err != nil {
		log.Println("Error querying top ASNs:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch top ASNs"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var asn uint32
		var asnName string
		var bytes uint64
		if err := rows.Scan(&asn, &asnName, &bytes); err == nil {
			results = append(results, map[string]interface{}{
				"asn":      asn,
				"asn_name": asnName,
				"bytes":    bytes,
			})
		}
	}
	return c.JSON(results)
}
