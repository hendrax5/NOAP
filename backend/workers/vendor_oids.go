package workers

import "fmt"

// VendorOIDs holds the SNMP OID templates for a specific vendor.
// OIDs that require an interface index suffix must use fmt.Sprintf with `idx`.
type VendorOIDs struct {
	// System metrics
	CPULoad    string // raw percent (0-100) or index-less scalar
	FreeMem    string // bytes free (0 = unsupported, use hrStorageFree fallback)
	TotalMem   string // bytes total
	SysUptime  string // standard: 1.3.6.1.2.1.1.3.0

	// Per-interface optical (format string: insert idx with fmt.Sprintf)
	RxPower    string // millidBm or raw dBm*100; set Scale accordingly
	TxPower    string // same
	TxBias     string // mA (optional, empty = skip)
	OptScale   float32 // divisor to convert raw int → dBm (typ 100.0)
}

// vendorOIDs returns the VendorOIDs for the given vendor string.
// Falls back to standard HOST-RESOURCES + IF-MIB for unknown vendors.
func vendorOIDs(vendor string) VendorOIDs {
	switch vendor {

	// ── Juniper (Junos) ──────────────────────────────────────────────────────
	case "Juniper":
		return VendorOIDs{
			// jnxOperatingCPU (Routing Engine slot 0)
			CPULoad:  "1.3.6.1.4.1.2636.3.1.13.1.8.9.1.0.0",
			// jnxOperatingBuffer (% buffer used → treated as mem)
			FreeMem:  "",
			TotalMem: "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// jnxDomCurrentRxLaserPower (idx = ifIndex)
			RxPower: "1.3.6.1.4.1.2636.3.60.1.1.1.1.5.%d",
			// jnxDomCurrentTxLaserOutputPower
			TxPower: "1.3.6.1.4.1.2636.3.60.1.1.1.1.7.%d",
			// jnxDomCurrentTxLaserBiasCurrent
			TxBias:   "1.3.6.1.4.1.2636.3.60.1.1.1.1.6.%d",
			OptScale: 100.0,
		}

	// ── Ruijie ───────────────────────────────────────────────────────────────
	case "Ruijie":
		return VendorOIDs{
			// ruijieAvgCpuUsedFloat5Min
			CPULoad:   "1.3.6.1.4.1.26526.1.1.1.1.1.3.0",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// ruijieTransceiverDiagRxPower (unit: 0.01 dBm)
			RxPower:  "1.3.6.1.4.1.26526.100.12.1.1.1.7.%d",
			TxPower:  "1.3.6.1.4.1.26526.100.12.1.1.1.8.%d",
			TxBias:   "1.3.6.1.4.1.26526.100.12.1.1.1.6.%d",
			OptScale: 100.0,
		}

	// ── Cisco IOS / IOS-XE ───────────────────────────────────────────────────
	case "Cisco", "Cisco IOS-XE":
		return VendorOIDs{
			// CISCO-PROCESS-MIB cpmCPUTotal5minRev (pid=1 is typical RE)
			CPULoad:   "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// CISCO-ENTITY-SENSOR-MIB entSensorValue; idx = entPhysicalIndex
			RxPower:  "1.3.6.1.4.1.9.9.91.1.1.1.1.4.%d",
			TxPower:  "1.3.6.1.4.1.9.9.91.1.1.1.1.4.%d", // same table, different row
			TxBias:   "",
			OptScale: 1000.0, // Cisco stores in dBm * 1000 (miliwatts dBm)
		}

	// ── Cisco NX-OS ──────────────────────────────────────────────────────────
	case "Cisco NX-OS":
		return VendorOIDs{
			CPULoad:   "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			RxPower:   "1.3.6.1.4.1.9.9.91.1.1.1.1.4.%d",
			TxPower:   "1.3.6.1.4.1.9.9.91.1.1.1.1.4.%d",
			TxBias:    "",
			OptScale:  1000.0,
		}

	// ── Huawei ───────────────────────────────────────────────────────────────
	case "Huawei":
		return VendorOIDs{
			// hwEntityCpuUsage (entPhysicalIndex for RE)
			CPULoad:  "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.%d",
			// hwEntityMemUsage (percent) – no raw bytes available
			FreeMem:  "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.%d",
			TotalMem: "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// hwEntityOpticalRxPower / hwEntityOpticalTxPower (unit: 0.01 dBm)
			RxPower:  "1.3.6.1.4.1.2011.5.25.31.1.1.3.1.6.%d",
			TxPower:  "1.3.6.1.4.1.2011.5.25.31.1.1.3.1.5.%d",
			TxBias:   "1.3.6.1.4.1.2011.5.25.31.1.1.3.1.4.%d",
			OptScale: 100.0,
		}

	// ── MikroTik RouterOS v6 ─────────────────────────────────────────────────
	case "MikroTik RouterOS v6":
		return VendorOIDs{
			CPULoad:   "1.3.6.1.4.1.14988.1.1.3.1.0",  // mtxrHlCpuLoad
			FreeMem:   "1.3.6.1.4.1.14988.1.1.3.2.0",  // mtxrHlFreeMemory
			TotalMem:  "1.3.6.1.4.1.14988.1.1.3.3.0",  // mtxrHlTotalMemory
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// mtxrOptical table v6 layout: .3 = RxLoss, .4 = TxPower
			RxPower:  "1.3.6.1.4.1.14988.1.1.19.1.1.3.%d",
			TxPower:  "1.3.6.1.4.1.14988.1.1.19.1.1.4.%d",
			TxBias:   "",
			OptScale: 100.0,
		}

	// ── MikroTik RouterOS v7 ─────────────────────────────────────────────────
	case "MikroTik RouterOS v7":
		return VendorOIDs{
			CPULoad:   "1.3.6.1.4.1.14988.1.1.3.1.0",
			FreeMem:   "1.3.6.1.4.1.14988.1.1.3.2.0",
			TotalMem:  "1.3.6.1.4.1.14988.1.1.3.3.0",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// v7 index shifted by one vs v6
			RxPower:  "1.3.6.1.4.1.14988.1.1.19.1.1.4.%d",
			TxPower:  "1.3.6.1.4.1.14988.1.1.19.1.1.5.%d",
			TxBias:   "",
			OptScale: 100.0,
		}

	// ── Nokia / SROS ─────────────────────────────────────────────────────────
	case "Nokia / SROS":
		return VendorOIDs{
			// tmnxCpmCpuMonStat5MinAvgUtil (card/cpu scalar)
			CPULoad:   "1.3.6.1.4.1.6527.3.1.2.1.1.2.1.9.1.1",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// tmnxPhysicalPortDDMRxOpticalPower (port index)
			RxPower:  "1.3.6.1.4.1.6527.3.1.2.2.4.29.1.16.%d",
			TxPower:  "1.3.6.1.4.1.6527.3.1.2.2.4.29.1.14.%d",
			TxBias:   "1.3.6.1.4.1.6527.3.1.2.2.4.29.1.12.%d",
			OptScale: 100.0,
		}

	// ── Arista EOS ───────────────────────────────────────────────────────────
	case "Arista":
		return VendorOIDs{
			// aristaCpuBusyPercent (last 5 min average via HOST-RESOURCES fallback)
			CPULoad:   "1.3.6.1.2.1.25.3.3.1.2.1",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// aristaTransceiverRxOpticalPowerInstantDb (entPhysicalIndex)
			RxPower:  "1.3.6.1.4.1.30065.3.30.1.4.1.1.1.%d",
			TxPower:  "1.3.6.1.4.1.30065.3.30.1.4.1.1.4.%d",
			TxBias:   "1.3.6.1.4.1.30065.3.30.1.4.1.1.7.%d",
			OptScale: 1000.0,
		}

	// ── Fortinet (FortiGate) ──────────────────────────────────────────────────
	case "Fortinet":
		return VendorOIDs{
			// fgSysInfo → fgSysCpuUsage (1-min avg)
			CPULoad:   "1.3.6.1.4.1.12356.101.4.1.3.0",
			// fgSysMemUsage (percent)
			FreeMem:  "1.3.6.1.4.1.12356.101.4.1.5.0",
			TotalMem: "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// No vendor DOM OID – use standard IF-MIB only
			RxPower:  "",
			TxPower:  "",
			TxBias:   "",
			OptScale: 100.0,
		}

	// ── Palo Alto (PAN-OS) ────────────────────────────────────────────────────
	case "Palo Alto":
		return VendorOIDs{
			// panCPULoadAverageMIB (1 min)
			CPULoad:   "1.3.6.1.4.1.25461.2.1.2.1.3.0",
			FreeMem:   "1.3.6.1.4.1.25461.2.1.2.1.5.0", // panMemAvail
			TotalMem:  "1.3.6.1.4.1.25461.2.1.2.1.6.0", // panMemTotal (PAN-OS 9+)
			SysUptime: "1.3.6.1.2.1.1.3.0",
			RxPower:  "",
			TxPower:  "",
			TxBias:   "",
			OptScale: 100.0,
		}

	// ── ZTE ───────────────────────────────────────────────────────────────────
	case "ZTE":
		return VendorOIDs{
			CPULoad:   "1.3.6.1.4.1.3902.1082.500.10.2.1.0", // zxrCpuUsage
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// zxr10IfOptxRxPower
			RxPower:  "1.3.6.1.4.1.3902.1082.500.10.20.2.1.6.%d",
			TxPower:  "1.3.6.1.4.1.3902.1082.500.10.20.2.1.5.%d",
			TxBias:   "",
			OptScale: 1000.0,
		}

	// ── H3C ───────────────────────────────────────────────────────────────────
	case "H3C":
		return VendorOIDs{
			// hh3cEntityCpuUsage
			CPULoad:   "1.3.6.1.4.1.25506.2.6.1.1.1.1.6.%d",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			// hh3cTransceiverRxPower
			RxPower:  "1.3.6.1.4.1.25506.2.70.1.1.1.26.%d",
			TxPower:  "1.3.6.1.4.1.25506.2.70.1.1.1.27.%d",
			TxBias:   "1.3.6.1.4.1.25506.2.70.1.1.1.24.%d",
			OptScale: 100.0,
		}

	// ── Extreme Networks ─────────────────────────────────────────────────────
	case "Extreme Networks":
		return VendorOIDs{
			// extremeCurrentTemperature / use HOST-RESOURCES for CPU
			CPULoad:   "1.3.6.1.2.1.25.3.3.1.2.1",
			FreeMem:   "",
			TotalMem:  "",
			SysUptime: "1.3.6.1.2.1.1.3.0",
			RxPower:   "", // EXOS DOM via SSH/XML not SNMP
			TxPower:   "",
			TxBias:    "",
			OptScale:  100.0,
		}

	// ── VyOS / DANOS / TP-Link / Generic ─────────────────────────────────────
	// All software routers or basic SMB gear — standard HOST-RESOURCES + IF-MIB
	default:
		return VendorOIDs{
			CPULoad:   "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad
			FreeMem:   "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageFree (RAM entry)
			TotalMem:  "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize
			SysUptime: "1.3.6.1.2.1.1.3.0",
			RxPower:   "",
			TxPower:   "",
			TxBias:    "",
			OptScale:  100.0,
		}
	}
}

// opticalOIDs returns the resolved RxPower / TxPower / TxBias OIDs for a given
// vendor and interface index.  Returns empty strings when the vendor has no DOM support.
func opticalOIDs(vendor string, idx int) (rx, tx, bias string) {
	v := vendorOIDs(vendor)
	if v.RxPower != "" {
		rx = fmt.Sprintf(v.RxPower, idx)
	}
	if v.TxPower != "" {
		tx = fmt.Sprintf(v.TxPower, idx)
	}
	if v.TxBias != "" {
		bias = fmt.Sprintf(v.TxBias, idx)
	}
	return
}
