package services

import (
	"log"
	"strconv"
	"strings"

	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

func parseOIDSuffix(oid string) int {
	parts := strings.Split(oid, ".")
	if len(parts) == 0 {
		return 0
	}
	idx, _ := strconv.Atoi(parts[len(parts)-1])
	return idx
}

// RunInterfaceDiscovery performs an SNMP walk of IF-MIB on the given device
// and upserts discovered interfaces into device_interfaces.
// Returns the number of interfaces discovered.
func RunInterfaceDiscovery(params *gosnmp.GoSNMP, dev models.Device) int {
	interfaces := make(map[int]*models.DeviceInterface)

	// Walk ifDescr (Name)
	params.Walk(".1.3.6.1.2.1.2.2.1.2", func(pdu gosnmp.SnmpPDU) error {
		idx := parseOIDSuffix(pdu.Name)
		if interfaces[idx] == nil {
			interfaces[idx] = &models.DeviceInterface{DeviceID: dev.ID, IfIndex: idx}
		}
		if pdu.Value != nil {
			interfaces[idx].Name = string(pdu.Value.([]byte))
		}
		return nil
	})

	// Walk ifAlias (Description)
	params.Walk(".1.3.6.1.2.1.31.1.1.1.18", func(pdu gosnmp.SnmpPDU) error {
		idx := parseOIDSuffix(pdu.Name)
		if interfaces[idx] != nil && pdu.Value != nil {
			interfaces[idx].Description = string(pdu.Value.([]byte))
		}
		return nil
	})

	// Walk ifOperStatus (Status)
	params.Walk(".1.3.6.1.2.1.2.2.1.8", func(pdu gosnmp.SnmpPDU) error {
		idx := parseOIDSuffix(pdu.Name)
		if interfaces[idx] != nil && pdu.Value != nil {
			statusInt := gosnmp.ToBigInt(pdu.Value).Int64()
			status := "unknown"
			if statusInt == 1 {
				status = "up"
			} else if statusInt == 2 {
				status = "down"
			}
			interfaces[idx].Status = status
		}
		return nil
	})

	// Upsert into DB
	discoveredCount := 0
	for _, intf := range interfaces {
		if intf.Name != "" {
			var existing models.DeviceInterface
			if err := database.DB.Where("device_id = ? AND if_index = ?", dev.ID, intf.IfIndex).First(&existing).Error; err == nil {
				// Update existing — preserve IsMonitored flag
				existing.Name = intf.Name
				existing.Description = intf.Description
				existing.Status = intf.Status
				database.DB.Save(&existing)
			} else {
				// Create new
				intf.IsMonitored = false
				database.DB.Create(intf)
			}
			discoveredCount++
		}
	}

	log.Printf("Auto-discovery for device %s (%s): found %d interfaces", dev.Name, dev.IP, discoveredCount)
	return discoveredCount
}
