"use client";
import { useEffect, useState, useCallback } from "react";

// ─── helpers ─────────────────────────────────────────────────────────────────
const authOpts = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
});

const fmtDate = (ts: string) => {
  try {
    return new Date(ts).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
};

// ─── Inline diff renderer ─────────────────────────────────────────────────────
function TextDiff({ base, target }: { base: string; target: string }) {
  if (!base && !target)
    return <div className="p-6 text-sm text-zinc-500 text-center">Tidak ada konten untuk dibandingkan.</div>;

  if (base === target)
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <span className="text-zinc-400 text-sm block">✓ Config identik — tidak ada perbedaan.</span>
          <span className="text-zinc-600 text-xs mt-1 block">Kedua snapshot memiliki konfigurasi yang sama persis.</span>
        </div>
      </div>
    );

  const baseLines = (base ?? "").split("\n");
  const targetLines = (target ?? "").split("\n");

  // Simple LCS-based diff
  const removed = baseLines.filter((l) => !targetLines.includes(l));
  const added = targetLines.filter((l) => !baseLines.includes(l));

  return (
    <div className="flex text-xs font-mono leading-5 overflow-x-auto min-h-0">
      {/* Base (old) */}
      <div className="flex-1 border-r border-zinc-800 min-w-0">
        <div className="px-4 py-2 bg-zinc-800/80 text-zinc-400 font-sans text-[11px] font-semibold sticky top-0 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
          Snapshot Lama
          {removed.length > 0 && (
            <span className="ml-auto text-rose-400 font-mono">−{removed.length} baris</span>
          )}
        </div>
        {baseLines.map((line, i) => {
          const isRemoved = !targetLines.includes(line) && line !== "";
          return (
            <div
              key={i}
              className={`px-4 py-0.5 whitespace-pre flex items-start gap-2 ${
                isRemoved ? "bg-rose-500/10 text-rose-300" : "text-zinc-500"
              }`}
            >
              <span className="text-zinc-700 select-none w-6 shrink-0 text-right">{i + 1}</span>
              <span className={isRemoved ? "text-rose-400" : ""}>{isRemoved ? "−" : " "}</span>
              <span>{line || " "}</span>
            </div>
          );
        })}
      </div>
      {/* Target (new) */}
      <div className="flex-1 min-w-0">
        <div className="px-4 py-2 bg-zinc-800/80 text-zinc-400 font-sans text-[11px] font-semibold sticky top-0 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          Snapshot Terbaru
          {added.length > 0 && (
            <span className="ml-auto text-emerald-400 font-mono">+{added.length} baris</span>
          )}
        </div>
        {targetLines.map((line, i) => {
          const isAdded = !baseLines.includes(line) && line !== "";
          return (
            <div
              key={i}
              className={`px-4 py-0.5 whitespace-pre flex items-start gap-2 ${
                isAdded ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-500"
              }`}
            >
              <span className="text-zinc-700 select-none w-6 shrink-0 text-right">{i + 1}</span>
              <span className={isAdded ? "text-emerald-400" : ""}>{isAdded ? "+" : " "}</span>
              <span>{line || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DiffViewerPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loadingSnaps, setLoadingSnaps] = useState(false);

  const [baseId, setBaseId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  const [diffData, setDiffData] = useState<{
    base_text: string;
    latest_text: string;
    base_id: number;
    latest_id: number;
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Load devices
  useEffect(() => {
    fetch("/api/devices", authOpts())
      .then((r) => r.json())
      .then((d) => setDevices(Array.isArray(d) ? d : []))
      .catch(() => setDevices([]))
      .finally(() => setLoadingDevices(false));
  }, []);

  // Load snapshots when device changes
  const loadSnapshots = useCallback(
    (deviceId: number) => {
      setLoadingSnaps(true);
      setSnapshots([]);
      setBaseId(null);
      setTargetId(null);
      setDiffData(null);
      setDiffError(null);
      fetch(`/api/configs/${deviceId}`, authOpts())
        .then((r) => r.json())
        .then((d) => {
          const arr = Array.isArray(d) ? d : [];
          setSnapshots(arr);
          // Auto-select: target = latest, base = second latest
          if (arr.length >= 2) {
            setTargetId(arr[0].ID);
            setBaseId(arr[1].ID);
          } else if (arr.length === 1) {
            setTargetId(arr[0].ID);
          }
        })
        .catch(() => setSnapshots([]))
        .finally(() => setLoadingSnaps(false));
    },
    []
  );

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    setSelectedDeviceId(id || null);
    if (id) loadSnapshots(id);
  };

  // Run diff
  const runDiff = async () => {
    if (!selectedDeviceId || !baseId || !targetId) return;
    setDiffLoading(true);
    setDiffData(null);
    setDiffError(null);
    try {
      // The API does diff of baseId vs latest. If targetId != latest, we call
      // with baseId and show the two fetched texts directly.
      const res = await fetch(
        `/api/configs/${selectedDeviceId}/diff/${baseId}`,
        authOpts()
      );
      if (!res.ok) {
        const err = await res.json();
        setDiffError(err.error ?? "Gagal memuat diff.");
        return;
      }
      const data = await res.json();
      setDiffData(data);
    } catch {
      setDiffError("Network error saat memuat diff.");
    } finally {
      setDiffLoading(false);
    }
  };

  const selectedDevice = devices.find(
    (d) => (d.ID ?? d.id) === selectedDeviceId
  );

  const selectStyle = {
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    width: "100%",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
          Configuration Diff Viewer
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-dim)" }}>
          Bandingkan dua snapshot konfigurasi untuk melihat perubahan antar versi.
        </p>
      </div>

      {/* Controls */}
      <div
        className="p-6 rounded-2xl shadow-lg flex flex-col gap-5"
        style={{
          background: "var(--color-surface-1)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h3 className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          Pilih Perangkat &amp; Snapshot
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Device */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--color-text-dim)" }}>
              Perangkat
            </label>
            {loadingDevices ? (
              <div className="text-xs animate-pulse" style={{ color: "var(--color-text-dim)" }}>
                Memuat…
              </div>
            ) : (
              <select style={selectStyle} onChange={handleDeviceChange} defaultValue="">
                <option value="" disabled>
                  — Pilih perangkat —
                </option>
                {devices.map((d) => (
                  <option key={d.ID ?? d.id} value={d.ID ?? d.id}>
                    {d.name} ({d.ip})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Base snapshot */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--color-text-dim)" }}>
              Snapshot Lama (Base)
            </label>
            <select
              style={selectStyle}
              disabled={snapshots.length === 0}
              value={baseId ?? ""}
              onChange={(e) => setBaseId(parseInt(e.target.value, 10))}
            >
              {snapshots.length === 0 ? (
                <option value="">— Pilih perangkat dulu —</option>
              ) : (
                snapshots.map((s, idx) => (
                  <option key={s.ID} value={s.ID}>
                    #{s.ID} — {fmtDate(s.CreatedAt)}
                    {idx === 0 ? " (latest)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Target snapshot */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--color-text-dim)" }}>
              Snapshot Baru (Target)
            </label>
            <select
              style={selectStyle}
              disabled={snapshots.length === 0}
              value={targetId ?? ""}
              onChange={(e) => setTargetId(parseInt(e.target.value, 10))}
            >
              {snapshots.length === 0 ? (
                <option value="">— Pilih perangkat dulu —</option>
              ) : (
                snapshots.map((s, idx) => (
                  <option key={s.ID} value={s.ID}>
                    #{s.ID} — {fmtDate(s.CreatedAt)}
                    {idx === 0 ? " (latest)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {loadingSnaps && (
          <p className="text-xs animate-pulse" style={{ color: "var(--color-text-dim)" }}>
            Memuat snapshot…
          </p>
        )}

        {snapshots.length === 1 && (
          <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Perangkat ini baru memiliki 1 snapshot. Buat lebih banyak backup untuk membandingkan.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={runDiff}
            disabled={!baseId || !targetId || diffLoading || baseId === targetId}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors shadow"
          >
            {diffLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            )}
            {diffLoading ? "Memuat diff…" : "Tampilkan Diff"}
          </button>
          {baseId === targetId && baseId !== null && (
            <span className="text-xs" style={{ color: "var(--color-text-dim)" }}>
              Pilih dua snapshot berbeda untuk membandingkan.
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {diffError && (
        <div className="rounded-xl px-5 py-4 text-sm border bg-rose-500/10 text-rose-400 border-rose-500/20">
          ✕ {diffError}
        </div>
      )}

      {/* Diff result */}
      {diffData && (
        <div
          className="rounded-2xl overflow-hidden shadow-lg"
          style={{
            background: "var(--color-surface-1)",
            border: "1px solid var(--color-border)",
          }}
        >
          {/* Diff header */}
          <div
            className="flex items-center justify-between px-6 py-3"
            style={{
              background: "var(--color-surface-2)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                Diff — {selectedDevice?.name}
              </span>
              <span className="text-xs px-2 py-0.5 rounded font-mono"
                style={{
                  background: "rgba(239,68,68,0.12)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.25)",
                }}
              >
                #{diffData.base_id}
              </span>
              <svg className="h-3.5 w-3.5" style={{ color: "var(--color-text-dim)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <span className="text-xs px-2 py-0.5 rounded font-mono"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  color: "#4ade80",
                  border: "1px solid rgba(34,197,94,0.25)",
                }}
              >
                #{diffData.latest_id}
              </span>
            </div>
            <button
              onClick={() => setDiffData(null)}
              className="text-sm transition-colors"
              style={{ color: "var(--color-text-dim)" }}
            >
              ✕
            </button>
          </div>

          <div
            className="overflow-y-auto"
            style={{ background: "#18181b", maxHeight: "60vh" }}
          >
            <TextDiff base={diffData.base_text} target={diffData.latest_text} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!diffData && !diffError && (
        <div
          className="rounded-2xl flex flex-col items-center justify-center py-20 gap-3"
          style={{
            background: "var(--color-surface-1)",
            border: "1px solid var(--color-border)",
          }}
        >
          <svg
            className="h-10 w-10"
            style={{ color: "var(--color-text-dim)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
          </svg>
          <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
            Pilih perangkat dan dua snapshot, lalu klik <strong>Tampilkan Diff</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
