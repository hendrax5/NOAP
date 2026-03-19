"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";

const SEV_COLORS = {
  crit: { bg: "rgba(239,68,68,0.1)", text: "#ef4444", dot: "#ef4444" },
  warn: { bg: "rgba(245,158,11,0.1)", text: "#f59e0b", dot: "#f59e0b" },
  info: { bg: "rgba(59,130,246,0.1)", text: "#3b82f6", dot: "#3b82f6" },
};

const SPARKLINE_FALLBACK = Array.from({ length: 24 }, (_, i) => ({
  h: `${i}:00`,
  latency: Math.floor(Math.random() * 40 + 5),
}));

const STAT_ICONS: Record<string, { icon: string; accent: string }> = {
  "Total Tenants":  { icon: "corporate_fare",  accent: "var(--color-info)" },
  "Active Devices": { icon: "router",           accent: "var(--color-primary)" },
  "Critical Alerts":{ icon: "warning",          accent: "var(--color-danger)" },
  "Core Bandwidth": { icon: "speed",            accent: "#818cf8" },
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [sparklineData, setSparklineData] = useState<{ h: string; latency: number }[]>([]);
  const [countdown, setCountdown] = useState(30);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = () => {
    api.getDashboardMetrics().then(setMetrics).catch(console.error);
    api.getSyslogEvents(20).then((events: any[]) => {
      const critical = (events ?? []).filter((e: any) => {
        const sev = (e.severity ?? "").toUpperCase();
        return ["EMERG","ALERT","CRIT","ERR","WARN"].includes(sev);
      });
      setAlerts(critical.slice(0, 8));
    }).catch(console.error);
    api.getICMPMetrics(0, "24h").then((rows: any) => {
      const arr = Array.isArray(rows) ? rows : [];
      if (arr.length === 0) { setSparklineData(SPARKLINE_FALLBACK); return; }
      const buckets: Record<string, number[]> = {};
      arr.forEach((r: any) => {
        const d = new Date(r.ts);
        const key = `${String(d.getHours()).padStart(2,"0")}:00`;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(r.latency ?? 0);
      });
      const data = Object.entries(buckets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([h, vals]) => ({
          h,
          latency: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        }));
      setSparklineData(data.slice(-24));
    }).catch(() => setSparklineData(SPARKLINE_FALLBACK));
  };

  useEffect(() => {
    fetchAll();
    setCountdown(30);
    const refresh = setInterval(() => {
      fetchAll();
      setCountdown(30);
    }, 30_000);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 30));
    }, 1000);
    return () => {
      clearInterval(refresh);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statItems = metrics
    ? [
        { label: "Total Tenants",  value: metrics.total_tenants },
        { label: "Active Devices", value: metrics.active_devices },
        { label: "Critical Alerts",value: metrics.critical_alerts },
        { label: "Core Bandwidth", value: metrics.total_bandwidth },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
            Network Operations Center
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            Real-time infrastructure overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/wall"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: "rgba(99,102,241,0.1)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.2)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>grid_view</span>
            Wall
          </Link>
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{
              background: "var(--color-primary-muted)",
              color: "var(--color-primary)",
              border: "1px solid var(--color-border-hover)",
            }}
          >
            <span className="status-ring status-up" />
            Live · {countdown}s
          </div>
        </div>
      </div>

      {/* Auto-refresh countdown bar */}
      <div className="countdown-bar" style={{ animation: `countdown-bar ${countdown}s linear` }} />

      {/* ── Alert Ticker ── */}
      <div
        className="glass-card rounded-xl overflow-hidden"
      >
        <div
          className="flex items-center gap-2 px-4 py-2 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="material-symbols-outlined text-sm" style={{ fontSize: 16, color: "var(--color-danger)" }}>
            campaign
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>
            Recent Critical Events
          </span>
        </div>
        <div className="flex flex-col">
          {alerts.length === 0 && (
            <div className="px-4 py-3 text-xs" style={{ color: "var(--color-text-dim)" }}>
              No critical events — all clear
            </div>
          )}
          {alerts.map((item: any, idx: number) => {
            const sev = (item.severity ?? "").toUpperCase();
            const isCrit = ["EMERG","ALERT","CRIT"].includes(sev);
            const isWarn = sev === "ERR" || sev === "WARN";
            const c = isCrit ? SEV_COLORS.crit : isWarn ? SEV_COLORS.warn : SEV_COLORS.info;
            const ts = new Date(item.ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
            return (
              <div
                key={idx}
                className="flex items-center gap-3 px-4 py-2.5 text-sm border-b"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.dot }} />
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-bold uppercase shrink-0"
                  style={{ background: c.bg, color: c.text }}
                >
                  {sev}
                </span>
                <span className="flex-1 truncate font-metric" style={{ color: "var(--color-text)" }}>
                  {item.message}
                </span>
                <span className="font-metric text-xs shrink-0" style={{ color: "var(--color-text-dim)" }}>
                  device-{item.device_id}
                </span>
                <span className="font-metric text-xs shrink-0" style={{ color: "var(--color-text-dim)" }}>
                  {ts}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Stat Cards ── */}
      {metrics ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statItems.map((stat) => {
            const meta = STAT_ICONS[stat.label];
            return (
              <div
                key={stat.label}
                className="glass-card border-gradient rounded-xl p-5 flex items-center gap-4"
              >
                <div
                  className="flex items-center justify-center rounded-xl shrink-0"
                  style={{
                    width: 44,
                    height: 44,
                    background: `${meta.accent}18`,
                    border: `1px solid ${meta.accent}30`,
                    color: meta.accent,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                    {meta.icon}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--color-text-dim)" }}>
                    {stat.label}
                  </p>
                  <p className="text-2xl font-bold mt-0.5" style={{ color: "var(--color-text)" }}>
                    {stat.value}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* ── Bandwidth Sparkline ── */}
      <div
        className="glass-card rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Avg ICMP Latency — 24h
          </h3>
          <span className="text-xs font-metric" style={{ color: "var(--color-text-dim)" }}>
            ms
          </span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={sparklineData.length ? sparklineData : SPARKLINE_FALLBACK}>
            <defs>
              <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#25f46a" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#25f46a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="h" tick={{ fontSize: 10, fill: "var(--color-text-dim)" }} tickLine={false} axisLine={false} interval={3} />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border-hover)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-text)",
              }}
            />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#25f46a"
              strokeWidth={2}
              fill="url(#bwGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Tenant Health Table ── */}
      {metrics && (
        <div
          className="glass-card rounded-xl"
        >
          <div
            className="flex items-center gap-2 px-5 py-3 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-primary)" }}>
              verified_user
            </span>
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Tenant Health Status
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Tenant", "Devices", "Uptime SLA", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-text-dim)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.tenant_health?.map((t: any, idx: number) => (
                  <tr
                    key={idx}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                          style={{
                            background: "var(--color-primary-muted)",
                            color: "var(--color-primary)",
                            border: "1px solid var(--color-border-hover)",
                          }}
                        >
                          {t.code}
                        </div>
                        <span style={{ color: "var(--color-text)" }}>{t.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-metric" style={{ color: "var(--color-text-muted)" }}>
                      {t.device_count}
                    </td>
                    <td className="px-5 py-3 font-metric" style={{ color: "var(--color-text-muted)" }}>
                      {t.uptime}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="badge"
                        style={
                          t.status === "Healthy"
                            ? { background: "rgba(37,244,106,0.1)", color: "#25f46a" }
                            : { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                        }
                      >
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
