package workers

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// MPLS-TE-STD-MIB OIDs
const (
	// mplsTunnelName        = "1.3.6.1.2.1.10.166.3.2.2.1.3" // string, tunnelIndex as suffix
	mplsTunnelOperStatus = "1.3.6.1.2.1.10.166.3.2.2.1.10" // INTEGER: up(1), down(2)
	mplsTunnelARHopType  = "1.3.6.1.2.1.10.166.3.2.2.1.3"  // tunnel name closest proxy
	// Active path via mplsTunnelARHopTable – we use mplsTunnelAdminStatus as simple proxy:
	mplsTunnelAdminStatus = "1.3.6.1.2.1.10.166.3.2.2.1.9" // INTEGER: up(1)
)

func StartMPLSPoller() {
	log.Println("Starting MPLS LSP Poller (MPLS-TE-STD-MIB)...")
	ticker := time.NewTicker(3 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		var devices []models.Device
		database.DB.Find(&devices)
		for _, dev := range devices {
			go pollMPLS(dev)
		}
	}
}

func pollMPLS(dev models.Device) {
	if dev.SNMPComm == "" {
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
		log.Printf("[MPLS] connect %s: %v", dev.IP, err)
		return
	}
	defer params.Conn.Close()

	// Map: tunnelIndex -> { name, operStatus }
	type lspEntry struct {
		name   string
		oper   string
		active string
	}
	lsps := map[string]*lspEntry{}

	// Walk tunnel names (OID .3 is mplsTunnelName)
	nameOID := "1.3.6.1.2.1.10.166.3.2.2.1.3"
	_ = params.Walk(nameOID, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+nameOID+".")
		name := ""
		switch v := pdu.Value.(type) {
		case string:
			name = v
		case []byte:
			name = string(v)
		}
		if name == "" {
			name = fmt.Sprintf("LSP-%s", suffix)
		}
		if _, ok := lsps[suffix]; !ok {
			lsps[suffix] = &lspEntry{}
		}
		lsps[suffix].name = name
		return nil
	})

	// Walk oper status
	_ = params.Walk(mplsTunnelOperStatus, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+mplsTunnelOperStatus+".")
		operInt := 2 // default down
		switch v := pdu.Value.(type) {
		case int:
			operInt = v
		case uint:
			operInt = int(v)
		}
		state := "DOWN"
		if operInt == 1 {
			state = "UP"
		}
		if _, ok := lsps[suffix]; !ok {
			lsps[suffix] = &lspEntry{}
		}
		lsps[suffix].oper = state
		return nil
	})

	// Walk admin status to infer path (primary if admin=up and oper=up, secondary otherwise)
	_ = params.Walk(mplsTunnelAdminStatus, func(pdu gosnmp.SnmpPDU) error {
		suffix := strings.TrimPrefix(pdu.Name, "."+mplsTunnelAdminStatus+".")
		adminInt := 0
		switch v := pdu.Value.(type) {
		case int:
			adminInt = v
		case uint:
			adminInt = int(v)
		}
		if e, ok := lsps[suffix]; ok {
			if adminInt == 1 && e.oper == "UP" {
				e.active = "PRIMARY"
			} else {
				e.active = "SECONDARY_BACKUP"
			}
		}
		return nil
	})

	if len(lsps) == 0 {
		log.Printf("[MPLS] no tunnels found on %s", dev.IP)
		return
	}

	for _, e := range lsps {
		if e.name == "" {
			continue
		}
		if e.oper == "DOWN" {
			go DispatchTelegramAlert(dev.TenantID,
				fmt.Sprintf("⚠️ MPLS LSP DOWN: %s on device %s", e.name, dev.Name))
		} else if e.active == "SECONDARY_BACKUP" {
			go DispatchTelegramAlert(dev.TenantID,
				fmt.Sprintf("⚠️ MPLS LSP PATH SWITCH: %s shifted to SECONDARY on device %s", e.name, dev.Name))
		}

		if database.CH != nil {
			q := `INSERT INTO metrics_mpls_lsp (tenant_id, device_id, timestamp, lsp_name, state, active_path) VALUES (?, ?, ?, ?, ?, ?)`
			if err := database.CH.Exec(context.Background(), q, dev.TenantID, dev.ID, time.Now(), e.name, e.oper, e.active); err != nil {
				log.Println("[MPLS] CH insert:", err)
			}
		}
	}
}
