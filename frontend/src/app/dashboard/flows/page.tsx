"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { api } from "@/lib/api";
import {
  SAMPLE_TALKERS, SAMPLE_BW_STATS, SAMPLE_TIME_SERIES,
  SAMPLE_APPS, SAMPLE_ASNS,
} from "@/lib/sampleFlowData";
import "./flows.css";

const GeoFlowMap    = dynamic(() => import("@/components/flows/GeoFlowMap"),    { ssr: false });
const SankeyDiagram = dynamic(() => import("@/components/flows/SankeyDiagram"), { ssr: false });

/* ── Types ── */
type Talker = {
  src_ip: string; dst_ip: string; protocol: string;
  total_bytes: number; app?: string; dst_asn_name?: string;
};
type BwStats = {
  total_gb: number; tcp_pct: number; udp_pct: number; icmp_pct: number;
  active_flows?: number;
};
type TimePoint = { bucket: string | number; in_bps: number; out_bps: number };
type AppEntry  = { app: string; bytes: number };
type ASNEntry  = { asn: number; asn_name: string; bytes: number };

/* ── Time Range Options ── */
const TIME_RANGES = [
  { value: "5m",  label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h",  label: "1 hour" },
  { value: "6h",  label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d",  label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;
type TimeRange = typeof TIME_RANGES[number]["value"];

/* ── Formatters ── */
function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(2) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(1) + " KB";
  return b + " B";
}
function fmtBps(v: number) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + " Gbps";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + " Mbps";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " Kbps";
  return v.toFixed(0) + " bps";
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ── Colours ── */
const PALETTE  = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#a3e635"];
const DONUT_COLORS = ["#6366f1","#10b981","#f59e0b","#ef4444"];
const PROTO_COLORS: Record<string, string> = { TCP:"#6366f1", UDP:"#10b981", ICMP:"#f59e0b" };

/* ── KPI gradient class map ── */
const KPI_VARIANTS: Record<string, string> = {
  primary: "kpi-card--primary",
  green:   "kpi-card--green",
  indigo:  "kpi-card--indigo",
  accent:  "kpi-card--accent",
};

/* ── Protocol Donut ── */
function ProtocolDonut({ bw }: { bw: BwStats | null }) {
  if (!bw) return <div className="h-full flex items-center justify-center text-sm" style={{ color:"var(--color-text-dim)" }}>Loading…</div>;
  const other = Math.max(0, 100 - (bw.tcp_pct + bw.udp_pct + bw.icmp_pct));
  const data = [
    { name:"TCP",  value:Math.round(bw.tcp_pct)  },
    { name:"UDP",  value:Math.round(bw.udp_pct)  },
    { name:"ICMP", value:Math.round(bw.icmp_pct) },
    { name:"Other",value:Math.round(other)       },
  ].filter(d => d.value > 0);

  return (
    <div className="flex items-center gap-6 h-full">
      <div className="flex-1 h-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius="55%" outerRadius="75%" dataKey="value" stroke="none">
              {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor:"var(--color-surface-2)", borderColor:"var(--color-border)", borderRadius:8 }}
              formatter={((v: any, name: any) => [`${v}%`, name]) as any}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background:DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span style={{ color:"var(--color-text-dim)" }}>{d.name}</span>
            <span className="ml-auto font-metric font-semibold" style={{ color:"var(--color-text)" }}>{d.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Bandwidth Timeseries Chart ── */
function BwTimeSeries({ data }: { data: TimePoint[] }) {
  if (!data.length) return (
    <div className="h-full flex items-center justify-center text-sm" style={{ color:"var(--color-text-dim)" }}>
      Loading…
    </div>
  );
  const normalized = data.map((d, i) => ({ ...d, label: `t-${(data.length - i) * 5}m` }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={normalized} margin={{ top:4, right:8, bottom:0, left:0 }}>
        <defs>
          <linearGradient id="gbIn"  x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gbOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize:10, fill:"var(--color-text-dim)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize:10, fill:"var(--color-text-dim)" }} axisLine={false} tickLine={false} tickFormatter={fmtBps} width={60} />
        <Tooltip
          contentStyle={{ backgroundColor:"var(--color-surface-2)", borderColor:"var(--color-border)", borderRadius:8 }}
          formatter={(v: any, name: any) => [fmtBps(v), name === "in_bps" ? "Inbound" : "Outbound"]}
          labelStyle={{ color:"var(--color-text-dim)", fontSize:11 }}
        />
        <Area type="monotone" dataKey="in_bps"  stroke="#6366f1" strokeWidth={2} fill="url(#gbIn)"  dot={false} name="in_bps"  />
        <Area type="monotone" dataKey="out_bps" stroke="#10b981" strokeWidth={2} fill="url(#gbOut)" dot={false} name="out_bps" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Top Applications Donut ── */
function AppsDonut({ data }: { data: AppEntry[] }) {
  if (!data.length) return <div className="h-full flex items-center justify-center text-sm" style={{ color:"var(--color-text-dim)" }}>Loading…</div>;
  const total = data.reduce((s, d) => s + d.bytes, 0);
  return (
    <div className="flex items-center gap-6 h-full">
      <div className="flex-1 h-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius="50%" outerRadius="72%" dataKey="bytes" nameKey="app" stroke="none">
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor:"var(--color-surface-2)", borderColor:"var(--color-border)", borderRadius:8 }}
              formatter={(v: any, name: any) => [fmtBytes(Number(v)), name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0 max-h-52 overflow-y-auto pr-1">
        {data.slice(0, 8).map((d, i) => (
          <div key={d.app} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background:PALETTE[i % PALETTE.length] }} />
            <span className="truncate max-w-[80px]" style={{ color:"var(--color-text-dim)" }}>{d.app}</span>
            <span className="ml-auto font-metric font-semibold tabular-nums" style={{ color:"var(--color-text)" }}>
              {total > 0 ? Math.round(d.bytes / total * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Top ASNs Horizontal Bar ── */
function ASNBars({ data }: { data: ASNEntry[] }) {
  if (!data.length) return <div className="h-full flex items-center justify-center text-sm" style={{ color:"var(--color-text-dim)" }}>Loading…</div>;
  const max = data[0]?.bytes ?? 1;
  return (
    <div className="flex flex-col gap-2 h-full overflow-y-auto pr-1">
      {data.map((d, i) => {
        const pct = (d.bytes / max) * 100;
        return (
          <div key={d.asn} className="flex items-center gap-3">
            <span className="w-5 shrink-0 text-right text-xs font-semibold" style={{ color:"var(--color-text-dim)" }}>{i+1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="text-xs font-semibold truncate" style={{ color:"var(--color-text)" }}>{d.asn_name || `AS${d.asn}`}</span>
                <span className="text-[10px]" style={{ color:"var(--color-text-dim)" }}>AS{d.asn}</span>
              </div>
              <div className="h-1 rounded-full" style={{ background:"var(--color-border)" }}>
                <div className="h-full rounded-full transition-all" style={{ width:`${pct}%`, background:PALETTE[i % PALETTE.length] }} />
              </div>
            </div>
            <span className="text-xs font-metric shrink-0" style={{ color:"var(--color-text-dim)" }}>{fmtBytes(d.bytes)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Protocol badge ── */
function ProtoBadge({ p }: { p: string }) {
  const c = PROTO_COLORS[p] ?? "#71717a";
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold"
      style={{ background:c+"22", color:c, border:`1px solid ${c}44` }}>
      {p}
    </span>
  );
}

/* ── Page ── */
export default function FlowsPage() {
  const [topTalkers, setTopTalkers] = useState<Talker[]>(SAMPLE_TALKERS);
  const [bwStats,    setBwStats]    = useState<BwStats | null>(SAMPLE_BW_STATS);
  const [timeSeries, setTimeSeries] = useState<TimePoint[]>(SAMPLE_TIME_SERIES);
  const [topApps,    setTopApps]    = useState<AppEntry[]>(SAMPLE_APPS);
  const [topASNs,    setTopASNs]    = useState<ASNEntry[]>(SAMPLE_ASNS);
  const [loading,    setLoading]    = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [range,      setRange]      = useState<TimeRange>("5m");
  const [usingDemo,  setUsingDemo]  = useState(true);

  const rangeLabel = TIME_RANGES.find(r => r.value === range)?.label ?? range;

  useEffect(() => {
    setLoading(true);
    const fetchAll = () => {
      Promise.allSettled([
        api.getTopTalkers(range).then(d => {
          const rows = (d as any) ?? [];
          setTopTalkers(rows.length > 0 ? rows : SAMPLE_TALKERS);
          if (rows.length > 0) setUsingDemo(false);
        }),
        api.getFlowBandwidth(range).then(d => {
          const stats = (d as any) ?? null;
          setBwStats(stats && (stats.active_flows ?? 0) + (stats.total_gb ?? 0) > 0 ? stats : SAMPLE_BW_STATS);
          if (stats && (stats.active_flows ?? 0) > 0) setUsingDemo(false);
        }),
        api.getFlowTimeSeries(range).then(d => {
          const pts = (d as any) ?? [];
          setTimeSeries(pts.length > 0 ? pts : SAMPLE_TIME_SERIES);
        }),
        api.getTopApplications(range).then(d => {
          const apps = (d as any) ?? [];
          setTopApps(apps.length > 0 ? apps : SAMPLE_APPS);
        }),
        api.getTopASNs(range).then(d => {
          const asns = (d as any) ?? [];
          setTopASNs(asns.length > 0 ? asns : SAMPLE_ASNS);
        }),
      ]).finally(() => { setLoading(false); setLastUpdate(new Date()); });
    };
    fetchAll();
    const t = setInterval(fetchAll, 30_000);
    return () => clearInterval(t);
  }, [range]);


  const maxBytes   = topTalkers[0]?.total_bytes ?? 1;
  const totalBytes = topTalkers.reduce((s, t) => s + (t.total_bytes ?? 0), 0);

  const kpis = [
    { label:`Total Volume (${rangeLabel})`, value:loading ? "—" : (bwStats ? bwStats.total_gb.toFixed(2)+" GB" : "—"), color:"var(--color-primary)", icon:"storage",     variant:"primary" },
    { label:"Active Flows",      value:loading ? "—" : (bwStats ? String(bwStats.active_flows ?? "—") : "—"), color:"#10b981",               icon:"stream",      variant:"green",  pulse: !loading && (bwStats?.active_flows ?? 0) > 0 },
    { label:"TCP Share",         value:loading ? "—" : (bwStats ? bwStats.tcp_pct.toFixed(0)+"%" : "—"),     color:"#6366f1",               icon:"sync_alt",    variant:"indigo" },
    { label:"Top Talkers",       value:loading ? "—" : String(topTalkers.length),                            color:"var(--color-accent)",   icon:"leaderboard", variant:"accent" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header + Time Range Picker */}
      <div className="flow-animate flow-animate-d1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" style={{ color:"var(--color-text)" }}>NetFlow Analytics</h1>
            {usingDemo && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ background:"#f59e0b22", color:"#f59e0b", border:"1px solid #f59e0b44" }}>
                Demo Data
              </span>
            )}
          </div>
          <p className="text-sm mt-0.5" style={{ color:"var(--color-text-dim)" }}>
            {usingDemo
              ? "Showing sample data — waiting for real NetFlow traffic…"
              : "Real-time flow telemetry — 30s auto-refresh"}
          </p>
        </div>
        <div className="time-range-bar flex items-center gap-1 p-1 rounded-xl"
          style={{ background:"var(--color-surface-2)", border:"1px solid var(--color-border)" }}>
          {TIME_RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`time-range-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                range === r.value ? "time-range-pill--active" : ""
              }`}
              style={{
                background: range === r.value ? "var(--color-primary)" : "transparent",
                color: range === r.value ? "#fff" : "var(--color-text-dim)",
                boxShadow: range === r.value ? "0 2px 8px rgba(99,102,241,0.3)" : "none",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flow-animate flow-animate-d2">
        {kpis.map(k => (
          <div key={k.label} className={`kpi-card ${KPI_VARIANTS[k.variant] ?? ""} rounded-xl p-4`}
            style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-sm" style={{ color:k.color }}>{k.icon}</span>
              <span className="text-xs" style={{ color:"var(--color-text-dim)" }}>{k.label}</span>
              {k.pulse && <span className="pulse-dot ml-auto" />}
            </div>
            <div className="text-2xl font-bold font-metric" style={{ color:k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Bandwidth Timeseries — full width */}
      <div className="flow-card rounded-2xl p-5 flow-animate flow-animate-d3"
        style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color:"var(--color-primary)" }}>show_chart</span>
          <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Bandwidth ({rangeLabel})</span>
          <div className="ml-auto flex items-center gap-4 text-xs" style={{ color:"var(--color-text-dim)" }}>
            <span className="last-updated">Updated {fmtTime(lastUpdate)}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded inline-block" style={{ background:"#6366f1" }} /> Inbound</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded inline-block" style={{ background:"#10b981" }} /> Outbound</span>
          </div>
        </div>
        <div className="h-56">
          <BwTimeSeries data={timeSeries} />
        </div>
      </div>

      {/* Second row: Protocol Donut | Top Talkers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flow-animate flow-animate-d4">
        {/* Protocol Donut */}
        <div className="flow-card rounded-2xl p-5"
          style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-base" style={{ color:"var(--color-primary)" }}>donut_small</span>
            <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Protocol Breakdown</span>
            {bwStats && (
              <span className="ml-auto text-xs font-metric" style={{ color:"var(--color-text-dim)" }}>
                {bwStats.total_gb.toFixed(2)} GB / {rangeLabel}
              </span>
            )}
          </div>
          <div className="h-52"><ProtocolDonut bw={bwStats} /></div>
        </div>

        {/* Top Talkers */}
        <div className="flow-card rounded-2xl overflow-hidden"
          style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor:"var(--color-border)" }}>
            <span className="material-symbols-outlined text-base" style={{ color:"var(--color-accent)" }}>leaderboard</span>
            <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Top Talkers ({rangeLabel})</span>
            <span className="ml-auto text-xs font-metric" style={{ color:"var(--color-text-dim)" }}>
              {fmtBytes(totalBytes)} total
            </span>
          </div>
          <div className="overflow-y-auto max-h-52">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm" style={{ color:"var(--color-text-dim)" }}>Loading…</div>
            ) : topTalkers.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-sm" style={{ color:"var(--color-text-dim)" }}>No flow data collected yet.</div>
            ) : topTalkers.map((t, i) => {
              const pct = (t.total_bytes / maxBytes) * 100;
              return (
                <div key={i} className="talker-row px-5 py-2.5 flex items-center gap-3"
                  style={{ borderBottom:"1px solid var(--color-border)" }}>
                  <span className="w-5 shrink-0 text-right text-xs font-semibold" style={{ color:"var(--color-text-dim)" }}>{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-xs truncate" style={{ color:"var(--color-text)" }}>{t.src_ip}</span>
                      <span className="text-[10px]" style={{ color:"var(--color-text-dim)" }}>→</span>
                      <span className="font-mono text-xs truncate" style={{ color:"var(--color-text-dim)" }}>{t.dst_ip}</span>
                      {t.dst_asn_name && (
                        <span className="text-[10px] px-1 rounded" style={{ color:"var(--color-text-dim)", background:"var(--color-surface-2)" }}>
                          {t.dst_asn_name}
                        </span>
                      )}
                    </div>
                    <div className="h-1 rounded-full" style={{ background:"var(--color-border)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width:`${pct}%`, background:"var(--color-primary)" }} />
                    </div>
                    {t.app && (
                      <span className="text-[10px] mt-0.5 inline-block" style={{ color:"var(--color-text-dim)" }}>app: {t.app}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ProtoBadge p={t.protocol} />
                    <span className="text-xs font-metric" style={{ color:"var(--color-text-dim)" }}>{fmtBytes(t.total_bytes)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Third row: Top Applications | Top ASNs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flow-animate flow-animate-d5">
        {/* Top Applications */}
        <div className="flow-card rounded-2xl p-5"
          style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-base" style={{ color:"#f59e0b" }}>apps</span>
            <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Top Applications ({rangeLabel})</span>
          </div>
          <div className="h-52"><AppsDonut data={topApps} /></div>
        </div>

        {/* Top ASNs */}
        <div className="flow-card rounded-2xl p-5"
          style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-base" style={{ color:"#3b82f6" }}>public</span>
            <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Top Destination ASNs ({rangeLabel})</span>
          </div>
          <div className="h-52"><ASNBars data={topASNs} /></div>
        </div>
      </div>

      {/* ── Row 4 – Full-width Geo Traffic Map ── */}
      <div className="flow-card rounded-2xl p-5 flow-animate flow-animate-d6"
        style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color:"#6366f1" }}>travel_explore</span>
          <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Geographic Traffic ({rangeLabel})</span>
          <div className="ml-auto map-legend">
            <span className="flex items-center gap-1"><span className="map-legend-dot" style={{ background:"#8b5cf6" }} /> Source</span>
            <span className="flex items-center gap-1"><span className="map-legend-dot" style={{ background:"#10b981" }} /> Destination</span>
          </div>
        </div>
        <div className="h-[340px]"><GeoFlowMap range={range} /></div>
      </div>

      {/* ── Row 5 – Full-width Sankey Diagram ── */}
      <div className="flow-card rounded-2xl p-5 flow-animate flow-animate-d6"
        style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color:"#8b5cf6" }}>account_tree</span>
          <span className="text-sm font-semibold" style={{ color:"var(--color-text)" }}>Traffic Flow: Source → Protocol → App ({rangeLabel})</span>
        </div>
        <div className="h-[340px]"><SankeyDiagram range={range} /></div>
      </div>
    </div>
  );
}
