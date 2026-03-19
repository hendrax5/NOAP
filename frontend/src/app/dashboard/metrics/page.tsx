"use client";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
  ReferenceLine,
} from "recharts";
import { api } from "@/lib/api";

const TIME_RANGES = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

function StatCard({
  label,
  value,
  unit,
  color,
  icon,
}: {
  label: string;
  value: number | null;
  unit: string;
  color: string;
  icon: string;
}) {
  return (
    <div
      className="flex-1 min-w-[140px] p-4 rounded-xl border flex flex-col gap-1"
      style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--color-text-dim)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color }}>{icon}</span>
        {label}
      </div>
      {value === null ? (
        <div className="text-xl font-bold animate-pulse" style={{ color: "var(--color-text-dim)" }}>—</div>
      ) : (
        <div className="text-2xl font-bold" style={{ color }}>
          {value.toFixed(1)}<span className="text-sm font-normal ml-1" style={{ color: "var(--color-text-dim)" }}>{unit}</span>
        </div>
      )}
    </div>
  );
}

const CustomTooltipTime = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-lg border" style={{ background: "var(--color-surface-2)", borderColor: "var(--color-border)", color: "var(--color-text)" }}>
      <div className="font-mono mb-1 text-[10px]" style={{ color: "var(--color-text-dim)" }}>{new Date(label).toLocaleString()}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: <span className="font-semibold">{Number(p.value).toFixed(2)}</span></div>
      ))}
    </div>
  );
};

export default function MetricsPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [range, setRange] = useState("1h");
  const [systemMetrics, setSystemMetrics] = useState<any[]>([]);
  const [icmpMetrics, setIcmpMetrics] = useState<any[]>([]);
  const [opticalData, setOpticalData] = useState<Record<string, any[]>>({});
  const [selectedIface, setSelectedIface] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load devices
  useEffect(() => {
    api.getDevices()
      .then((data) => {
        setDevices(data || []);
        if (data && data.length > 0) setSelectedDevice(data[0]);
      })
      .catch(console.error);
  }, []);

  // Load metrics whenever device or range changes
  useEffect(() => {
    if (!selectedDevice) return;
    setLoading(true);

    const opts = { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };

    const fetchAll = () => {
      Promise.all([
        fetch(`/api/metrics/system?device_id=${selectedDevice.ID}&range=${range}`, opts).then(r => r.json()).catch(() => []),
        fetch(`/api/metrics/icmp?device_id=${selectedDevice.ID}&range=${range}`, opts).then(r => r.json()).catch(() => []),
        api.getOpticalSparklines(selectedDevice.ID, range).catch(() => ({})),
      ]).then(([sys, icmp, optical]) => {
        setSystemMetrics(Array.isArray(sys) ? sys : []);
        setIcmpMetrics(Array.isArray(icmp) ? icmp : []);
        const optRec = (optical && typeof optical === "object" && !Array.isArray(optical)) ? optical as Record<string, any[]> : {};
        setOpticalData(optRec);
        // Auto-select first interface that has data
        const keys = Object.keys(optRec);
        setSelectedIface(prev => (prev && optRec[prev]) ? prev : (keys[0] ?? null));
        setLoading(false);
      });
    };

    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [selectedDevice, range]);

  // Latest stats for summary cards
  const latestSys = systemMetrics.length ? systemMetrics[systemMetrics.length - 1] : null;
  const latestIcmp = icmpMetrics.length ? icmpMetrics[icmpMetrics.length - 1] : null;

  const avgCpu = systemMetrics.length
    ? systemMetrics.reduce((acc, r) => acc + (r.cpu ?? 0), 0) / systemMetrics.length
    : null;
  const avgMem = systemMetrics.length
    ? systemMetrics.reduce((acc, r) => acc + (r.mem ?? 0), 0) / systemMetrics.length
    : null;
  const avgLatency = icmpMetrics.length
    ? icmpMetrics.reduce((acc, r) => acc + (r.latency ?? 0), 0) / icmpMetrics.length
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>Device Metrics</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-dim)" }}>
            Time-series CPU, memory, latency and packet-loss per device.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Device selector */}
          <select
            className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer"
            style={{
              background: "var(--color-surface-1)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
            value={selectedDevice?.ID ?? ""}
            onChange={(e) => {
              const dev = devices.find((d) => d.ID === Number(e.target.value));
              setSelectedDevice(dev || null);
            }}
          >
            {devices.length === 0 && <option>No devices</option>}
            {devices.map((d) => (
              <option key={d.ID} value={d.ID}>{d.hostname || d.ip_address}</option>
            ))}
          </select>

          {/* Time range */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  background: range === r.value ? "var(--color-primary)" : "var(--color-surface-1)",
                  color: range === r.value ? "#fff" : "var(--color-text-dim)",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Latest CPU"
          value={latestSys ? Number(latestSys.cpu) : null}
          unit="%"
          color={latestSys && latestSys.cpu > 80 ? "#f87171" : "var(--color-primary)"}
          icon="memory"
        />
        <StatCard
          label="Avg CPU"
          value={avgCpu}
          unit="%"
          color="var(--color-primary)"
          icon="bar_chart"
        />
        <StatCard
          label="Latest Mem"
          value={latestSys ? Number(latestSys.mem) : null}
          unit="%"
          color={latestSys && latestSys.mem > 90 ? "#f87171" : "#a78bfa"}
          icon="storage"
        />
        <StatCard
          label="Avg Mem"
          value={avgMem}
          unit="%"
          color="#a78bfa"
          icon="database"
        />
        <StatCard
          label="Latest RTT"
          value={latestIcmp ? Number(latestIcmp.latency) : null}
          unit="ms"
          color="#34d399"
          icon="network_ping"
        />
        <StatCard
          label="Avg RTT"
          value={avgLatency}
          unit="ms"
          color="#34d399"
          icon="speed"
        />
        <StatCard
          label="Pkt Loss"
          value={latestIcmp ? Number(latestIcmp.loss) : null}
          unit="%"
          color={latestIcmp && latestIcmp.loss > 1 ? "#f87171" : "#fbbf24"}
          icon="signal_disconnected"
        />
      </div>

      {loading && (
        <div className="text-center py-4 animate-pulse text-sm" style={{ color: "var(--color-text-dim)" }}>
          Fetching metrics…
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPU Utilisation */}
        <div
          className="p-5 rounded-2xl border shadow-lg"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-primary)" }}>memory</span>
            CPU Utilisation (%)
          </h3>
          {systemMetrics.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
              No CPU data for this device / range.
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={systemMetrics} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomTooltipTime />} />
                  <ReferenceLine y={80} stroke="#f87171" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="cpu" name="CPU %" stroke="var(--color-primary)" fill="url(#cpuGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Memory Utilisation */}
        <div
          className="p-5 rounded-2xl border shadow-lg"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#a78bfa" }}>storage</span>
            Memory Utilisation (%)
          </h3>
          {systemMetrics.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
              No memory data for this device / range.
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={systemMetrics} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomTooltipTime />} />
                  <ReferenceLine y={90} stroke="#f87171" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="mem" name="Mem %" stroke="#a78bfa" fill="url(#memGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ICMP Latency */}
        <div
          className="p-5 rounded-2xl border shadow-lg"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#34d399" }}>network_ping</span>
            ICMP Round-Trip Time (ms)
          </h3>
          {icmpMetrics.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
              No ICMP data for this device / range.
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={icmpMetrics} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomTooltipTime />} />
                  <Line type="monotone" dataKey="latency" name="RTT ms" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ICMP Packet Loss */}
        <div
          className="p-5 rounded-2xl border shadow-lg"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#fbbf24" }}>signal_disconnected</span>
            Packet Loss (%)
          </h3>
          {icmpMetrics.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
              No ICMP data for this device / range.
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={icmpMetrics} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomTooltipTime />} />
                  <ReferenceLine y={1} stroke="#f87171" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="loss" name="Loss %" stroke="#fbbf24" fill="url(#lossGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Optical TX / RX Power */}
        <div
          className="p-5 rounded-2xl border shadow-lg"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="font-semibold flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#fb923c" }}>fiber_optic</span>
              Optical Power (dBm)
            </h3>
            {/* Interface selector */}
            {Object.keys(opticalData).length > 0 && (
              <select
                className="px-2 py-1 rounded text-xs border outline-none"
                style={{ background: "var(--color-surface-2)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                value={selectedIface ?? ""}
                onChange={(e) => setSelectedIface(e.target.value)}
              >
                {Object.keys(opticalData).map((k) => (
                  <option key={k} value={k}>Interface {k}</option>
                ))}
              </select>
            )}
          </div>
          {(!selectedIface || !opticalData[selectedIface]?.length) ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-dim)" }}>
              No optical data for this device / range.
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={opticalData[selectedIface]} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--color-text-dim)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomTooltipTime />} />
                  <ReferenceLine y={-20} stroke="#f87171" strokeDasharray="4 4" label={{ value: "-20 dBm", fill: "#f87171", fontSize: 10 }} />
                  <Line type="monotone" dataKey="rx_dbm" name="RX dBm" stroke="#fb923c" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tx_dbm" name="TX dBm" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Data table */}
      {systemMetrics.length > 0 && (
        <div
          className="p-5 rounded-2xl border shadow-lg overflow-x-auto"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <h3 className="font-semibold mb-4" style={{ color: "var(--color-text)" }}>
            System Metrics — Recent Data Points
          </h3>
          <table className="w-full text-sm text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-dim)" }}>
                <th className="pb-2 font-medium pr-6">Timestamp</th>
                <th className="pb-2 font-medium pr-6">CPU %</th>
                <th className="pb-2 font-medium pr-6">Mem %</th>
                <th className="pb-2 font-medium">Uptime (s)</th>
              </tr>
            </thead>
            <tbody>
              {[...systemMetrics].reverse().slice(0, 20).map((row, i) => (
                <tr
                  key={i}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text)" }}
                >
                  <td className="py-2 pr-6 font-mono text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {new Date(row.ts).toLocaleString()}
                  </td>
                  <td className="py-2 pr-6 font-mono">
                    <span style={{ color: row.cpu > 80 ? "#f87171" : "var(--color-primary)" }}>
                      {Number(row.cpu).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-6 font-mono">
                    <span style={{ color: row.mem > 90 ? "#f87171" : "#a78bfa" }}>
                      {Number(row.mem).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {row.uptime ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
