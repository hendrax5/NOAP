package handlers

import (
	"context"
	"math"
	"math/rand"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
)

// ─── React Flow wire types ────────────────────────────────────────────────────

type ReactFlowNode struct {
	ID       string                 `json:"id"`
	Data     map[string]interface{} `json:"data"`
	Position map[string]float64     `json:"position"`
	Type     string                 `json:"type,omitempty"`
}

type ReactFlowEdge struct {
	ID           string            `json:"id"`
	Source       string            `json:"source"`
	Target       string            `json:"target"`
	Label        string            `json:"label,omitempty"`
	Animated     bool              `json:"animated"`
	Style        map[string]string `json:"style,omitempty"`
	MarkerEnd    map[string]string `json:"markerEnd,omitempty"`
}

// ─── Internal layout types ────────────────────────────────────────────────────

type layoutNode struct {
	ID     string
	X, Y   float64
	Vx, Vy float64 // velocity for FR iteration
}

// ─── C-1: ClickHouse metric enrichment ───────────────────────────────────────

type deviceMetrics struct {
	LatencyMs    float32
	PacketLoss   float32
	CPUUtilPct   float32
	MemUtilPct   float32
	Status       string // "up" | "warn" | "down"
}

// fetchDeviceMetrics queries ClickHouse for the last-known ICMP and SNMP values
// for every device belonging to the tenant. Returns a map keyed by device_id.
func fetchDeviceMetrics(tenantID uint) map[uint32]deviceMetrics {
	result := make(map[uint32]deviceMetrics)
	if database.CH == nil {
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	tid := uint32(tenantID)
	since := time.Now().Add(-10 * time.Minute) // last 10 min window

	// --- ICMP (latency + packet loss) ---
	rows, err := database.CH.Query(ctx,
		`SELECT device_id,
		        argMax(latency_ms,    timestamp) AS lat,
		        argMax(packet_loss_pct, timestamp) AS loss
		   FROM metrics_icmp
		  WHERE tenant_id = ? AND timestamp >= ?
		  GROUP BY device_id`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var did uint32
			var lat, loss float32
			if rows.Scan(&did, &lat, &loss) == nil {
				m := result[did]
				m.LatencyMs = lat
				m.PacketLoss = loss
				result[did] = m
			}
		}
		rows.Close()
	}

	// --- SNMP system (CPU + memory) ---
	rows, err = database.CH.Query(ctx,
		`SELECT device_id,
		        argMax(cpu_util_pct, timestamp) AS cpu,
		        argMax(mem_util_pct, timestamp) AS mem
		   FROM metrics_snmp_system
		  WHERE tenant_id = ? AND timestamp >= ?
		  GROUP BY device_id`,
		tid, since,
	)
	if err == nil {
		for rows.Next() {
			var did uint32
			var cpu, mem float32
			if rows.Scan(&did, &cpu, &mem) == nil {
				m := result[did]
				m.CPUUtilPct = cpu
				m.MemUtilPct = mem
				result[did] = m
			}
		}
		rows.Close()
	}

	// Classify status from metrics.
	for did, m := range result {
		switch {
		case m.PacketLoss >= 50:
			m.Status = "down"
		case m.PacketLoss >= 10 || m.CPUUtilPct >= 80 || m.MemUtilPct >= 85:
			m.Status = "warn"
		default:
			m.Status = "up"
		}
		result[did] = m
	}

	return result
}

// ─── C-1: Fruchterman-Reingold force-directed layout ────────────────────────

const (
	frCanvasW   = 1400.0
	frCanvasH   = 900.0
	frIterations = 120
	frCooling   = 0.92
)

// fruchtermanReingold computes stable 2D positions for the given node IDs and
// edge pairs. Returns a map from node ID → (x, y).
//
// Algorithm: F-R 1991 — attractive force pulls connected nodes together,
// repulsive force pushes all node pairs apart. Temperature cools each iteration.
func fruchtermanReingold(nodeIDs []string, edges [][2]string) map[string][2]float64 {
	n := len(nodeIDs)
	if n == 0 {
		return nil
	}

	rng := rand.New(rand.NewSource(42)) // deterministic seed for stable layout
	nodes := make([]layoutNode, n)
	idxByID := make(map[string]int, n)

	// Random initial placement in a smaller box at centre.
	for i, id := range nodeIDs {
		nodes[i] = layoutNode{
			ID: id,
			X:  frCanvasW/4 + rng.Float64()*frCanvasW/2,
			Y:  frCanvasH/4 + rng.Float64()*frCanvasH/2,
		}
		idxByID[id] = i
	}

	area := frCanvasW * frCanvasH
	k := math.Sqrt(area / float64(n)) // optimal distance
	temp := frCanvasW / 10.0           // initial temperature

	attract := func(d float64) float64 { return (d * d) / k }
	repulse := func(d float64) float64 { return (k * k) / d }

	for iter := 0; iter < frIterations; iter++ {
		// Reset forces.
		for i := range nodes {
			nodes[i].Vx = 0
			nodes[i].Vy = 0
		}

		// Repulsive forces: every pair.
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				dx := nodes[i].X - nodes[j].X
				dy := nodes[i].Y - nodes[j].Y
				dist := math.Sqrt(dx*dx+dy*dy) + 1e-6
				f := repulse(dist) / dist
				nodes[i].Vx += dx * f
				nodes[i].Vy += dy * f
				nodes[j].Vx -= dx * f
				nodes[j].Vy -= dy * f
			}
		}

		// Attractive forces: connected pairs.
		for _, e := range edges {
			si, okS := idxByID[e[0]]
			ti, okT := idxByID[e[1]]
			if !okS || !okT {
				continue
			}
			dx := nodes[si].X - nodes[ti].X
			dy := nodes[si].Y - nodes[ti].Y
			dist := math.Sqrt(dx*dx+dy*dy) + 1e-6
			f := attract(dist) / dist
			nodes[si].Vx -= dx * f
			nodes[si].Vy -= dy * f
			nodes[ti].Vx += dx * f
			nodes[ti].Vy += dy * f
		}

		// Apply displacement, clamped to temperature.
		for i := range nodes {
			dispLen := math.Sqrt(nodes[i].Vx*nodes[i].Vx+nodes[i].Vy*nodes[i].Vy) + 1e-6
			scale := math.Min(dispLen, temp) / dispLen
			nodes[i].X += nodes[i].Vx * scale
			nodes[i].Y += nodes[i].Vy * scale
			// Clamp to canvas with margin.
			nodes[i].X = math.Max(60, math.Min(frCanvasW-60, nodes[i].X))
			nodes[i].Y = math.Max(60, math.Min(frCanvasH-60, nodes[i].Y))
		}

		temp *= frCooling
	}

	out := make(map[string][2]float64, n)
	for _, nd := range nodes {
		out[nd.ID] = [2]float64{nd.X, nd.Y}
	}
	return out
}

// ─── Handler: GET /api/v1/topology ───────────────────────────────────────────

func GetTopologyMap(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	// 1. Load devices + links from Postgres.
	var devices []models.Device
	database.DB.Where("tenant_id = ?", tenantID).Find(&devices)

	var links []models.Link
	database.DB.Where("tenant_id = ?", tenantID).Find(&links)

	// 2. Fetch live metrics from ClickHouse (C-1).
	metrics := fetchDeviceMetrics(tenantID)

	// 3. Enrich device statuses from Postgres last_seen for devices with no CH data.
	now := time.Now()
	for i := range devices {
		did := uint32(devices[i].ID)
		m, exists := metrics[did]
		if !exists {
			// No CH data — classify purely from last_seen.
			if now.Sub(devices[i].LastSeen) > 5*time.Minute {
				m.Status = "down"
			} else {
				m.Status = "up"
			}
			metrics[did] = m
		}
	}

	// 4. Build node + edge ID lists for layout.
	nodeIDs := make([]string, 0, len(devices))
	for _, d := range devices {
		nodeIDs = append(nodeIDs, strconv.Itoa(int(d.ID)))
	}

	edgePairs := make([][2]string, 0, len(links))
	for _, l := range links {
		edgePairs = append(edgePairs, [2]string{
			strconv.Itoa(int(l.SourceDeviceID)),
			strconv.Itoa(int(l.TargetDeviceID)),
		})
	}

	// 5. Run Fruchterman-Reingold layout (C-1).
	positions := fruchtermanReingold(nodeIDs, edgePairs)

	// 6. Build React Flow nodes with enriched data.
	nodes := make([]ReactFlowNode, 0, len(devices))
	for _, dev := range devices {
		idStr := strconv.Itoa(int(dev.ID))
		pos := positions[idStr]
		m := metrics[uint32(dev.ID)]

		nodeStatus := m.Status
		if nodeStatus == "" {
			nodeStatus = "unknown"
		}

		nodes = append(nodes, ReactFlowNode{
			ID: idStr,
			Type: "networkDevice",
			Data: map[string]interface{}{
				"label":      dev.Name,
				"ip":         dev.IP,
				"vendor":     dev.Vendor,
				"status":     nodeStatus,
				"cpu":        m.CPUUtilPct,
				"mem":        m.MemUtilPct,
				"latency_ms": m.LatencyMs,
				"loss_pct":   m.PacketLoss,
			},
			Position: map[string]float64{"x": pos[0], "y": pos[1]},
		})
	}

	// 7. Build React Flow edges with protocol-aware styling.
	protocolColors := map[string]string{
		"BGP":   "#f59e0b",
		"OSPF":  "#3b82f6",
		"LLDP":  "#6366f1",
		"CDP":   "#8b5cf6",
		"MPLS":  "#ec4899",
		"STATIC": "#22c55e",
	}

	edges := make([]ReactFlowEdge, 0, len(links))
	seen := make(map[string]bool)
	for _, link := range links {
		eid := "e" + strconv.Itoa(int(link.SourceDeviceID)) + "-" + strconv.Itoa(int(link.TargetDeviceID))
		if seen[eid] {
			continue
		}
		seen[eid] = true

		color, ok := protocolColors[link.Protocol]
		if !ok {
			color = "#64748b"
		}

		edgeLabel := link.Protocol
		if link.SourcePort != "" {
			edgeLabel += " " + link.SourcePort + "→" + link.TargetPort
		}

		edges = append(edges, ReactFlowEdge{
			ID:       eid,
			Source:   strconv.Itoa(int(link.SourceDeviceID)),
			Target:   strconv.Itoa(int(link.TargetDeviceID)),
			Label:    edgeLabel,
			Animated: link.Protocol == "BGP" || link.Protocol == "OSPF",
			Style:    map[string]string{"stroke": color, "strokeWidth": "2"},
			MarkerEnd: map[string]string{"type": "arrowclosed", "color": color},
		})
	}

	// 8. Summary stats for the UI header.
	upCount, warnCount, downCount := 0, 0, 0
	for _, dev := range devices {
		switch metrics[uint32(dev.ID)].Status {
		case "up":
			upCount++
		case "warn":
			warnCount++
		case "down":
			downCount++
		default:
			upCount++ // unknown treated as up
		}
	}

	return c.JSON(fiber.Map{
		"nodes": nodes,
		"edges": edges,
		"summary": fiber.Map{
			"total": len(devices),
			"up":    upCount,
			"warn":  warnCount,
			"down":  downCount,
			"links": len(links),
		},
	})
}
