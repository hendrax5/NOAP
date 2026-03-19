package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/hendrax5/noap/database"
)

// ─────────────────────────────────────────────────────────────────────────────
// FlowRow — a single enriched flow record ready for ClickHouse.
// All three ingestion paths (GoFlow2 decoder, legacy v5 receiver, mock
// generator) feed rows into the shared batch writer.
// ─────────────────────────────────────────────────────────────────────────────

type FlowRow struct {
	TenantID  uint
	DeviceID  uint
	Timestamp time.Time

	SrcIP    string
	DstIP    string
	SrcPort  uint16
	DstPort  uint16
	Protocol string

	Bytes   uint64
	Packets uint64

	SrcASN     uint32
	DstASN     uint32
	SrcASNName string
	DstASNName string
	App        string

	FlowType string
	InIf     uint32
	OutIf    uint32
	ToS      uint32
	TCPFlags uint32
	VlanID   uint32
	NextHop  string

	SrcCountry string
	DstCountry string
	SrcCity    string
	DstCity    string

	SrcLat float64
	SrcLon float64
	DstLat float64
	DstLon float64
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Writer — collects FlowRows in a channel and flushes them to
// ClickHouse in bulk every FLOW_FLUSH_INTERVAL seconds or when the buffer
// hits FLOW_BATCH_SIZE rows, whichever comes first.
//
// At 100K flows/sec this is the difference between 100K INSERT/s (will kill
// ClickHouse) and 10 batch inserts/s of 10K rows (perfectly fine).
// ─────────────────────────────────────────────────────────────────────────────

var (
	FlowChan chan FlowRow         // all ingestion paths write here
	flowOnce sync.Once           // ensures StartFlowBatchWriter is called once
)

func flowBatchSize() int {
	if v, err := strconv.Atoi(os.Getenv("FLOW_BATCH_SIZE")); err == nil && v > 0 {
		return v
	}
	return 10_000 // default: flush every 10K rows
}

func flowFlushInterval() time.Duration {
	if v, err := strconv.Atoi(os.Getenv("FLOW_FLUSH_INTERVAL_SECS")); err == nil && v > 0 {
		return time.Duration(v) * time.Second
	}
	return 5 * time.Second // default: flush every 5 seconds
}

// StartFlowBatchWriter must be called once at application startup.
// It creates the channel and launches the background writer goroutine.
func StartFlowBatchWriter() {
	flowOnce.Do(func() {
		bufSize := flowBatchSize() * 5 // channel capacity = 5× batch to absorb bursts
		FlowChan = make(chan FlowRow, bufSize)

		batchSize := flowBatchSize()
		interval := flowFlushInterval()

		log.Printf("[FlowWriter] batch=%d  flush_interval=%s  chan_cap=%d",
			batchSize, interval, bufSize)

		go flowWriterLoop(batchSize, interval)
	})
}

func flowWriterLoop(batchSize int, interval time.Duration) {
	batch := make([]FlowRow, 0, batchSize)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case row, ok := <-FlowChan:
			if !ok {
				// channel closed — flush remaining
				if len(batch) > 0 {
					flushBatch(batch)
				}
				return
			}
			batch = append(batch, row)
			if len(batch) >= batchSize {
				flushBatch(batch)
				batch = batch[:0]
			}

		case <-ticker.C:
			if len(batch) > 0 {
				flushBatch(batch)
				batch = batch[:0]
			}
		}
	}
}

// flushBatch performs a single ClickHouse batch INSERT for all rows.
func flushBatch(rows []FlowRow) {
	if database.CH == nil || len(rows) == 0 {
		return
	}

	ctx := context.Background()

	batch, err := database.CH.PrepareBatch(ctx,
		`INSERT INTO metrics_flow
			(tenant_id, device_id, timestamp,
			 src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets,
			 src_asn, dst_asn, src_asn_name, dst_asn_name, app,
			 flow_type, in_if, out_if, tos, tcp_flags, vlan_id, next_hop,
			 src_country, dst_country, src_city, dst_city,
			 src_lat, src_lon, dst_lat, dst_lon)`)
	if err != nil {
		log.Printf("[FlowWriter] PrepareBatch error: %v", err)
		// Fallback: try individual inserts so we don't lose data silently
		fallbackInsert(rows)
		return
	}

	for _, r := range rows {
		if err := batch.Append(
			r.TenantID, r.DeviceID, r.Timestamp,
			r.SrcIP, r.DstIP, r.SrcPort, r.DstPort, r.Protocol,
			r.Bytes, r.Packets,
			r.SrcASN, r.DstASN, r.SrcASNName, r.DstASNName, r.App,
			r.FlowType, r.InIf, r.OutIf, r.ToS, r.TCPFlags, r.VlanID, r.NextHop,
			r.SrcCountry, r.DstCountry, r.SrcCity, r.DstCity,
			r.SrcLat, r.SrcLon, r.DstLat, r.DstLon,
		); err != nil {
			log.Printf("[FlowWriter] Append error: %v", err)
		}
	}

	if err := batch.Send(); err != nil {
		log.Printf("[FlowWriter] batch Send error (%d rows): %v", len(rows), err)
	} else {
		log.Printf("[FlowWriter] ✓ flushed %d flow rows", len(rows))
	}
}

// fallbackInsert is a safety net — if PrepareBatch fails we fall back to
// individual Exec calls so data is never silently dropped.
func fallbackInsert(rows []FlowRow) {
	q := `INSERT INTO metrics_flow
		(tenant_id, device_id, timestamp,
		 src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets,
		 src_asn, dst_asn, src_asn_name, dst_asn_name, app,
		 flow_type, in_if, out_if, tos, tcp_flags, vlan_id, next_hop,
		 src_country, dst_country, src_city, dst_city,
		 src_lat, src_lon, dst_lat, dst_lon)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	errCount := 0
	for _, r := range rows {
		if err := database.CH.Exec(context.Background(), q,
			r.TenantID, r.DeviceID, r.Timestamp,
			r.SrcIP, r.DstIP, r.SrcPort, r.DstPort, r.Protocol,
			r.Bytes, r.Packets,
			r.SrcASN, r.DstASN, r.SrcASNName, r.DstASNName, r.App,
			r.FlowType, r.InIf, r.OutIf, r.ToS, r.TCPFlags, r.VlanID, r.NextHop,
			r.SrcCountry, r.DstCountry, r.SrcCity, r.DstCity,
			r.SrcLat, r.SrcLon, r.DstLat, r.DstLon,
		); err != nil {
			errCount++
		}
	}
	if errCount > 0 {
		log.Printf("[FlowWriter] fallback: %d/%d rows failed", errCount, len(rows))
	} else {
		log.Printf("[FlowWriter] fallback: all %d rows inserted individually", len(rows))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Sampling Rate Configuration
//
//   FLOW_DEFAULT_SAMPLING_RATE   — fallback when device sends 0
//   FLOW_OVERRIDE_SAMPLING_RATE  — force this rate regardless of device value
//
// Akvorado-inspired: many devices (Palo Alto, MikroTik, Cisco NCS 5500)
// either don't send or mis-report their sampling rate.
// ─────────────────────────────────────────────────────────────────────────────

var (
	samplingDefault  uint64
	samplingOverride uint64
	samplingOnce     sync.Once
)

func loadSamplingConfig() {
	samplingOnce.Do(func() {
		if v, err := strconv.ParseUint(os.Getenv("FLOW_DEFAULT_SAMPLING_RATE"), 10, 64); err == nil && v > 0 {
			samplingDefault = v
			log.Printf("[FlowWriter] FLOW_DEFAULT_SAMPLING_RATE = %d", v)
		}
		if v, err := strconv.ParseUint(os.Getenv("FLOW_OVERRIDE_SAMPLING_RATE"), 10, 64); err == nil && v > 0 {
			samplingOverride = v
			log.Printf("[FlowWriter] FLOW_OVERRIDE_SAMPLING_RATE = %d (overrides all devices)", v)
		}
	})
}

// EffectiveSamplingRate returns the sampling rate to multiply by, honouring
// the override → device-reported → default → 1 priority chain.
func EffectiveSamplingRate(deviceReported uint64) uint64 {
	loadSamplingConfig()

	// 1. Global override takes top priority
	if samplingOverride > 0 {
		return samplingOverride
	}
	// 2. Device-reported value
	if deviceReported > 0 {
		return deviceReported
	}
	// 3. Configured default fallback
	if samplingDefault > 0 {
		return samplingDefault
	}
	// 4. No sampling info at all → store as-is
	return 1
}

// Convenience: send a *FlowRow non-blockingly, logging if channel is full.
func EnqueueFlow(row FlowRow) {
	select {
	case FlowChan <- row:
		// OK
	default:
		log.Println("[FlowWriter] ⚠ channel full — dropping flow")
	}
}

// Metrics (expose for /api/health or Prometheus later)
func FlowChanLen() int {
	if FlowChan == nil {
		return 0
	}
	return len(FlowChan)
}

func FlowChanCap() int {
	if FlowChan == nil {
		return 0
	}
	return cap(FlowChan)
}

// Utility
func fmtCount(n int) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(n)/1e6)
	}
	if n >= 1_000 {
		return fmt.Sprintf("%.1fK", float64(n)/1e3)
	}
	return fmt.Sprintf("%d", n)
}
