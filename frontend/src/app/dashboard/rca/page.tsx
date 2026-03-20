"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function RCA() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRCAEvents()
      .then((data: any) => {
        setEvents(data || []);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, []);

  if (loading) return (
    <div className="text-center mt-20 animate-pulse" style={{ color: "var(--color-text-dim)" }}>
      Loading AI causality models...
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 mb-2">
        <span className="material-symbols-outlined text-4xl" style={{ color: "var(--color-primary)" }}>psychology</span>
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
            AI Root Cause Analysis
          </h1>
          <p style={{ color: "var(--color-text-muted)" }}>
            Automated multi-domain event correlation and causality reasoning engine.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {events.length === 0 ? (
          <div
            className="p-12 rounded-2xl text-center"
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-dim)",
            }}
          >
            <span className="material-symbols-outlined text-4xl mb-2 opacity-50 block">check_circle</span>
            <p>No anomalous events or network regressions detected.</p>
          </div>
        ) : events?.map((event: any, idx: number) => (
          <div
            key={idx}
            className="p-6 rounded-2xl shadow-lg"
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-border)",
            }}
          >
            {/* Event header */}
            <div
              className="flex items-center justify-between pb-4 mb-4"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="material-symbols-outlined text-2xl"
                  style={{ color: event.severity === 'Critical' ? '#f43f5e' : '#f59e0b' }}
                >
                  warning
                </span>
                <h3 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
                  {event.incident_title}
                </h3>
              </div>
              <span className="text-xs font-metric" style={{ color: "var(--color-text-dim)" }}>
                {new Date(event.timestamp).toLocaleString("id-ID")}
              </span>
            </div>

            {/* Root Cause */}
            <div className="mb-6">
              <h4
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--color-text-dim)" }}
              >
                Root Cause Hypothesis
              </h4>
              <p
                className="leading-relaxed p-4 rounded-xl"
                style={{
                  color: "var(--color-text-muted)",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {event.root_cause_summary}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Timeline */}
              <div>
                <h4
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--color-text-dim)" }}
                >
                  Event Timeline Correlated
                </h4>
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-700 before:to-transparent">
                  {event.timeline?.map((t: any, i: number) => (
                    <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div
                        className="flex items-center justify-center w-6 h-6 rounded-full border-4 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2"
                        style={{
                          borderColor: "var(--color-surface-1)",
                          background: "var(--color-surface-3)",
                        }}
                      />
                      <div
                        className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg shadow"
                        style={{
                          background: "var(--color-surface-2)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold" style={{ color: "var(--color-primary)" }}>{t.source}</span>
                          <span className="text-[10px] font-metric" style={{ color: "var(--color-text-dim)" }}>
                            {new Date(t.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{t.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div>
                <h4
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--color-text-dim)" }}
                >
                  AI Recommendations
                </h4>
                <ul className="space-y-3">
                  {event.recommendations?.map((r: any, i: number) => (
                    <li
                      key={i}
                      className="flex gap-3 p-4 rounded-xl"
                      style={{
                        background: "rgba(99,102,241,0.06)",
                        border: "1px solid rgba(99,102,241,0.15)",
                      }}
                    >
                      <span className="material-symbols-outlined mt-0.5" style={{ color: "var(--color-primary)" }}>
                        auto_awesome
                      </span>
                      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{r}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div
              className="mt-6 pt-4 flex items-center justify-end gap-3"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <span className="text-xs italic" style={{ color: "var(--color-text-dim)" }}>
                Confidence Score: {event.confidence_score * 100}%
              </span>
              <button className="btn btn-ghost">Acknowledge</button>
              <button className="btn btn-primary">Start Automation Recovery</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
