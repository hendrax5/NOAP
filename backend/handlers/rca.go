package handlers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
	"google.golang.org/genai"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// RCAEvent is one entry in the incident timeline returned to the frontend.
type RCAEvent struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Severity  string    `json:"severity"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
	Type      string    `json:"type"`
	Category  string    `json:"category"`
	Action    string    `json:"action"`
}

// RCAResponse is the top-level response structure (SSE final payload or plain JSON).
type RCAResponse struct {
	IncidentID      string     `json:"incident_id"`
	RootCause       string     `json:"root_cause"`
	Impact          string     `json:"impact"`
	Status          string     `json:"status"`
	Timeline        []RCAEvent `json:"timeline"`
	Recommendations []string   `json:"recommendations"`
}

// rcaContext is the internal struct used to build the LLM prompt.
type rcaContext struct {
	DownDevices    []models.Device
	ICMPLossEvents []icmpLossRow
	CPUSpikeEvents []cpuSpikeRow
	SyslogEvents   []syslogRow
	BGPDownEvents  []bgpDownRow
}

type icmpLossRow struct {
	DeviceID      uint32    `ch:"device_id"`
	Timestamp     time.Time `ch:"timestamp"`
	PacketLossPct float32   `ch:"packet_loss_pct"`
}

type cpuSpikeRow struct {
	DeviceID   uint32    `ch:"device_id"`
	Timestamp  time.Time `ch:"timestamp"`
	CPUUtilPct float32   `ch:"cpu_util_pct"`
	MemUtilPct float32   `ch:"mem_util_pct"`
}

type syslogRow struct {
	DeviceID  uint32    `ch:"device_id"`
	Timestamp time.Time `ch:"timestamp"`
	Severity  string    `ch:"severity"`
	Message   string    `ch:"message"`
}

type bgpDownRow struct {
	DeviceID  uint32    `ch:"device_id"`
	Timestamp time.Time `ch:"timestamp"`
	PeerIP    string    `ch:"peer_ip"`
	State     string    `ch:"state"`
}

// ─── B-1: Context Collector ───────────────────────────────────────────────────

// collectRCAContext gathers real telemetry from ClickHouse and Postgres for the
// given tenant over the past lookback window. Queries run sequentially; each
// is guarded so a ClickHouse outage only skips that source.
func collectRCAContext(tenantID uint, lookback time.Duration) rcaContext {
	ctx := context.Background()
	since := time.Now().Add(-lookback)
	tid := uint32(tenantID)

	var result rcaContext

	// 1. Down devices (Postgres)
	database.DB.Where(
		"tenant_id = ? AND last_seen < ?", tenantID, since,
	).Find(&result.DownDevices)

	if database.CH == nil {
		return result
	}

	// 2. ICMP packet-loss events (> 20%)
	rows, err := database.CH.Query(ctx,
		`SELECT device_id, timestamp, packet_loss_pct
		   FROM metrics_icmp
		  WHERE tenant_id = ?
		    AND timestamp >= ?
		    AND packet_loss_pct > 20
		  ORDER BY timestamp DESC
		  LIMIT 50`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var r icmpLossRow
			if rows.Scan(&r.DeviceID, &r.Timestamp, &r.PacketLossPct) == nil {
				result.ICMPLossEvents = append(result.ICMPLossEvents, r)
			}
		}
		rows.Close()
	}

	// 3. CPU/memory spikes (CPU > 80% or mem > 85%)
	rows, err = database.CH.Query(ctx,
		`SELECT device_id, timestamp, cpu_util_pct, mem_util_pct
		   FROM metrics_snmp_system
		  WHERE tenant_id = ?
		    AND timestamp >= ?
		    AND (cpu_util_pct > 80 OR mem_util_pct > 85)
		  ORDER BY timestamp DESC
		  LIMIT 50`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var r cpuSpikeRow
			if rows.Scan(&r.DeviceID, &r.Timestamp, &r.CPUUtilPct, &r.MemUtilPct) == nil {
				result.CPUSpikeEvents = append(result.CPUSpikeEvents, r)
			}
		}
		rows.Close()
	}

	// 4. Syslog CRITICAL / ERROR events
	rows, err = database.CH.Query(ctx,
		`SELECT device_id, timestamp, severity, message
		   FROM events_syslog
		  WHERE tenant_id = ?
		    AND timestamp >= ?
		    AND severity IN ('CRITICAL','ERROR','EMERG','ALERT')
		  ORDER BY timestamp DESC
		  LIMIT 100`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var r syslogRow
			if rows.Scan(&r.DeviceID, &r.Timestamp, &r.Severity, &r.Message) == nil {
				result.SyslogEvents = append(result.SyslogEvents, r)
			}
		}
		rows.Close()
	}

	// 5. BGP peers not in Established state
	rows, err = database.CH.Query(ctx,
		`SELECT device_id, timestamp, peer_ip, state
		   FROM metrics_bgp_peers
		  WHERE tenant_id = ?
		    AND timestamp >= ?
		    AND state != 'Established'
		  ORDER BY timestamp DESC
		  LIMIT 50`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var r bgpDownRow
			if rows.Scan(&r.DeviceID, &r.Timestamp, &r.PeerIP, &r.State) == nil {
				result.BGPDownEvents = append(result.BGPDownEvents, r)
			}
		}
		rows.Close()
	}

	return result
}

// ─── Timeline builder (shared by LLM path and rule-based fallback) ────────────

func buildTimeline(ctx rcaContext) []RCAEvent {
	var events []RCAEvent
	seq := 1

	for _, d := range ctx.DownDevices {
		events = append(events, RCAEvent{
			ID:        fmt.Sprintf("EVT-%03d", seq),
			Timestamp: d.LastSeen,
			Severity:  "CRITICAL",
			Source:    d.IP,
			Message:   fmt.Sprintf("Device %s (%s) unreachable — last seen %s", d.Name, d.IP, d.LastSeen.Format(time.RFC3339)),
			Type:      "DEVICE_DOWN",
			Category:  "Availability",
			Action:    "Device marked down",
		})
		seq++
	}

	for _, r := range ctx.ICMPLossEvents {
		events = append(events, RCAEvent{
			ID:        fmt.Sprintf("EVT-%03d", seq),
			Timestamp: r.Timestamp,
			Severity:  "WARNING",
			Source:    fmt.Sprintf("device:%d", r.DeviceID),
			Message:   fmt.Sprintf("Packet loss %.1f%% detected via ICMP probe", r.PacketLossPct),
			Type:      "ICMP",
			Category:  "Latency",
			Action:    "Probe threshold exceeded",
		})
		seq++
	}

	for _, r := range ctx.CPUSpikeEvents {
		events = append(events, RCAEvent{
			ID:        fmt.Sprintf("EVT-%03d", seq),
			Timestamp: r.Timestamp,
			Severity:  "WARNING",
			Source:    fmt.Sprintf("device:%d", r.DeviceID),
			Message:   fmt.Sprintf("CPU %.1f%% / Memory %.1f%% utilization spike", r.CPUUtilPct, r.MemUtilPct),
			Type:      "SNMP",
			Category:  "Resources",
			Action:    "SNMP threshold alert",
		})
		seq++
	}

	for _, r := range ctx.SyslogEvents {
		events = append(events, RCAEvent{
			ID:        fmt.Sprintf("EVT-%03d", seq),
			Timestamp: r.Timestamp,
			Severity:  r.Severity,
			Source:    fmt.Sprintf("device:%d", r.DeviceID),
			Message:   r.Message,
			Type:      "SYSLOG",
			Category:  "Events",
			Action:    "Syslog received",
		})
		seq++
	}

	for _, r := range ctx.BGPDownEvents {
		events = append(events, RCAEvent{
			ID:        fmt.Sprintf("EVT-%03d", seq),
			Timestamp: r.Timestamp,
			Severity:  "CRITICAL",
			Source:    fmt.Sprintf("device:%d → %s", r.DeviceID, r.PeerIP),
			Message:   fmt.Sprintf("BGP peer %s in state %s", r.PeerIP, r.State),
			Type:      "BGP",
			Category:  "Routing",
			Action:    "BGP state change",
		})
		seq++
	}

	// Sort ascending by timestamp so the timeline reads chronologically.
	for i := 0; i < len(events)-1; i++ {
		for j := i + 1; j < len(events); j++ {
			if events[j].Timestamp.Before(events[i].Timestamp) {
				events[i], events[j] = events[j], events[i]
			}
		}
	}

	return events
}

// ─── B-2: Rule-based fallback ────────────────────────────────────────────────

// rcaRuleBased performs deterministic root-cause classification when the LLM
// is unavailable. It checks event counts in priority order.
func rcaRuleBased(ctx rcaContext, timeline []RCAEvent) RCAResponse {
	incidentID := "INC-" + time.Now().Format("20060102150405")

	if len(ctx.DownDevices) > 0 {
		names := make([]string, 0, len(ctx.DownDevices))
		for _, d := range ctx.DownDevices {
			names = append(names, d.Name)
		}
		return RCAResponse{
			IncidentID: incidentID,
			RootCause:  fmt.Sprintf("Device(s) unreachable: %s. ICMP probes failed and device has not reported to the management plane.", strings.Join(names, ", ")),
			Impact:     fmt.Sprintf("High — %d device(s) fully offline.", len(ctx.DownDevices)),
			Status:     "INVESTIGATING",
			Timeline:   timeline,
			Recommendations: []string{
				"Verify physical layer connectivity and power status.",
				"Check management interface (OOB/console) for device availability.",
				"Review recent configuration changes via Config Automation.",
			},
		}
	}

	if len(ctx.BGPDownEvents) > 0 {
		return RCAResponse{
			IncidentID: incidentID,
			RootCause:  fmt.Sprintf("BGP adjacency loss on %d peer(s). Likely cause: hold timer expiry, route-map policy change, or control-plane memory pressure.", len(ctx.BGPDownEvents)),
			Impact:     "High — loss of routing reachability to affected BGP neighbors.",
			Status:     "INVESTIGATING",
			Timeline:   timeline,
			Recommendations: []string{
				"Inspect BGP hold timers and keepalive intervals.",
				"Check control-plane CPU and memory on affected devices.",
				"Review route-map and prefix-list configurations applied to impacted peers.",
			},
		}
	}

	if len(ctx.CPUSpikeEvents) > 0 {
		return RCAResponse{
			IncidentID: incidentID,
			RootCause:  "Control-plane resource exhaustion detected (CPU and/or memory above threshold). Possible causes: routing table churn, software bug, or active attacks.",
			Impact:     "Medium — degraded control-plane responsiveness, possible protocol flaps.",
			Status:     "INVESTIGATING",
			Timeline:   timeline,
			Recommendations: []string{
				"Identify processes consuming CPU via 'show processes cpu sorted'.",
				"Check for routing table growth (show bgp summary, show ip route summary).",
				"Apply CoPP (Control Plane Policing) if not already configured.",
			},
		}
	}

	if len(ctx.ICMPLossEvents) > 0 {
		return RCAResponse{
			IncidentID: incidentID,
			RootCause:  fmt.Sprintf("Elevated ICMP packet loss on %d path(s). Possible causes: interface errors, QoS misconfiguration, or link congestion.", len(ctx.ICMPLossEvents)),
			Impact:     "Medium — degraded path quality; TCP sessions may time out.",
			Status:     "INVESTIGATING",
			Timeline:   timeline,
			Recommendations: []string{
				"Run traceroute to isolate impacted hops.",
				"Check interface error counters and optical signal levels.",
				"Review QoS policy drop statistics.",
			},
		}
	}

	if len(ctx.SyslogEvents) > 0 {
		return RCAResponse{
			IncidentID: incidentID,
			RootCause:  fmt.Sprintf("%d CRITICAL/ERROR syslog events detected in the past hour. Review event timeline for specific failure details.", len(ctx.SyslogEvents)),
			Impact:     "Unknown — requires manual investigation.",
			Status:     "INVESTIGATING",
			Timeline:   timeline,
			Recommendations: []string{
				"Review the full syslog stream at /events/syslog.",
				"Correlate events with recent change control records.",
			},
		}
	}

	return RCAResponse{
		IncidentID:      incidentID,
		RootCause:       "No anomalies detected in the last hour. All monitored metrics are within normal thresholds.",
		Impact:          "None",
		Status:          "CLEARED",
		Timeline:        timeline,
		Recommendations: []string{"Continue monitoring. Consider adding additional probes for deeper visibility."},
	}
}

// ─── Context → prompt ─────────────────────────────────────────────────────────

// buildGeminiPrompt serialises the collected telemetry into a structured text
// prompt that Gemini will analyse.
func buildGeminiPrompt(ctx rcaContext, timeline []RCAEvent) string {
	var b strings.Builder

	b.WriteString("You are a senior NOC (Network Operations Center) engineer performing root-cause analysis.\n")
	b.WriteString("Analyse the following telemetry from the past hour and return a JSON object with EXACTLY these keys:\n")
	b.WriteString(`{"root_cause": "...", "impact": "...", "status": "INVESTIGATING|CLEARED|RESOLVED", "recommendations": ["step1","step2","step3"]}` + "\n\n")
	b.WriteString("Be concise, technical, and actionable. Do NOT wrap JSON in markdown code fences.\n\n")

	b.WriteString(fmt.Sprintf("## Down Devices (%d)\n", len(ctx.DownDevices)))
	for _, d := range ctx.DownDevices {
		b.WriteString(fmt.Sprintf("- %s (%s) — last_seen: %s\n", d.Name, d.IP, d.LastSeen.Format(time.RFC3339)))
	}

	b.WriteString(fmt.Sprintf("\n## ICMP Loss Events (%d, threshold >20%%)\n", len(ctx.ICMPLossEvents)))
	for _, r := range ctx.ICMPLossEvents {
		b.WriteString(fmt.Sprintf("- device:%d @ %s — loss %.1f%%\n", r.DeviceID, r.Timestamp.Format(time.RFC3339), r.PacketLossPct))
	}

	b.WriteString(fmt.Sprintf("\n## CPU/Memory Spikes (%d)\n", len(ctx.CPUSpikeEvents)))
	for _, r := range ctx.CPUSpikeEvents {
		b.WriteString(fmt.Sprintf("- device:%d @ %s — CPU %.1f%% Mem %.1f%%\n", r.DeviceID, r.Timestamp.Format(time.RFC3339), r.CPUUtilPct, r.MemUtilPct))
	}

	b.WriteString(fmt.Sprintf("\n## BGP Peer Failures (%d)\n", len(ctx.BGPDownEvents)))
	for _, r := range ctx.BGPDownEvents {
		b.WriteString(fmt.Sprintf("- device:%d → peer %s state=%s @ %s\n", r.DeviceID, r.PeerIP, r.State, r.Timestamp.Format(time.RFC3339)))
	}

	b.WriteString(fmt.Sprintf("\n## Syslog CRITICAL/ERROR Events (%d, showing last 20)\n", len(ctx.SyslogEvents)))
	shown := ctx.SyslogEvents
	if len(shown) > 20 {
		shown = shown[:20]
	}
	for _, r := range shown {
		b.WriteString(fmt.Sprintf("- [%s] device:%d @ %s — %s\n", r.Severity, r.DeviceID, r.Timestamp.Format(time.RFC3339), r.Message))
	}

	return b.String()
}

// ─── Gemini LLM call ─────────────────────────────────────────────────────────

// callGemini sends the prompt to Gemini and returns parsed root_cause, impact,
// status, and recommendations. Returns an error if the API key is absent or the
// call/parse fails.
func callGemini(prompt string) (rootCause, impact, status string, recs []string, err error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", "", "", nil, fmt.Errorf("GEMINI_API_KEY not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return "", "", "", nil, fmt.Errorf("gemini client: %w", err)
	}

	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = "gemini-2.0-flash"
	}

	resp, err := client.Models.GenerateContent(ctx, model,
		genai.Text(prompt),
		nil,
	)
	if err != nil {
		return "", "", "", nil, fmt.Errorf("gemini generate: %w", err)
	}

	// Extract raw text from first candidate.
	if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return "", "", "", nil, fmt.Errorf("gemini returned no candidates")
	}

	var rawText string
	for _, part := range resp.Candidates[0].Content.Parts {
		rawText += fmt.Sprintf("%v", part)
	}
	rawText = strings.TrimSpace(rawText)

	// Strip accidental markdown fences.
	rawText = strings.TrimPrefix(rawText, "```json")
	rawText = strings.TrimPrefix(rawText, "```")
	rawText = strings.TrimSuffix(rawText, "```")
	rawText = strings.TrimSpace(rawText)

	// Parse compact JSON output.
	var parsed struct {
		RootCause       string   `json:"root_cause"`
		Impact          string   `json:"impact"`
		Status          string   `json:"status"`
		Recommendations []string `json:"recommendations"`
	}
	if err = json.Unmarshal([]byte(rawText), &parsed); err != nil {
		return "", "", "", nil, fmt.Errorf("gemini JSON parse (%q): %w", rawText, err)
	}

	return parsed.RootCause, parsed.Impact, parsed.Status, parsed.Recommendations, nil
}

// ─── Handler: GET /api/v1/rca/events ─────────────────────────────────────────

// GetRCAEvents is the main RCA endpoint.
//
// It:
//  1. Collects real telemetry for the past 1 hour from CH + PG (B-1).
//  2. Attempts a Gemini LLM call for intelligent root-cause analysis (B-2).
//  3. Falls back to rule-based analysis if Gemini is unavailable.
//
// Response mode is controlled by the `stream` query param:
//
//	?stream=true  → SSE: emits "data: <chunk>\n\n" while streaming, then
//	                closes with a final "data: [DONE]\n\n" event.
//	?stream=false → plain JSON (default).
func GetRCAEvents(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	// Lookback window: default 1 hour, overridable via ?lookback=<minutes>.
	lookbackMin := c.QueryInt("lookback", 60)
	if lookbackMin < 1 || lookbackMin > 1440 {
		lookbackMin = 60
	}
	lookback := time.Duration(lookbackMin) * time.Minute

	// B-1: Gather real telemetry context.
	rctx := collectRCAContext(tenantID, lookback)

	// Build timeline (shared by all paths).
	timeline := buildTimeline(rctx)

	incidentID := "INC-" + time.Now().Format("20060102150405")

	// B-2: Attempt Gemini LLM analysis.
	rootCause, impact, status, recs, geminiErr := callGemini(buildGeminiPrompt(rctx, timeline))
	if geminiErr != nil {
		log.Printf("[RCA] Gemini unavailable (%v), using rule-based fallback", geminiErr)
		fallback := rcaRuleBased(rctx, timeline)
		if c.Query("stream") == "true" {
			return streamRCAResponse(c, fallback)
		}
		return c.JSON(fallback)
	}

	res := RCAResponse{
		IncidentID:      incidentID,
		RootCause:       rootCause,
		Impact:          impact,
		Status:          status,
		Timeline:        timeline,
		Recommendations: recs,
	}

	if c.Query("stream") == "true" {
		return streamRCAResponse(c, res)
	}
	return c.JSON(res)
}

// ─── SSE streaming helper ─────────────────────────────────────────────────────

// streamRCAResponse sends the RCAResponse as a series of SSE events.
// Each line of the JSON is emitted as a separate "data:" frame so the frontend
// can show progress without waiting for the full payload.
func streamRCAResponse(c *fiber.Ctx, res RCAResponse) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		payload, err := json.Marshal(res)
		if err != nil {
			fmt.Fprintf(w, "data: {\"error\":%q}\n\n", err.Error())
			w.Flush()
			return
		}

		// Stream line-by-line (simulates token streaming for the UI).
		scanner := bufio.NewScanner(bytes.NewReader(payload))
		for scanner.Scan() {
			fmt.Fprintf(w, "data: %s\n\n", scanner.Text())
			w.Flush()
		}

		// Sentinel event.
		fmt.Fprintf(w, "data: [DONE]\n\n")
		w.Flush()
	})

	return nil
}
