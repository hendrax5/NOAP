"use client";
import { useEffect, useState } from "react";

// ─── helpers ─────────────────────────────────────────────────────────────────
const authOpts = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
});

const INTERVALS = [
  { label: "Setiap 1 jam", value: "1h", minutes: 60 },
  { label: "Setiap 4 jam", value: "4h", minutes: 240 },
  { label: "Setiap 12 jam", value: "12h", minutes: 720 },
  { label: "Setiap hari (24 jam)", value: "24h", minutes: 1440 },
  { label: "Setiap 3 hari", value: "72h", minutes: 4320 },
  { label: "Setiap minggu (7 hari)", value: "168h", minutes: 10080 },
];

/** Convert backend minutes → frontend dropdown value */
function minutesToValue(min: number): string {
  const found = INTERVALS.find((i) => i.minutes === min);
  return found ? found.value : "24h";
}

/** Convert frontend dropdown value → backend minutes */
function valueToMinutes(val: string): number {
  const found = INTERVALS.find((i) => i.value === val);
  return found ? found.minutes : 1440;
}

/** Format a date string as relative time (e.g. "5 menit lalu") */
function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Belum pernah";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  return `${days} hari lalu`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Local schedule state per device — initialised from DB data
  const [schedules, setSchedules] = useState<Record<number, { enabled: boolean; interval: string }>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetch("/api/devices", authOpts())
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setDevices(arr);
        // Init schedules from DB values
        const init: Record<number, { enabled: boolean; interval: string }> = {};
        arr.forEach((dev: any) => {
          const id = dev.ID ?? dev.id;
          init[id] = {
            enabled: dev.backup_enabled ?? true,
            interval: minutesToValue(dev.backup_interval_min ?? 1440),
          };
        });
        setSchedules(init);
      })
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = (id: number) => {
    setSchedules((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled: !prev[id]?.enabled },
    }));
    setSaved((prev) => ({ ...prev, [id]: false }));
    setDirty((prev) => ({ ...prev, [id]: true }));
  };

  const handleInterval = (id: number, value: string) => {
    setSchedules((prev) => ({
      ...prev,
      [id]: { ...prev[id], interval: value },
    }));
    setSaved((prev) => ({ ...prev, [id]: false }));
    setDirty((prev) => ({ ...prev, [id]: true }));
  };

  const handleSave = async (id: number) => {
    const sch = schedules[id];
    if (!sch) return;

    setSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/devices/${id}/schedule`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          backup_enabled: sch.enabled,
          backup_interval_min: valueToMinutes(sch.interval),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Schedule save failed:", err);
        return;
      }

      setSaved((prev) => ({ ...prev, [id]: true }));
      setDirty((prev) => ({ ...prev, [id]: false }));
      setTimeout(() => setSaved((prev) => ({ ...prev, [id]: false })), 2500);
    } finally {
      setSaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const selectStyle = {
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    outline: "none",
    minWidth: 200,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
          Jadwal Backup Otomatis
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-dim)" }}>
          Atur frekuensi snapshot konfigurasi per perangkat secara otomatis.
        </p>
      </div>

      {/* Info banner */}
      <div
        className="rounded-xl px-5 py-3.5 text-sm flex items-start gap-3"
        style={{
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.25)",
          color: "var(--color-text-dim)",
        }}
      >
        <span className="material-symbols-outlined text-indigo-400 mt-0.5 shrink-0" style={{ fontSize: 18 }}>
          info
        </span>
        <span>
          Jadwal backup berjalan di background via worker. Setiap perubahan
          konfigurasi akan disimpan sebagai snapshot baru. Pengaturan tersimpan
          otomatis ke database dan berlaku segera setelah disimpan.
        </span>
      </div>

      {/* Table */}
      <div
        className="rounded-2xl shadow-lg overflow-hidden"
        style={{
          background: "var(--color-surface-1)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          className="px-6 py-4"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <h3 className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
            Konfigurasi Jadwal per Perangkat
          </h3>
        </div>

        {loading ? (
          <div
            className="py-16 text-center text-sm animate-pulse"
            style={{ color: "var(--color-text-dim)" }}
          >
            Memuat perangkat…
          </div>
        ) : devices.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
              Tidak ada perangkat. Tambahkan perangkat di menu Devices.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead
                className="text-xs"
                style={{
                  background: "var(--color-surface-2)",
                  color: "var(--color-text-dim)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Perangkat</th>
                  <th className="px-6 py-3 text-left font-semibold">IP</th>
                  <th className="px-6 py-3 text-left font-semibold">Vendor</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3 text-left font-semibold">Interval</th>
                  <th className="px-6 py-3 text-left font-semibold">Backup Terakhir</th>
                  <th className="px-6 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d: any, idx) => {
                  const id = d.ID ?? d.id;
                  const sch = schedules[id] ?? { enabled: true, interval: "24h" };
                  return (
                    <tr
                      key={id}
                      style={{
                        borderTop: "1px solid var(--color-border)",
                        background: idx % 2 === 0 ? "transparent" : "var(--color-surface-0)",
                      }}
                    >
                      <td className="px-6 py-4 font-medium" style={{ color: "var(--color-text)" }}>
                        {d.name}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {d.ip}
                      </td>
                      <td className="px-6 py-4" style={{ color: "var(--color-text-muted)" }}>
                        {d.vendor || "Unknown"}
                      </td>

                      {/* Toggle */}
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggle(id)}
                          className="flex items-center gap-2 text-xs font-medium transition-colors"
                          style={{ color: sch.enabled ? "#4ade80" : "var(--color-text-dim)" }}
                        >
                          <span
                            className="relative inline-block transition-colors rounded-full"
                            style={{
                              width: 36,
                              height: 20,
                              background: sch.enabled ? "#4ade80" : "var(--color-surface-3)",
                            }}
                          >
                            <span
                              className="absolute top-0.5 transition-all rounded-full"
                              style={{
                                width: 16,
                                height: 16,
                                background: "white",
                                left: sch.enabled ? 18 : 2,
                              }}
                            />
                          </span>
                          {sch.enabled ? "Aktif" : "Nonaktif"}
                        </button>
                      </td>

                      {/* Interval */}
                      <td className="px-6 py-4">
                        <select
                          style={{
                            ...selectStyle,
                            opacity: sch.enabled ? 1 : 0.4,
                            cursor: sch.enabled ? "auto" : "not-allowed",
                          }}
                          disabled={!sch.enabled}
                          value={sch.interval}
                          onChange={(e) => handleInterval(id, e.target.value)}
                        >
                          {INTERVALS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Last Backup */}
                      <td className="px-6 py-4 text-xs" style={{ color: "var(--color-text-dim)" }}>
                        {relativeTime(d.last_backup_at)}
                      </td>

                      {/* Save */}
                      <td className="px-6 py-4 text-right">
                        {saved[id] ? (
                          <span className="text-xs text-emerald-400">✓ Tersimpan</span>
                        ) : (
                          <button
                            onClick={() => handleSave(id)}
                            disabled={saving[id] || !dirty[id]}
                            className="btn btn-ghost text-xs px-3 py-1.5"
                            style={{
                              opacity: !dirty[id] ? 0.4 : 1,
                              cursor: !dirty[id] ? "default" : "pointer",
                            }}
                          >
                            {saving[id] ? "Menyimpan…" : "Simpan"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Next steps */}
      <div
        className="rounded-2xl p-6 flex flex-col gap-4"
        style={{
          background: "var(--color-surface-1)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h3 className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          Cara Kerja Scheduler
        </h3>
        <ol className="flex flex-col gap-3 list-none">
          {[
            { n: "01", title: "Worker Aktif", desc: "Background worker di backend melakukan polling perangkat sesuai interval yang ditentukan." },
            { n: "02", title: "Snapshot Dibuat", desc: "Jika config berubah (hash berbeda), snapshot baru tersimpan ke database." },
            { n: "03", title: "Diff Tersedia", desc: "Gunakan tab Diff Viewer untuk membandingkan antar versi secara visual." },
            { n: "04", title: "Rollback", desc: "Masuk ke Backup History untuk rollback ke versi sebelumnya jika diperlukan." },
          ].map((step) => (
            <li key={step.n} className="flex gap-4 items-start">
              <span
                className="font-mono text-xs font-bold shrink-0 mt-0.5 px-2 py-0.5 rounded"
                style={{
                  background: "rgba(99,102,241,0.12)",
                  color: "#818cf8",
                  border: "1px solid rgba(99,102,241,0.3)",
                  minWidth: 32,
                  textAlign: "center",
                }}
              >
                {step.n}
              </span>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  {step.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                  {step.desc}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
