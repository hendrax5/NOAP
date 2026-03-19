"use client";
import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import "../flows.css";

/* ── Types ── */
type Talker = {
  src_ip: string; dst_ip: string; protocol: string;
  total_bytes: number; app?: string; dst_asn_name?: string;
  src_asn_name?: string; packets?: number;
};

/* ── Helpers ── */
function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(2) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(1) + " KB";
  return b + " B";
}

const PROTO_COLORS: Record<string, string> = { TCP:"#6366f1", UDP:"#10b981", ICMP:"#f59e0b" };

function ProtoBadge({ p }: { p: string }) {
  const c = PROTO_COLORS[p] ?? "#71717a";
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold"
      style={{ background:c+"22", color:c, border:`1px solid ${c}44` }}>
      {p}
    </span>
  );
}

type SortKey = "total_bytes" | "src_ip" | "dst_ip" | "protocol";

export default function TopTalkersPage() {
  const [talkers, setTalkers]   = useState<Talker[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search,  setSearch]    = useState("");
  const [sortBy,  setSortBy]    = useState<SortKey>("total_bytes");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      api.getTopTalkers()
        .then(d => { setTalkers((d as any) ?? []); setLoading(false); })
        .catch(() => setLoading(false));
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir(key === "total_bytes" ? "desc" : "asc"); }
  };

  const filtered = useMemo(() => {
    let list = [...talkers];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.src_ip.includes(q) || t.dst_ip.includes(q) || t.protocol.toLowerCase().includes(q)
        || (t.app ?? "").toLowerCase().includes(q)
        || (t.dst_asn_name ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "total_bytes") cmp = a.total_bytes - b.total_bytes;
      else if (sortBy === "src_ip") cmp = a.src_ip.localeCompare(b.src_ip);
      else if (sortBy === "dst_ip") cmp = a.dst_ip.localeCompare(b.dst_ip);
      else if (sortBy === "protocol") cmp = a.protocol.localeCompare(b.protocol);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [talkers, search, sortBy, sortDir]);

  const maxBytes = talkers[0]?.total_bytes ?? 1;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return <span className="material-symbols-outlined text-xs opacity-30">unfold_more</span>;
    return <span className="material-symbols-outlined text-xs" style={{ color:"var(--color-primary)" }}>
      {sortDir === "asc" ? "expand_less" : "expand_more"}
    </span>;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flow-animate flow-animate-d1">
        <h1 className="text-2xl font-bold" style={{ color:"var(--color-text)" }}>Top Talkers</h1>
        <p className="text-sm mt-0.5" style={{ color:"var(--color-text-dim)" }}>
          Highest-volume conversations — last hour · 30s auto-refresh
        </p>
      </div>

      {/* Search + Stats */}
      <div className="flex items-center gap-3 flow-animate flow-animate-d2">
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-base"
            style={{ color:"var(--color-text-dim)" }}>search</span>
          <input
            type="text"
            placeholder="Filter by IP, protocol, app, ASN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
            style={{
              background:"var(--color-surface-2)", border:"1px solid var(--color-border)",
              color:"var(--color-text)", outline:"none",
            }}
          />
        </div>
        <span className="text-xs font-metric" style={{ color:"var(--color-text-dim)" }}>
          {filtered.length} / {talkers.length} flows
        </span>
      </div>

      {/* Table */}
      <div className="flow-card rounded-2xl overflow-hidden flow-animate flow-animate-d3"
        style={{ background:"var(--color-surface-1)", border:"1px solid var(--color-border)" }}>
        {/* Table header */}
        <div className="grid grid-cols-[40px_1fr_1fr_90px_120px_100px] gap-2 px-5 py-2.5 text-xs font-semibold border-b"
          style={{ color:"var(--color-text-dim)", borderColor:"var(--color-border)", background:"var(--color-surface-2)" }}>
          <span>#</span>
          <button className="flex items-center gap-1 text-left" onClick={() => toggleSort("src_ip")}>
            Source <SortIcon col="src_ip" />
          </button>
          <button className="flex items-center gap-1 text-left" onClick={() => toggleSort("dst_ip")}>
            Destination <SortIcon col="dst_ip" />
          </button>
          <button className="flex items-center gap-1 text-left" onClick={() => toggleSort("protocol")}>
            Proto <SortIcon col="protocol" />
          </button>
          <span>Volume</span>
          <button className="flex items-center gap-1 text-right justify-end" onClick={() => toggleSort("total_bytes")}>
            Bytes <SortIcon col="total_bytes" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm" style={{ color:"var(--color-text-dim)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm" style={{ color:"var(--color-text-dim)" }}>
              {search ? "No flows match your filter." : "No flow data collected yet."}
            </div>
          ) : filtered.map((t, i) => {
            const pct = (t.total_bytes / maxBytes) * 100;
            const isExpanded = expanded === i;
            return (
              <div key={i}>
                <div
                  className="talker-row grid grid-cols-[40px_1fr_1fr_90px_120px_100px] gap-2 px-5 py-3 items-center cursor-pointer"
                  style={{ borderBottom:"1px solid var(--color-border)" }}
                  onClick={() => setExpanded(isExpanded ? null : i)}
                >
                  <span className="text-xs font-semibold" style={{ color:"var(--color-text-dim)" }}>{i + 1}</span>
                  <div className="min-w-0">
                    <span className="font-mono text-xs truncate block" style={{ color:"var(--color-text)" }}>{t.src_ip}</span>
                    {t.src_asn_name && <span className="text-[10px]" style={{ color:"var(--color-text-dim)" }}>{t.src_asn_name}</span>}
                  </div>
                  <div className="min-w-0">
                    <span className="font-mono text-xs truncate block" style={{ color:"var(--color-text)" }}>{t.dst_ip}</span>
                    {t.dst_asn_name && <span className="text-[10px]" style={{ color:"var(--color-text-dim)" }}>{t.dst_asn_name}</span>}
                  </div>
                  <ProtoBadge p={t.protocol} />
                  <div className="w-full">
                    <div className="h-1.5 rounded-full" style={{ background:"var(--color-border)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width:`${pct}%`, background:"var(--color-primary)" }} />
                    </div>
                  </div>
                  <span className="text-xs font-metric text-right" style={{ color:"var(--color-text)" }}>{fmtBytes(t.total_bytes)}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-14 py-3 text-xs grid grid-cols-2 md:grid-cols-4 gap-4"
                    style={{ background:"var(--color-surface-2)", borderBottom:"1px solid var(--color-border)" }}>
                    <div>
                      <span style={{ color:"var(--color-text-dim)" }}>Application</span>
                      <div className="font-semibold mt-0.5" style={{ color:"var(--color-text)" }}>{t.app || "—"}</div>
                    </div>
                    <div>
                      <span style={{ color:"var(--color-text-dim)" }}>Packets</span>
                      <div className="font-semibold mt-0.5" style={{ color:"var(--color-text)" }}>{t.packets?.toLocaleString() ?? "—"}</div>
                    </div>
                    <div>
                      <span style={{ color:"var(--color-text-dim)" }}>Dst ASN</span>
                      <div className="font-semibold mt-0.5" style={{ color:"var(--color-text)" }}>{t.dst_asn_name || "—"}</div>
                    </div>
                    <div>
                      <span style={{ color:"var(--color-text-dim)" }}>Protocol</span>
                      <div className="font-semibold mt-0.5" style={{ color:"var(--color-text)" }}>{t.protocol}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
