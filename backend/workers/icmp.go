package workers

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/go-ping/ping"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// icmpSem limits concurrent ping goroutines.
// Default 200; override with ICMP_CONCURRENCY env variable.
var icmpSem = make(chan struct{}, icmpConcurrency())

func icmpConcurrency() int {
	if v := os.Getenv("ICMP_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 200
}

func StartICMPPoller() {
	log.Printf("Starting ICMP Poller (concurrency: %d)...", cap(icmpSem))
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		var devices []models.Device
		if err := database.DB.Find(&devices).Error; err != nil {
			log.Println("ICMP Poller failed to fetch devices:", err)
			continue
		}

		for _, dev := range devices {
			dev := dev
			icmpSem <- struct{}{} // acquire slot
			go func() {
				defer func() { <-icmpSem }() // release slot
				pingDevice(dev)
			}()
		}
	}
}

func pingDevice(dev models.Device) {
	pinger, err := ping.NewPinger(dev.IP)
	if err != nil {
		log.Printf("Cannot initialize pinger for %s: %v\n", dev.IP, err)
		return
	}
	pinger.Count = 3
	pinger.Timeout = time.Second * 3
	pinger.SetPrivileged(true) // Required for some OS

	err = pinger.Run()
	if err != nil {
		log.Printf("Ping failed for %s: %v\n", dev.IP, err)
		return
	}

	stats := pinger.Statistics()

	// Determine device status from ping result
	devStatus := "up"
	if stats.PacketLoss == 100 {
		devStatus = "down"
	}

	// Sync status + last_seen back to Postgres so the device list reflects reality
	database.DB.Model(&dev).Updates(map[string]interface{}{
		"status":    devStatus,
		"last_seen": time.Now(),
	})

	insertICMPMetric(dev.TenantID, dev.ID, float32(stats.AvgRtt.Milliseconds()), float32(stats.PacketLoss))
	checkAlerts(dev, "icmp", float32(stats.AvgRtt.Milliseconds()), float32(stats.PacketLoss))
}

func insertICMPMetric(tenantID, deviceID uint, latency, loss float32) {
	status := "UP"
	if loss == 100 {
		status = "DOWN"
	}
	
	query := `INSERT INTO metrics_icmp (tenant_id, device_id, timestamp, latency_ms, packet_loss_pct, status) VALUES (?, ?, ?, ?, ?, ?)`
	err := database.CH.Exec(context.Background(), query, tenantID, deviceID, time.Now(), latency, loss, status)
	if err != nil {
		log.Println("Failed to insert ClickHouse ICMP metric:", err)
	}
}
