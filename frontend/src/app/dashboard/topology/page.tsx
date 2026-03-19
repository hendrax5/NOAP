"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  up: "#22c55e",
  warn: "#f59e0b",
  down: "#ef4444",
  unknown: "#64748b",
};

const STATUS_LABEL: Record<string, string> = {
  up: "UP",
  warn: "WARN",
  down: "DOWN",
  unknown: "–",
};

function MetricBar({
  value,
  label,
  warnAt = 80,
  critAt = 90,
}: {
  value: number;
  label: string;
  warnAt?: number;
  critAt?: number;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const color =
    pct >= critAt ? "#ef4444" : pct >= warnAt ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ marginBottom: 3 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "#94a3b8",
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span style={{ color }}>{pct.toFixed(0)}%</span>
      </div>
      <div
        style={{
          height: 4,
          background: "#1e293b",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Custom node: NetworkDevice ────────────────────────────────────────────────

function NetworkDeviceNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    ip: string;
    vendor?: string;
    status: string;
    cpu: number;
    mem: number;
    latency_ms: number;
    loss_pct: number;
  };

  const statusColor = STATUS_COLOR[d.status] ?? STATUS_COLOR.unknown;
  const showMetrics = d.cpu > 0 || d.mem > 0;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          background: "rgba(15,23,42,0.92)",
          border: `1.5px solid ${statusColor}`,
          borderRadius: 10,
          padding: "8px 12px",
          minWidth: 148,
          boxShadow: `0 0 10px ${statusColor}40`,
          backdropFilter: "blur(8px)",
          cursor: "default",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          {/* Status LED */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: "#f1f5f9",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {d.label}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: statusColor,
              background: `${statusColor}20`,
              borderRadius: 4,
              padding: "1px 4px",
            }}
          >
            {STATUS_LABEL[d.status] ?? "–"}
          </span>
        </div>

        {/* IP + vendor */}
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5 }}>
          {d.ip}
          {d.vendor ? (
            <span style={{ marginLeft: 6, color: "#475569" }}>
              · {d.vendor}
            </span>
          ) : null}
        </div>

        {/* Metric bars */}
        {showMetrics && (
          <div>
            <MetricBar value={d.cpu} label="CPU" warnAt={70} critAt={85} />
            <MetricBar value={d.mem} label="MEM" warnAt={75} critAt={90} />
          </div>
        )}

        {/* Latency / loss */}
        {(d.latency_ms > 0 || d.loss_pct > 0) && (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 4,
              fontSize: 9,
              color: "#64748b",
            }}
          >
            {d.latency_ms > 0 && (
              <span>
                ⏱{" "}
                <span style={{ color: "#94a3b8" }}>
                  {d.latency_ms.toFixed(1)} ms
                </span>
              </span>
            )}
            {d.loss_pct > 0 && (
              <span>
                ⚠{" "}
                <span
                  style={{
                    color:
                      d.loss_pct >= 10 ? "#ef4444" : "#f59e0b",
                  }}
                >
                  {d.loss_pct.toFixed(1)}% loss
                </span>
              </span>
            )}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0 }}
      />
    </>
  );
}

const NODE_TYPES = { networkDevice: NetworkDeviceNode };

// ─── Summary stat pill ─────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(15,23,42,0.7)",
        border: "1px solid #1e293b",
        borderRadius: 8,
        padding: "4px 12px",
        fontSize: 12,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 5px ${color}`,
        }}
      />
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

const PROTOCOL_LEGEND = [
  { proto: "BGP", color: "#f59e0b" },
  { proto: "OSPF", color: "#3b82f6" },
  { proto: "LLDP", color: "#6366f1" },
  { proto: "MPLS", color: "#ec4899" },
  { proto: "STATIC", color: "#22c55e" },
];

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        background: "rgba(15,23,42,0.75)",
        border: "1px solid #1e293b",
        borderRadius: 8,
        padding: "5px 12px",
        fontSize: 11,
        backdropFilter: "blur(6px)",
      }}
    >
      {PROTOCOL_LEGEND.map(({ proto, color }) => (
        <div
          key={proto}
          style={{ display: "flex", alignItems: "center", gap: 5 }}
        >
          <div
            style={{
              width: 20,
              height: 2,
              background: color,
              borderRadius: 1,
            }}
          />
          <span style={{ color: "#94a3b8" }}>{proto}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface TopologySummary {
  total: number;
  up: number;
  warn: number;
  down: number;
  links: number;
}

export default function TopologyMap() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [summary, setSummary] = useState<TopologySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTopology()
      .then((data: any) => {
        if (!data || !data.nodes) {
          setLoading(false);
          return;
        }

        // Use server-computed FR positions — no Math.random().
        const formattedNodes: Node[] = (data.nodes ?? []).map((n: any) => ({
          id: n.id,
          type: "networkDevice",
          position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          data: {
            label: n.data?.label ?? n.id,
            ip: n.data?.ip ?? "",
            vendor: n.data?.vendor ?? "",
            status: n.data?.status ?? "unknown",
            cpu: n.data?.cpu ?? 0,
            mem: n.data?.mem ?? 0,
            latency_ms: n.data?.latency_ms ?? 0,
            loss_pct: n.data?.loss_pct ?? 0,
          },
        }));

        const formattedEdges: Edge[] = (data.edges ?? []).map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label ?? "",
          animated: e.animated ?? false,
          style: e.style ?? { stroke: "#64748b", strokeWidth: "2" },
          markerEnd: e.markerEnd ?? undefined,
        }));

        setNodes(formattedNodes);
        setEdges(formattedEdges);
        if (data.summary) setSummary(data.summary);
        setLoading(false);
      })
      .catch((err: Error) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  if (loading)
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "60vh", color: "var(--color-text-dim)" }}
      >
        <div className="text-center animate-pulse">
          <div style={{ fontSize: 48, marginBottom: 12 }}>🕸️</div>
          <p>Calculating topology layout…</p>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="text-center mt-20" style={{ color: "#ef4444" }}>
        Failed to load topology: {error}
      </div>
    );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Page header */}
      <div>
        <h1
          className="text-3xl font-bold mb-1"
          style={{ color: "var(--color-text)" }}
        >
          Network Topology Map
        </h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          Auto-discovered L2/L3 connections via LLDP/CDP, BGP & OSPF —
          force-directed layout, live metric overlay.
        </p>
      </div>

      {/* Summary bar */}
      {summary && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatPill label="Devices" value={summary.total} color="#6366f1" />
          <StatPill label="Up" value={summary.up} color="#22c55e" />
          <StatPill label="Warning" value={summary.warn} color="#f59e0b" />
          <StatPill label="Down" value={summary.down} color="#ef4444" />
          <StatPill label="Links" value={summary.links} color="#64748b" />
        </div>
      )}

      {/* Legend */}
      <Legend />

      {/* Canvas */}
      <div
        className="flex-1 rounded-2xl shadow-lg w-full"
        style={{
          background: "#060c17",
          border: "1px solid #1e293b",
          height: "640px",
          position: "relative",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode="dark"
          minZoom={0.15}
          maxZoom={2.5}
        >
          <Controls
            style={{
              background: "rgba(15,23,42,0.8)",
              border: "1px solid #1e293b",
            }}
          />
          <MiniMap
            style={{
              background: "rgba(15,23,42,0.9)",
              border: "1px solid #1e293b",
            }}
            nodeColor={(n) => {
              const status = (n.data as any)?.status ?? "unknown";
              return STATUS_COLOR[status] ?? STATUS_COLOR.unknown;
            }}
          />
          <Background color="#1e293b" gap={24} />
        </ReactFlow>
      </div>
    </div>
  );
}
