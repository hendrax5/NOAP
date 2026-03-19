"use client";
import { useEffect, useState, memo, useMemo } from "react";
import { api } from "@/lib/api";
import { SAMPLE_SANKEY } from "@/lib/sampleFlowData";


/* ── types ── */
type SankeyData = {
  nodes: { id: string }[];
  links: { source: string; target: string; value: number }[];
};

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

const COLORS = [
  "#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6",
  "#ec4899","#8b5cf6","#14b8a6","#f97316","#a3e635",
];

/* ── layout engine ── */
type LayoutNode = {
  id: string; x: number; y: number; h: number;
  col: number; total: number; color: string;
};
type LayoutLink = {
  srcNode: LayoutNode; dstNode: LayoutNode; value: number;
  srcY: number; dstY: number; thickness: number; color: string;
};

function layoutSankey(
  data: SankeyData, W: number, H: number
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  if (!data?.nodes?.length) return { nodes:[], links:[] };

  const sourceSet = new Set(data.links.map(l => l.source));
  const targetSet = new Set(data.links.map(l => l.target));

  const left = data.nodes.filter(n => sourceSet.has(n.id) && !targetSet.has(n.id));
  const right = data.nodes.filter(n => targetSet.has(n.id) && !sourceSet.has(n.id));
  const middle = data.nodes.filter(n => sourceSet.has(n.id) && targetSet.has(n.id));

  const cols = [left, middle.length ? middle : [], right];
  const nodeW = 14;
  const pad = 6;
  const colX = [24, W / 2 - nodeW / 2, W - nodeW - 24];

  const totals: Record<string, number> = {};
  data.links.forEach(l => {
    totals[l.source] = (totals[l.source] ?? 0) + l.value;
    totals[l.target] = (totals[l.target] ?? 0) + l.value;
  });

  const nodeMap: Record<string, LayoutNode> = {};
  let colorIdx = 0;

  cols.forEach((col, ci) => {
    if (!col.length) return;
    const colTotal = col.reduce((s, n) => s + (totals[n.id] ?? 1), 0);
    const availH = H - pad * (col.length - 1) - 40;
    let yOff = 30; // leave room for column labels

    col
      .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
      .forEach(n => {
        const t = totals[n.id] ?? 1;
        const h = Math.max(8, (t / colTotal) * availH);
        nodeMap[n.id] = {
          id: n.id, x: colX[ci], y: yOff, h, col: ci,
          total: t, color: COLORS[colorIdx++ % COLORS.length],
        };
        yOff += h + pad;
      });
  });

  // links
  const srcOffsets: Record<string, number> = {};
  const dstOffsets: Record<string, number> = {};
  Object.keys(nodeMap).forEach(id => { srcOffsets[id] = 0; dstOffsets[id] = 0; });

  const links: LayoutLink[] = data.links
    .sort((a, b) => b.value - a.value)
    .map(l => {
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

      return { srcNode:src, dstNode:dst, value:l.value, srcY, dstY, thickness, color:src.color };
    })
    .filter(Boolean);

  return { nodes: Object.values(nodeMap), links };
}

/* ── component ── */
function SankeyDiagram({ range = "5m" }: { range?: string }) {
  const [data, setData] = useState<SankeyData | null>(SAMPLE_SANKEY as SankeyData);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api.getSankeyFlows(range).then(d => {
        const sd = d as SankeyData;
        if (sd?.nodes?.length) setData(sd);
      }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [range]);


  const W = 600;
  const H = 300;
  const layout = useMemo(
    () => (data ? layoutSankey(data, W, H) : { nodes:[], links:[] }),
    [data]
  );

  if (!data)
    return (
      <div className="h-full flex items-center justify-center text-sm"
        style={{ color:"var(--color-text-dim)" }}>
        Loading sankey…
      </div>
    );

  const colLabels = ["Sources", "Transit", "Destinations"];
  const colX = [24, W / 2, W - 24];

  return (
    <div style={{ width:"100%", height:"100%", position:"relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
        style={{ width:"100%", height:"100%" }}>
        {/* Gradient defs for links */}
        <defs>
          {layout.links.map((l, i) => (
            <linearGradient key={`lg-${i}`} id={`sankey-grad-${i}`}
              x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={l.srcNode.color} stopOpacity={0.6} />
              <stop offset="100%" stopColor={l.dstNode.color} stopOpacity={0.3} />
            </linearGradient>
          ))}
        </defs>

        {/* Column labels */}
        {colLabels.map((lbl, ci) => (
          <text key={lbl} x={colX[ci]}
            y={16}
            textAnchor={ci === 0 ? "start" : ci === 2 ? "end" : "middle"}
            fontSize={10} fontWeight={600}
            fill="var(--color-text-dim)"
            fontFamily="var(--font-mono, monospace)"
          >
            {lbl}
          </text>
        ))}

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
              stroke={active ? l.color : `url(#sankey-grad-${i})`}
              strokeWidth={l.thickness}
              strokeOpacity={active ? 0.8 : 0.35}
              onMouseEnter={() => setHover(`link-${i}`)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor:"pointer", transition:"stroke-opacity 0.2s" }}
            />
          );
        })}

        {/* Nodes */}
        {layout.nodes.map(n => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={14} height={n.h} rx={4}
              fill={n.color} opacity={0.85} />
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

      {/* Tooltip */}
      {hover?.startsWith("link-") && (() => {
        const idx = parseInt(hover.replace("link-", ""));
        const l = layout.links[idx];
        if (!l) return null;
        return (
          <div
            style={{
              position:"absolute", top:8, left:8,
              background:"var(--color-surface-2)", border:"1px solid var(--color-border)",
              borderRadius:8, padding:"6px 12px", fontSize:11,
              color:"var(--color-text)", pointerEvents:"none", zIndex:10,
              backdropFilter:"blur(8px)",
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
