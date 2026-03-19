"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type DeviceStatus = "up" | "warn" | "down" | "unknown";

interface DeviceCell {
  id: number;
  name: string;
  ip: string;
  status: DeviceStatus;
  latency: number | null;
  tenant: string;
}

function deriveStatus(device: any, icmpMap: Map<number, number>): DeviceStatus {
  const lat = icmpMap.get(device.id);
  if (lat === undefined) return "unknown";
  if (lat === 0) return "down";
  if (lat > 150) return "warn";
  return "up";
}

const STATUS_LABEL: Record<DeviceStatus, string> = {
  up: "UP",
  warn: "WARN",
  down: "DOWN",
  unknown: "—",
};

const RING_CLASS: Record<DeviceStatus, string> = {
  up: "status-ring status-up",
  warn: "status-ring status-warn",
  down: "status-ring status-down",
  unknown: "status-ring status-unknown",
};

const CELL_CLASS: Record<DeviceStatus, string> = {
  up: "noc-cell noc-cell-up",
  warn: "noc-cell noc-cell-warn",
  down: "noc-cell noc-cell-down",
  unknown: "noc-cell noc-cell-unknown",
};

export default function NOCWall() {
  const [devices, setDevices] = useState<DeviceCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(30);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = async () => {
    try {
      const [rawDevices, icmpRows] = await Promise.all([
        api.getDevices(),
        api.getICMPMetrics(0, "1h"),
      ]);

      // Build latest-latency map per device
      const icmpMap = new Map<number, number>();
      const arr = Array.isArray(icmpRows) ? icmpRows : [];
      // Take the most recent entry per device_id
      [...arr].reverse().forEach((r: any) => {
        if (!icmpMap.has(r.device_id)) {
          icmpMap.set(r.device_id, r.latency ?? 0);
        }
      });

      const cells: DeviceCell[] = (rawDevices ?? []).map((d: any) => ({
        id: d.id,
        name: d.hostname ?? d.ip,
        ip: d.ip,
        status: deriveStatus(d, icmpMap),
        latency: icmpMap.get(d.id) ?? null,
        tenant: d.tenant_code ?? "—",
      }));

      setDevices(cells);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("NOC Wall fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    setCountdown(30);

    const refresh = setInterval(() => {
      fetchAll();
      setCountdown(30);
    }, 30_000);

    tickRef.current = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 30));
    }, 1000);

    return () => {
      clearInterval(refresh);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Summary counts
  const upCount   = devices.filter((d) => d.status === "up").length;
  const warnCount = devices.filter((d) => d.status === "warn").length;
  const downCount = devices.filter((d) => d.status === "down").length;
  const unkCount  = devices.filter((d) => d.status === "unknown").length;

  return (
    <div className="min-h-screen flex flex-col gap-4" style={{ background: "var(--color-surface-0)" }}>
      {/* ── Top Bar ── */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface-1)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--color-text-dim)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            Dashboard
          </Link>
          <span style={{ color: "var(--color-border-hover)" }}>|</span>
          <h1 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            NOC Wall — Device Health Grid
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Summary pills */}
          {[
            { label: "UP",      count: upCount,   color: "#25f46a", bg: "rgba(37,244,106,0.1)" },
            { label: "WARN",    count: warnCount,  color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
            { label: "DOWN",    count: downCount,  color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
            { label: "UNKNOWN", count: unkCount,   color: "#64748b", bg: "rgba(100,116,139,0.1)" },
          ].map(({ label, count, color, bg }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{ background: bg, color }}
            >
              {count}
              <span className="font-normal opacity-70">{label}</span>
            </div>
          ))}

          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium"
            style={{
              background: "var(--color-primary-muted)",
              color: "var(--color-primary)",
              border: "1px solid var(--color-border-hover)",
            }}
          >
            <span className="status-ring status-up" style={{ width: 6, height: 6 }} />
            Live · {countdown}s
          </div>

          {lastUpdated && (
            <span className="text-xs font-metric" style={{ color: "var(--color-text-dim)" }}>
              {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Countdown bar */}
      <div
        className="countdown-bar mx-6"
        style={{ animation: `countdown-bar ${countdown}s linear` }}
      />

      {/* ── Device Grid ── */}
      <div className="flex-1 px-6 pb-6">
        {loading ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
            {Array.from({ length: 32 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-lg" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 text-center rounded-xl"
            style={{ border: "1px dashed var(--color-border)" }}
          >
            <span className="material-symbols-outlined text-4xl mb-3" style={{ color: "var(--color-text-dim)", fontSize: 40 }}>
              router
            </span>
            <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
              No devices found. Add devices to populate the NOC Wall.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
          >
            {devices.map((d) => (
              <Link key={d.id} href={`/dashboard/devices/${d.id}`}>
                <div className={CELL_CLASS[d.status]}>
                  {/* Status ring */}
                  <span className={RING_CLASS[d.status]} />

                  {/* Hostname */}
                  <span
                    className="text-xs font-semibold text-center leading-tight max-w-full truncate px-1"
                    style={{ color: "var(--color-text)", maxWidth: "100px" }}
                    title={d.name}
                  >
                    {d.name}
                  </span>

                  {/* IP */}
                  <span
                    className="font-metric text-center"
                    style={{ fontSize: 9, color: "var(--color-text-dim)", letterSpacing: "0.3px" }}
                  >
                    {d.ip}
                  </span>

                  {/* Latency or status */}
                  <span
                    className="font-metric font-bold"
                    style={{
                      fontSize: 11,
                      color:
                        d.status === "up"   ? "#25f46a" :
                        d.status === "warn" ? "#f59e0b" :
                        d.status === "down" ? "#ef4444" :
                        "var(--color-text-dim)",
                    }}
                  >
                    {d.latency !== null && d.status !== "down"
                      ? `${d.latency}ms`
                      : STATUS_LABEL[d.status]}
                  </span>

                  {/* Tenant badge */}
                  <span
                    className="text-center px-1 py-px rounded"
                    style={{
                      fontSize: 9,
                      background: "var(--color-surface-3)",
                      color: "var(--color-text-dim)",
                      maxWidth: "100px",
                    }}
                  >
                    {d.tenant}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
