"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis, Line, LineChart
} from "recharts";
import AddSensorWizard from "../../../../components/AddSensorWizard";

// ─── helpers ────────────────────────────────────────────────────────────────
const authOpts = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
});

const formatBandwidth = (bps: number) => {
  if (!bps) return "0 bps";
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Gbps";
  if (bps >= 1e6) return (bps / 1e6).toFixed(2) + " Mbps";
  if (bps >= 1e3) return (bps / 1e3).toFixed(2) + " kbps";
  return bps + " bps";
};

const formatTime = (ts: any) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ─── BGP History Modal ───────────────────────────────────────────────────────
function BGPHistoryModal({
  deviceId, peer, onClose,
}: { deviceId: string; peer: any; onClose: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const [range, setRange] = useState("1h");

  useEffect(() => {
    if (!peer) return;
    fetch(
      `/api/metrics/bgp/history?device_id=${deviceId}&peer_ip=${peer.peer_ip}&range=${range}`,
      authOpts()
    )
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]));
  }, [deviceId, peer, range]);

  if (!peer) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">BGP Peer: {peer.peer_ip}</h3>
            <p className="text-zinc-500 text-xs mt-0.5">AS{peer.remote_as} · {peer.peer_state}</p>
          </div>
          <div className="flex items-center gap-3">
            {["1h", "6h", "24h"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${range === r ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >
                {r}
              </button>
            ))}
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors ml-2">✕</button>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-zinc-600 text-sm">No history data yet</div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fill: "#71717a", fontSize: 10 }} />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "11px" }}
                  labelFormatter={(v) => new Date(v).toLocaleString()}
                />
                <Area type="monotone" dataKey="prefixes_received" stroke="#818cf8" fill="#818cf8" fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} name="Prefixes Rx" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: "Prefixes Rx", value: peer.prefixes_received ?? "—" },
            { label: "Uptime", value: peer.uptime ?? "—" },
            { label: "State", value: peer.peer_state },
          ].map((stat) => (
            <div key={stat.label} className="bg-zinc-800/60 rounded-xl p-3 text-center">
              <div className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-1">{stat.label}</div>
              <div className="text-white font-mono font-semibold text-sm">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Config Tab ─────────────────────────────────────────────────────────────
function ConfigTab({ deviceId }: { deviceId: string }) {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]); // up to 2 filenames for diff
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewContent, setViewContent] = useState<{ name: string; content: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadBackups = () => {
    setLoading(true);
    fetch(`/api/configs/${deviceId}/backups`, authOpts())
      .then((r) => r.json())
      .then((d) => setBackups(Array.isArray(d) ? d : []))
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadBackups(); }, [deviceId]);

  const triggerBackup = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await fetch(`/api/configs/${deviceId}/backup`, { method: "POST", ...authOpts() });
      if (res.status === 409) {
        setTriggerMsg({ ok: false, text: "Backup already running for this device." });
        setTriggering(false);
        return;
      }
      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        setTriggerMsg({ ok: false, text: data.error ?? "Failed to start backup." });
        setTriggering(false);
        return;
      }

      setTriggerMsg({ ok: true, text: "Backup running…" });
      const maxPolls = 60;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const poll = await fetch(`/api/configs/${deviceId}/backup/status`, authOpts());
          const job = await poll.json();
          if (job.status === "completed") {
            setTriggerMsg({ ok: true, text: `Backup saved${job.changed ? " — config changed" : " — no changes"}` });
            loadBackups();
            setTriggering(false);
            return;
          }
          if (job.status === "failed") {
            setTriggerMsg({ ok: false, text: job.error ?? "Backup failed." });
            setTriggering(false);
            return;
          }
        } catch {
          // poll error — keep trying
        }
      }
      setTriggerMsg({ ok: false, text: "Backup timeout — check device status." });
    } catch {
      setTriggerMsg({ ok: false, text: "Network error." });
    }
    setTriggering(false);
  };

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      if (prev.includes(filename)) return prev.filter((f) => f !== filename);
      if (prev.length >= 2) return [prev[1], filename];
      return [...prev, filename];
    });
    setDiff(null);
  };

  const fetchDiff = async () => {
    if (selected.length !== 2) return;
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await fetch(
        `/api/configs/${deviceId}/diff?a=${encodeURIComponent(selected[0])}&b=${encodeURIComponent(selected[1])}`,
        authOpts()
      );
      const data = await res.json();
      setDiff(data.diff ?? "");
    } catch {
      setDiff("Error fetching diff.");
    }
    setDiffLoading(false);
  };

  const fetchContent = async (filename: string) => {
    try {
      const res = await fetch(`/api/configs/${deviceId}/backups/${encodeURIComponent(filename)}`, authOpts());
      const data = await res.json();
      setViewContent({ name: filename, content: data.content ?? "" });
    } catch {
      setViewContent({ name: filename, content: "Error loading file." });
    }
  };

  const deleteBackup = async (filename: string) => {
    try {
      await fetch(`/api/configs/${deviceId}/backups/${encodeURIComponent(filename)}`, { method: "DELETE", ...authOpts() });
      setBackups((prev) => prev.filter((b) => b.filename !== filename));
      setSelected((prev) => prev.filter((f) => f !== filename));
    } catch {}
    setDeleteConfirm(null);
  };

  const fmtSize = (bytes: number) => {
    if (!bytes) return "0 B";
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
  };

  const fmtDate = (ts: string) => {
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  };

  const renderDiffLine = (line: string, i: number) => {
    if (line.startsWith("+")) return <div key={i} className="bg-emerald-500/10 text-emerald-300 px-3 py-0.5 font-mono text-xs whitespace-pre">{line}</div>;
    if (line.startsWith("-")) return <div key={i} className="bg-rose-500/10 text-rose-300 px-3 py-0.5 font-mono text-xs whitespace-pre">{line}</div>;
    if (line.startsWith("@@")) return <div key={i} className="text-indigo-400 px-3 py-0.5 font-mono text-xs whitespace-pre">{line}</div>;
    return <div key={i} className="text-zinc-400 px-3 py-0.5 font-mono text-xs whitespace-pre">{line}</div>;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-base">Configuration Backups</h3>
          <p className="text-zinc-500 text-xs mt-0.5">Select 2 snapshots to compare diffs. Click a row to view full config.</p>
        </div>
        <button
          onClick={triggerBackup}
          disabled={triggering}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow"
        >
          {triggering ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          )}
          {triggering ? "Running…" : "Backup Now"}
        </button>
      </div>

      {triggerMsg && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${triggerMsg.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
          {triggerMsg.text}
        </div>
      )}

      {/* Diff toolbar */}
      {selected.length === 2 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
          <span className="text-indigo-300 text-xs font-medium">Comparing 2 snapshots</span>
          <div className="flex-1" />
          <button
            onClick={fetchDiff}
            disabled={diffLoading}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
          >
            {diffLoading ? "Loading…" : "Show Diff"}
          </button>
          <button onClick={() => { setSelected([]); setDiff(null); }} className="text-zinc-500 hover:text-white text-xs transition-colors">Clear</button>
        </div>
      )}

      {/* Snapshot list */}
      <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl shadow-lg overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-zinc-500 text-sm animate-pulse">Loading snapshots…</div>
        ) : backups.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-zinc-500 text-sm">No backups yet.</div>
            <div className="text-zinc-600 text-xs mt-1">Click <span className="text-indigo-400">Backup Now</span> to take the first snapshot.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#18181b] border-b border-zinc-800 text-zinc-400 text-xs">
                <tr>
                  <th className="p-3 pl-5 w-8">✓</th>
                  <th className="p-3 font-semibold">Filename</th>
                  <th className="p-3 font-semibold">Taken At</th>
                  <th className="p-3 font-semibold">Size</th>
                  <th className="p-3 font-semibold">Changed</th>
                  <th className="p-3 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {backups.map((b: any) => {
                  const isSel = selected.includes(b.filename);
                  return (
                    <tr
                      key={b.filename}
                      onClick={() => fetchContent(b.filename)}
                      className={`hover:bg-zinc-800/30 transition-colors cursor-pointer ${isSel ? "bg-indigo-500/5" : ""}`}
                    >
                      <td className="p-3 pl-5" onClick={(e) => { e.stopPropagation(); toggleSelect(b.filename); }}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                          isSel ? "bg-indigo-600 border-indigo-500" : "border-zinc-600 bg-zinc-800 hover:border-indigo-500"
                        }`}>
                          {isSel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-zinc-200 text-xs">{b.filename}</td>
                      <td className="p-3 text-zinc-400 text-xs">{b.taken_at ? fmtDate(b.taken_at) : "—"}</td>
                      <td className="p-3 text-zinc-400 text-xs">{b.size ? fmtSize(b.size) : "—"}</td>
                      <td className="p-3">
                        {b.changed === true ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-amber-500/10 text-amber-400 border-amber-500/20">Changed</span>
                        ) : b.changed === false ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-zinc-800 text-zinc-500 border-zinc-700">Same</span>
                        ) : <span className="text-zinc-600 text-xs">—</span>}
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {deleteConfirm === b.filename ? (
                          <div className="flex gap-1">
                            <button onClick={() => deleteBackup(b.filename)} className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold">Yes</button>
                            <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(b.filename)} className="text-zinc-600 hover:text-rose-400 transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
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

      {/* Diff viewer */}
      {diff !== null && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-white font-semibold text-sm">Diff: <span className="font-mono text-indigo-400 text-xs">{selected[0]}</span> → <span className="font-mono text-indigo-400 text-xs">{selected[1]}</span></span>
            <button onClick={() => setDiff(null)} className="text-zinc-500 hover:text-white transition-colors">✕</button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {diff === "" ? (
              <div className="py-10 text-center text-zinc-500 text-sm">No differences found — configs are identical.</div>
            ) : (
              <div>{diff.split("\n").map((line, i) => renderDiffLine(line, i))}</div>
            )}
          </div>
        </div>
      )}

      {/* Full config modal */}
      {viewContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={() => setViewContent(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col" style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
              <span className="text-white font-semibold font-mono text-sm">{viewContent.name}</span>
              <button onClick={() => setViewContent(null)} className="text-zinc-500 hover:text-white transition-colors text-lg">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <pre className="text-zinc-300 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{viewContent.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Thresholds Tab ──────────────────────────────────────────────────────────
function ThresholdsTab({ deviceId, device, onUpdate }: { deviceId: string; device: any; onUpdate: (d: any) => void }) {
  const [cpu, setCpu] = useState<string>(device.cpu_threshold?.toString() ?? "");
  const [mem, setMem] = useState<string>(device.mem_threshold?.toString() ?? "");
  const [lat, setLat] = useState<string>(device.latency_threshold_ms?.toString() ?? "");
  const [pkt, setPkt] = useState<string>(device.packet_loss_threshold_pct?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const body: any = {};
    if (cpu !== "") body.cpu_threshold = parseFloat(cpu);
    if (mem !== "") body.mem_threshold = parseFloat(mem);
    if (lat !== "") body.latency_threshold_ms = parseFloat(lat);
    if (pkt !== "") body.packet_loss_threshold_pct = parseFloat(pkt);

    if (Object.keys(body).length === 0) {
      setMsg({ ok: false, text: "No changes to save." });
      setSaving(false);
      return;
    }
    try {
      const res = await fetch(`/api/devices/${deviceId}/thresholds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authOpts().headers },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        onUpdate(data);
        setMsg({ ok: true, text: "Thresholds saved." });
      } else {
        setMsg({ ok: false, text: data.error ?? "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    }
    setSaving(false);
  };

  const fields = [
    { label: "CPU Warn (%)", hint: "Alert when CPU exceeds this value", val: cpu, set: setCpu, placeholder: "e.g. 80" },
    { label: "Memory Warn (%)", hint: "Alert when RAM utilisation exceeds this value", val: mem, set: setMem, placeholder: "e.g. 90" },
    { label: "Latency Warn (ms)", hint: "Alert when ICMP RTT exceeds this value", val: lat, set: setLat, placeholder: "e.g. 50" },
    { label: "Packet-Loss Warn (%)", hint: "Alert when packet loss exceeds this value", val: pkt, set: setPkt, placeholder: "e.g. 5" },
  ];

  return (
    <div className="max-w-lg">
      <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl p-6 flex flex-col gap-5">
        <div>
          <h3 className="text-white font-semibold text-base">Alert Thresholds</h3>
          <p className="text-zinc-500 text-xs mt-1">Override global defaults for this device. Leave blank to use global defaults.</p>
        </div>

        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{f.label}</label>
            <p className="text-[11px] text-zinc-600">{f.hint}</p>
            <input
              type="number"
              min={0}
              step="any"
              value={f.val}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              className="mt-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition"
            />
          </div>
        ))}

        {msg && (
          <div className={`text-xs rounded-lg px-3 py-2 ${msg.ok ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
            {msg.text}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="self-start px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save Thresholds"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function DeviceDetail() {
  const { id } = useParams();
  const router = useRouter();

  const [device, setDevice] = useState<any>(null);
  const [icmp, setIcmp] = useState<any[]>([]);
  const [system, setSystem] = useState<any[]>([]);
  const [interfaces, setInterfaces] = useState<any[]>([]);
  const [discoveredIntfs, setDiscoveredIntfs] = useState<any[]>([]);
  const [trafficSparklines, setTrafficSparklines] = useState<any>({});
  const [opticalSparklines, setOpticalSparklines] = useState<any>({});
  const [interfaceTimeRange] = useState("1h");
  const [activeTab, setActiveTab] = useState("overview");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedIntfs, setSelectedIntfs] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [editingIntf, setEditingIntf] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState("");

  // BGP state
  const [bgpPeers, setBgpPeers] = useState<any[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<any>(null);

  // Backup events state
  const [backupEvents, setBackupEvents] = useState<any[]>([]);
  const [backupEventsLoading, setBackupEventsLoading] = useState(false);

  // Connectivity test state
  const [connTesting, setConnTesting] = useState(false);
  const [connResult, setConnResult] = useState<{ snmp: any; ssh: any; telnet: any } | null>(null);

  useEffect(() => {
    const opts = authOpts();
    fetch(`/api/devices`, opts)
      .then((r) => r.json())
      .then((data) => setDevice(data.find((d: any) => d.ID == id)));

    const fetchMetrics = () => {
      fetch(`/api/metrics/icmp?device_id=${id}`, opts).then((r) => r.json()).then(setIcmp).catch(() => setIcmp([]));
      fetch(`/api/metrics/system?device_id=${id}`, opts).then((r) => r.json()).then(setSystem).catch(() => setSystem([]));
      fetch(`/api/metrics/interfaces?device_id=${id}`, opts).then((r) => r.json()).then(setInterfaces).catch(() => setInterfaces([]));
      fetch(`/api/metrics/interfaces/sparklines?device_id=${id}&range=${interfaceTimeRange}`, opts).then((r) => r.json()).then(setTrafficSparklines).catch(() => setTrafficSparklines({}));
      fetch(`/api/metrics/optical/sparklines?device_id=${id}&range=${interfaceTimeRange}`, opts).then((r) => r.json()).then(setOpticalSparklines).catch(() => setOpticalSparklines({}));
      fetch(`/api/devices/${id}/interfaces`, opts).then((r) => r.json()).then(setDiscoveredIntfs).catch(() => setDiscoveredIntfs([]));
      fetch(`/api/metrics/bgp?device_id=${id}`, opts).then((r) => r.json()).then((d) => setBgpPeers(Array.isArray(d) ? d : [])).catch(() => setBgpPeers([]));
    };

    fetchMetrics();
    const int = setInterval(fetchMetrics, 10000);
    return () => clearInterval(int);
  }, [id, interfaceTimeRange]);

  // Lazy-load backup events when Backup Events tab is opened
  useEffect(() => {
    if (activeTab !== "backup-events" || !device) return;
    setBackupEventsLoading(true);
    fetch(`/api/devices/${id}/backup-events`, authOpts())
      .then((r) => r.json())
      .then((d) => setBackupEvents(Array.isArray(d) ? d : []))
      .catch(() => setBackupEvents([]))
      .finally(() => setBackupEventsLoading(false));
  }, [activeTab, id, device]);

  if (!device) return <div className="text-zinc-500 animate-pulse text-center mt-20">Loading device telemetry...</div>;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "interfaces", label: "Interfaces" },
    { id: "bgp", label: "BGP" },
    { id: "thresholds", label: "Thresholds" },
    { id: "logs", label: "Logs" },
    { id: "config", label: "Config" },
    { id: "backup-events", label: "Backup Events" },
  ];

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleDeleteInterface = async (ifIndex: number) => {
    try {
      const res = await fetch(`/api/devices/${id}/interfaces/${ifIndex}`, { method: "DELETE", ...authOpts() });
      if (res.ok || res.status === 204) {
        setDiscoveredIntfs((prev) => prev.filter((i) => i.if_index !== ifIndex));
        setSelectedIntfs((prev) => { const n = new Set(prev); n.delete(ifIndex); return n; });
      }
    } catch (e) { console.error(e); }
    setDeleteConfirm(null);
  };

  const handleBulkDelete = async () => {
    for (const ifIndex of Array.from(selectedIntfs)) {
      try { await fetch(`/api/devices/${id}/interfaces/${ifIndex}`, { method: "DELETE", ...authOpts() }); } catch {}
    }
    setDiscoveredIntfs((prev) => prev.filter((i) => !selectedIntfs.has(i.if_index)));
    setSelectedIntfs(new Set());
    setBulkDeleteConfirm(false);
  };

  const toggleSelectIntf = (ifIndex: number) => setSelectedIntfs((prev) => { const n = new Set(prev); if (n.has(ifIndex)) n.delete(ifIndex); else n.add(ifIndex); return n; });
  const toggleSelectAll = () => setSelectedIntfs(selectedIntfs.size === discoveredIntfs.length ? new Set() : new Set(discoveredIntfs.map((i) => i.if_index)));

  const handleEditDescription = async (ifIndex: number) => {
    try {
      await fetch(`/api/devices/${id}/interfaces/${ifIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authOpts().headers },
        body: JSON.stringify({ is_monitored: discoveredIntfs.find((i) => i.if_index === ifIndex)?.is_monitored ?? false }),
      });
      setDiscoveredIntfs((prev) => prev.map((i) => i.if_index === ifIndex ? { ...i, description: editDesc } : i));
    } catch (e) { console.error(e); }
    setEditingIntf(null);
  };

  const handleToggleAutoDiscover = async () => {
    const newVal = !device.auto_discover;
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authOpts().headers },
        body: JSON.stringify({ auto_discover: newVal }),
      });
      if (res.ok) setDevice((prev: any) => ({ ...prev, auto_discover: newVal }));
    } catch {}
  };

  const handleToggleMonitor = async (ifIndex: number, current: boolean) => {
    try {
      await fetch(`/api/devices/${id}/interfaces/${ifIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authOpts().headers },
        body: JSON.stringify({ is_monitored: !current }),
      });
      setDiscoveredIntfs((prev) => prev.map((i) => i.if_index === ifIndex ? { ...i, is_monitored: !current } : i));
    } catch {}
  };

  // ── Connectivity test handler ──────────────────────────────────────────
  const testConnectivity = async () => {
    setConnTesting(true);
    setConnResult(null);
    try {
      const res = await fetch(`/api/devices/${id}/test`, { method: "POST", ...authOpts() });
      if (res.ok) {
        const data = await res.json();
        setConnResult(data);
        // auto-dismiss after 20s
        setTimeout(() => setConnResult((prev) => (prev === data ? null : prev)), 20000);
      }
    } catch {}
    setConnTesting(false);
  };

  const probeBadge = (label: string, probe: any) => {
    if (!probe) return null;
    if (probe.status === "up")
      return (
        <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          {label} <span className="font-mono text-[10px] text-emerald-500/80">{probe.latency}ms</span>
        </span>
      );
    if (probe.status === "down")
      return (
        <span key={label} title={probe.error} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-help">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
          {label} <span className="font-mono text-[10px] text-rose-500/80">FAIL</span>
        </span>
      );
    return (
      <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-500 border border-zinc-700">
        {label} <span className="text-[10px]">—</span>
      </span>
    );
  };

  // ── BGP render helpers ───────────────────────────────────────────────────
  const stateColor = (s: string) => {
    if (s === "Established") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (s === "Idle" || s === "Active") return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">{device.name}</h1>
          <p className="text-zinc-500 font-mono text-sm mt-1">{device.ip} &middot; {device.vendor || "Generic"}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {connResult && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
              {probeBadge("SNMP", connResult.snmp)}
              {probeBadge("SSH", connResult.ssh)}
              {probeBadge("Telnet", connResult.telnet)}
            </div>
          )}
          <button
            onClick={testConnectivity}
            disabled={connTesting}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-all shadow-[0_0_12px_rgba(99,102,241,0.15)] hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
          >
            {connTesting ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></svg>
            )}
            {connTesting ? "Testing…" : "Test Connectivity"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-zinc-800/80 overflow-x-auto scroller-hide pb-[-1px]">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${activeTab === t.id ? "text-indigo-400" : "text-zinc-400 hover:text-zinc-200"}`}>
            {t.label}
            {activeTab === t.id && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-indigo-500 rounded-t-full shadow-[0_0_8px_rgba(99,102,241,0.6)]" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="pt-2">

        {/* ── Overview ── */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-8 bg-zinc-900/50 backdrop-blur border border-zinc-800 p-4 rounded-xl shadow-sm text-sm">
              <div><span className="text-zinc-500 block text-xs font-semibold">DNS/IP</span><span className="font-mono text-zinc-200">{device.ip}</span></div>
              <div><span className="text-zinc-500 block text-xs font-semibold">Poll Interval</span><span className="text-zinc-200">{device.poll_interval}s</span></div>
              <div><span className="text-zinc-500 block text-xs font-semibold">Dependency</span><span className="text-zinc-200">Parent</span></div>
              <div className="ml-auto flex gap-6">
                <div className="text-center">
                  <span className="text-zinc-500 block text-xs font-semibold mb-1">Status</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${device.last_snmp_status === "up" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{device.last_snmp_status?.toUpperCase() || "UNKNOWN"}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#18181b] border-b border-zinc-800 text-zinc-400 text-xs">
                    <tr>
                      <th className="p-3 w-8 text-center font-medium">Pos</th>
                      <th className="p-3 w-12 text-center font-medium">State</th>
                      <th className="p-3 font-medium">Sensor</th>
                      <th className="p-3 w-32 font-medium">Status</th>
                      <th className="p-3 font-medium">Message</th>
                      <th className="p-3 w-48 text-right font-medium">Graph</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    <tr onClick={() => router.push(`/dashboard/devices/${id}/sensors/icmp/ping`)} className="hover:bg-zinc-800/30 transition-colors group cursor-pointer">
                      <td className="p-3 text-center text-zinc-600 font-mono text-xs">1.</td>
                      <td className="p-3 text-center"><div className="w-4 h-4 rounded-sm bg-emerald-500 flex items-center justify-center mx-auto text-black shadow-[0_0_8px_rgba(16,185,129,0.5)]"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg></div></td>
                      <td className="p-3 font-medium text-indigo-400 group-hover:underline">{device.name} [Ping]</td>
                      <td className="p-3 text-emerald-500 text-xs">Up</td>
                      <td className="p-3 text-zinc-300 text-xs">OK</td>
                      <td className="p-3">
                        <div className="flex items-center justify-between text-xs text-zinc-400 mb-0.5"><span>Ping Time</span><span>{icmp.length > 0 ? `${icmp[icmp.length - 1].latency} msec` : "-"}</span></div>
                        <div className="h-6 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={icmp.slice(-20)}><Area type="monotone" dataKey="latency" fill="#34d399" fillOpacity={0.2} stroke="#34d399" strokeWidth={1} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                      </td>
                    </tr>
                    <tr onClick={() => router.push(`/dashboard/devices/${id}/sensors/system/uptime`)} className="hover:bg-zinc-800/30 transition-colors group cursor-pointer">
                      <td className="p-3 text-center text-zinc-600 font-mono text-xs">2.</td>
                      <td className="p-3 text-center"><div className="w-4 h-4 rounded-sm bg-emerald-500 flex items-center justify-center mx-auto text-black shadow-[0_0_8px_rgba(16,185,129,0.5)]"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg></div></td>
                      <td className="p-3 font-medium text-indigo-400 group-hover:underline">{device.name} Uptime</td>
                      <td className="p-3 text-emerald-500 text-xs">Up</td>
                      <td className="p-3 text-zinc-300 text-xs">OK</td>
                      <td className="p-3">
                        <div className="flex items-center justify-between text-xs text-zinc-400 mb-0.5"><span>System Uptime</span><span>A few minutes</span></div>
                        <div className="h-6 w-full bg-emerald-500/20" />
                      </td>
                    </tr>
                    <tr onClick={() => router.push(`/dashboard/devices/${id}/sensors/system/cpu`)} className="hover:bg-zinc-800/30 transition-colors group cursor-pointer">
                      <td className="p-3 text-center text-zinc-600 font-mono text-xs">3.</td>
                      <td className="p-3 text-center">
                        <div className={`w-4 h-4 rounded-sm flex items-center justify-center mx-auto text-black ${system.length > 0 && system[system.length - 1].cpu > 80 ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"}`}>
                          {system.length > 0 && system[system.length - 1].cpu > 80 ? <span className="font-bold text-[10px]">U</span> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                        </div>
                      </td>
                      <td className="p-3 font-medium text-indigo-400 group-hover:underline">{device.name} System CPU</td>
                      <td className="p-3 text-zinc-300 text-xs">{system.length > 0 && system[system.length - 1].cpu > 80 ? "Warning" : "Up"}</td>
                      <td className="p-3 text-zinc-300 text-xs">{system.length > 0 ? "OK" : "No data"}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-between text-xs text-zinc-400 mb-0.5"><span>CPU Load</span><span>{system.length > 0 ? `${system[system.length - 1].cpu.toFixed(0)} %` : "-"}</span></div>
                        <div className="h-6 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={system.slice(-20)}><Area type="step" dataKey="cpu" fill="#fb923c" fillOpacity={0.2} stroke="#fb923c" strokeWidth={1} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                      </td>
                    </tr>
                    <tr onClick={() => router.push(`/dashboard/devices/${id}/sensors/system/mem`)} className="hover:bg-zinc-800/30 transition-colors group cursor-pointer">
                      <td className="p-3 text-center text-zinc-600 font-mono text-xs">4.</td>
                      <td className="p-3 text-center"><div className="w-4 h-4 rounded-sm bg-emerald-500 flex items-center justify-center mx-auto text-black shadow-[0_0_8px_rgba(16,185,129,0.5)]"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg></div></td>
                      <td className="p-3 font-medium text-indigo-400 group-hover:underline">{device.name} System Memory</td>
                      <td className="p-3 text-emerald-500 text-xs">Up</td>
                      <td className="p-3 text-zinc-300 text-xs">{system.length > 0 ? "OK" : "No data"}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-between text-xs text-zinc-400 mb-0.5"><span>Memory Usage</span><span>{system.length > 0 ? `${system[system.length - 1].mem.toFixed(0)} %` : "-"}</span></div>
                        <div className="h-6 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={system.slice(-20)}><Area type="monotone" dataKey="mem" fill="#38bdf8" fillOpacity={0.2} stroke="#38bdf8" strokeWidth={1} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                      </td>
                    </tr>

                    {discoveredIntfs.filter((i) => i.is_monitored).map((intf: any, idx) => {
                      const sparkData = trafficSparklines[intf.if_index] || [];
                      const latestTraffic = sparkData.length > 0 ? sparkData[sparkData.length - 1] : null;
                      return (
                        <tr key={intf.if_index} onClick={() => router.push(`/dashboard/devices/${id}/sensors/traffic/${intf.if_index}`)} className="hover:bg-zinc-800/30 transition-colors group cursor-pointer">
                          <td className="p-3 text-center text-zinc-600 font-mono text-xs">{idx + 5}.</td>
                          <td className="p-3 text-center"><div className={`w-4 h-4 rounded-sm flex items-center justify-center mx-auto text-black ${intf.status === "down" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"}`}>{intf.status === "down" ? <span className="font-bold text-[10px]">D</span> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}</div></td>
                          <td className="p-3 font-medium text-indigo-400 group-hover:underline max-w-[250px] truncate" title={intf.description}>({intf.name || intf.if_index}) {intf.description || "Traffic"}</td>
                          <td className="p-3 text-zinc-300 text-xs">{intf.status === "up" ? "Up" : "Down"}</td>
                          <td className="p-3 text-zinc-300 text-xs">{latestTraffic ? "OK" : "Awaiting data..."}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-between text-xs text-zinc-400 mb-0.5"><span>Traffic Total</span><span>{latestTraffic ? `${(latestTraffic.in_mbps + latestTraffic.out_mbps).toFixed(3)} Mbit/s` : "-"}</span></div>
                            <div className="h-6 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={sparkData}><Area type="monotone" dataKey="in_mbps" stroke="#818cf8" fill="#818cf8" fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} /><Area type="monotone" dataKey="out_mbps" stroke="#34d399" fill="#34d399" fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bg-[#18181b] px-4 py-3 border-t border-zinc-800/80 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Auto-refresh every 10s</span>
                <button onClick={() => setIsWizardOpen(true)} className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs font-semibold uppercase tracking-wider transition-colors inline-flex items-center gap-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Sensor
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Interfaces ── */}
        {activeTab === "interfaces" && (
          <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 p-6 rounded-2xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-medium text-lg">Interface Sensors</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 font-medium">Auto-Discovery</span>
                  <button onClick={handleToggleAutoDiscover} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${device.auto_discover ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-zinc-700"}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${device.auto_discover ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                  </button>
                </div>
                <button onClick={() => setIsWizardOpen(true)} className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Sensor
                </button>
              </div>
            </div>

            {selectedIntfs.size > 0 && (
              <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                <span className="text-sm text-indigo-300 font-medium">{selectedIntfs.size} sensor{selectedIntfs.size > 1 ? "s" : ""} selected</span>
                <div className="flex-1" />
                {bulkDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-400">Delete {selectedIntfs.size} sensor{selectedIntfs.size > 1 ? "s" : ""}?</span>
                    <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors">Yes, delete</button>
                    <button onClick={() => setBulkDeleteConfirm(false)} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs font-bold transition-colors">Cancel</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setBulkDeleteConfirm(true)} className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5">Delete selected</button>
                    <button onClick={() => setSelectedIntfs(new Set())} className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs transition-colors">Clear</button>
                  </>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#18181b] border-b border-zinc-800/80 text-zinc-400 text-xs border-x">
                  <tr>
                    <th className="p-3 pl-4 w-10"><input type="checkbox" checked={discoveredIntfs.length > 0 && selectedIntfs.size === discoveredIntfs.length} onChange={toggleSelectAll} className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer" /></th>
                    <th className="p-3 font-semibold">Port</th>
                    <th className="p-3 font-semibold">Description</th>
                    <th className="p-3 font-semibold text-center">Status</th>
                    <th className="p-3 font-semibold text-center">Speed</th>
                    <th className="p-3 font-semibold" style={{ minWidth: "200px" }}>Traffic</th>
                    <th className="p-3 font-semibold" style={{ minWidth: "180px" }}>Optical</th>
                    <th className="p-3 font-semibold text-center">Monitor</th>
                    <th className="p-3 font-semibold text-center w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 border-x border-b border-zinc-800/80">
                  {discoveredIntfs.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-zinc-500 bg-zinc-900/40">No interface sensors yet. Click &ldquo;Add Sensor&rdquo; to create one.</td></tr>
                  ) : discoveredIntfs.map((intf) => {
                    const isMonitored = intf.is_monitored;
                    const sparkData = trafficSparklines[intf.if_index] || [];
                    const optData = opticalSparklines[intf.if_index] || [];
                    const latestTraffic = sparkData.length > 0 ? sparkData[sparkData.length - 1] : null;
                    const latestOpt = optData.length > 0 ? optData[optData.length - 1] : null;
                    return (
                      <tr key={intf.if_index} className={`hover:bg-zinc-800/30 transition-colors group ${selectedIntfs.has(intf.if_index) ? "bg-indigo-500/5" : "bg-zinc-900/40"}`}>
                        <td className="p-3 pl-4"><input type="checkbox" checked={selectedIntfs.has(intf.if_index)} onChange={() => toggleSelectIntf(intf.if_index)} className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer" /></td>
                        <td className={`p-3 font-mono text-zinc-300 ${isMonitored ? "cursor-pointer group-hover:text-indigo-400" : ""} transition-colors whitespace-nowrap`} onClick={() => isMonitored && router.push(`/dashboard/devices/${id}/sensors/traffic/${intf.if_index}`)}>
                          <div className="flex gap-2 items-center">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${intf.status === "down" ? "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]" : "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"}`} />
                            <span className="text-xs">{intf.name || intf.if_index}</span>
                            {isMonitored && <span className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500 text-xs">→</span>}
                          </div>
                        </td>
                        <td className="p-3 text-zinc-400 max-w-[180px]">
                          {editingIntf === intf.if_index ? (
                            <div className="flex gap-2 items-center">
                              <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white w-full focus:border-indigo-500 focus:outline-none" autoFocus />
                              <button onClick={() => handleEditDescription(intf.if_index)} className="text-emerald-400 hover:text-emerald-300 text-[10px] font-bold">Save</button>
                              <button onClick={() => setEditingIntf(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
                            </div>
                          ) : (
                            <span className="truncate max-w-[160px] inline-block cursor-pointer hover:text-zinc-200 transition-colors text-xs" onClick={() => { setEditingIntf(intf.if_index); setEditDesc(intf.description || ""); }}>{intf.description || <span className="text-zinc-600 italic">click to add</span>}</span>
                          )}
                        </td>
                        <td className="p-3 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${intf.status === "down" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>{intf.status === "up" ? "UP" : "DOWN"}</span></td>
                        <td className="p-3 text-center text-xs text-zinc-300 whitespace-nowrap font-mono">{intf.speed ? formatBandwidth(intf.speed) : <span className="text-zinc-600">—</span>}</td>
                        <td className="p-3">
                          {isMonitored && sparkData.length > 0 ? (
                            <div>
                              <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                                <div className="flex gap-2"><span className="text-indigo-400">▼ {latestTraffic?.in_mbps.toFixed(2) ?? "—"}</span><span className="text-emerald-400">▲ {latestTraffic?.out_mbps.toFixed(2) ?? "—"}</span></div>
                                <span className="text-zinc-600">Mbit/s</span>
                              </div>
                              <div className="h-7 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={sparkData}><Area type="monotone" dataKey="in_mbps" stroke="#818cf8" fill="#818cf8" fillOpacity={0.15} strokeWidth={1} isAnimationActive={false} /><Area type="monotone" dataKey="out_mbps" stroke="#34d399" fill="#34d399" fillOpacity={0.15} strokeWidth={1} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                            </div>
                          ) : <span className="text-[10px] text-zinc-600 italic">{isMonitored ? "Awaiting data…" : "—"}</span>}
                        </td>
                        <td className="p-3">
                          {isMonitored && optData.length > 0 ? (
                            <div>
                              <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                                <div className="flex gap-2"><span className="text-amber-400">Rx {latestOpt?.rx_dbm.toFixed(1) ?? "—"}</span><span className="text-sky-400">Tx {latestOpt?.tx_dbm.toFixed(1) ?? "—"}</span></div>
                                <span className="text-zinc-600">dBm</span>
                              </div>
                              <div className="h-7 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={optData}><Line type="monotone" dataKey="rx_dbm" stroke="#f59e0b" strokeWidth={1} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="tx_dbm" stroke="#38bdf8" strokeWidth={1} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
                            </div>
                          ) : <span className="text-[10px] text-zinc-600 italic">{isMonitored ? "No optics" : "—"}</span>}
                        </td>
                        <td className="p-3 text-center">
                          <button onClick={(e) => { e.stopPropagation(); handleToggleMonitor(intf.if_index, isMonitored); }} className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border shadow-sm ${isMonitored ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20" : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{isMonitored ? "✓ On" : "Off"}</button>
                        </td>
                        <td className="p-3 text-center">
                          {deleteConfirm === intf.if_index ? (
                            <div className="flex items-center gap-1 justify-center">
                              <button onClick={() => handleDeleteInterface(intf.if_index)} className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold">Yes</button>
                              <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-[10px] font-bold">No</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirm(intf.if_index)} className="text-zinc-600 hover:text-rose-400 transition-colors">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {discoveredIntfs.length > 0 && <div className="mt-3 text-xs text-zinc-500 italic text-right">Click port names of enabled sensors to view detailed historic telemetry.</div>}
          </div>
        )}

        {/* ── BGP ── */}
        {activeTab === "bgp" && (
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl shadow-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-white font-semibold text-base">BGP Peers</h3>
                <span className="text-xs text-zinc-500">{bgpPeers.length} peer{bgpPeers.length !== 1 ? "s" : ""} · auto-refresh 10s</span>
              </div>
              {bgpPeers.length === 0 ? (
                <div className="py-16 text-center text-zinc-500 text-sm">No BGP peers discovered for this device.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#18181b] text-zinc-400 text-xs border-b border-zinc-800">
                      <tr>
                        <th className="p-3 pl-5 font-semibold">Peer IP</th>
                        <th className="p-3 font-semibold">Remote AS</th>
                        <th className="p-3 font-semibold">State</th>
                        <th className="p-3 font-semibold">Prefixes Rx</th>
                        <th className="p-3 font-semibold">Uptime</th>
                        <th className="p-3 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {bgpPeers.map((peer: any) => (
                        <tr key={peer.peer_ip} className="hover:bg-zinc-800/30 transition-colors group">
                          <td className="p-3 pl-5 font-mono text-zinc-200 text-xs">{peer.peer_ip}</td>
                          <td className="p-3 font-mono text-zinc-400 text-xs">AS{peer.remote_as}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${stateColor(peer.peer_state)}`}>{peer.peer_state}</span>
                          </td>
                          <td className="p-3 text-zinc-300 text-xs font-mono">{peer.prefixes_received ?? "—"}</td>
                          <td className="p-3 text-zinc-400 text-xs">{peer.uptime ?? "—"}</td>
                          <td className="p-3">
                            <button onClick={() => setSelectedPeer(peer)} className="px-3 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-semibold hover:bg-indigo-500/20 transition-colors">
                              History →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Thresholds ── */}
        {activeTab === "thresholds" && (
          <ThresholdsTab deviceId={id as string} device={device} onUpdate={setDevice} />
        )}

        {/* ── Logs stub ── */}
        {activeTab === "logs" && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-10 text-center text-zinc-500 text-sm">
            Syslog &amp; trap correlation coming soon — use the <span className="text-indigo-400 cursor-pointer" onClick={() => router.push("/dashboard/events/syslog")}>Events</span> page in the meantime.
          </div>
        )}

        {/* ── Config ── */}
        {activeTab === "config" && (
          <ConfigTab deviceId={id as string} />
        )}

        {/* ── Backup Events ── */}
        {activeTab === "backup-events" && (
          <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-white font-semibold text-base">Backup Event History</h3>
              <span className="text-xs text-zinc-500">{backupEvents.length} event{backupEvents.length !== 1 ? "s" : ""} · last 50</span>
            </div>
            {backupEventsLoading ? (
              <div className="py-16 text-center text-zinc-500 text-sm animate-pulse">Loading backup events…</div>
            ) : backupEvents.length === 0 ? (
              <div className="py-16 text-center text-zinc-500 text-sm">No backup events recorded yet — run a manual backup from the Config tab.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#18181b] text-zinc-400 text-xs border-b border-zinc-800">
                    <tr>
                      <th className="p-3 pl-5 font-semibold">Time</th>
                      <th className="p-3 font-semibold">Status</th>
                      <th className="p-3 font-semibold">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {backupEvents.map((ev: any) => (
                      <tr key={ev.ID} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="p-3 pl-5 text-zinc-400 text-xs whitespace-nowrap">
                          {(() => { try { return new Date(ev.CreatedAt).toLocaleString(); } catch { return ev.CreatedAt; } })()}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                            ev.status === "success"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          }`}>{ev.status}</span>
                        </td>
                        <td className="p-3 text-zinc-300 text-xs font-mono max-w-md truncate" title={ev.message}>{ev.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BGP History Modal */}
      {selectedPeer && (
        <BGPHistoryModal deviceId={id as string} peer={selectedPeer} onClose={() => setSelectedPeer(null)} />
      )}

      {/* Add Sensor Wizard */}
      <AddSensorWizard
        deviceId={id as string}
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onAdded={() => {
          const opts = authOpts();
          fetch(`/api/devices/${id}/interfaces`, opts).then((r) => r.json()).then(setDiscoveredIntfs).catch(() => setDiscoveredIntfs([]));
        }}
      />
    </div>
  );
}
