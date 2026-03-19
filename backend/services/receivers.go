package services

import (
	"context"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// AlertDispatch is set by main() to workers.AlertChannel.
// Typed as chan models.AlertJob (defined in models, imported by both packages)
// so that services does NOT need to import workers – which would be circular.
var AlertDispatch chan models.AlertJob

// ────────────────────────────────────────────────────────────────────────────
// RFC 3164/5424 Syslog Severity & Facility maps
// ────────────────────────────────────────────────────────────────────────────

var severityNames = []string{
	"EMERGENCY", "ALERT", "CRITICAL", "ERROR", "WARNING", "NOTICE", "INFO", "DEBUG",
}

var facilityNames = []string{
	"kernel", "user", "mail", "daemon", "auth", "syslog", "lpr", "news",
	"uucp", "cron", "security", "ftpd", "ntp", "audit", "alert", "clock",
	"local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7",
}

// parseSyslogPRI extracts PRI, severity, facility, and the remaining message per RFC 3164.
// PRI field format: <{facility*8 + severity}>
// Returns severity name, facility name, and the rest of the message string.
func parseSyslogPRI(msg string) (severityStr, facilityStr, rest string) {
	severityStr = "INFO"
	facilityStr = "local7"
	rest = msg

	if len(msg) > 3 && msg[0] == '<' {
		end := strings.Index(msg, ">")
		if end > 0 && end <= 5 {
			pri, err := strconv.Atoi(msg[1:end])
			if err == nil {
				sev := pri % 8
				fac := pri / 8

				if sev < len(severityNames) {
					severityStr = severityNames[sev]
				}
				if fac < len(facilityNames) {
					facilityStr = facilityNames[fac]
				}
				rest = msg[end+1:]
			}
		}
	}
	return
}

// alertSeverityThreshold returns true when severity is EMERGENCY, ALERT, CRITICAL, or ERROR.
func alertSeverityThreshold(sev string) bool {
	return sev == "EMERGENCY" || sev == "ALERT" || sev == "CRITICAL" || sev == "ERROR"
}

// ────────────────────────────────────────────────────────────────────────────
// UDP Listeners
// ────────────────────────────────────────────────────────────────────────────

func StartSyslogListener() {
	addr := net.UDPAddr{
		Port: 1514,
		IP:   net.ParseIP("0.0.0.0"),
	}

	conn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		log.Println("[Syslog] Failed to start UDP Listener:", err)
		return
	}
	defer conn.Close()

	log.Println("[Syslog] Listener started on UDP 1514")

	buf := make([]byte, 4096)
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Println("[Syslog] Error reading from UDP:", err)
			continue
		}

		message := string(buf[:n])
		go processLog(remoteAddr.IP.String(), message, "syslog")
	}
}

func StartSNMPTrapListener() {
	addr := net.UDPAddr{
		Port: 1162,
		IP:   net.ParseIP("0.0.0.0"),
	}

	conn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		log.Println("[SNMPTrap] Failed to start UDP Listener:", err)
		return
	}
	defer conn.Close()

	log.Println("[SNMPTrap] Listener started on UDP 1162")

	buf := make([]byte, 4096)
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Println("[SNMPTrap] Error reading from UDP:", err)
			continue
		}

		raw := buf[:n]
		go processTrap(remoteAddr.IP.String(), raw)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Log / Trap Processing
// ────────────────────────────────────────────────────────────────────────────

func processLog(sourceIP, msg, logType string) {
	// 1. Identify device and tenant based on Source IP
	var device models.Device
	if err := database.DB.Where("ip = ?", sourceIP).First(&device).Error; err != nil {
		// Drop logs from unknown IPs for security
		return
	}

	// 2. RFC 3164 PRI parsing – extract severity and facility
	severity, facility, _ := parseSyslogPRI(msg)

	// 3. Store to ClickHouse
	if database.CH != nil {
		query := `INSERT INTO events_syslog (tenant_id, device_id, timestamp, severity, facility, message, type) VALUES (?, ?, ?, ?, ?, ?, ?)`
		err := database.CH.Exec(context.Background(), query,
			device.TenantID, device.ID, time.Now(), severity, facility, msg, logType)
		if err != nil {
			log.Println("[Syslog] Failed to insert event to ClickHouse:", err)
		}
	}

	// 4. Trigger alert for high-severity events (EMERGENCY/ALERT/CRITICAL/ERROR)
	if alertSeverityThreshold(severity) {
		alertMsg := fmt.Sprintf("🔴 <b>SYSLOG ALERT – %s</b>\nDevice: <b>%s</b> (%s)\nFacility: %s\nMessage: %s",
			severity, device.Name, device.IP, facility, strings.TrimSpace(msg))

		// Import via fully-qualified call to avoid circular import
		go dispatchAlert(device.TenantID, alertMsg)
	}
}

// processTrap handles raw SNMP trap UDP datagrams.
// G-4: Decodes BER-encoded PDU using gosnmp.Unmarshal, extracts trap OID and
// all varbinds, builds a human-readable message, and stores it in ClickHouse.
func processTrap(sourceIP string, raw []byte) {
	var device models.Device
	if err := database.DB.Where("ip = ?", sourceIP).First(&device).Error; err != nil {
		return // Drop traps from unregistered devices
	}

	// ── BER Decode ──────────────────────────────────────────────────────────
	pkt := &gosnmp.SnmpPacket{}
	var err error

	if pkt, err = gosnmp.Default.SnmpDecodePacket(raw); err != nil {
		// Fallback: store raw length if BER parse fails (malformed or SNMPv1)
		log.Printf("[SNMPTrap] BER decode failed from %s: %v", sourceIP, err)
		pkt = nil
	}

	// ── Build human-readable trap message ───────────────────────────────────
	trapMsg := ""
	trapOID := ""
	severity := "WARNING"

	if pkt != nil && (pkt.PDUType == gosnmp.SNMPv2Trap || pkt.PDUType == gosnmp.InformRequest) {
		var sb strings.Builder
		for _, v := range pkt.Variables {
			// snmpTrapOID.0 carries the trap identity
			if strings.HasSuffix(v.Name, ".1.3.6.1.6.3.1.1.4.1.0") {
				if oid, ok := v.Value.(string); ok {
					trapOID = oid
				}
				continue
			}
			sb.WriteString(fmt.Sprintf("%s=%v ", v.Name, v.Value))
		}
		if trapOID != "" {
			trapMsg = fmt.Sprintf("TRAP %s | %s", trapOID, strings.TrimSpace(sb.String()))
		} else {
			trapMsg = strings.TrimSpace(sb.String())
		}
		// Escalate severity for link-down / cold-start / warm-start OIDs
		switch {
		case strings.Contains(trapOID, "1.3.6.1.6.3.1.1.5.3"), // linkDown
			strings.Contains(trapOID, "1.3.6.1.6.3.1.1.5.1"), // coldStart
			strings.Contains(trapOID, "1.3.6.1.6.3.1.1.5.2"): // warmStart
			severity = "ERROR"
		}
	} else if pkt != nil && pkt.PDUType == gosnmp.Trap {
		// SNMPv1 Trap – GenericTrap field carries severity hint
		trapMsg = fmt.Sprintf("SNMPv1 TRAP generic=%d specific=%d enterprise=%s",
			pkt.GenericTrap, pkt.SpecificTrap, pkt.Enterprise)
		if pkt.GenericTrap == 0 || pkt.GenericTrap == 1 { // coldStart / warmStart
			severity = "ERROR"
		}
	} else {
		trapMsg = fmt.Sprintf("SNMP TRAP received – %d bytes (BER decode failed)", len(raw))
	}

	facility := "daemon"

	// ── Store to ClickHouse ──────────────────────────────────────────────────
	if database.CH != nil {
		q := `INSERT INTO events_syslog
			(tenant_id, device_id, timestamp, severity, facility, message, type)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		if err := database.CH.Exec(context.Background(), q,
			device.TenantID, device.ID, time.Now(), severity, facility, trapMsg, "trap"); err != nil {
			log.Println("[SNMPTrap] Failed to insert trap to ClickHouse:", err)
		}
	}

	// ── Alert on high-severity traps ─────────────────────────────────────────
	if alertSeverityThreshold(severity) {
		alertMsg := fmt.Sprintf("🔴 <b>SNMP TRAP – %s</b>\nDevice: <b>%s</b> (%s)\n%s",
			severity, device.Name, device.IP, trapMsg)
		go dispatchAlert(device.TenantID, alertMsg)
	}
}

// dispatchAlert pushes a high-severity event to the shared alert channel so
// the workers package can forward it to Telegram without an import cycle.
func dispatchAlert(tenantID uint, message string) {
	if AlertDispatch == nil {
		// Fallback: log only if channel not wired (e.g. unit tests).
		log.Printf("[Syslog] Alert channel not initialised – tenant %d: %s", tenantID, message)
		return
	}
	select {
	case AlertDispatch <- models.AlertJob{TenantID: tenantID, Message: message}:
	default:
		// Channel full – drop and warn rather than block the receiver goroutine.
		log.Printf("[Syslog] Alert channel full – dropped alert for tenant %d", tenantID)
	}
}
