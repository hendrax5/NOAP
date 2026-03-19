"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type Probe = {
  ID: number;
  target: string;
  type: string;    // "icmp" | "tcp" | "http"
  interval: number;
  TenantID: number;
};

type SLAPoint = {
  ts: number;
  response_ms: number;
  uptime: number;
};

type ProbeStatus = {
  probe: Probe;
  latestMs: number | null;
  uptime: number;     // 0‑100
  status: "UP" | "DOWN" | "UNKNOWN";
};

const PROBE_TYPES = ["icmp", "tcp", "http"] as const;

// ── Utilities ────────────────────────────────────────────────────────────────
function statusColor(s: "UP" | "DOWN" | "UNKNOWN") {
  if (s === "UP")   return "#25f46a";
  if (s === "DOWN") return "#ef4444";
  return "#6b7280";
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-xl"
      style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border-hover)" }}
    >
      <div style={{ color: "var(--color-text-dim)" }}>{fmtTime(label)}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color ?? "var(--color-text)" }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</strong>
          {p.name === "Latency" ? " ms" : "%"}
        </div>
      ))}
    </div>
  );
}

// ── Create Probe Modal ───────────────────────────────────────────────────────
function CreateProbeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Probe) => void }) {
  const [target, setTarget] = useState("");
  const [type, setType] = useState<typeof PROBE_TYPES[number]>("icmp");
  const [interval, setInterval] = useState(30);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const created: Probe = await api.createProbe({ target, type, interval }) as Probe;
      onCreated(created);
    } catch (e: any) {
      setErr(e.message ?? "Failed to create probe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border-hover)" }}
      >
        <h3 className="text-base font-bold mb-5" style={{ color: "var(--color-text)" }}>
          Add Probe
        </h3>
        {err && (
          <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,.1)", color: "#ef4444" }}>
            {err}
          </p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Target */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-dim)" }}>Target (IP / hostname)</span>
            <input
              required
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              placeholder="8.8.8.8"
              value={target}
              onChange={e => setTarget(e.target.value)}
            />
          </label>

          {/* Type */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-dim)" }}>Probe type</span>
            <select
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              value={type}
              onChange={e => setType(e.target.value as typeof PROBE_TYPES[number])}
            >
              {PROBE_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </label>

          {/* Interval */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-dim)" }}>Interval (seconds)</span>
            <input
              type="number"
              min={5}
              max={300}
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              value={interval}
              onChange={e => setInterval(Number(e.target.value))}
            />
          </label>

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm font-semibold"
              style={{ background: "var(--color-surface-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-xl text-sm font-bold"
              style={{ background: "var(--color-primary)", color: "#0a0a0c", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProbesPage() {
  const [probes, setProbes]               = useState<Probe[]>([]);
  const [statuses, setStatuses]           = useState<Map<number, ProbeStatus>>(new Map());
  const [selected, setSelected]           = useState<Probe | null>(null);
  const [metrics, setMetrics]             = useState<SLAPoint[]>([]);
  const [loadingProbes, setLoadingProbes] = useState(true);
  const [loadingChart, setLoadingChart]   = useState(false);
  const [showCreate, setShowCreate]       = useState(false);
  const intervalRef                        = useRef<NodeJS.Timeout | null>(null);

  // Load probes
  useEffect(() => {
    api.getProbes()
      .then((data: any[]) => {
        const ps = data ?? [];
        setProbes(ps);
        if (ps.length > 0) setSelected(ps[0]);
      })
      .catch(console.error)
      .finally(() => setLoadingProbes(false));
  }, []);

  // Compute quick status for each probe (from SLA last point)
  const refreshStatuses = useCallback(async () => {
    if (probes.length === 0) return;
    const updates = new Map<number, ProbeStatus>();
    await Promise.allSettled(
      probes.map(async (p) => {
        try {
          const pts = (await api.getSLAMetrics(p.ID)) as SLAPoint[];
          const last = pts?.[pts.length - 1];
          updates.set(p.ID, {
            probe: p,
            latestMs: last?.response_ms ?? null,
            uptime: last?.uptime ?? 100,
            status: last ? (last.uptime >= 50 ? "UP" : "DOWN") : "UNKNOWN",
          });
        } catch {
          updates.set(p.ID, { probe: p, latestMs: null, uptime: 0, status: "UNKNOWN" });
        }
      })
    );
    setStatuses(updates);
  }, [probes]);

  useEffect(() => {
    if (probes.length === 0) return;
    refreshStatuses();
    const t = setInterval(refreshStatuses, 15_000);
    return () => clearInterval(t);
  }, [refreshStatuses, probes]);

  // Load chart for selected probe
  useEffect(() => {
    if (!selected) return;
    setLoadingChart(true);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const fetch = () =>
      api.getSLAMetrics(selected.ID)
        .then((d: any) => setMetrics((d ?? []) as SLAPoint[]))
        .catch(console.error)
        .finally(() => setLoadingChart(false));

    fetch();
    intervalRef.current = setInterval(fetch, 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [selected]);

  // Stats from chart data
  const avgMs = metrics.length > 0
    ? metrics.reduce((s, p) => s + p.response_ms, 0) / metrics.length
    : null;
  const uptimePct = metrics.length > 0
    ? (metrics.filter(p => p.uptime >= 50).length / metrics.length) * 100
    : null;
  const maxMs = metrics.length > 0
    ? Math.max(...metrics.map(p => p.response_ms))
    : null;

  const selStatus = selected ? statuses.get(selected.ID) : null;

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
            SLA &amp; Probes
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            ICMP · TCP · HTTP synthetic monitoring — 15s refresh
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: "var(--color-primary)", color: "#0a0a0c" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Add Probe
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* ── Probe list ── */}
        <div
          className="lg:w-72 shrink-0 flex flex-col gap-2 rounded-2xl p-4 overflow-y-auto"
          style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-dim)" }}>
            Configured Probes
          </p>

          {loadingProbes && (
            <div className="text-xs animate-pulse" style={{ color: "var(--color-text-dim)" }}>Loading…</div>
          )}

          {!loadingProbes && probes.length === 0 && (
            <div className="text-xs flex flex-col items-center gap-1 py-6" style={{ color: "var(--color-text-dim)" }}>
              <span className="material-symbols-outlined text-2xl">radar</span>
              <span>No probes yet</span>
            </div>
          )}

          {probes.map(p => {
            const st = statuses.get(p.ID);
            const isSelected = selected?.ID === p.ID;
            return (
              <button
                key={p.ID}
                onClick={() => setSelected(p)}
                className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                style={{
                  background: isSelected ? "var(--color-primary-muted)" : "var(--color-surface-2)",
                  border: `1px solid ${isSelected ? "var(--color-primary)40" : "var(--color-border)"}`,
                }}
              >
                {/* Status dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: statusColor(st?.status ?? "UNKNOWN") }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                    {p.target}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {p.type.toUpperCase()} · {p.interval}s
                  </div>
                </div>
                {st?.latestMs != null && (
                  <span className="text-xs font-metric shrink-0" style={{ color: statusColor(st.status) }}>
                    {st.latestMs.toFixed(0)}ms
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Detail panel ── */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {!selected ? (
            <div
              className="flex-1 rounded-2xl flex items-center justify-center text-sm"
              style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", color: "var(--color-text-dim)" }}
            >
              Select a probe
            </div>
          ) : (
            <>
              {/* Probe header */}
              <div
                className="rounded-2xl p-4 flex items-center justify-between"
                style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ background: statusColor(selStatus?.status ?? "UNKNOWN") }}
                  />
                  <div>
                    <div className="text-base font-bold" style={{ color: "var(--color-text)" }}>{selected.target}</div>
                    <div className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                      {selected.type.toUpperCase()} probe · every {selected.interval}s
                    </div>
                  </div>
                </div>
                <span
                  className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: `${statusColor(selStatus?.status ?? "UNKNOWN")}20`, color: statusColor(selStatus?.status ?? "UNKNOWN") }}
                >
                  {selStatus?.status ?? "UNKNOWN"}
                </span>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Avg Latency", value: avgMs != null ? `${avgMs.toFixed(1)} ms` : "—", color: "var(--color-primary)" },
                  { label: "SLA Uptime",  value: uptimePct != null ? `${uptimePct.toFixed(2)}%` : "—", color: uptimePct != null && uptimePct >= 99 ? "#25f46a" : "#f59e0b" },
                  { label: "Peak Latency", value: maxMs != null ? `${maxMs.toFixed(0)} ms` : "—", color: "#f97316" },
                ].map(k => (
                  <div
                    key={k.label}
                    className="rounded-xl p-4"
                    style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
                  >
                    <div className="text-xs mb-1" style={{ color: "var(--color-text-dim)" }}>{k.label}</div>
                    <div className="text-xl font-bold font-metric" style={{ color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Latency chart */}
              <div
                className="rounded-2xl p-4 flex-1"
                style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-dim)" }}>
                    Latency (ms) — last 60 samples
                  </p>
                  {loadingChart && (
                    <span className="text-xs animate-pulse" style={{ color: "var(--color-text-dim)" }}>refreshing…</span>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={metrics} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradLatency" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="ts" tickFormatter={fmtTime} stroke="var(--color-border)" fontSize={11} tickLine={false} />
                    <YAxis stroke="var(--color-border)" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="response_ms"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#gradLatency)"
                      dot={false}
                      name="Latency"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Uptime bar chart */}
              <div
                className="rounded-2xl p-4"
                style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
              >
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-dim)" }}>
                  Availability (%) — last 60 samples
                </p>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={metrics} margin={{ top: 0, right: 4, left: -20, bottom: 0 }} barSize={4}>
                    <XAxis dataKey="ts" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="uptime" name="Uptime" radius={[2, 2, 0, 0]}
                      fill="#25f46a"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create probe modal */}
      {showCreate && (
        <CreateProbeModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            setProbes(prev => [...prev, p]);
            setSelected(p);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
