"use client";
import { useEffect, useState, useCallback } from "react";

// ─── helpers ─────────────────────────────────────────────────────────────────
const authOpts = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
});

const fmtDate = (ts: string) => {
  try { return new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" }); }
  catch { return ts; }
};

// ─── Inline text diff renderer (no external dep) ─────────────────────────────
function TextDiff({ base, target }: { base: string; target: string }) {
  if (!base && !target) return <div className="p-4 text-sm text-zinc-500">Tidak ada konten.</div>;
  if (base === target) return (
    <div className="flex items-center justify-center py-12">
      <span className="text-zinc-400 text-sm">Config identik — tidak ada perbedaan.</span>
    </div>
  );

  const baseLines = (base ?? "").split("\n");
  const targetLines = (target ?? "").split("\n");

  return (
    <div className="flex text-xs font-mono leading-5 overflow-x-auto">
      {/* Base (old) */}
      <div className="flex-1 border-r border-zinc-800">
        <div className="px-3 py-1.5 bg-zinc-800 text-zinc-400 font-sans text-[11px] font-semibold sticky top-0">Sebelumnya</div>
        {baseLines.map((line, i) => {
          const inTarget = targetLines.includes(line);
          return (
            <div
              key={i}
              className={`px-3 py-0.5 whitespace-pre ${!inTarget && line !== "" ? "bg-rose-500/10 text-rose-300" : "text-zinc-400"}`}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
      {/* Target (new) */}
      <div className="flex-1">
        <div className="px-3 py-1.5 bg-zinc-800 text-zinc-400 font-sans text-[11px] font-semibold sticky top-0">Terbaru</div>
        {targetLines.map((line, i) => {
          const inBase = baseLines.includes(line);
          return (
            <div
              key={i}
              className={`px-3 py-0.5 whitespace-pre ${!inBase && line !== "" ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400"}`}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Config modal (full text view) ───────────────────────────────────────────
function ConfigModal({ backup, onClose }: { backup: any; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-white font-semibold text-sm">Config ID #{backup.ID}</p>
            <p className="text-zinc-500 text-xs font-mono mt-0.5 truncate max-w-sm">{backup.hash}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          <pre className="text-zinc-300 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {backup.config_text || "(kosong)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ─── BackupPanel — per-device ─────────────────────────────────────────────────
function BackupPanel({ device }: { device: any }) {
  const deviceId = device.ID ?? device.id;
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diffData, setDiffData] = useState<{ base_text: string; latest_text: string; base_id: number; latest_id: number } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewBackup, setViewBackup] = useState<any | null>(null);

  const loadBackups = useCallback(() => {
    setLoading(true);
    fetch(`/api/configs/${deviceId}`, authOpts())
      .then((r) => r.json())
      .then((d) => setBackups(Array.isArray(d) ? d : []))
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const triggerBackup = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      // Start backup (returns 202 immediately — runs in background)
      const res = await fetch(`/api/configs/${deviceId}/backup`, { method: "POST", ...authOpts() });
      if (res.status === 409) {
        setTriggerMsg({ ok: false, text: "Backup sudah berjalan untuk device ini." });
        setTriggering(false);
        return;
      }
      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        setTriggerMsg({ ok: false, text: data.error ?? "Gagal memulai backup." });
        setTriggering(false);
        return;
      }

      // Poll for completion every 3 seconds, up to 3 minutes
      setTriggerMsg({ ok: true, text: "Backup berjalan…" });
      const maxPolls = 60; // 60 × 3s = 180s
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const poll = await fetch(`/api/configs/${deviceId}/backup/status`, authOpts());
          const job = await poll.json();
          if (job.status === "completed") {
            setTriggerMsg({ ok: true, text: `Backup berhasil. ${job.changed ? "Ada perubahan config." : "Config tidak berubah."}` });
            loadBackups();
            setTriggering(false);
            return;
          }
          if (job.status === "failed") {
            setTriggerMsg({ ok: false, text: job.error ?? "Backup gagal." });
            setTriggering(false);
            return;
          }
          // still running — continue polling
        } catch {
          // poll network error — keep trying
        }
      }
      setTriggerMsg({ ok: false, text: "Backup timeout — cek status device." });
    } catch {
      setTriggerMsg({ ok: false, text: "Network error." });
    }
    setTriggering(false);
  };

  const loadDiff = async (baseId: number) => {
    setDiffLoading(true);
    setDiffData(null);
    try {
      const res = await fetch(`/api/configs/${deviceId}/diff/${baseId}`, authOpts());
      const data = await res.json();
      setDiffData(data);
    } catch {
      setDiffData(null);
    }
    setDiffLoading(false);
  };

  return (
    <div
      className="rounded-2xl shadow-lg overflow-hidden"
      style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div>
          <h3 className="font-semibold text-base" style={{ color: "var(--color-text)" }}>
            Config Backups — {device.name}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            Klik baris snapshot untuk lihat diff vs terbaru. Klik hash untuk lihat full config.
          </p>
        </div>
        <button
          onClick={triggerBackup}
          disabled={triggering}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow"
        >
          {triggering ? (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
          {triggering ? "Running…" : "Backup Now"}
        </button>
      </div>

      {/* Trigger message */}
      {triggerMsg && (
        <div
          className={`mx-6 mt-4 text-xs rounded-lg px-4 py-2.5 border ${
            triggerMsg.ok
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
          }`}
        >
          {triggerMsg.ok ? "✓ " : "✕ "}{triggerMsg.text}
        </div>
      )}

      {/* Snapshot table */}
      <div className="px-6 pb-6 mt-4">
        {loading ? (
          <div className="py-10 text-center text-sm animate-pulse" style={{ color: "var(--color-text-dim)" }}>
            Memuat snapshots…
          </div>
        ) : backups.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-sm" style={{ color: "var(--color-text-dim)" }}>Belum ada backup untuk perangkat ini.</div>
            <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              Klik <span className="text-indigo-400 font-medium">Backup Now</span> untuk membuat snapshot pertama.
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden border"
            style={{ borderColor: "var(--color-border)" }}
          >
            <table className="w-full text-left text-sm">
              <thead
                className="text-xs"
                style={{
                  background: "var(--color-surface-2)",
                  borderBottom: "1px solid var(--color-border)",
                  color: "var(--color-text-dim)",
                }}
              >
                <tr>
                  <th className="p-3 pl-4 font-semibold">ID</th>
                  <th className="p-3 font-semibold">Hash (SHA-256)</th>
                  <th className="p-3 font-semibold">Diambil pada</th>
                  <th className="p-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b: any, idx: number) => (
                  <tr
                    key={b.ID}
                    style={{ borderTop: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="p-3 pl-4">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{
                          background: idx === 0 ? "rgba(99,102,241,0.15)" : "var(--color-surface-2)",
                          color: idx === 0 ? "#818cf8" : "var(--color-text-dim)",
                          border: `1px solid ${idx === 0 ? "rgba(99,102,241,0.4)" : "var(--color-border)"}`,
                        }}
                      >
                        {idx === 0 ? "latest" : `#${b.ID}`}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setViewBackup(b)}
                        className="font-mono text-xs hover:text-indigo-400 transition-colors text-left"
                        style={{ color: "var(--color-text-muted)" }}
                        title="Lihat full config"
                      >
                        {(b.hash ?? "").substring(0, 24)}…
                      </button>
                    </td>
                    <td className="p-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {b.CreatedAt ? fmtDate(b.CreatedAt) : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {idx === 0 ? (
                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>terbaru</span>
                      ) : (
                        <button
                          onClick={() => loadDiff(b.ID)}
                          disabled={diffLoading}
                          className="btn btn-ghost text-xs px-3 py-1.5"
                        >
                          {diffLoading ? "Loading…" : "Lihat Diff vs Latest"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Diff viewer */}
      {diffData && (
        <div
          className="mx-6 mb-6 rounded-xl overflow-hidden border"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)" }}
          >
            <span className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
              Diff — Snapshot #{diffData.base_id}{" "}
              <span style={{ color: "var(--color-text-dim)" }}>vs</span>{" "}
              Latest #{diffData.latest_id}
            </span>
            <button
              onClick={() => setDiffData(null)}
              className="transition-colors text-base"
              style={{ color: "var(--color-text-dim)" }}
            >
              ✕
            </button>
          </div>
          <div
            className="max-h-[32rem] overflow-y-auto"
            style={{ background: "#18181b" }}
          >
            <TextDiff base={diffData.base_text} target={diffData.latest_text} />
          </div>
        </div>
      )}

      {/* Full config modal */}
      {viewBackup && (
        <ConfigModal backup={viewBackup} onClose={() => setViewBackup(null)} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AutomationPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [openDeviceId, setOpenDeviceId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/devices", authOpts())
      .then((r) => r.json())
      .then((d) => setDevices(Array.isArray(d) ? d : []))
      .catch(() => setDevices([]))
      .finally(() => setLoadingDevices(false));
  }, []);

  const openDevice = devices.find((d) => (d.ID ?? d.id) === openDeviceId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
          Configuration Automation
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-dim)" }}>
          Snapshot, version control, dan diff konfigurasi perangkat jaringan.
        </p>
      </div>

      {/* Device inventory */}
      <div
        className="p-6 rounded-2xl shadow-lg"
        style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="font-medium mb-4" style={{ color: "var(--color-text)" }}>
          Device Config Inventory
        </h3>

        {loadingDevices ? (
          <div className="py-10 text-center text-sm animate-pulse" style={{ color: "var(--color-text-dim)" }}>
            Memuat perangkat…
          </div>
        ) : devices.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--color-text-dim)" }}>
            Tidak ada perangkat. Tambahkan perangkat di menu Devices.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead style={{ borderBottom: "1px solid var(--color-border)" }}>
              <tr>
                <th className="pb-3 font-medium" style={{ color: "var(--color-text-dim)" }}>Device Name</th>
                <th className="pb-3 font-medium" style={{ color: "var(--color-text-dim)" }}>IP Address</th>
                <th className="pb-3 font-medium" style={{ color: "var(--color-text-dim)" }}>Vendor</th>
                <th className="pb-3 font-medium text-right" style={{ color: "var(--color-text-dim)" }}>Backups</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d: any) => {
                const id = d.ID ?? d.id;
                const isOpen = openDeviceId === id;
                return (
                  <tr
                    key={id}
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="py-4 font-medium" style={{ color: "var(--color-text)" }}>{d.name}</td>
                    <td className="py-4 font-mono text-xs" style={{ color: "var(--color-text-muted)" }}>{d.ip}</td>
                    <td className="py-4" style={{ color: "var(--color-text-muted)" }}>{d.vendor || "Unknown"}</td>
                    <td className="py-4 text-right">
                      <button
                        onClick={() => setOpenDeviceId(isOpen ? null : id)}
                        className={`btn btn-ghost text-xs px-3 py-1.5 ${isOpen ? "text-indigo-400" : ""}`}
                      >
                        {isOpen ? "Tutup ▲" : "View Backups ▼"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Expandable backup panel */}
      {openDevice && <BackupPanel key={openDeviceId} device={openDevice} />}
    </div>
  );
}
