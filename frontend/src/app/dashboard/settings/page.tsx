"use client";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────
interface TenantSettings {
  telegram_bot_token: string;
  telegram_chat_id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  alert_email_to: string;
  webhook_url: string;
  webhook_secret: string;
  name?: string;
}

interface AlertDelivery {
  ID: number;
  channel: string;
  status: string;
  message: string;
  last_error: string;
  attempts: number;
  CreatedAt: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
      style={{ color: "var(--color-text-dim)" }}
    >
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full h-11 rounded-lg px-4 text-sm font-mono transition-colors focus:outline-none"
      style={{
        background: "var(--color-surface-2)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text)",
      }}
      onFocus={e =>
        (e.currentTarget.style.borderColor = "var(--color-primary)")
      }
      onBlur={e =>
        (e.currentTarget.style.borderColor = "var(--color-border)")
      }
    />
  );
}

type Tab = "telegram" | "smtp" | "webhook" | "log";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "telegram", label: "Telegram",  icon: "send" },
  { key: "smtp",     label: "Email",     icon: "email" },
  { key: "webhook",  label: "Webhook",   icon: "webhook" },
  { key: "log",      label: "Delivery Log", icon: "receipt_long" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    delivered: "rgba(37,244,106,0.15)",
    sent:      "rgba(37,244,106,0.15)",
    dlq:       "rgba(239,68,68,0.15)",
    pending:   "rgba(255,171,0,0.15)",
  };
  const text: Record<string, string> = {
    delivered: "var(--color-primary)",
    sent:      "var(--color-primary)",
    dlq:       "var(--color-danger)",
    pending:   "var(--color-warning, #ffab00)",
  };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase"
      style={{ background: colors[status] ?? "var(--color-surface-2)", color: text[status] ?? "var(--color-text)" }}
    >
      {status}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const icons: Record<string, string> = { telegram: "send", email: "email", webhook: "webhook" };
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--color-text-dim)" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icons[channel] ?? "notifications"}</span>
      {channel}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [form, setForm] = useState<TenantSettings>({
    telegram_bot_token: "",
    telegram_chat_id: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    smtp_from: "",
    alert_email_to: "",
    webhook_url: "",
    webhook_secret: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [tab, setTab] = useState<Tab>("telegram");

  // Delivery log state
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [dlTotal, setDlTotal] = useState(0);
  const [dlLoading, setDlLoading] = useState(false);
  const [dlFilter, setDlFilter] = useState<{ channel: string; status: string }>({ channel: "", status: "" });

  // ── Load settings ──
  useEffect(() => {
    api.getTenantSettings()
      .then((data: any) => {
        setForm({
          telegram_bot_token: data.telegram_bot_token ?? "",
          telegram_chat_id:   data.telegram_chat_id   ?? "",
          smtp_host:          data.smtp_host           ?? "",
          smtp_port:          data.smtp_port           || 587,
          smtp_user:          data.smtp_user           ?? "",
          smtp_pass:          data.smtp_pass           ?? "",
          smtp_from:          data.smtp_from           ?? "",
          alert_email_to:     data.alert_email_to      ?? "",
          webhook_url:        data.webhook_url         ?? "",
          webhook_secret:     data.webhook_secret      ?? "",
          name:               data.name                ?? "",
        });
      })
      .catch(() => showToast("error", "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  // ── Load delivery log ──
  const loadDeliveries = useCallback(() => {
    setDlLoading(true);
    api.getAlertDeliveries({ channel: dlFilter.channel || undefined, status: dlFilter.status || undefined, limit: 50 })
      .then(data => { setDeliveries(data.deliveries ?? []); setDlTotal(data.total); })
      .catch(() => {})
      .finally(() => setDlLoading(false));
  }, [dlFilter]);

  useEffect(() => {
    if (tab === "log") loadDeliveries();
  }, [tab, loadDeliveries]);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Save ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateTenantSettings({
        telegram_bot_token: form.telegram_bot_token,
        telegram_chat_id:   form.telegram_chat_id,
        smtp_host:          form.smtp_host,
        smtp_port:          form.smtp_port,
        smtp_user:          form.smtp_user,
        smtp_pass:          form.smtp_pass,
        smtp_from:          form.smtp_from,
        alert_email_to:     form.alert_email_to,
        webhook_url:        form.webhook_url,
        webhook_secret:     form.webhook_secret,
      });
      showToast("success", "Settings saved successfully");
    } catch {
      showToast("error", "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--color-surface-2)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl relative">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--color-text)" }}>
          Notification Settings
        </h1>
        <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
          Configure alert delivery channels — Telegram, Email, and Webhooks.
        </p>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium"
          style={{
            background: toast.type === "success" ? "rgba(37,244,106,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${toast.type === "success" ? "var(--color-primary)" : "var(--color-danger)"}`,
            color: toast.type === "success" ? "var(--color-primary)" : "var(--color-danger)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {toast.type === "success" ? "check_circle" : "error"}
          </span>
          {toast.msg}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all flex-1 justify-center"
            style={{
              background: tab === t.key ? "var(--color-primary)" : "transparent",
              color: tab === t.key ? "#000" : "var(--color-text-dim)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab panels ── */}
      {tab !== "log" ? (
        <form
          onSubmit={handleSave}
          className="rounded-xl p-6 flex flex-col gap-5"
          style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}
        >
          {/* ── Telegram ── */}
          {tab === "telegram" && (
            <>
              <div className="flex items-center gap-2 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>send</span>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Telegram Bot</h2>
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    Send alerts to a Telegram group or channel via BotFather.
                  </p>
                </div>
              </div>
              <div>
                <FieldLabel>Bot Token</FieldLabel>
                <Input type="password" autoComplete="off" placeholder="123456789:ABCdefGHIjklmNOPqrstUVWxyz" value={form.telegram_bot_token}
                  onChange={e => setForm(f => ({ ...f, telegram_bot_token: e.target.value }))} />
                <p className="mt-1 text-xs" style={{ color: "var(--color-text-dim)" }}>
                  Obtain from&nbsp;
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary)" }}>@BotFather</a>.
                </p>
              </div>
              <div>
                <FieldLabel>Chat ID</FieldLabel>
                <Input type="text" placeholder="-1001234567890" value={form.telegram_chat_id}
                  onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} />
                <p className="mt-1 text-xs" style={{ color: "var(--color-text-dim)" }}>Group / channel ID where alerts are posted.</p>
              </div>
            </>
          )}

          {/* ── SMTP ── */}
          {tab === "smtp" && (
            <>
              <div className="flex items-center gap-2 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>email</span>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Email (SMTP)</h2>
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>Send alert notifications via email using SMTP relay.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <FieldLabel>SMTP Host</FieldLabel>
                  <Input placeholder="smtp.gmail.com" value={form.smtp_host}
                    onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <FieldLabel>Port</FieldLabel>
                  <Input type="number" placeholder="587" value={String(form.smtp_port)}
                    onChange={e => setForm(f => ({ ...f, smtp_port: parseInt(e.target.value) || 587 }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <FieldLabel>Username</FieldLabel>
                  <Input placeholder="alerts@example.com" value={form.smtp_user}
                    onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <FieldLabel>Password</FieldLabel>
                  <Input type="password" autoComplete="off" placeholder="••••••••" value={form.smtp_pass}
                    onChange={e => setForm(f => ({ ...f, smtp_pass: e.target.value }))} />
                </div>
              </div>
              <div>
                <FieldLabel>From Address</FieldLabel>
                <Input placeholder="NOC Alert <noc@example.com>" value={form.smtp_from}
                  onChange={e => setForm(f => ({ ...f, smtp_from: e.target.value }))} />
              </div>
              <div>
                <FieldLabel>Alert Recipients</FieldLabel>
                <Input placeholder="ops@company.com, noc@company.com" value={form.alert_email_to}
                  onChange={e => setForm(f => ({ ...f, alert_email_to: e.target.value }))} />
                <p className="mt-1 text-xs" style={{ color: "var(--color-text-dim)" }}>Comma-separated list of email addresses.</p>
              </div>
            </>
          )}

          {/* ── Webhook ── */}
          {tab === "webhook" && (
            <>
              <div className="flex items-center gap-2 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>webhook</span>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Webhook</h2>
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    POST alert payloads to an external URL with HMAC-SHA256 signatures.
                  </p>
                </div>
              </div>
              <div>
                <FieldLabel>Webhook URL</FieldLabel>
                <Input placeholder="https://hooks.example.com/noap" value={form.webhook_url}
                  onChange={e => setForm(f => ({ ...f, webhook_url: e.target.value }))} />
              </div>
              <div>
                <FieldLabel>Signing Secret</FieldLabel>
                <Input type="password" autoComplete="off" placeholder="whsec_..." value={form.webhook_secret}
                  onChange={e => setForm(f => ({ ...f, webhook_secret: e.target.value }))} />
                <p className="mt-1 text-xs" style={{ color: "var(--color-text-dim)" }}>
                  Used to generate <code style={{ color: "var(--color-primary)" }}>X-NOAP-Signature</code> HMAC-SHA256 header.
                </p>
              </div>
            </>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 h-10 px-6 rounded-lg text-sm font-semibold transition-opacity"
              style={{ background: "var(--color-primary)", color: "#000", opacity: saving ? 0.6 : 1 }}
            >
              {saving && <span className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />}
              {saving ? "Saving…" : "Save Configuration"}
            </button>
          </div>
        </form>
      ) : (
        /* ── Delivery Log ── */
        <div className="rounded-xl p-6" style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
          <div className="flex items-center justify-between pb-4 mb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>receipt_long</span>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Alert Delivery Log</h2>
                <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                  {dlTotal} total entries
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={dlFilter.channel}
                onChange={e => setDlFilter(f => ({ ...f, channel: e.target.value }))}
                className="h-8 rounded-lg px-2 text-xs"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              >
                <option value="">All channels</option>
                <option value="telegram">Telegram</option>
                <option value="email">Email</option>
                <option value="webhook">Webhook</option>
              </select>
              <select
                value={dlFilter.status}
                onChange={e => setDlFilter(f => ({ ...f, status: e.target.value }))}
                className="h-8 rounded-lg px-2 text-xs"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              >
                <option value="">All status</option>
                <option value="sent">Sent</option>
                <option value="dlq">DLQ</option>
              </select>
              <button
                onClick={loadDeliveries}
                disabled={dlLoading}
                className="h-8 px-3 rounded-lg text-xs font-semibold"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              >
                {dlLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ color: "var(--color-text)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="text-left py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Time</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Channel</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Status</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Message</th>
                  <th className="text-right py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Retries</th>
                  <th className="text-left py-2 px-2 font-semibold uppercase" style={{ color: "var(--color-text-dim)" }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8" style={{ color: "var(--color-text-dim)" }}>
                      {dlLoading ? "Loading…" : "No alert deliveries yet"}
                    </td>
                  </tr>
                )}
                {deliveries.map(d => (
                  <tr key={d.ID} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td className="py-2 px-2 whitespace-nowrap font-mono" style={{ color: "var(--color-text-dim)" }}>
                      {new Date(d.CreatedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-2"><ChannelBadge channel={d.channel} /></td>
                    <td className="py-2 px-2"><StatusBadge status={d.status} /></td>
                    <td className="py-2 px-2 max-w-[260px] truncate" title={d.message}>{d.message}</td>
                    <td className="py-2 px-2 text-right font-mono">{d.attempts}</td>
                    <td className="py-2 px-2 max-w-[200px] truncate" title={d.last_error} style={{ color: "var(--color-danger)" }}>
                      {d.last_error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
