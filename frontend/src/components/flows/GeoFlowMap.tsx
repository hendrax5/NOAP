"use client";
import { useEffect, useState, memo, useMemo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from "react-simple-maps";
import { api } from "@/lib/api";

/* ── types ── */
type Arc = {
  src_country: string;
  dst_country: string;
  src_lat: number;
  src_lon: number;
  dst_lat: number;
  dst_lon: number;
  bytes: number;
};

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

const ARC_PALETTE = [
  "#818cf8","#6366f1","#4f46e5","#a78bfa","#7c3aed",
  "#10b981","#f59e0b","#ef4444","#3b82f6","#ec4899",
];

function GeoFlowMap({ range = "5m" }: { range?: string }) {
  const [arcs, setArcs] = useState<Arc[]>([]);

  useEffect(() => {
    const load = () =>
      api.getGeoFlows(range).then(d => setArcs((d as Arc[]) ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [range]);

  const maxBytes = useMemo(() => Math.max(...arcs.map(a => a.bytes), 1), [arcs]);
  const [hover, setHover] = useState<number | null>(null);

  if (!arcs.length)
    return (
      <div className="h-full flex items-center justify-center text-sm"
        style={{ color:"var(--color-text-dim)" }}>
        Loading geo map…
      </div>
    );

  return (
    <div style={{ position:"relative", width:"100%", height:"100%" }}>
      {/* CSS for animated dash */}
      <style>{`
        @keyframes dash-flow { to { stroke-dashoffset: -40; } }
        .geo-arc { animation: dash-flow 2s linear infinite; }
      `}</style>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale:120, center:[0, 20] }}
        style={{ width:"100%", height:"100%" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="var(--color-surface-2)"
                stroke="var(--color-border)"
                strokeWidth={0.4}
                style={{
                  default:{ outline:"none" },
                  hover:{ outline:"none", fill:"var(--color-surface-3)" },
                  pressed:{ outline:"none" },
                }}
              />
            ))
          }
        </Geographies>

        {arcs.map((arc, i) => {
          const pct = arc.bytes / maxBytes;
          const sw = 1.2 + pct * 3;
          const color = ARC_PALETTE[i % ARC_PALETTE.length];
          const active = hover === i;

          return (
            <Line
              key={`${arc.src_country}-${arc.dst_country}-${i}`}
              from={[arc.src_lon, arc.src_lat]}
              to={[arc.dst_lon, arc.dst_lat]}
              stroke={active ? "#fff" : color}
              strokeWidth={active ? sw + 1 : sw}
              strokeLinecap="round"
              strokeOpacity={active ? 1 : 0.5 + pct * 0.4}
              strokeDasharray={active ? "none" : "8 6"}
              className={active ? "" : "geo-arc"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor:"pointer", transition:"stroke-width 0.2s, stroke-opacity 0.2s" }}
            />
          );
        })}

        {/* Source dots – pulsing */}
        {arcs.map((arc, i) => (
          <Marker key={`src-${i}`} coordinates={[arc.src_lon, arc.src_lat]}>
            <circle r={4} fill="#8b5cf600" stroke="#8b5cf6" strokeWidth={1.5}>
              <animate attributeName="r" values="2.5;5;2.5" dur="3s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle r={2.5} fill="#8b5cf6" stroke="#fff" strokeWidth={0.4} />
          </Marker>
        ))}

        {/* Destination dots – pulsing */}
        {arcs.map((arc, i) => (
          <Marker key={`dst-${i}`} coordinates={[arc.dst_lon, arc.dst_lat]}>
            <circle r={4} fill="#10b98100" stroke="#10b981" strokeWidth={1.5}>
              <animate attributeName="r" values="2.5;5;2.5" dur="3s" repeatCount="indefinite" begin="1.5s" />
              <animate attributeName="stroke-opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite" begin="1.5s" />
            </circle>
            <circle r={2.5} fill="#10b981" stroke="#fff" strokeWidth={0.4} />
          </Marker>
        ))}
      </ComposableMap>

      {/* Tooltip */}
      {hover !== null && arcs[hover] && (
        <div
          style={{
            position:"absolute", top:10, right:10,
            background:"var(--color-surface-2)", border:"1px solid var(--color-border)",
            borderRadius:10, padding:"8px 14px", fontSize:12,
            color:"var(--color-text)", pointerEvents:"none", zIndex:10,
            backdropFilter:"blur(8px)",
          }}
        >
          <strong>{arcs[hover].src_country} → {arcs[hover].dst_country}</strong>
          <br />
          {fmtBytes(arcs[hover].bytes)}
        </div>
      )}
    </div>
  );
}

export default memo(GeoFlowMap);
