package services

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"

	// Blank-import the binary format driver so its init() registers with GoFlow2.
	_ "github.com/netsampler/goflow2/v3/format/binary"
	flowpb "github.com/netsampler/goflow2/v3/pb"
	"github.com/netsampler/goflow2/v3/pkg/goflow2/app"
	"github.com/netsampler/goflow2/v3/pkg/goflow2/config"
	"github.com/netsampler/goflow2/v3/transport"
	"google.golang.org/protobuf/proto"
)

// ─────────────────────────────────────────────────────────────────────────────
// ClickHouse TransportDriver — GoFlow2 v3 plugin that receives every decoded
// flow message as serialised protobuf and inserts it into ClickHouse.
// ─────────────────────────────────────────────────────────────────────────────

// chTransport implements GoFlow2 transport.TransportDriver.
type chTransport struct {
	mu         sync.Mutex
	deviceMap  map[string]*models.Device
	cacheUntil time.Time
}

// Register the driver at init so GoFlow2 can find it by name.
func init() {
	transport.RegisterTransportDriver("clickhouse", &chTransport{
		deviceMap:  make(map[string]*models.Device),
		cacheUntil: time.Time{},
	})
}

func (t *chTransport) Prepare() error { return nil }
func (t *chTransport) Init() error    { return nil }
func (t *chTransport) Close() error   { return nil }

// refreshDeviceCache loads device records from Postgres every 60 s so we can
// resolve exporter IPs to (tenant_id, device_id) without a DB hit per flow.
func (t *chTransport) refreshDeviceCache() {
	t.mu.Lock()
	defer t.mu.Unlock()

	if time.Now().Before(t.cacheUntil) {
		return
	}

	var devices []models.Device
	database.DB.Find(&devices)

	m := make(map[string]*models.Device, len(devices))
	for i := range devices {
		m[devices[i].IP] = &devices[i]
	}
	t.deviceMap = m
	t.cacheUntil = time.Now().Add(60 * time.Second)
}

func (t *chTransport) lookupDevice(ip string) *models.Device {
	t.refreshDeviceCache()
	t.mu.Lock()
	dev := t.deviceMap[ip]
	t.mu.Unlock()
	return dev
}

// Send is called by GoFlow2 for every decoded flow message.
// data contains the protobuf-serialised FlowMessage.
func (t *chTransport) Send(key, data []byte) error {
	if FlowChan == nil {
		return nil
	}

	// Deserialise the FlowMessage protobuf
	msg := &flowpb.FlowMessage{}
	if err := proto.Unmarshal(data, msg); err != nil {
		log.Printf("[FlowDecoder] protobuf unmarshal error: %v", err)
		return nil // don't kill the pipeline for bad data
	}

	// Resolve exporter IP → NOAP device
	exporterIP := net.IP(msg.SamplerAddress).String()
	dev := t.lookupDevice(exporterIP)
	if dev == nil {
		// Try stripping mapped-v4 prefix
		if parsed := net.ParseIP(exporterIP); parsed != nil {
			if v4 := parsed.To4(); v4 != nil {
				dev = t.lookupDevice(v4.String())
			}
		}
		if dev == nil {
			return nil // exporter not registered in NOAP
		}
	}

	srcIP := net.IP(msg.SrcAddr).String()
	dstIP := net.IP(msg.DstAddr).String()
	srcPort := uint16(msg.SrcPort)
	dstPort := uint16(msg.DstPort)
	protoStr := protoNameFromNumber(msg.Proto)

	// P4 enrichment — re-use existing NOAP helpers
	srcASN := LookupASN(srcIP)
	dstASN := LookupASN(dstIP)
	appLabel := MapApplication(dstPort, srcPort, protoStr)

	// GeoIP enrichment (Phase 2)
	srcGeo := LookupGeoIP(srcIP)
	dstGeo := LookupGeoIP(dstIP)

	// Prefer AS numbers from the flow record itself when available
	if msg.SrcAs != 0 {
		srcASN.ASN = uint32(msg.SrcAs)
	}
	if msg.DstAs != 0 {
		dstASN.ASN = uint32(msg.DstAs)
	}

	nextHop := net.IP(msg.NextHop).String()
	flowTypeName := flowTypeLabel(msg.Type)

	// ── Sampling rate correction ─────────────────────────────────────────
	// Uses configurable priority chain:
	//   FLOW_OVERRIDE_SAMPLING_RATE → device-reported → FLOW_DEFAULT_SAMPLING_RATE → 1
	samplingRate := EffectiveSamplingRate(uint64(msg.SamplingRate))
	adjustedBytes := msg.Bytes * samplingRate
	adjustedPackets := msg.Packets * samplingRate

	// Enqueue into batch writer (non-blocking)
	EnqueueFlow(FlowRow{
		TenantID:   dev.TenantID,
		DeviceID:   dev.ID,
		Timestamp:  time.Now(),
		SrcIP:      srcIP,
		DstIP:      dstIP,
		SrcPort:    srcPort,
		DstPort:    dstPort,
		Protocol:   protoStr,
		Bytes:      adjustedBytes,
		Packets:    adjustedPackets,
		SrcASN:     srcASN.ASN,
		DstASN:     dstASN.ASN,
		SrcASNName: srcASN.Name,
		DstASNName: dstASN.Name,
		App:        appLabel,
		FlowType:   flowTypeName,
		InIf:       msg.InIf,
		OutIf:      msg.OutIf,
		ToS:        msg.IpTos,
		TCPFlags:   msg.TcpFlags,
		VlanID:     msg.VlanId,
		NextHop:    nextHop,
		SrcCountry: srcGeo.Country,
		DstCountry: dstGeo.Country,
		SrcCity:    srcGeo.City,
		DstCity:    dstGeo.City,
		SrcLat:     srcGeo.Lat,
		SrcLon:     srcGeo.Lon,
		DstLat:     dstGeo.Lat,
		DstLon:     dstGeo.Lon,
	})

	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// flowTypeLabel returns a human-readable label for the GoFlow2 flow type enum.
func flowTypeLabel(ft flowpb.FlowMessage_FlowType) string {
	switch ft {
	case flowpb.FlowMessage_NETFLOW_V5:
		return "NetFlow-v5"
	case flowpb.FlowMessage_NETFLOW_V9:
		return "NetFlow-v9"
	case flowpb.FlowMessage_IPFIX:
		return "IPFIX"
	case flowpb.FlowMessage_SFLOW_5:
		return "sFlow-v5"
	default:
		return fmt.Sprintf("unknown(%d)", ft)
	}
}

// protoNameFromNumber converts an IP protocol number to a short name.
func protoNameFromNumber(p uint32) string {
	switch p {
	case 1:
		return "ICMP"
	case 6:
		return "TCP"
	case 17:
		return "UDP"
	case 47:
		return "GRE"
	case 58:
		return "ICMPv6"
	case 89:
		return "OSPF"
	case 132:
		return "SCTP"
	default:
		return fmt.Sprintf("PROTO%d", p)
	}
}

// envInt reads an environment variable as int, with fallback default.
func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var n int
	_, err := fmt.Sscanf(v, "%d", &n)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// ─────────────────────────────────────────────────────────────────────────────
// GoFlow2 Pipeline Startup
// ─────────────────────────────────────────────────────────────────────────────

// StartGoFlow2Receiver starts GoFlow2 as an embedded library, listening for
// NetFlow v5/v9, IPFIX, and sFlow on configurable UDP ports. GoFlow2 handles
// all decoding; our clickhouse TransportDriver receives the decoded messages
// and inserts them into ClickHouse with P4 enrichment.
func StartGoFlow2Receiver() {
	netflowPort := envInt("NETFLOW_PORT", 2055)
	sflowPort := envInt("SFLOW_PORT", 6343)

	listenSpec := fmt.Sprintf("netflow://:%d,sflow://:%d", netflowPort, sflowPort)

	log.Printf("[FlowDecoder] Starting GoFlow2 multi-protocol receiver")
	log.Printf("[FlowDecoder]   Listen spec: %s", listenSpec)

	cfg := &config.Config{
		ListenAddresses: listenSpec,
		Produce:         "sample",
		Format:          "bin", // raw protobuf → our Send() gets bytes
		Transport:       "clickhouse",
		LogLevel:        "info",
		LogFmt:          "text",
		Addr:            "", // disable GoFlow2's built-in HTTP server
	}

	application, err := app.New(cfg)
	if err != nil {
		log.Printf("[FlowDecoder] Failed to initialise GoFlow2: %v — falling back to mock flows", err)
		startMockFlowReceiver()
		return
	}

	ctx := context.Background()
	if err := application.Run(ctx); err != nil {
		log.Printf("[FlowDecoder] GoFlow2 pipeline exited: %v", err)
	}
}
