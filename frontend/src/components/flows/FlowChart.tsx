"use client";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { ChartType } from "./FlowQueryBuilder";

/* ── Types (mirroring backend response) ── */
export interface FlowQueryRow {
  dimensions: Record<string, string | number>;
  value: number;
}
export interface FlowQueryBucket {
  bucket: string;
  series: Record<string, number>;
}
export interface FlowQueryResult {
  rows: FlowQueryRow[] | null;
  time_series: FlowQueryBucket[] | null;
}

/* ── Palette ── */
const COLORS = [
  "#6366f1", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#3b82f6",
  "#8b5cf6", "#10b981",
];

/* ── Helpers ── */
function fmtValue(v: number, metric: string) {
  if (metric === "packets") {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + " Gpkt";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + " Mpkt";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + " Kpkt";
    return v.toString();
  }
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " GB";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " MB";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " KB";
  return v + " B";
}

function pct(v: number, total: number) {
  return total > 0 ? ((v / total) * 100).toFixed(1) + "%" : "0%";
}

interface Props {
  data: FlowQueryResult;
  chartType: ChartType;
  metric: string;
}

export default function FlowChart({ data, chartType, metric }: Props) {
  const rows = data.rows ?? [];
  const ts   = data.time_series ?? [];
  const total = rows.reduce((s, r) => s + r.value, 0);

  // Build unique series keys from rows
  const seriesKeys = rows.map((r) =>
    Object.values(r.dimensions).join("/")
  );

  /* ── Table view ── */
  if (chartType === "table") {
    const dimNames = rows.length > 0 ? Object.keys(rows[0].dimensions) : [];
    return (
      <div className="vz-table-wrap">
        <table className="vz-table">
          <thead>
            <tr>
              <th>#</th>
              {dimNames.map((d) => (
                <th key={d}>{d.replace(/_/g, " ")}</th>
              ))}
              <th className="text-right">{metric}</th>
              <th className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="vz-rank">{i + 1}</td>
                {dimNames.map((d) => (
                  <td key={d}>{String(r.dimensions[d])}</td>
                ))}
                <td className="text-right vz-mono">{fmtValue(r.value, metric)}</td>
                <td className="text-right vz-mono">{pct(r.value, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  /* ── Pie / Donut ── */
  if (chartType === "pie") {
    const pieData = rows.map((r, i) => ({
      name: Object.values(r.dimensions).join(" / "),
      value: r.value,
      fill: COLORS[i % COLORS.length],
    }));
    return (
      <div className="vz-chart-area">
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={140}
              paddingAngle={2}
              strokeWidth={0}
            >
              {pieData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#1a1a2e",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 8,
              }}
              formatter={(v: unknown) => fmtValue(Number(v ?? 0), metric)}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, opacity: 0.8 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ── Time-series charts (area / bar / line) ── */
  // Transform time_series buckets into recharts-friendly array
  const chartData = ts.map((b) => {
    const point: Record<string, string | number> = { bucket: b.bucket };
    for (const k of seriesKeys) {
      point[k] = b.series[k] ?? 0;
    }
    return point;
  });

  const commonProps = {
    width: "100%" as const,
    height: 400,
  };

  const renderXAxis = () => (
    <XAxis
      dataKey="bucket"
      tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }}
      stroke="rgba(255,255,255,.1)"
    />
  );
  const renderYAxis = () => (
    <YAxis
      tickFormatter={(v: number) => fmtValue(v, metric)}
      tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }}
      stroke="rgba(255,255,255,.1)"
      width={70}
    />
  );
  const renderGrid = () => (
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
  );
  const renderTooltip = () => (
    <Tooltip
      contentStyle={{
        background: "#1a1a2e",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 8,
        fontSize: 12,
      }}
      formatter={(v: unknown) => fmtValue(Number(v ?? 0), metric)}
    />
  );
  const renderLegend = () => (
    <Legend wrapperStyle={{ fontSize: 11, opacity: 0.8 }} />
  );

  if (chartType === "line") {
    return (
      <div className="vz-chart-area">
        <ResponsiveContainer {...commonProps}>
          <LineChart data={chartData}>
            {renderGrid()}
            {renderXAxis()}
            {renderYAxis()}
            {renderTooltip()}
            {renderLegend()}
            {seriesKeys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "bar") {
    return (
      <div className="vz-chart-area">
        <ResponsiveContainer {...commonProps}>
          <BarChart data={chartData}>
            {renderGrid()}
            {renderXAxis()}
            {renderYAxis()}
            {renderTooltip()}
            {renderLegend()}
            {seriesKeys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                fill={COLORS[i % COLORS.length]}
                stackId="stack"
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // default: stacked area
  return (
    <div className="vz-chart-area">
      <ResponsiveContainer {...commonProps}>
        <AreaChart data={chartData}>
          {renderGrid()}
          {renderXAxis()}
          {renderYAxis()}
          {renderTooltip()}
          {renderLegend()}
          {seriesKeys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="stack"
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.35}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
