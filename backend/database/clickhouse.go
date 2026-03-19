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

	log.Println("ClickHouse schema verified")
}
