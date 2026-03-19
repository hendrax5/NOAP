"use client";
import { useState } from "react";

/* ── Dimension whitelist (mirrors backend allowedDimensions) ── */
const DIMENSIONS = [
  { value: "protocol",     label: "Protocol" },
  { value: "app",          label: "Application" },
  { value: "src_ip",       label: "Source IP" },
  { value: "dst_ip",       label: "Dest IP" },
  { value: "src_port",     label: "Source Port" },
  { value: "dst_port",     label: "Dest Port" },
  { value: "src_asn_name", label: "Source ASN" },
  { value: "dst_asn_name", label: "Dest ASN" },
  { value: "src_country",  label: "Source Country" },
  { value: "dst_country",  label: "Dest Country" },
  { value: "flow_type",    label: "Flow Type" },
  { value: "in_if",        label: "In Interface" },
  { value: "out_if",       label: "Out Interface" },
  { value: "next_hop",     label: "Next Hop" },
  { value: "vlan_id",      label: "VLAN" },
  { value: "tos",          label: "ToS / DSCP" },
] as const;

const TIME_RANGES = [
  { value: "5m",  label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h",  label: "1 hour" },
  { value: "6h",  label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d",  label: "7 days" },
];

const CHART_TYPES = [
  { value: "area",  icon: "area_chart",  tip: "Stacked Area" },
  { value: "bar",   icon: "bar_chart",   tip: "Bar Chart" },
  { value: "line",  icon: "show_chart",  tip: "Line Chart" },
  { value: "pie",   icon: "donut_large", tip: "Pie / Donut" },
  { value: "table", icon: "table_chart", tip: "Table" },
] as const;

export type ChartType = (typeof CHART_TYPES)[number]["value"];

export interface FlowQueryParams {
  dimensions: string[];
  metric: "bytes" | "packets";
  time_range: string;
  limit: number;
  filter: string;
  chartType: ChartType;
}

interface Props {
  onQuery: (params: FlowQueryParams) => void;
  loading: boolean;
}

export default function FlowQueryBuilder({ onQuery, loading }: Props) {
  const [dims, setDims] = useState<string[]>(["protocol"]);
  const [metric, setMetric] = useState<"bytes" | "packets">("bytes");
  const [timeRange, setTimeRange] = useState("1h");
  const [limit, setLimit] = useState(10);
  const [filter, setFilter] = useState("");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [showDimPicker, setShowDimPicker] = useState(false);

  const toggleDim = (d: string) => {
    setDims((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const run = () => {
    const finalDims = dims.length ? dims : ["protocol"];
    onQuery({
      dimensions: finalDims,
      metric,
      time_range: timeRange,
      limit,
      filter,
      chartType,
    });
  };

  return (
    <div className="vz-toolbar">
      {/* ── Dimensions ── */}
      <div className="vz-group">
        <label className="vz-label">Dimensions</label>
        <div className="vz-chips-wrap">
          {dims.map((d) => {
            const lbl = DIMENSIONS.find((x) => x.value === d)?.label ?? d;
            return (
              <span key={d} className="vz-chip">
                {lbl}
                <button onClick={() => toggleDim(d)} className="vz-chip-x">
                  ×
                </button>
              </span>
            );
          })}
          <button
            className="vz-chip vz-chip--add"
            onClick={() => setShowDimPicker((v) => !v)}
          >
            + Add
          </button>
        </div>
        {showDimPicker && (
          <div className="vz-dim-picker">
            {DIMENSIONS.filter((d) => !dims.includes(d.value)).map((d) => (
              <button
                key={d.value}
                className="vz-dim-option"
                onClick={() => {
                  toggleDim(d.value);
                  setShowDimPicker(false);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Metric toggle ── */}
      <div className="vz-group">
        <label className="vz-label">Metric</label>
        <div className="vz-toggle-pair">
          <button
            className={`vz-toggle ${metric === "bytes" ? "active" : ""}`}
            onClick={() => setMetric("bytes")}
          >
            Bytes
          </button>
          <button
            className={`vz-toggle ${metric === "packets" ? "active" : ""}`}
            onClick={() => setMetric("packets")}
          >
            Packets
          </button>
        </div>
      </div>

      {/* ── Time Range ── */}
      <div className="vz-group">
        <label className="vz-label">Range</label>
        <select
          className="vz-select"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Limit ── */}
      <div className="vz-group">
        <label className="vz-label">Top N</label>
        <input
          type="number"
          className="vz-input-num"
          value={limit}
          min={1}
          max={50}
          onChange={(e) => setLimit(Math.min(50, Math.max(1, +e.target.value)))}
        />
      </div>

      {/* ── Filter ── */}
      <div className="vz-group vz-group--filter">
        <label className="vz-label">Filter</label>
        <input
          className="vz-input-text"
          placeholder="e.g. protocol = 'TCP'"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* ── Chart type icons ── */}
      <div className="vz-group">
        <label className="vz-label">Chart</label>
        <div className="vz-chart-icons">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.value}
              className={`vz-chart-btn ${chartType === ct.value ? "active" : ""}`}
              onClick={() => setChartType(ct.value)}
              title={ct.tip}
            >
              <span className="material-symbols-outlined">{ct.icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Run ── */}
      <button className="vz-run" onClick={run} disabled={loading}>
        {loading ? (
          <span className="material-symbols-outlined spin">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined">play_arrow</span>
        )}
        Run
      </button>
    </div>
  );
}
