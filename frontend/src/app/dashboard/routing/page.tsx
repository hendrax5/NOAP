"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/* ── Types aligned with routing.go API response ── */
type BGPPeer = {
  peer_ip: string;
  state: string;          // "ESTABLISHED" | "IDLE" | "ACTIVE" | etc.
  uptime_seconds: number;
  prefixes_received: number;
  ts: number;
};

type MPLSEntry = {
  lsp_name: string;
  state: string;          // "UP" | "DOWN"
  active_path: string;    // "PRIMARY" | "SECONDARY_BACKUP"
  ts: number;
};

/* ── Helpers ── */
function fmtUptime(s: number) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtPrefixes(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

type BadgeStyle = "green" | "red" | "amber" | "dim";
const BADGE_COLORS: Record<BadgeStyle, { bg: string; text: string; border: string }> = {
  green: { bg: "rgba(37,244,106,.1)",  text: "#25f46a", border: "rgba(37,244,106,.25)" },
  red:   { bg: "rgba(239,68,68,.1)",   text: "#ef4444", border: "rgba(239,68,68,.25)" },
  amber: { bg: "rgba(251,191,36,.1)",  text: "#fbbf24", border: "rgba(251,191,36,.25)" },
  dim:   { bg: "rgba(120,120,120,.08)",text: "var(--color-text-dim)", border: "rgba(120,120,120,.2)" },
};

function Badge({ variant, label }: { variant: BadgeStyle; label: string }) {
  const c = BADGE_COLORS[variant];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.text }} />
      {label}
    </span>
  );
}

function bgpBadge(state: string) {
  if (state === "ESTABLISHED") return <Badge variant="green" label="Established" />;
  if (["IDLE", "ACTIVE", "CONNECT"].includes(state)) return <Badge variant="red" label={state} />;
  return <Badge variant="amber" label={state || "UNKNOWN"} />;
}

function mplsBadge(state: string, path: string) {
  if (state === "UP" && path === "PRIMARY")      return <Badge variant="green" label="Up · Primary" />;
  if (state === "UP" && path !== "PRIMARY")       return <Badge variant="amber" label="Up · Backup" />;
  return <Badge variant="red" label="Down" />;
}

/* ── Page ── */
export default function RoutingPage() {
  const [bgp,  setBgp]  = useState<BGPPeer[]>([]);
  const [mpls, setMpls] = useState<MPLSEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.getBGPMetrics().then(d => setBgp((d as any) ?? [])),
      api.getMPLSMetrics().then(d => setMpls((d as any) ?? [])),
    ]).finally(() => setLoading(false));

    const t = setInterval(() => {
      api.getBGPMetrics().then(d => setBgp((d as any) ?? [])).catch(() => {});
      api.getMPLSMetrics().then(d => setMpls((d as any) ?? [])).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const q = search.toLowerCase();
  const filteredBgp = useMemo(
    () => bgp.filter(b =>
      !q ||
      b.peer_ip?.toLowerCase().includes(q) ||
      b.state?.toLowerCase().includes(q)
    ),
    [bgp, q]
  );
  const filteredMpls = useMemo(
    () => mpls.filter(m =>
      !q ||
      m.lsp_name?.toLowerCase().includes(q) ||
      m.state?.toLowerCase().includes(q) ||
      m.active_path?.toLowerCase().includes(q)
    ),
    [mpls, q]
  );

  const bgpUp   = bgp.filter(b => b.state === "ESTABLISHED").length;
  const bgpDown = bgp.length - bgpUp;
  const mplsUp  = mpls.filter(m => m.state === "UP").length;
  const mplsBackup = mpls.filter(m => m.state === "UP" && m.active_path !== "PRIMARY").length;

  const kpis = [
    { label: "BGP Sessions",      value: bgp.length, color: "var(--color-text)" },
    { label: "BGP Established",   value: bgpUp,      color: "#25f46a" },
    { label: "BGP Down",          value: bgpDown,    color: bgpDown > 0 ? "#ef4444" : "var(--color-text-dim)" },
    { label: "MPLS LSPs Up",      value: mplsUp,     color: "#25f46a" },
    { label: "MPLS On Backup",    value: mplsBackup, color: mplsBackup > 0 ? "#fbbf24" : "var(--color-text-dim)" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>BGP &amp; MPLS</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            Peering state &amp; LSP health — 30s auto-refresh
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
          <span className="material-symbols-outlined text-base" style={{ color: "var(--color-text-dim)" }}>search</span>
          <input
            className="bg-transparent text-sm outline-none w-44 placeholder:text-zinc-500"
            style={{ color: "var(--color-text)" }}
            placeholder="Filter…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-xl p-4"
            style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
            <div className="text-xs mb-1" style={{ color: "var(--color-text-dim)" }}>{k.label}</div>
            <div className="text-2xl font-bold font-metric" style={{ color: k.color }}>
              {loading ? "—" : k.value}
            </div>
          </div>
        ))}
      </div>

      {/* BGP table */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <span className="material-symbols-outlined text-base" style={{ color: "var(--color-primary)" }}>route</span>
          <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>BGP Peerings</span>
          <span className="ml-auto text-xs" style={{ color: "var(--color-text-dim)" }}>
            {filteredBgp.length} of {bgp.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Peer IP", "Uptime", "Prefixes Rx", "State"].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-dim)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: "var(--color-text-dim)" }}>Loading…</td></tr>
              ) : filteredBgp.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: "var(--color-text-dim)" }}>
                  {bgp.length === 0 ? "No BGP peering states collected." : "No matches."}
                </td></tr>
              ) : filteredBgp.map((b, i) => (
                <tr key={i} className="transition-colors"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td className="px-5 py-3 font-mono font-semibold" style={{ color: "var(--color-text)" }}>{b.peer_ip}</td>
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: "var(--color-text-dim)" }}>{fmtUptime(b.uptime_seconds)}</td>
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: "var(--color-text-dim)" }}>{b.prefixes_received ? fmtPrefixes(b.prefixes_received) : "—"}</td>
                  <td className="px-5 py-3">{bgpBadge(b.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MPLS table */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <span className="material-symbols-outlined text-base" style={{ color: "#25f46a" }}>alt_route</span>
          <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>MPLS Label Switched Paths</span>
          <span className="ml-2 text-xs font-metric" style={{ color: "#25f46a" }}>{mplsUp}/{mpls.length} Up</span>
          {mplsBackup > 0 && (
            <span className="ml-1 text-xs font-metric" style={{ color: "#fbbf24" }}>· {mplsBackup} on backup</span>
          )}
          <span className="ml-auto text-xs" style={{ color: "var(--color-text-dim)" }}>
            {filteredMpls.length} of {mpls.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["LSP Name", "Active Path", "Status"].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-dim)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-sm" style={{ color: "var(--color-text-dim)" }}>Loading…</td></tr>
              ) : filteredMpls.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-sm" style={{ color: "var(--color-text-dim)" }}>
                  {mpls.length === 0 ? "No MPLS LSPs discovered." : "No matches."}
                </td></tr>
              ) : filteredMpls.map((m, i) => (
                <tr key={i} className="transition-colors"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td className="px-5 py-3 font-semibold" style={{ color: "var(--color-text)" }}>{m.lsp_name}</td>
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {m.active_path === "PRIMARY" ? "Primary" : m.active_path === "SECONDARY_BACKUP" ? "Backup" : m.active_path || "—"}
                  </td>
                  <td className="px-5 py-3">{mplsBadge(m.state, m.active_path)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
