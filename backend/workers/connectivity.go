package workers

import (
	"fmt"
	"io"
	"log"
	"net"
	"time"

	"github.com/gosnmp/gosnmp"
	"golang.org/x/crypto/ssh"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// ProbeResult holds the outcome of a single protocol connectivity test.
type ProbeResult struct {
	Status  string `json:"status"`  // "up", "down", "skipped"
	Latency int    `json:"latency"` // milliseconds
	Error   string `json:"error"`   // empty on success
}

// ConnectivityResult aggregates per-protocol test results.
type ConnectivityResult struct {
	SNMP   ProbeResult `json:"snmp"`
	SSH    ProbeResult `json:"ssh"`
	Telnet ProbeResult `json:"telnet"`
}

// sysObjectID is a universal OID that every SNMP-enabled device responds to.
const sysObjectID = ".1.3.6.1.2.1.1.2.0"

// TestDeviceConnectivity performs SNMP, SSH, and Telnet connectivity probes
// against a device. Each probe has a short timeout so the call returns quickly.
// Results are also persisted to last_snmp_status / last_cli_status.
func TestDeviceConnectivity(dev models.Device) ConnectivityResult {
	result := ConnectivityResult{
		SNMP:   probeSkipped(),
		SSH:    probeSkipped(),
		Telnet: probeSkipped(),
	}

	// ── SNMP ──────────────────────────────────────────────────────────────
	if dev.SNMPComm != "" {
		result.SNMP = testSNMP(dev)
		if result.SNMP.Status == "up" {
			database.DB.Model(&dev).Update("last_snmp_status", "up")
		} else {
			database.DB.Model(&dev).Update("last_snmp_status", "down")
		}
	}

	// ── SSH / Telnet ─────────────────────────────────────────────────────
	if dev.SSHUser != "" {
		if isProtocolTelnet(dev.AuthProtocol) {
			result.Telnet = testTelnet(dev)
			status := "down"
			if result.Telnet.Status == "up" {
				status = "up"
			}
			database.DB.Model(&dev).Update("last_cli_status", status)
		} else {
			result.SSH = testSSH(dev)
			status := "down"
			if result.SSH.Status == "up" {
				status = "up"
			}
			database.DB.Model(&dev).Update("last_cli_status", status)
		}
	}

	return result
}

// ── Individual probes ────────────────────────────────────────────────────────

func testSNMP(dev models.Device) ProbeResult {
	start := time.Now()

	params := &gosnmp.GoSNMP{
		Target:    dev.IP,
		Port:      161,
		Community: dev.SNMPComm,
		Version:   gosnmp.Version2c,
		Timeout:   5 * time.Second,
		Retries:   0,
		Logger:    gosnmp.NewLogger(log.New(io.Discard, "", 0)),
	}

	if err := params.Connect(); err != nil {
		return probeFailed(time.Since(start), fmt.Sprintf("connect: %v", err))
	}
	defer params.Conn.Close()

	_, err := params.Get([]string{sysObjectID})
	latency := time.Since(start)
	if err != nil {
		return probeFailed(latency, fmt.Sprintf("get sysObjectID: %v", err))
	}

	log.Printf("[ConnTest] SNMP OK for %s (%dms)", dev.IP, latency.Milliseconds())
	return probeOK(latency)
}

func testSSH(dev models.Device) ProbeResult {
	start := time.Now()
	addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)

	cfg := &ssh.ClientConfig{
		User:            dev.SSHUser,
		Auth:            []ssh.AuthMethod{ssh.Password(dev.SSHPass)},
		HostKeyCallback: loadHostKeyCallback(),
		Timeout:         10 * time.Second,
	}

	client, err := ssh.Dial("tcp", addr, cfg)
	latency := time.Since(start)
	if err != nil {
		return probeFailed(latency, fmt.Sprintf("dial: %v", err))
	}
	client.Close()

	log.Printf("[ConnTest] SSH OK for %s (%dms)", dev.IP, latency.Milliseconds())
	return probeOK(latency)
}

func testTelnet(dev models.Device) ProbeResult {
	start := time.Now()
	addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)

	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	latency := time.Since(start)
	if err != nil {
		return probeFailed(latency, fmt.Sprintf("dial: %v", err))
	}
	conn.Close()

	log.Printf("[ConnTest] Telnet OK for %s (%dms)", dev.IP, latency.Milliseconds())
	return probeOK(latency)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func probeSkipped() ProbeResult {
	return ProbeResult{Status: "skipped"}
}

func probeOK(d time.Duration) ProbeResult {
	return ProbeResult{Status: "up", Latency: int(d.Milliseconds())}
}

func probeFailed(d time.Duration, errMsg string) ProbeResult {
	return ProbeResult{Status: "down", Latency: int(d.Milliseconds()), Error: errMsg}
}

func isProtocolTelnet(proto string) bool {
	return proto == "telnet" || proto == "Telnet" || proto == "TELNET"
}
