"use client";
import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";

type Probe = {
  ID: number;
  target: string;
  type: string;
  interval: number;
};

type SLAPoint = {
  ts: number;
  response_ms: number;
  uptime: number;  // 100 = up, 0 = down
};

function fmtMs(ms: number) {
  return ms >= 1000 ? (ms / 1000).toFixed(2) + "s" : ms.toFixed(1) + "ms";
}

function calcSla(pts: SLAPoint[]) {
  if (!pts.length) return null;
  const upCount = pts.filter(p => p.uptime === 100).length;
  const sla = (upCount / pts.length) * 100;
  const validMs = pts.filter(p => p.uptime === 100).map(p => p.response_ms);
  const avgMs = validMs.length ? validMs.reduce((a, b) => a + b, 0) / validMs.length : 0;
  const maxMs = validMs.length ? Math.max(...validMs) : 0;
  return { sla, avgMs, maxMs, incidents: pts.length - upCount };
}

const PROBE_TYPE_ICON: Record<string, string> = {
  ICMP: "sensors", HTTP: "http", HTTPS: "https", DNS: "dns", TCP: "lan",
};

export default function SLAPage() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [selectedProbe, setSelectedProbe] = useState<Probe | null>(null);
  const [metrics, setMetrics] = useState<SLAPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProbes()
      .then(data => {
        const arr = (data || []) as Probe[];
        setProbes(arr);
        if (arr.length > 0) setSelectedProbe(arr[0]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProbe) return;
    const fetchSla = () => {
      api.getSLAMetrics(selectedProbe.ID)
        .then(data => setMetrics((data as SLAPoint[]) || []))
        .catch(console.error);
    };
    fetchSla();
    const t = setInterval(fetchSla, 15_000);
    return () => clearInterval(t);
  }, [selectedProbe]);

  const stats = calcSla(metrics);
  const slaColor = !stats ? "var(--color-text-dim)"
    : stats.sla >= 99.9 ? "#25f46a"
    : stats.sla >= 99.0 ? "#fbbf24"
    : "#ef4444";

  const kpis = [
    { label: "SLA (60 min)", value: stats ? stats.sla.toFixed(2) + "%" : "—", color: slaColor },
    { label: "Avg Latency",  value: stats ? fmtMs(stats.avgMs) : "—", color: "var(--color-primary)" },
    { label: "Peak Latency", value: stats ? fmtMs(stats.maxMs) : "—", color: "var(--color-text-dim)" },
    { label: "Incidents",    value: stats ? String(stats.incidents) : "—", color: stats?.incidents ? "#ef4444" : "var(--color-text-dim)" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>SLA &amp; Synthetic Monitoring</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
          Probe health &amp; latency — 15s auto-refresh
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Sidebar — probe list */}
        <div className="lg:w-64 shrink-0 rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-dim)" }}>
            Probes
          </div>
          {loading ? (
            <div className="text-sm py-4 text-center" style={{ color: "var(--color-text-dim)" }}>Loading…</div>
          ) : probes.length === 0 ? (
            <div className="text-sm py-4 text-center" style={{ color: "var(--color-text-dim)" }}>No probes configured.</div>
          ) : probes.map(p => {
            const icon = PROBE_TYPE_ICON[p.type] ?? "monitor_heart";
            const active = selectedProbe?.ID === p.ID;
            return (
              <button key={p.ID} onClick={() => setSelectedProbe(p)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                style={{
                  background: active ? "rgba(var(--color-primary-raw),.12)" : "transparent",
                  border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                  color: active ? "var(--color-primary)" : "var(--color-text)",
                }}>
                <span className="material-symbols-outlined text-sm">{icon}</span>
                <span className="flex-1 text-sm font-medium truncate">{p.target}</span>
                <span className="text-xs" style={{ color: "var(--color-text-dim)" }}>{p.type}</span>
              </button>
            );
          })}
        </div>

        {/* Main panel */}
        <div className="flex-1 flex flex-col gap-4">
          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="rounded-xl p-4"
                style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
                <div className="text-xs mb-1" style={{ color: "var(--color-text-dim)" }}>{k.label}</div>
                <div className="text-2xl font-bold font-metric" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="rounded-2xl p-5"
            style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-base" style={{ color: "var(--color-primary)" }}>ssid_chart</span>
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {selectedProbe ? `${selectedProbe.target} — Latency & Uptime` : "Select a probe"}
              </span>
            </div>
            <div className="h-64 w-full">
              {!selectedProbe ? (
                <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
                  Select a probe from the left panel.
                </div>
              ) : metrics.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
                  No SLA data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metrics} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="ts"
                      tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      stroke="var(--color-text-dim)" fontSize={11} tickLine={false}
                    />
                    <YAxis yAxisId="ms" stroke="var(--color-text-dim)" fontSize={11} tickLine={false} axisLine={false}
                      tickFormatter={v => fmtMs(v)} />
                    <YAxis yAxisId="up" orientation="right" hide domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--color-surface-2)", borderColor: "var(--color-border)", borderRadius: 8 }}
                      labelFormatter={v => new Date(v).toLocaleTimeString()}
                      formatter={((v: any, name: any) => name === "response_ms" ? [fmtMs(v), "Latency"] : [v === 100 ? "UP" : "DOWN", "Status"]) as any}
                    />
                    {/* Downtime bars as red background */}
                    <Bar yAxisId="up" dataKey="uptime" fill="rgba(239,68,68,.08)" barSize={8} name="uptime" isAnimationActive={false} />
                    <Line yAxisId="ms" type="monotone" dataKey="response_ms"
                      stroke="var(--color-primary)" strokeWidth={2} dot={false} name="response_ms" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
