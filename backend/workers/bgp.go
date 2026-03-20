package workers

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// BGP4-MIB (RFC 4273) OIDs
const (
	bgpPeerStateOID          = "1.3.6.1.2.1.15.3.1.2"  // bgpPeerState — INTEGER 1..6
	bgpPeerAdminStatusOID    = "1.3.6.1.2.1.15.3.1.3"  // bgpPeerAdminStatus
	bgpPeerFsmEstabTimeOID   = "1.3.6.1.2.1.15.3.1.16" // seconds since established
	bgpPeerInUpdateElapsedOID = "1.3.6.1.2.1.15.3.1.24" // bgpPeerInUpdateElapsedTime (fallback uptime)
	bgpPeerPrefixesReceivedOID = "1.3.6.1.4.1.9.9.187.1.2.4.1.1" // Cisco-BGP4-MIB bgpPeerPrefixesReceived
	bgpPeerPrefixesAdvertisedOID = "1.3.6.1.4.1.9.9.187.1.2.4.1.4" // Cisco-BGP4-MIB bgpPeerPrefixesAdvertised
)

// bgpStateString converts RFC 4271 FSM integer to string.
func bgpStateString(s int) string {
	states := map[int]string{
		1: "IDLE",
		2: "CONNECT",
		3: "ACTIVE",
		4: "OPENSENT",
		5: "OPENCONFIRM",
		6: "ESTABLISHED",
	}
	if st, ok := states[s]; ok {
		return st
	}
	return fmt.Sprintf("UNKNOWN(%d)", s)
}

// extractPeerIP extracts the last 4 octets of an OID suffix as a dotted IP.
// Example: ".1.3.6.1.2.1.15.3.1.2.192.168.100.1" → "192.168.100.1"
func extractPeerIP(fullOID, baseOID string) string {
	suffix := strings.TrimPrefix(fullOID, "."+baseOID+".")
	parts := strings.Split(suffix, ".")
	if len(parts) >= 4 {
		return strings.Join(parts[len(parts)-4:], ".")
	}
	return suffix
}

func StartBGPPoller() {
	log.Println("Starting BGP Peer Poller (BGP4-MIB)...")
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		var devices []models.Device
		database.DB.Find(&devices)
		for _, dev := range devices {
			go pollBGP(dev)
		}
	}
}

func pollBGP(dev models.Device) {
	if dev.SNMPComm == "" {
		log.Printf("[BGP] skipping %s: no community string", dev.IP)
		return
	}

	params := &gosnmp.GoSNMP{
		Target:    dev.IP,
		Port:      161,
		Community: dev.SNMPComm,
		Version:   gosnmp.Version2c,
		Timeout:   5 * time.Second,
		Retries:   1,
		Logger:    gosnmp.NewLogger(log.New(io.Discard, "", 0)),
	}
	if err := params.Connect(); err != nil {
		log.Printf("[BGP] connect %s: %v", dev.IP, err)
		return
	}
	defer params.Conn.Close()

	type peerEntry struct {
		state               int
		fsmEstabTime        uint32
		prefixesReceived    uint32
		prefixesAdvertised  uint32
		description         string
	}
	peers := map[string]*peerEntry{}

	// Walk bgpPeerState — primary: extracts peer IP + state
	if err := params.Walk(bgpPeerStateOID, func(pdu gosnmp.SnmpPDU) error {
		peerIP := extractPeerIP(pdu.Name, bgpPeerStateOID)
		stateVal := 1
		switch v := pdu.Value.(type) {
		case int:
			stateVal = v
		case uint:
			stateVal = int(v)
		case uint64:
			stateVal = int(v)
		}
		if _, ok := peers[peerIP]; !ok {
			peers[peerIP] = &peerEntry{}
		}
		peers[peerIP].state = stateVal
		return nil
	}); err != nil {
		log.Printf("[BGP] Walk %s failed: %v", dev.IP, err)
		return
	}

	// Walk bgpPeerFsmEstablishedTime for uptime
	_ = params.Walk(bgpPeerFsmEstabTimeOID, func(pdu gosnmp.SnmpPDU) error {
		peerIP := extractPeerIP(pdu.Name, bgpPeerFsmEstabTimeOID)
		var val uint32
		switch v := pdu.Value.(type) {
		case uint:
			val = uint32(v)
		case uint32:
			val = v
		case uint64:
			val = uint32(v)
		}
		if e, ok := peers[peerIP]; ok {
			e.fsmEstabTime = val
		}
		return nil
	})

	// Walk Cisco-BGP4-MIB cbgpPeerPrefixesAccepted — real prefix count received per peer.
	// Optional: many non-Cisco devices won't respond; walk will simply return 0 rows.
	_ = params.Walk(bgpPeerPrefixesReceivedOID, func(pdu gosnmp.SnmpPDU) error {
		peerIP := extractPeerIP(pdu.Name, bgpPeerPrefixesReceivedOID)
		var val uint32
		switch v := pdu.Value.(type) {
		case uint:
			val = uint32(v)
		case uint32:
			val = v
		case uint64:
			val = uint32(v)
		}
		if e, ok := peers[peerIP]; ok {
			e.prefixesReceived = val
		}
		return nil
	})

	// Walk Cisco-BGP4-MIB cbgpPeerPrefixesAdvertised — prefixes sent to peer.
	_ = params.Walk(bgpPeerPrefixesAdvertisedOID, func(pdu gosnmp.SnmpPDU) error {
		peerIP := extractPeerIP(pdu.Name, bgpPeerPrefixesAdvertisedOID)
		var val uint32
		switch v := pdu.Value.(type) {
		case uint:
			val = uint32(v)
		case uint32:
			val = v
		case uint64:
			val = uint32(v)
		}
		if e, ok := peers[peerIP]; ok {
			e.prefixesAdvertised = val
		}
		return nil
	})

	if len(peers) == 0 {
		log.Printf("[BGP] no peers found on %s", dev.IP)
		return
	}

	// Enrich peers with descriptions from SSH (non-blocking best-effort).
	if sshDescriptions, sshErr := enrichBGPViaSSH(dev); sshErr == nil {
		for peerIP, desc := range sshDescriptions {
			if e, ok := peers[peerIP]; ok {
				e.description = desc
			}
		}
	} else {
		log.Printf("[BGP] SSH enrichment skipped on %s: %v", dev.IP, sshErr)
	}

	for peerIP, e := range peers {
		stateStr := bgpStateString(e.state)

		if e.state != 6 { // not ESTABLISHED
			go DispatchTelegramAlert(dev.TenantID,
				fmt.Sprintf("🚨 BGP SESSION %s: peer %s on device %s", stateStr, peerIP, dev.Name))
		}

		if database.CH != nil {
			q := `INSERT INTO metrics_bgp_peers
				(tenant_id, device_id, timestamp, peer_ip, state, uptime_seconds, prefixes_received, prefixes_advertised, description)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			if err := database.CH.Exec(context.Background(), q,
				dev.TenantID, dev.ID, time.Now(),
				peerIP, stateStr, e.fsmEstabTime, e.prefixesReceived, e.prefixesAdvertised, e.description,
			); err != nil {
				log.Println("[BGP] CH insert:", err)
			}
		}
	}

	// Store discrete BGP state-change events for audit log / alarming.
	go fetchAndStoreBGPLog(dev)
}

// bgpSSHResult holds per-peer data retrieved via SSH (currently: description).
type bgpSSHResult struct {
	Description string
}

// enrichBGPViaSSH connects to dev via SSH and returns a map of peerIP→description.
// Supports Huawei VRP (display bgp peer verbose) and MikroTik RouterOS.
// Returns an error if SSH is not configured; callers should treat this as soft-skip.
func enrichBGPViaSSH(dev models.Device) (map[string]string, error) {
	if dev.SSHUser == "" {
		return nil, fmt.Errorf("no SSH credentials configured")
	}

	result := make(map[string]string)

	switch dev.Vendor {
	case "Huawei", "H3C":
		out, err := sshShellExec(dev, "display bgp peer verbose")
		if err != nil {
			return nil, fmt.Errorf("Huawei SSH: %w", err)
		}
		parseHuaweiBGPPeerVerbose(out, result)

	case "MikroTik":
		out, err := sshShellExec(dev, "/routing bgp peer print detail")
		if err != nil {
			return nil, fmt.Errorf("MikroTik SSH: %w", err)
		}
		parseMikroTikBGPPeerDetail(out, result)

	default:
		// Cisco-style — attempt via shell exec as well.
		out, err := sshShellExec(dev, "show bgp neighbors")
		if err != nil {
			return nil, fmt.Errorf("Cisco SSH: %w", err)
		}
		parseCiscoBGPNeighbors(out, result)
	}

	return result, nil
}

// parseHuaweiBGPPeerVerbose parses Huawei VRP output of "display bgp peer verbose".
// Each peer block starts with a line like" BGP Peer is 10.0.0.1" and may have
// a "Description" field.
func parseHuaweiBGPPeerVerbose(out string, dest map[string]string) {
	var currentPeer string
	ipRe := regexp.MustCompile(`BGP Peer is (\d+\.\d+\.\d+\.\d+)`)
	descRe := regexp.MustCompile(`(?i)Description\s*:\s*(.+)`)
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if m := ipRe.FindStringSubmatch(line); len(m) == 2 {
			currentPeer = m[1]
			if _, exists := dest[currentPeer]; !exists {
				dest[currentPeer] = ""
			}
		}
		if currentPeer != "" {
			if m := descRe.FindStringSubmatch(line); len(m) == 2 {
				dest[currentPeer] = strings.TrimSpace(m[1])
			}
		}
	}
}

// parseMikroTikBGPPeerDetail parses RouterOS "/routing bgp peer print detail".
// Looks for lines like: remote-address=10.0.0.1 ... comment="ISP Upstream".
func parseMikroTikBGPPeerDetail(out string, dest map[string]string) {
	ipRe := regexp.MustCompile(`remote-address=(\d+\.\d+\.\d+\.\d+)`)
	commentRe := regexp.MustCompile(`comment="([^"]*)"|comment=([^\s]+)`)
	// RouterOS prints multi-line blocks; scan the whole output line by line
	// accumulating IP and comment that appear on the same logical line/block.
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		mIP := ipRe.FindStringSubmatch(line)
		if len(mIP) < 2 {
			continue
		}
		ip := mIP[1]
		desc := ""
		if mC := commentRe.FindStringSubmatch(line); len(mC) >= 2 {
			desc = strings.TrimSpace(mC[1])
			if desc == "" && len(mC) >= 3 {
				desc = strings.TrimSpace(mC[2])
			}
		}
		dest[ip] = desc
	}
}

// parseCiscoBGPNeighbors parses "show bgp neighbors" or "show ip bgp neighbors"
// output for IOS/IOS-XE/IOS-XR style output.
// Finds lines like:  BGP neighbor is 10.0.0.1 and Description: ISP link.
func parseCiscoBGPNeighbors(out string, dest map[string]string) {
	var currentPeer string
	ipRe := regexp.MustCompile(`BGP neighbor is (\d+\.\d+\.\d+\.\d+)`)
	descRe := regexp.MustCompile(`(?i)Description:\s*(.+)`)
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if m := ipRe.FindStringSubmatch(line); len(m) == 2 {
			currentPeer = m[1]
			if _, exists := dest[currentPeer]; !exists {
				dest[currentPeer] = ""
			}
		}
		if currentPeer != "" {
			if m := descRe.FindStringSubmatch(line); len(m) == 2 {
				dest[currentPeer] = strings.TrimSpace(m[1])
			}
		}
	}
}

// fetchAndStoreBGPLog compares the most-recent stored state of each peer (from CH)
// against the current state being polled and writes a row to metrics_bgp_events
// whenever a peer transitions between states. This provides a discrete audit log
// that the BGP history chart can use for annotations.
func fetchAndStoreBGPLog(dev models.Device) {
	if database.CH == nil {
		return
	}

	// Read the most-recently polled state for every peer on this device.
	rows, err := database.CH.Query(context.Background(),
		`SELECT peer_ip, argMax(state, timestamp) AS last_state
		 FROM metrics_bgp_peers
		 WHERE device_id = ?
		 GROUP BY peer_ip`, dev.ID)
	if err != nil {
		log.Printf("[BGP] fetchAndStoreBGPLog query failed for %s: %v", dev.IP, err)
		return
	}
	defer rows.Close()

	prevStates := make(map[string]string)
	for rows.Next() {
		var ip, state string
		if scanErr := rows.Scan(&ip, &state); scanErr == nil {
			prevStates[ip] = state
		}
	}

	// Re-read latest rows (already in CH from this poll cycle) to detect any changes.
	nowRows, err := database.CH.Query(context.Background(),
		`SELECT peer_ip, argMax(state, timestamp) AS cur_state
		 FROM metrics_bgp_peers
		 WHERE device_id = ? AND timestamp >= now() - INTERVAL 5 MINUTE
		 GROUP BY peer_ip`, dev.ID)
	if err != nil {
		return
	}
	defer nowRows.Close()

	for nowRows.Next() {
		var ip, curState string
		if scanErr := nowRows.Scan(&ip, &curState); scanErr != nil {
			continue
		}
		prev, known := prevStates[ip]
		if !known || prev == curState {
			continue
		}
		// State changed — write an event.
		q := `INSERT INTO metrics_bgp_events
			(tenant_id, device_id, timestamp, peer_ip, from_state, to_state, message)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		msg := fmt.Sprintf("BGP peer %s on %s: %s → %s", ip, dev.Name, prev, curState)
		_ = database.CH.Exec(context.Background(), q,
			dev.TenantID, dev.ID, time.Now(), ip, prev, curState, msg)
		log.Printf("[BGP] state change %s (%s→%s) on %s", ip, prev, curState, dev.Name)
	}
}
