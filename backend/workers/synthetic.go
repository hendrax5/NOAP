package workers

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

func StartSLAProbes() {
	log.Println("Starting SLA Synthetic Probes...")
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		var probes []models.Probe
		if err := database.DB.Find(&probes).Error; err != nil {
			log.Println("SLA Probes failed to fetch inventory:", err)
			continue
		}

		for _, p := range probes {
			go executeProbe(p)
		}
	}
}

func executeProbe(p models.Probe) {
	start := time.Now()
	var err error
	var rtt int64
	status := "UP"

	switch p.Type {
	case "HTTP":
		client := http.Client{Timeout: 5 * time.Second}
		resp, reqErr := client.Get(p.Target)
		if reqErr != nil || resp.StatusCode >= 400 {
			err = reqErr
			status = "DOWN"
		} else {
			resp.Body.Close()
		}
	case "TCP":
		conn, reqErr := net.DialTimeout("tcp", p.Target, 5*time.Second)
		if reqErr != nil {
			err = reqErr
			status = "DOWN"
		} else {
			conn.Close()
		}
	case "DNS":
		r := &net.Resolver{
			PreferGo: true,
			Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				return net.DialTimeout("udp", p.Target+":53", 5*time.Second)
			},
		}
		_, err = r.LookupHost(context.Background(), "google.com")
		if err != nil {
			status = "DOWN"
		}
	}

	rtt = time.Since(start).Milliseconds()

	// If connection hard failed, track as max timeout
	if err != nil {
		rtt = 5000
	}

	// Insert to ClickHouse
	query := `INSERT INTO metrics_sla (tenant_id, probe_id, timestamp, response_ms, status) VALUES (?, ?, ?, ?, ?)`
	// Soft fail if clickhouse is skipped
	if database.CH != nil {
		errCH := database.CH.Exec(context.Background(), query, p.TenantID, p.ID, time.Now(), float32(rtt), status)
		if errCH != nil {
			log.Println("Failed to insert ClickHouse SLA metric:", errCH)
		}
	}

	if status == "DOWN" {
		go DispatchTelegramAlert(p.TenantID, "🚨 SLA PROBE DOWN: "+p.Name+" ("+p.Target+")")
	}
}
