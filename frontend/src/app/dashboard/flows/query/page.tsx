"use client";
import { useState } from "react";
import FlowQueryBuilder, { type FlowQueryParams } from "@/components/flows/FlowQueryBuilder";
import FlowChart, { type FlowQueryResult } from "@/components/flows/FlowChart";
import { api } from "@/lib/api";
import "./visualize.css";

export default function VisualizePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FlowQueryResult | null>(null);
  const [chartType, setChartType] = useState<FlowQueryParams["chartType"]>("area");
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async (params: FlowQueryParams) => {
    setLoading(true);
    setError(null);
    setChartType(params.chartType);
    try {
      const res = await api.queryFlows({
        dimensions: params.dimensions,
        metric: params.metric,
        time_range: params.time_range,
        limit: params.limit,
        filter: params.filter || undefined,
      });
      setResult(res as FlowQueryResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content vz-page">
      <div className="page-header">
        <h1>
          <span className="material-symbols-outlined">query_stats</span>
          Visualize
        </h1>
        <p className="page-subtitle">
          Build custom flow queries — group by any dimension, choose a metric, and pick your chart.
        </p>
      </div>

      <FlowQueryBuilder onQuery={handleQuery} loading={loading} />

      {error && (
        <div className="vz-error">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      {result && !error && (
        <FlowChart data={result} chartType={chartType} metric="bytes" />
      )}

      {!result && !error && !loading && (
        <div className="vz-empty">
          <span className="material-symbols-outlined">insights</span>
          <h3>Ready to visualize</h3>
          <p>Select dimensions, set your time range, and click <strong>Run</strong> to build your chart.</p>
        </div>
      )}
    </div>
  );
}
