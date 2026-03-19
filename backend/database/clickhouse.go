package database

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

var CH driver.Conn

func ConnectClickHouse() {
	host := os.Getenv("CH_HOST")
	if host == "" {
		host = "127.0.0.1:8123" // Fallback local
	} else {
		host = "clickhouse:8123" // Override 9000 to use HTTP port
	}

	var conn driver.Conn
	var err error

	for i := 0; i < 15; i++ {
		conn, err = clickhouse.Open(&clickhouse.Options{
			Addr: []string{host},
			Auth: clickhouse.Auth{
				Database: "default",
				Username: "default",
				Password: "password",
			},
			Protocol: clickhouse.HTTP,
			DialTimeout: time.Second * 5,
		})

		if err == nil {
			err = conn.Ping(context.Background())
			if err == nil {
				break
			}
		}
		log.Println("Waiting for ClickHouse...")
		time.Sleep(3 * time.Second)
	}

	if err != nil {
		log.Fatal("Failed to connect to ClickHouse:", err)
	}

	log.Println("ClickHouse connected")
	CH = conn

	// Auto-create schema for ICMP and SNMP
	initClickHouseSchema(context.Background())
}

func initClickHouseSchema(ctx context.Context) {
	schemas := []string{
		`CREATE TABLE IF NOT EXISTS metrics_icmp (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			latency_ms Float32,
			packet_loss_pct Float32,
			status String
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_snmp_system (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			cpu_util_pct Float32,
			mem_util_pct Float32,
			sys_uptime UInt64
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_snmp_interfaces (
			tenant_id UInt32,
			device_id UInt32,
			interface_id UInt32,
			interface_name String,
			timestamp DateTime,
			in_bps UInt64,
			out_bps UInt64,
			rx_dbm Float32,
			tx_dbm Float32,
			errors UInt32,
			oper_status UInt8 DEFAULT 2
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_sla (
			tenant_id UInt32,
			probe_id UInt32,
			timestamp DateTime,
			response_ms Float32,
			status String
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, probe_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS events_syslog (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			severity String,
			facility String,
			message String,
			type String
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_bgp_peers (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			peer_ip String,
			state String,
			uptime_seconds UInt32,
			prefixes_received UInt32
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_mpls_lsp (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			lsp_name String,
			state String,
			active_path String
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,

		`CREATE TABLE IF NOT EXISTS metrics_flow (
			tenant_id UInt32,
			device_id UInt32,
			timestamp DateTime,
			src_ip String,
			dst_ip String,
			src_port UInt16,
			dst_port UInt16,
			protocol String,
			bytes UInt64,
			packets UInt64,
			src_asn UInt32,
			dst_asn UInt32,
			src_asn_name String,
			dst_asn_name String,
			app String
		) ENGINE = MergeTree()
		ORDER BY (tenant_id, device_id, timestamp)`,
	}

	for _, stmt := range schemas {
		if err := CH.Exec(ctx, stmt); err != nil {
			log.Fatal("Failed to setup ClickHouse schema:", err)
		}
	}

	// Hot migrations — safe to run on existing installations
	CH.Exec(ctx, "ALTER TABLE metrics_snmp_interfaces ADD COLUMN IF NOT EXISTS oper_status UInt8 DEFAULT 2")
	CH.Exec(ctx, "ALTER TABLE metrics_bgp_peers ADD COLUMN IF NOT EXISTS prefixes_advertised UInt32 DEFAULT 0")
	// P4 flow enrichment columns
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_asn UInt32 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_asn UInt32 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_asn_name String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_asn_name String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS app String DEFAULT ''")

	// Phase 2 — GeoIP + multi-protocol flow columns
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS flow_type String DEFAULT 'netflow_v5'")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_country String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_country String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_city String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_city String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS in_if UInt32 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS out_if UInt32 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS next_hop String DEFAULT ''")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS tcp_flags UInt8 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS sampling_rate UInt32 DEFAULT 1")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS tos UInt8 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS vlan_id UInt32 DEFAULT 0")

	// Phase 3 — lat/lon for geo map arcs
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_lat Float64 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS src_lon Float64 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_lat Float64 DEFAULT 0")
	CH.Exec(ctx, "ALTER TABLE metrics_flow ADD COLUMN IF NOT EXISTS dst_lon Float64 DEFAULT 0")

	// ─── Phase 7: TTL + Rollup materialised views ─────────────────────────
	// 7a. Raw table keeps only 7 days of per-flow data.
	CH.Exec(ctx, "ALTER TABLE metrics_flow MODIFY TTL timestamp + INTERVAL 7 DAY")

	// 7b. 5-minute rollup — kept for 90 days.
	CH.Exec(ctx, `CREATE TABLE IF NOT EXISTS metrics_flow_5m (
		tenant_id    UInt32,
		device_id    UInt32,
		ts_5m        DateTime,
		src_ip       String,
		dst_ip       String,
		protocol     String,
		app          String,
		src_asn      UInt32,
		dst_asn      UInt32,
		src_asn_name String,
		dst_asn_name String,
		src_country  String,
		dst_country  String,
		bytes        UInt64,
		packets      UInt64,
		flow_count   UInt64
	) ENGINE = SummingMergeTree((bytes, packets, flow_count))
	ORDER BY (tenant_id, device_id, ts_5m, src_ip, dst_ip, protocol, app)
	TTL ts_5m + INTERVAL 90 DAY`)

	CH.Exec(ctx, `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_flow_5m
	TO metrics_flow_5m AS
	SELECT
		tenant_id, device_id,
		toStartOfFiveMinutes(timestamp) AS ts_5m,
		src_ip, dst_ip, protocol, app,
		src_asn, dst_asn,
		any(src_asn_name) AS src_asn_name,
		any(dst_asn_name) AS dst_asn_name,
		any(src_country)  AS src_country,
		any(dst_country)  AS dst_country,
		sum(bytes)   AS bytes,
		sum(packets) AS packets,
		count()      AS flow_count
	FROM metrics_flow
	GROUP BY tenant_id, device_id, ts_5m, src_ip, dst_ip, protocol, app, src_asn, dst_asn`)

	// 7c. 1-hour rollup — kept for 2 years.
	CH.Exec(ctx, `CREATE TABLE IF NOT EXISTS metrics_flow_1h (
		tenant_id    UInt32,
		device_id    UInt32,
		ts_1h        DateTime,
		src_ip       String,
		dst_ip       String,
		protocol     String,
		app          String,
		src_asn      UInt32,
		dst_asn      UInt32,
		src_asn_name String,
		dst_asn_name String,
		src_country  String,
		dst_country  String,
		bytes        UInt64,
		packets      UInt64,
		flow_count   UInt64
	) ENGINE = SummingMergeTree((bytes, packets, flow_count))
	ORDER BY (tenant_id, device_id, ts_1h, src_ip, dst_ip, protocol, app)
	TTL ts_1h + INTERVAL 730 DAY`)

	CH.Exec(ctx, `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_flow_1h
	TO metrics_flow_1h AS
	SELECT
		tenant_id, device_id,
		toStartOfHour(timestamp) AS ts_1h,
		src_ip, dst_ip, protocol, app,
		src_asn, dst_asn,
		any(src_asn_name) AS src_asn_name,
		any(dst_asn_name) AS dst_asn_name,
		any(src_country)  AS src_country,
		any(dst_country)  AS dst_country,
		sum(bytes)   AS bytes,
		sum(packets) AS packets,
		count()      AS flow_count
	FROM metrics_flow
	GROUP BY tenant_id, device_id, ts_1h, src_ip, dst_ip, protocol, app, src_asn, dst_asn`)

	log.Println("ClickHouse schema verified (incl. flow TTL + rollup views)")
}

// FlowTable returns the best rollup table name for a given lookback duration.
//
//	≤ 6 h  → metrics_flow       (raw, per-flow)
//	≤ 7 d  → metrics_flow_5m    (5-min rollup)
//	> 7 d  → metrics_flow_1h    (1-hour rollup)
//
// The timestamp column name differs per table; returned as the second value.
func FlowTable(lookback time.Duration) (table string, tsCol string) {
	switch {
	case lookback <= 6*time.Hour:
		return "metrics_flow", "timestamp"
	case lookback <= 7*24*time.Hour:
		return "metrics_flow_5m", "ts_5m"
	default:
		return "metrics_flow_1h", "ts_1h"
	}
}

