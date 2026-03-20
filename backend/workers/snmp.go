package workers

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
	"github.com/hendrax5/noap/services"
)

// ── Worker Pool ───────────────────────────────────────────────────────────────

// snmpSem limits the number of concurrent SNMP connections.
// Default is 500; override with SNMP_CONCURRENCY env variable.
var snmpSem = make(chan struct{}, snmpConcurrency())

func snmpConcurrency() int {
	if v := os.Getenv("SNMP_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 500
}

// ── Delta Counter Store ───────────────────────────────────────────────────────

// counterEntry holds a previous octet counter reading and its timestamp.
type counterEntry struct {
	value uint64
	ts    time.Time
}

// ifCounters stores previous counter readings for bps delta calculation.
// Key: "{deviceID}:{ifIndex}:{dir}" where dir is "in" or "out".
var ifCounters sync.Map

// deltaKey builds the sync.Map key.
func deltaKey(deviceID uint, ifIndex int, dir string) string {
	return fmt.Sprintf("%d:%d:%s", deviceID, ifIndex, dir)
}

// computeDelta returns bits-per-second given the previous and current octet
// counters, handling 64-bit wrap-around (ignored — 64-bit wraps at ~1 exabyte).
// Returns 0 on first poll (no previous reading).
func computeDelta(deviceID uint, ifIndex int, dir string, current uint64, now time.Time) uint64 {
	key := deltaKey(deviceID, ifIndex, dir)
	if prev, ok := ifCounters.Load(key); ok {
		entry := prev.(counterEntry)
		elapsed := now.Sub(entry.ts).Seconds()
		if elapsed <= 0 {
			return 0
		}
		// Handle 32-bit counter wrap-around (if 64-bit HC is not available)
		diff := int64(current) - int64(entry.value)
		if diff < 0 {
			// 32-bit wrap: add 2^32
			diff += 1 << 32
		}
		if diff < 0 {
			// Unexpected — skip this interval
			ifCounters.Store(key, counterEntry{value: current, ts: now})
			return 0
		}
		bps := uint64(float64(diff) * 8 / elapsed)
		ifCounters.Store(key, counterEntry{value: current, ts: now})
		return bps
	}
	// First reading — store and return 0
	ifCounters.Store(key, counterEntry{value: current, ts: now})
	return 0
}

// ── OID constants ─────────────────────────────────────────────────────────────

const (
	// 64-bit high-capacity counters (IF-MIB RFC 2863) — primary
	oidHCIn  = ".1.3.6.1.2.1.31.1.1.1.6."  // ifHCInOctets
	oidHCOut = ".1.3.6.1.2.1.31.1.1.1.10." // ifHCOutOctets

	// 32-bit fallback (IF-MIB RFC 1213) — for legacy gear without HC support
	oidIn  = ".1.3.6.1.2.1.2.2.1.10." // ifInOctets
	oidOut = ".1.3.6.1.2.1.2.2.1.16." // ifOutOctets

	oidOperStat = ".1.3.6.1.2.1.2.2.1.8." // ifOperStatus
	oidSysUptime = "1.3.6.1.2.1.1.3.0"    // sysUpTime
)

// ── Batch insert type ─────────────────────────────────────────────────────────

type ifMetricRow struct {
	tenantID    uint
	deviceID    uint
	ifIndex     int
	ifName      string
	ts          time.Time
	inBps       uint64
	outBps      uint64
	rxDbm       float32
	txDbm       float32
	errors      uint64
	operStatus  int
}

// ── Poller entry point ────────────────────────────────────────────────────────

func StartSNMPPoller() {
	log.Println("Starting SNMP Poller (concurrency:", cap(snmpSem), ")...")
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		var devices []models.Device
		if err := database.DB.Find(&devices).Error; err != nil {
			log.Println("SNMP Poller failed to fetch devices:", err)
			continue
		}

		for _, dev := range devices {
			dev := dev
			snmpSem <- struct{}{} // acquire slot (blocks when pool is full)
			go func() {
				defer func() { <-snmpSem }() // release slot
				pollSNMPDevice(dev)
			}()
		}
	}
}

// ── Per-device poll ───────────────────────────────────────────────────────────

func pollSNMPDevice(dev models.Device) {
	if dev.SNMPComm == "" {
		return // Not configured — skip silently
	}

	params := &gosnmp.GoSNMP{
		Target:    dev.IP,
		Port:      161,
		Community: dev.SNMPComm,
		Version:   gosnmp.Version2c,
		Timeout:   3 * time.Second,
		Retries:   1,
		Logger:    gosnmp.NewLogger(log.New(io.Discard, "", 0)),
	}

	if err := params.Connect(); err != nil {
		log.Printf("[SNMP] Connection failed to %s: %v", dev.IP, err)
		database.DB.Model(&dev).Update("last_snmp_status", "down")
		return
	}
	defer params.Conn.Close()

	database.DB.Model(&dev).Updates(map[string]interface{}{
		"last_snmp_status": "up",
		"last_seen":        time.Now(),
	})

	// Auto-discover interfaces (only when flag is set)
	if dev.AutoDiscover {
		services.RunInterfaceDiscovery(params, dev)
	}

	// System metrics (CPU / Mem / Uptime)
	cpuUtil, memUtil, sysUptime := pollSystemMetrics(params, dev)

	qSys := `INSERT INTO metrics_snmp_system
		(tenant_id, device_id, timestamp, cpu_util_pct, mem_util_pct, sys_uptime)
		VALUES (?, ?, ?, ?, ?, ?)`
	if err := database.CH.Exec(context.Background(), qSys,
		dev.TenantID, dev.ID, time.Now(), cpuUtil, memUtil, sysUptime); err != nil {
		log.Println("[SNMP] Failed to insert system metric:", err)
	}

	// CPU alert
	if cpuUtil > 80 {
		checkAlerts(dev, "cpu", cpuUtil, 0)
	} else {
		checkAlerts(dev, "cpu", 0, 0) // clear cooldown when resolved
	}

	// Mem alert
	if memUtil > 85 {
		checkAlerts(dev, "mem", memUtil, 0)
	} else {
		checkAlerts(dev, "mem", 0, 0) // clear cooldown when resolved
	}

	// Per-interface metrics (batch insert)
	pollInterfaceMetrics(params, dev)
}

// ── System Metrics ────────────────────────────────────────────────────────────

func pollSystemMetrics(params *gosnmp.GoSNMP, dev models.Device) (cpuUtil, memUtil float32, sysUptime uint64) {
	v := vendorOIDs(dev.Vendor)

	// CPU — vendor OID first, then HOST-RESOURCES fallback
	cpuUtil = scalarFloat(params, v.CPULoad)
	if cpuUtil == 0 {
		cpuUtil = scalarFloat(params, "1.3.6.1.2.1.25.3.3.1.2.1")
	}
	// No random fallback — 0 means no data

	// Memory
	if v.FreeMem != "" && v.TotalMem != "" {
		free := scalarUint64(params, v.FreeMem)
		total := scalarUint64(params, v.TotalMem)
		if total > 0 {
			memUtil = float32(100.0 * float64(total-free) / float64(total))
		}
	} else if v.FreeMem != "" {
		// Vendor returns % used directly (e.g. Fortinet, Palo Alto)
		memUtil = scalarFloat(params, v.FreeMem)
	}
	// No random fallback — 0 means no data

	// Uptime (sysUpTime.0) — always standard
	if res, err := params.Get([]string{oidSysUptime}); err == nil && len(res.Variables) > 0 {
		if val, ok := res.Variables[0].Value.(uint32); ok {
			sysUptime = uint64(val) / 100 // centiseconds → seconds
		}
	}
	return
}

// ── Interface Metrics — GETBULK + 64-bit + batch ─────────────────────────────

func pollInterfaceMetrics(params *gosnmp.GoSNMP, dev models.Device) {
	var monitored []models.DeviceInterface
	database.DB.Where("device_id = ? AND is_monitored = ?", dev.ID, true).Find(&monitored)
	if len(monitored) == 0 {
		return
	}

	now := time.Now()

	// ── GETBULK: fetch ifOperStatus for all monitored interfaces in one call ──
	// Build one OID list covering all interfaces
	operOids := make([]string, 0, len(monitored))
	hcInOids := make([]string, 0, len(monitored))
	hcOutOids := make([]string, 0, len(monitored))
	for _, intf := range monitored {
		idx := intf.IfIndex
		operOids = append(operOids, fmt.Sprintf("%s%d", oidOperStat, idx))
		hcInOids = append(hcInOids, fmt.Sprintf("%s%d", oidHCIn, idx))
		hcOutOids = append(hcOutOids, fmt.Sprintf("%s%d", oidHCOut, idx))
	}

	// Fetch all three tables in parallel via Get (up to 60 OIDs per call,
	// well within gosnmp's default max-varbinds of 64).
	// For very high interface counts (>20) we'd paginate with GetBulk;
	// for typical ISP device (<200 ports) this is fine.
	allOids := append(append(operOids, hcInOids...), hcOutOids...)

	// gosnmp.Get accepts up to 60 OIDs; for large interface counts we chunk.
	operMap := make(map[int]int)          // ifIndex → operStatus
	hcInMap := make(map[int]uint64)       // ifIndex → HC in octets
	hcOutMap := make(map[int]uint64)      // ifIndex → HC out octets
	use32bit := false                     // fallback flag

	chunkSize := 60
	for i := 0; i < len(allOids); i += chunkSize {
		end := i + chunkSize
		if end > len(allOids) {
			end = len(allOids)
		}
		res, err := params.Get(allOids[i:end])
		if err != nil {
			log.Printf("[SNMP] GetBulk-style Get failed for %s: %v", dev.IP, err)
			use32bit = true
			break
		}
		// Decode results by OID prefix
		for _, v := range res.Variables {
			oid := v.Name
			// Determine which table and which index
			for _, intf := range monitored {
				idx := intf.IfIndex
				switch oid {
				case fmt.Sprintf("%s%d", oidOperStat, idx):
					if val, ok := v.Value.(int); ok {
						operMap[idx] = val
					}
				case fmt.Sprintf("%s%d", oidHCIn, idx):
					hcInMap[idx] = toUint64(v.Value)
				case fmt.Sprintf("%s%d", oidHCOut, idx):
					hcOutMap[idx] = toUint64(v.Value)
				}
			}
		}
	}

	// If HC OIDs returned nothing (device doesn't support RFC 2863),
	// fall back to 32-bit ifInOctets / ifOutOctets.
	if use32bit || (len(hcInMap) == 0 && len(monitored) > 0) {
		log.Printf("[SNMP] %s: ifHC not supported, falling back to 32-bit counters", dev.IP)
		fallbackOids := make([]string, 0, len(monitored)*2)
		for _, intf := range monitored {
			fallbackOids = append(fallbackOids,
				fmt.Sprintf("%s%d", oidIn, intf.IfIndex),
				fmt.Sprintf("%s%d", oidOut, intf.IfIndex),
			)
		}
		for i := 0; i < len(fallbackOids); i += chunkSize {
			end := i + chunkSize
			if end > len(fallbackOids) {
				end = len(fallbackOids)
			}
			res, err := params.Get(fallbackOids[i:end])
			if err != nil {
				break
			}
			for _, v := range res.Variables {
				for _, intf := range monitored {
					idx := intf.IfIndex
					if v.Name == fmt.Sprintf("%s%d", oidIn, idx) {
						hcInMap[idx] = toUint64(v.Value)
					}
					if v.Name == fmt.Sprintf("%s%d", oidOut, idx) {
						hcOutMap[idx] = toUint64(v.Value)
					}
				}
			}
		}
	}

	// ── Build rows and compute deltas ─────────────────────────────────────────
	rows := make([]ifMetricRow, 0, len(monitored))

	for _, intf := range monitored {
		idx := intf.IfIndex
		operStatus := operMap[idx]
		if operStatus == 0 {
			operStatus = 2 // default: down (ifOperStatus 1=up, 2=down)
		}

		inBps := computeDelta(dev.ID, idx, "in", hcInMap[idx], now)
		outBps := computeDelta(dev.ID, idx, "out", hcOutMap[idx], now)

		// Optical power (vendor-aware)
		rxDbm, txDbm := pollOptical(params, dev, idx, operStatus)

		// Optical alerts
		if operStatus == 1 {
			var prevRx float32
			qPrev := `SELECT rx_dbm FROM metrics_snmp_interfaces
				WHERE tenant_id = ? AND device_id = ? AND interface_id = ?
				ORDER BY timestamp DESC LIMIT 1`
			_ = database.CH.QueryRow(context.Background(), qPrev,
				dev.TenantID, dev.ID, idx).Scan(&prevRx)

			if rxDbm <= -25 {
				checkAlerts(dev, "optical", rxDbm, float32(idx))
			} else if prevRx != 0 && (prevRx-rxDbm) >= 1.0 {
				checkAlerts(dev, "optical_degrade", rxDbm, float32(idx))
			}

			// Link down alert
			checkAlerts(dev, "link_down", 0, float32(idx)) // clears if up
		} else {
			checkAlerts(dev, "link_down", 1, float32(idx)) // fires if down
		}

		rows = append(rows, ifMetricRow{
			tenantID:   dev.TenantID,
			deviceID:   dev.ID,
			ifIndex:    idx,
			ifName:     intf.Name,
			ts:         now,
			inBps:      inBps,
			outBps:     outBps,
			rxDbm:      rxDbm,
			txDbm:      txDbm,
			errors:     0,
			operStatus: operStatus,
		})
	}

	// ── Batch insert to ClickHouse ────────────────────────────────────────────
	batchInsertInterfaceMetrics(rows)
}

// batchInsertInterfaceMetrics inserts all interface rows in a single CH batch.
func batchInsertInterfaceMetrics(rows []ifMetricRow) {
	if len(rows) == 0 {
		return
	}

	// Build a multi-row values block using ClickHouse batch API.
	// ClickHouse Go driver v2 supports native batch via PrepareBatch.
	batch, err := database.CH.PrepareBatch(context.Background(),
		`INSERT INTO metrics_snmp_interfaces
			(tenant_id, device_id, interface_id, interface_name, timestamp,
			 in_bps, out_bps, rx_dbm, tx_dbm, errors, oper_status)`)
	if err != nil {
		log.Println("[SNMP] Failed to prepare CH batch:", err)
		return
	}

	for _, r := range rows {
		if err := batch.Append(
			r.tenantID, r.deviceID, r.ifIndex, r.ifName, r.ts,
			r.inBps, r.outBps, r.rxDbm, r.txDbm, r.errors, r.operStatus,
		); err != nil {
			log.Println("[SNMP] Failed to append to CH batch:", err)
		}
	}

	if err := batch.Send(); err != nil {
		log.Println("[SNMP] Failed to send CH batch:", err)
	}
}

// ── Optical Power ─────────────────────────────────────────────────────────────

func pollOptical(params *gosnmp.GoSNMP, dev models.Device, idx, operStatus int) (rxDbm, txDbm float32) {
	v := vendorOIDs(dev.Vendor)
	rxOid, txOid, _ := opticalOIDs(dev.Vendor, idx)

	if rxOid != "" {
		if val := scalarInt64(params, rxOid); val != 0 {
			rxDbm = float32(val) / v.OptScale
		}
	}
	if txOid != "" && txOid != rxOid {
		if val := scalarInt64(params, txOid); val != 0 {
			txDbm = float32(val) / v.OptScale
		}
	}
	// No random fallback — 0 means no DOM data available
	return
}

// ── SNMP scalar helpers ───────────────────────────────────────────────────────

func scalarFloat(params *gosnmp.GoSNMP, oid string) float32 {
	if oid == "" {
		return 0
	}
	res, err := params.Get([]string{oid})
	if err != nil || len(res.Variables) == 0 {
		return 0
	}
	return float32(toInt64(res.Variables[0].Value))
}

func scalarUint64(params *gosnmp.GoSNMP, oid string) uint64 {
	if oid == "" {
		return 0
	}
	res, err := params.Get([]string{oid})
	if err != nil || len(res.Variables) == 0 {
		return 0
	}
	return toUint64(res.Variables[0].Value)
}

func scalarInt64(params *gosnmp.GoSNMP, oid string) int64 {
	if oid == "" {
		return 0
	}
	res, err := params.Get([]string{oid})
	if err != nil || len(res.Variables) == 0 {
		return 0
	}
	return toInt64(res.Variables[0].Value)
}

// toUint64 converts common gosnmp value types to uint64.
func toUint64(v interface{}) uint64 {
	switch val := v.(type) {
	case uint:
		return uint64(val)
	case uint32:
		return uint64(val)
	case uint64:
		return val
	case int:
		if val > 0 {
			return uint64(val)
		}
	case int64:
		if val > 0 {
			return uint64(val)
		}
	}
	return 0
}

// toInt64 converts common gosnmp value types to int64 (handles negative dBm).
func toInt64(v interface{}) int64 {
	switch val := v.(type) {
	case int:
		return int64(val)
	case int64:
		return val
	case uint:
		return int64(val)
	case uint32:
		return int64(val)
	case uint64:
		return int64(val)
	}
	return 0
}
