"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────
type BackendEvent = {
  ts: number;          // Unix milliseconds
  device_id: number;
  severity: string;
  facility: string;
  message: string;
  type: string;        // "syslog" | "trap"
};

type LogEntry = {
  id: string;
  ts: number;
  host: string;        // device_id as string (or resolved label)
  facility: string;
  sev: string;
  msg: string;
  type: string;
};

// ── Severity styling ──────────────────────────────────────────────────────────
const SEV_STYLE: Record<string, { color: string; bg: string }> = {
  EMERG:     { color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  ALERT:     { color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  CRIT:      { color: "#f97316", bg: "rgba(249,115,22,0.10)" },
  ERR:       { color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  WARN:      { color: "#eab308", bg: "rgba(234,179,8,0.10)" },
  NOTICE:    { color: "#3b82f6", bg: "rgba(59,130,246,0.10)" },
  INFO:      { color: "#25f46a", bg: "rgba(37,244,106,0.10)" },
  DEBUG:     { color: "#6b7280", bg: "rgba(107,114,128,0.10)" },
  // fallback for unknown
  UNKNOWN:   { color: "#6b7280", bg: "rgba(107,114,128,0.10)" },
};

const TABS = ["Syslog", "SNMP Traps"] as const;
const SEVERITIES = ["ALL", "EMERG", "ALERT", "CRIT", "ERR", "WARN", "NOTICE", "INFO", "DEBUG"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalise(raw: BackendEvent[]): LogEntry[] {
  return raw.map((e, idx) => ({
    id: `${e.ts}-${e.device_id}-${idx}`,
    ts: e.ts,
    host: e.device_id ? `device-${e.device_id}` : "unknown",
    facility: e.facility,
    sev: e.severity?.toUpperCase() ?? "UNKNOWN",
    msg: e.message,
    type: e.type,
  }));
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return [
    d.getHours().toString().padStart(2, "0"),
    d.getMinutes().toString().padStart(2, "0"),
    d.getSeconds().toString().padStart(2, "0"),
  ].join(":");
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LiveEvents() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Syslog");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const seenIds = useRef<Set<string>>(new Set());

  const fetchEvents = useCallback(async () => {
    if (paused) return;
    try {
      const raw: BackendEvent[] =
        activeTab === "Syslog"
          ? await api.getSyslogEvents(200)
          : await api.getTrapEvents(200);

      const normalised = normalise(raw);

      setEntries((prev) => {
        // Merge: add only entries not already seen
        const newOnes = normalised.filter((e) => {
          if (seenIds.current.has(e.id)) return false;
          seenIds.current.add(e.id);
          return true;
        });
        if (newOnes.length === 0) return prev;
        const merged = [...prev, ...newOnes];
        // Sort by ts ascending, keep last 500
        merged.sort((a, b) => a.ts - b.ts);
        return merged.slice(-500);
      });
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  }, [paused, activeTab]);

  // Initial + polling
  useEffect(() => {
    // Reset when tab changes
    setEntries([]);
    seenIds.current.clear();
    setLoading(true);
    fetchEvents();
    const t = setInterval(fetchEvents, 10_000);
    return () => clearInterval(t);
  }, [fetchEvents]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries]);

  const visible = entries.filter((e) => {
    if (filter !== "ALL" && e.sev !== filter) return false;
    if (
      search &&
      !e.msg.toLowerCase().includes(search.toLowerCase()) &&
      !e.host.includes(search)
    )
      return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
            Live Events
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            UDP 514 (Syslog) · UDP 162 (SNMP Traps) · polling every 10s
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Live / Paused badge */}
          <span
            className="flex items-center gap-1.5 text-xs font-metric px-3 py-1.5 rounded-lg"
            style={{
              background: paused ? "var(--color-surface-2)" : "rgba(37,244,106,0.1)",
              color: paused ? "var(--color-text-dim)" : "#25f46a",
              border: "1px solid var(--color-border-hover)",
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${!paused ? "animate-pulse" : ""}`}
              style={{ background: paused ? "var(--color-text-dim)" : "#25f46a" }}
            />
            {paused ? "Paused" : "Live"}
          </span>

          {/* Pause/Resume */}
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
            style={{
              background: "var(--color-surface-2)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              {paused ? "play_arrow" : "pause"}
            </span>
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="text-sm px-4 py-1.5 rounded-lg font-semibold transition-colors"
            style={
              activeTab === tab
                ? {
                    background: "var(--color-primary-muted)",
                    color: "var(--color-primary)",
                    border: "1px solid var(--color-primary)40",
                  }
                : {
                    background: "var(--color-surface-1)",
                    color: "var(--color-text-dim)",
                    border: "1px solid var(--color-border)",
                  }
            }
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="text-xs px-4 py-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Severity pills */}
        <div className="flex gap-1 flex-wrap">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="text-xs px-2 py-1 rounded font-semibold transition-colors"
              style={
                filter === s
                  ? {
                      background: SEV_STYLE[s]?.bg ?? "var(--color-primary-muted)",
                      color: SEV_STYLE[s]?.color ?? "var(--color-primary)",
                      border: `1px solid ${SEV_STYLE[s]?.color ?? "var(--color-primary)"}40`,
                    }
                  : {
                      background: "var(--color-surface-1)",
                      color: "var(--color-text-dim)",
                      border: "1px solid var(--color-border)",
                    }
              }
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <div
          className="flex items-center gap-2 flex-1 min-w-[180px]"
          style={{
            background: "var(--color-surface-1)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "4px 10px",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-text-dim)" }}>
            search
          </span>
          <input
            className="bg-transparent outline-none text-sm flex-1"
            style={{ color: "var(--color-text)" }}
            placeholder="Filter by host or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <span className="text-xs font-metric ml-auto" style={{ color: "var(--color-text-dim)" }}>
          {visible.length} events
        </span>
      </div>

      {/* Log pane */}
      <div
        className="flex-1 rounded-xl overflow-hidden flex flex-col min-h-0"
        style={{
          background: "#0a0a0c",
          border: "1px solid var(--color-border)",
          fontFamily: "var(--font-metric)",
        }}
      >
        {/* Column headers */}
        <div
          className="flex items-center gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b select-none shrink-0"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-dim)", background: "var(--color-surface-1)" }}
        >
          <span className="w-16 shrink-0">Time</span>
          <span className="w-16 shrink-0">Sev</span>
          <span className="w-28 shrink-0">Host</span>
          <span className="w-20 shrink-0">Type</span>
          <span className="flex-1">Message</span>
        </div>

        {/* Scrollable rows */}
        <div
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
          }}
        >
          {loading && (
            <div className="flex items-center justify-center h-32 text-xs" style={{ color: "var(--color-text-dim)" }}>
              <span className="animate-pulse">Fetching events…</span>
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2" style={{ color: "var(--color-text-dim)" }}>
              <span className="material-symbols-outlined text-3xl">inbox</span>
              <span className="text-xs">No events received yet</span>
              <span className="text-xs opacity-60">Ensure network devices are pointing to this syslog server</span>
            </div>
          )}

          {visible.map((entry) => {
            const sevKey = SEV_STYLE[entry.sev] ? entry.sev : "UNKNOWN";
            const style = SEV_STYLE[sevKey];
            return (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-4 py-1.5 text-xs border-b hover:bg-white/[0.03] transition-colors"
                style={{ borderColor: "rgba(255,255,255,0.04)" }}
              >
                <span className="w-16 shrink-0" style={{ color: "var(--color-text-dim)" }}>
                  {fmtTime(entry.ts)}
                </span>
                <span
                  className="w-16 shrink-0 font-bold px-1.5 py-0.5 rounded text-center"
                  style={{ background: style.bg, color: style.color }}
                >
                  {entry.sev}
                </span>
                <span className="w-28 shrink-0 truncate" style={{ color: "#7dd3fc" }}>
                  {entry.host}
                </span>
                <span className="w-20 shrink-0 text-xs opacity-50" style={{ color: "var(--color-text-dim)" }}>
                  {entry.type}
                </span>
                <span className="flex-1 truncate" style={{ color: "var(--color-text-muted)" }}>
                  {entry.msg}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
