"use client";
import { useEffect, useState, memo, useMemo } from "react";
import { api } from "@/lib/api";

/* ── types ── */
type SankeyData = {
  nodes: { id: string }[];
  links: { source: string; target: string; value: number }[];
};

/* ── helpers ── */
function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

const COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#a3e635",
];

/* ── layout engine (minimal 3-column sankey) ── */
type LayoutNode = {
  id: string;
  x: number;
  y: number;
  h: number;
  col: number;
  total: number;
  color: string;
};
type LayoutLink = {
  srcNode: LayoutNode;
  dstNode: LayoutNode;
  value: number;
  srcY: number;
  dstY: number;
  thickness: number;
  color: string;
};

function layoutSankey(
  data: SankeyData,
  W: number,
  H: number
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  if (!data.nodes.length) return { nodes: [], links: [] };

  // Determine columns: sources on left, sinks on right, middle otherwise
  const sourceSet = new Set(data.links.map((l) => l.source));
  const targetSet = new Set(data.links.map((l) => l.target));

  const left = data.nodes.filter(
    (n) => sourceSet.has(n.id) && !targetSet.has(n.id)
  );
  const right = data.nodes.filter(
    (n) => targetSet.has(n.id) && !sourceSet.has(n.id)
  );
  const middle = data.nodes.filter(
    (n) => sourceSet.has(n.id) && targetSet.has(n.id)
  );

  // If no middle layer, treat targets as right
  const cols = [left, middle.length ? middle : [], right];

  const nodeW = 14;
  const pad = 6;
  const colX = [20, W / 2 - nodeW / 2, W - nodeW - 20];

  // Compute totals per node
  const totals: Record<string, number> = {};
  data.links.forEach((l) => {
    totals[l.source] = (totals[l.source] ?? 0) + l.value;
    totals[l.target] = (totals[l.target] ?? 0) + l.value;
  });

  const nodeMap: Record<string, LayoutNode> = {};
  let colorIdx = 0;

  cols.forEach((col, ci) => {
    if (!col.length) return;
    const colTotal = col.reduce((s, n) => s + (totals[n.id] ?? 1), 0);
    const availH = H - pad * (col.length - 1) - 20;
    let yOff = 10;

    col
      .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
      .forEach((n) => {
        const t = totals[n.id] ?? 1;
        const h = Math.max(8, (t / colTotal) * availH);
        nodeMap[n.id] = {
          id: n.id,
          x: colX[ci],
          y: yOff,
          h,
          col: ci,
          total: t,
          color: COLORS[colorIdx++ % COLORS.length],
        };
        yOff += h + pad;
      });
  });

  // Layout links
  const srcOffsets: Record<string, number> = {};
  const dstOffsets: Record<string, number> = {};
  Object.keys(nodeMap).forEach((id) => {
    srcOffsets[id] = 0;
    dstOffsets[id] = 0;
  });

  const links: LayoutLink[] = data.links
    .sort((a, b) => b.value - a.value)
    .map((l) => {
      const src = nodeMap[l.source];
      const dst = nodeMap[l.target];
      if (!src || !dst) return null!;

      const srcFrac = l.value / (src.total || 1);
      const dstFrac = l.value / (dst.total || 1);
      const thickness = Math.max(2, srcFrac * src.h);

      const srcY = src.y + srcOffsets[src.id];
      const dstY = dst.y + dstOffsets[dst.id];

      srcOffsets[src.id] += srcFrac * src.h;
      dstOffsets[dst.id] += dstFrac * dst.h;

      return {
        srcNode: src,
        dstNode: dst,
        value: l.value,
        srcY,
        dstY,
        thickness,
        color: src.color,
      };
    })
    .filter(Boolean);

  return { nodes: Object.values(nodeMap), links };
}

/* ── component ── */
function SankeyDiagram() {
  const [data, setData] = useState<SankeyData | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .getSankeyFlows()
        .then((d) => setData(d as SankeyData))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const W = 600;
  const H = 280;
  const layout = useMemo(
    () => (data ? layoutSankey(data, W, H) : { nodes: [], links: [] }),
    [data]
  );

  if (!data)
    return (
      <div
        className="h-full flex items-center justify-center text-sm"
        style={{ color: "var(--color-text-dim)" }}
      >
        Loading sankey…
      </div>
    );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%" }}
      >
        {/* Links */}
        {layout.links.map((l, i) => {
          const x0 = l.srcNode.x + 14;
          const x1 = l.dstNode.x;
          const mx = (x0 + x1) / 2;
          const active = hover === `link-${i}`;

          return (
            <path
              key={`link-${i}`}
              d={`M${x0},${l.srcY + l.thickness / 2}
                  C${mx},${l.srcY + l.thickness / 2}
                   ${mx},${l.dstY + l.thickness / 2}
                   ${x1},${l.dstY + l.thickness / 2}`}
              fill="none"
              stroke={l.color}
              strokeWidth={l.thickness}
              strokeOpacity={active ? 0.7 : 0.25}
              onMouseEnter={() => setHover(`link-${i}`)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "stroke-opacity 0.2s" }}
            />
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={14}
              height={n.h}
              rx={3}
              fill={n.color}
              opacity={0.85}
            />
            <text
              x={n.col === 2 ? n.x - 4 : n.x + 18}
              y={n.y + n.h / 2 + 3.5}
              textAnchor={n.col === 2 ? "end" : "start"}
              fontSize={9}
              fill="var(--color-text)"
              fontFamily="var(--font-mono, monospace)"
            >
              {n.id.length > 18 ? n.id.slice(0, 16) + "…" : n.id}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip for hovered link */}
      {hover?.startsWith("link-") && (() => {
        const idx = parseInt(hover.replace("link-", ""));
        const l = layout.links[idx];
        if (!l) return null;
        return (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 11,
              color: "var(--color-text)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <strong>{l.srcNode.id}</strong> → <strong>{l.dstNode.id}</strong>
            <br />
            {fmtBytes(l.value)}
          </div>
        );
      })()}
    </div>
  );
}

export default memo(SankeyDiagram);
