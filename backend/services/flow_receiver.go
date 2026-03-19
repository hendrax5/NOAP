package services

import (
	"encoding/binary"
	"fmt"
	"log"
	"math/rand"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// ─────────────────────────────────────────────────────────────────────────────
// NetFlow v5 header & record layout (RFC 3954 / Cisco spec)
// ─────────────────────────────────────────────────────────────────────────────

const (
	nfv5HeaderLen = 24
	nfv5RecordLen = 48
)

type nfv5Header struct {
	Version        uint16
	Count          uint16
	SysUptime      uint32
	UnixSecs       uint32
	UnixNsecs      uint32
	FlowSequence   uint32
	EngineType     uint8
	EngineID       uint8
	SamplingMode   uint16
}

type nfv5Record struct {
	SrcIP    uint32
	DstIP    uint32
	NextHop  uint32
	InIface  uint16
	OutIface uint16
	Packets  uint32
	Bytes    uint32
	First    uint32
	Last     uint32
	SrcPort  uint16
	DstPort  uint16
	Pad      uint8
	Flags    uint8
	Proto    uint8
	ToS      uint8
	SrcAS    uint16
	DstAS    uint16
	SrcMask  uint8
	DstMask  uint8
	Pad2     uint16
}

// protoName converts a IP protocol number to a human-readable name.
func protoName(p uint8) string {
	switch p {
	case 1:
		return "ICMP"
	case 6:
		return "TCP"
	case 17:
		return "UDP"
	default:
		return fmt.Sprintf("PROTO%d", p)
	}
}

// uint32ToIP converts a packed uint32 to dotted-decimal notation.
func uint32ToIP(n uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", n>>24, (n>>16)&0xFF, (n>>8)&0xFF, n&0xFF)
}

// ─────────────────────────────────────────────────────────────────────────────
// StartFlowReceiver binds to UDP :2055 and parses NetFlow v5 datagrams.
//
// Set MOCK_FLOWS=true (env) to fall back to synthetic data generation —
// useful when no physical router is available in development.
// ─────────────────────────────────────────────────────────────────────────────

func StartFlowReceiver() {
	if os.Getenv("MOCK_FLOWS") == "true" {
		log.Println("[FlowReceiver] MOCK_FLOWS=true — running synthetic flow generator")
		startMockFlowReceiver()
		return
	}

	port := os.Getenv("NETFLOW_PORT")
	if port == "" {
		port = "2055"
	}

	conn, err := net.ListenPacket("udp", ":"+port)
	if err != nil {
		log.Printf("[FlowReceiver] Cannot bind UDP :%s — falling back to MOCK_FLOWS: %v", port, err)
		startMockFlowReceiver()
		return
	}
	log.Printf("[FlowReceiver] Listening for NetFlow v5 on UDP :%s", port)
	go receiveFlows(conn)
}

// receiveFlows is the long-running UDP read loop.
func receiveFlows(conn net.PacketConn) {
	defer conn.Close()

	buf := make([]byte, 65535)
	for {
		n, src, err := conn.ReadFrom(buf)
		if err != nil {
			log.Printf("[FlowReceiver] ReadFrom error: %v", err)
			continue
		}
		data := buf[:n]
		if err := parseNetFlowV5(data, src.String()); err != nil {
			log.Printf("[FlowReceiver] Parse error from %s: %v", src, err)
		}
	}
}

// parseNetFlowV5 validates and decodes a NetFlow v5 datagram, then writes
// each flow record into ClickHouse.
func parseNetFlowV5(data []byte, srcAddr string) error {
	if len(data) < nfv5HeaderLen {
		return fmt.Errorf("packet too short (%d bytes)", len(data))
	}

	version := binary.BigEndian.Uint16(data[0:2])
	if version != 5 {
		return fmt.Errorf("unsupported NetFlow version %d (want 5)", version)
	}

	count := binary.BigEndian.Uint16(data[2:4])
	expected := int(nfv5HeaderLen) + int(count)*nfv5RecordLen
	if len(data) < expected {
		return fmt.Errorf("packet length %d < expected %d for %d records", len(data), expected, count)
	}

	log.Printf("[FlowReceiver] ✓ packet from %s — %d flow records", srcAddr, count)

	if FlowChan == nil {
		log.Printf("[FlowReceiver] ⚠ Batch writer not ready — dropping %d flows from %s", count, srcAddr)
		return nil
	}

	// Resolve the exporter device by IP so we can store tenant / device IDs.
	host, _, _ := net.SplitHostPort(srcAddr)
	var dev models.Device
	database.DB.Where("ip = ?", host).First(&dev)
	if dev.ID == 0 {
		log.Printf("[FlowReceiver] ⚠ exporter %s not registered as a Device in NOAP — add it in the Devices page", host)
		return nil
	}

	for i := 0; i < int(count); i++ {
		offset := nfv5HeaderLen + i*nfv5RecordLen
		rec := data[offset : offset+nfv5RecordLen]

		srcIP := uint32ToIP(binary.BigEndian.Uint32(rec[0:4]))
		dstIP := uint32ToIP(binary.BigEndian.Uint32(rec[4:8]))
		srcPort := binary.BigEndian.Uint16(rec[32:34])
		dstPort := binary.BigEndian.Uint16(rec[34:36])
		proto := protoName(rec[38])
		bytesVal := binary.BigEndian.Uint32(rec[16:20])
		pkts := binary.BigEndian.Uint32(rec[12:16])

		// P4 enrichment
		srcASN := LookupASN(srcIP)
		dstASN := LookupASN(dstIP)
		app := MapApplication(dstPort, srcPort, proto)

		// GeoIP enrichment (Phase 2)
		srcGeo := LookupGeoIP(srcIP)
		dstGeo := LookupGeoIP(dstIP)

		EnqueueFlow(FlowRow{
			TenantID:   dev.TenantID,
			DeviceID:   dev.ID,
			Timestamp:  time.Now(),
			SrcIP:      srcIP,
			DstIP:      dstIP,
			SrcPort:    srcPort,
			DstPort:    dstPort,
			Protocol:   proto,
			Bytes:      uint64(bytesVal),
			Packets:    uint64(pkts),
			SrcASN:     srcASN.ASN,
			DstASN:     dstASN.ASN,
			SrcASNName: srcASN.Name,
			DstASNName: dstASN.Name,
			App:        app,
			SrcCountry: srcGeo.Country,
			DstCountry: dstGeo.Country,
			SrcCity:    srcGeo.City,
			DstCity:    dstGeo.City,
			SrcLat:     srcGeo.Lat,
			SrcLon:     srcGeo.Lon,
			DstLat:     dstGeo.Lat,
			DstLon:     dstGeo.Lon,
		})
	}
	log.Printf("[FlowReceiver] ✓ inserted %d flows from device %s (id=%d)", count, host, dev.ID)
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic fallback — generates plausible flow data so dashboards work
// without a real NetFlow exporter in development / demo environments.
// ─────────────────────────────────────────────────────────────────────────────

func startMockFlowReceiver() {
	log.Println("[FlowReceiver] Starting synthetic flow generator (2 s tick)")

	intervalStr := os.Getenv("MOCK_FLOW_INTERVAL_SECS")
	intervalSec := 2
	if v, err := strconv.Atoi(intervalStr); err == nil && v > 0 {
		intervalSec = v
	}

	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	go func() {
		defer ticker.Stop()

		// Mix of private + public IPs so ASN enrichment produces variety
		ips := []string{
			"10.0.0.1", "10.0.0.2",
			"192.168.1.100", "192.168.1.150",
			"8.8.8.8", "8.8.4.4",   // Google
			"1.1.1.1", "1.0.0.1",   // Cloudflare
			"52.20.0.1",             // AWS
			"13.64.0.1",             // Azure
			"157.240.0.1",           // Meta
		}
		// dst ports that map to well-known apps
		dstPorts := []uint16{443, 80, 53, 22, 3306, 5432, 25, 3389, 443, 443, 443, 8080}
		protocols := []string{"TCP", "TCP", "TCP", "UDP", "ICMP"}

		for range ticker.C {
			if FlowChan == nil {
				continue
			}

			var devices []models.Device
			database.DB.Limit(5).Find(&devices)
			if len(devices) == 0 {
				continue
			}

			dev := devices[rand.Intn(len(devices))]
			batchSize := rand.Intn(10) + 5

			for i := 0; i < batchSize; i++ {
				src := ips[rand.Intn(len(ips))]
				dst := ips[rand.Intn(len(ips))]
				if src == dst {
					dst = "8.8.4.4"
				}
				dstPort := dstPorts[rand.Intn(len(dstPorts))]
				proto := protocols[rand.Intn(len(protocols))]

				// Enrich with ASN + application
				srcASN := LookupASN(src)
				dstASN := LookupASN(dst)
				app := MapApplication(dstPort, uint16(rand.Intn(65000)+1024), proto)

				// GeoIP enrichment (Phase 2)
				srcGeo := LookupGeoIP(src)
				dstGeo := LookupGeoIP(dst)

				EnqueueFlow(FlowRow{
					TenantID:   dev.TenantID,
					DeviceID:   dev.ID,
					Timestamp:  time.Now(),
					SrcIP:      src,
					DstIP:      dst,
					SrcPort:    uint16(rand.Intn(65000)),
					DstPort:    dstPort,
					Protocol:   proto,
					Bytes:      uint64(rand.Intn(5000000) + 500),
					Packets:    uint64(rand.Intn(5000) + 10),
					SrcASN:     srcASN.ASN,
					DstASN:     dstASN.ASN,
					SrcASNName: srcASN.Name,
					DstASNName: dstASN.Name,
					App:        app,
					SrcCountry: srcGeo.Country,
					DstCountry: dstGeo.Country,
					SrcCity:    srcGeo.City,
					DstCity:    dstGeo.City,
					SrcLat:     srcGeo.Lat,
					SrcLon:     srcGeo.Lon,
					DstLat:     dstGeo.Lat,
					DstLon:     dstGeo.Lon,
				})
			}
		}
	}()
}
