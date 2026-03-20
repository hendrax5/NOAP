package workers

import (
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// LLDP-MIB (IEEE 802.1AB) OIDs
const (
	// lldpRemSysName        = "1.0.8802.1.1.2.1.4.1.1.9"   // remote system name
	lldpRemChassisID     = "1.0.8802.1.1.2.1.4.1.1.5" // remote chassis ID (MAC or string)
	lldpRemPortID        = "1.0.8802.1.1.2.1.4.1.1.7" // remote port ID
	lldpRemSysName       = "1.0.8802.1.1.2.1.4.1.1.9" // remote hostname
	lldpLocSysName       = "1.0.8802.1.1.2.1.3.3.0"   // local hostname
	lldpLocPortIDSubtype = "1.0.8802.1.1.2.1.3.7.1.2" // local port ID subtype
	lldpLocPortID_       = "1.0.8802.1.1.2.1.3.7.1.3" // local port ID
)

func StartTopologyPoller() {
	log.Println("Starting Topology Discovery Poller (LLDP-MIB)...")
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	discoverTopology()

	for range ticker.C {
		discoverTopology()
	}
}

func discoverTopology() {
	var devices []models.Device
	if err := database.DB.Find(&devices).Error; err != nil {
		log.Println("[LLDP] failed to load devices:", err)
		return
	}
	if len(devices) < 1 {
		return
	}

	// Build a map: IP -> Device for quick lookup by remote hostname/chassisID
	ipToDevice := map[string]models.Device{}
	nameToDevice := map[string]models.Device{}
	for _, d := range devices {
		ipToDevice[d.IP] = d
		nameToDevice[strings.ToLower(d.Name)] = d
	}

	// Remove stale LLDP-discovered links before rediscovery
	if err := database.DB.Where("protocol = ?", "LLDP").Delete(&models.Link{}).Error; err != nil {
		log.Println("[LLDP] delete old links:", err)
	}

	for _, dev := range devices {
		if dev.SNMPComm == "" {
			continue
		}
		go lldpWalk(dev, nameToDevice, ipToDevice)
	}
}

type lldpNeighbor struct {
	chassisID string
	sysName   string
	localPort string
	remPort   string
}

func lldpWalk(dev models.Device, nameToDevice, ipToDevice map[string]models.Device) {
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
		log.Printf("[LLDP] connect %s: %v", dev.IP, err)
		return
	}
	defer params.Conn.Close()

	// Map: timemarkIfIndex.neighborIdx -> neighbor
	neighbors := map[string]*lldpNeighbor{}

	ensureNeighbor := func(suffix string) *lldpNeighbor {
		if _, ok := neighbors[suffix]; !ok {
			neighbors[suffix] = &lldpNeighbor{}
		}
		return neighbors[suffix]
	}

	pduString := func(pdu gosnmp.SnmpPDU) string {
		switch v := pdu.Value.(type) {
		case string:
			return v
		case []byte:
			// Try as printable string first
			isPrint := true
			for _, b := range v {
				if b < 0x20 || b > 0x7e {
					isPrint = false
					break
				}
			}
			if isPrint {
				return string(v)
			}
			// Format as MAC
			hexParts := make([]string, len(v))
			for i, b := range v {
				hexParts[i] = fmt.Sprintf("%02x", b)
			}
			return strings.Join(hexParts, ":")
		}
		return fmt.Sprintf("%v", pdu.Value)
	}

	// Walk remote chassis ID
	_ = params.Walk(lldpRemChassisID, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+lldpRemChassisID+".")
		ensureNeighbor(suffix).chassisID = pduString(pdu)
		return nil
	})

	// Walk remote system name
	_ = params.Walk(lldpRemSysName, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+lldpRemSysName+".")
		ensureNeighbor(suffix).sysName = pduString(pdu)
		return nil
	})

	// Walk remote port ID
	_ = params.Walk(lldpRemPortID, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+lldpRemPortID+".")
		ensureNeighbor(suffix).remPort = pduString(pdu)
		return nil
	})

	// Walk local port IDs — suffix is timemark.ifIndex, use ifIndex as local port
	localPorts := map[string]string{} // ifIndex -> portID
	_ = params.Walk(lldpLocPortID_, func(pdu gosnmp.SnmpPDU) error {
		// OID: ...lldpLocPortID.ifIndex
		parts := strings.Split(pdu.Name, ".")
		if len(parts) > 0 {
			idx := parts[len(parts)-1]
			localPorts[idx] = pduString(pdu)
		}
		return nil
	})

	// Match each neighbor entry's ifIndex to local port:
	for suffix, nbr := range neighbors {
		// suffix = timemark.ifIndex.neighborIdx — local port = second segment
		segs := strings.Split(suffix, ".")
		var localPort string
		if len(segs) >= 2 {
			localPort = localPorts[segs[1]]
			if localPort == "" {
				localPort = "ifIndex-" + segs[1]
			}
		}
		nbr.localPort = localPort

		// Resolve neighbor to a known device
		var targetDev *models.Device

		// Try sysName match first
		if nbr.sysName != "" {
			if d, ok := nameToDevice[strings.ToLower(nbr.sysName)]; ok {
				targetDev = &d
			}
		}
		// Fallback: chassisID may be an IP
		if targetDev == nil && nbr.chassisID != "" {
			if d, ok := ipToDevice[nbr.chassisID]; ok {
				targetDev = &d
			}
		}

		if targetDev == nil {
			log.Printf("[LLDP] %s: neighbor %q (chassis=%q) not in DB — skipping link",
				dev.Name, nbr.sysName, nbr.chassisID)
			continue
		}

		if targetDev.ID == dev.ID {
			continue // self-loop
		}

		link := models.Link{
			TenantID:       dev.TenantID,
			SourceDeviceID: dev.ID,
			TargetDeviceID: targetDev.ID,
			SourcePort:     nbr.localPort,
			TargetPort:     nbr.remPort,
			Protocol:       "LLDP",
		}
		if err := database.DB.Create(&link).Error; err != nil {
			log.Printf("[LLDP] create link %s→%s: %v", dev.Name, targetDev.Name, err)
		} else {
			log.Printf("[LLDP] discovered: %s(%s) → %s(%s)",
				dev.Name, nbr.localPort, targetDev.Name, nbr.remPort)
		}
	}
}
