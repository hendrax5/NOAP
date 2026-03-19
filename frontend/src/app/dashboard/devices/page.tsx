"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const VENDORS: { label: string; logo?: string }[] = [
  { label: "Juniper" },
  { label: "Ruijie" },
  { label: "Cisco" },
  { label: "Cisco IOS-XE" },
  { label: "Cisco NX-OS" },
  { label: "Huawei" },
  { label: "MikroTik RouterOS v6" },
  { label: "MikroTik RouterOS v7" },
  { label: "Nokia / SROS" },
  { label: "ZTE" },
  { label: "Arista" },
  { label: "Fortinet" },
  { label: "Palo Alto" },
  { label: "H3C" },
  { label: "Extreme Networks" },
  { label: "TP-Link (SMB)" },
  { label: "VyOS" },
  { label: "DANOS" },
  { label: "Generic / RFC" },
];

interface Device {
  ID: number;
  name: string;
  ip: string;
  vendor: string;
  snmp_comm: string;
  ssh_user: string;
  ssh_pass: string;
  auth_protocol: string;
  auth_port: number;
  poll_interval: number;
  auto_discover: boolean;
}

const EMPTY: Partial<Device> = {
  name: "",
  ip: "",
  vendor: "",
  snmp_comm: "public",
  ssh_user: "",
  ssh_pass: "",
  auth_protocol: "SSH",
  auth_port: 22,
  poll_interval: 300,
  auto_discover: false,
};

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "edit" | "delete" | null>(null);
  const [form, setForm] = useState<Partial<Device>>(EMPTY);
  const [selected, setSelected] = useState<Device | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const vendorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (vendorRef.current && !vendorRef.current.contains(e.target as Node)) {
        setVendorOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const load = () => {
    setLoading(true);
    api.getDevices()
      .then(setDevices)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (modal) {
      setTimeout(() => nameRef.current?.focus(), 50);
      setError(null);
    }
  }, [modal]);

  const openAdd = () => {
    setForm({ ...EMPTY });
    setSelected(null);
    setModal("add");
  };

  const openEdit = (d: Device, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm({ ...d });
    setSelected(d);
    setModal("edit");
  };

  const openDelete = (d: Device, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(d);
    setModal("delete");
  };

  const closeModal = () => { setModal(null); setError(null); };

  const handleSave = async () => {
    if (!form.name?.trim() || !form.ip?.trim()) {
      setError("Name and IP address are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (modal === "add") {
        await api.createDevice(form);
      } else if (modal === "edit" && selected) {
        await api.updateDevice(selected.ID, form);
      }
      closeModal();
      load();
    } catch (e: any) {
      setError(e.message ?? "Failed to save device.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteDevice(selected.ID);
      closeModal();
      load();
    } catch (e: any) {
      setError(e.message ?? "Failed to delete device.");
    } finally {
      setSaving(false);
    }
  };

  const inp = (
    label: string,
    key: keyof Device,
    opts?: { type?: string; placeholder?: string; ref?: React.RefObject<HTMLInputElement | null> }
  ) => (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <input
        ref={opts?.ref as React.RefObject<HTMLInputElement> | undefined}
        className="field-input"
        type={opts?.type ?? "text"}
        placeholder={opts?.placeholder}
        value={(form[key] as string | number | undefined) ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
            Device Inventory
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-text-dim)" }}>
            Manage monitored devices in this tenant
          </p>
        </div>
        <button
          className="btn btn-primary flex items-center gap-2"
          onClick={openAdd}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Add Device
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Name", "IP Address", "Vendor", "SNMP", "Status", ""].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-dim)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>
                    <div className="px-5 py-8 flex flex-col gap-2">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="skeleton h-10 rounded-lg" />
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              {!loading && devices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center" style={{ color: "var(--color-text-dim)" }}>
                    No devices found. Click <strong>Add Device</strong> to get started.
                  </td>
                </tr>
              )}
              {!loading && devices.map((d) => (
                <tr
                  key={d.ID}
                  className="transition-colors cursor-pointer"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onClick={() => router.push(`/dashboard/devices/${d.ID}`)}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: "var(--color-text)" }}>
                    {d.name}
                  </td>
                  <td className="px-5 py-3 font-metric" style={{ color: "var(--color-text-muted)" }}>
                    {d.ip}
                  </td>
                  <td className="px-5 py-3" style={{ color: "var(--color-text-muted)" }}>
                    {d.vendor || "—"}
                  </td>
                  <td className="px-5 py-3 font-metric text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {d.snmp_comm || "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className="badge badge-success">Online</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="p-1.5 rounded-lg transition-colors"
                        title="Edit"
                        style={{ color: "var(--color-text-dim)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-surface-3)"; e.currentTarget.style.color = "var(--color-primary)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-dim)"; }}
                        onClick={(e) => openEdit(d, e)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button
                        className="p-1.5 rounded-lg transition-colors"
                        title="Delete"
                        style={{ color: "var(--color-text-dim)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; e.currentTarget.style.color = "#ef4444"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-dim)"; }}
                        onClick={(e) => openDelete(d, e)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 flex flex-col gap-5 overflow-y-auto"
            style={{
              maxHeight: "90vh",
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-border-hover)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: "var(--color-text)" }}>
                {modal === "add" ? "Add Device" : "Edit Device"}
              </h2>
              <button
                className="p-1 rounded-lg transition-colors"
                style={{ color: "var(--color-text-dim)" }}
                onClick={closeModal}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {inp("Device Name *", "name", { ref: nameRef, placeholder: "core-rtr-01" })}
              {inp("IP Address *", "ip", { placeholder: "192.168.1.1" })}
              {/* Vendor combobox */}
              <div className="field-group" ref={vendorRef} style={{ position: "relative" }}>
                <label className="field-label">Vendor</label>
                <input
                  className="field-input"
                  placeholder="Type to search vendor…"
                  value={form.vendor ?? ""}
                  autoComplete="off"
                  onFocus={() => setVendorOpen(true)}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, vendor: e.target.value }));
                    setVendorOpen(true);
                  }}
                />
                {vendorOpen && (() => {
                  const q = (form.vendor ?? "").toLowerCase();
                  const filtered = VENDORS.filter((v) =>
                    v.label.toLowerCase().includes(q)
                  );
                  if (filtered.length === 0) return null;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        zIndex: 9999,
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border-hover)",
                        borderRadius: 8,
                        marginTop: 4,
                        maxHeight: 220,
                        overflowY: "auto",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      }}
                    >
                      {filtered.map((v) => (
                        <button
                          key={v.label}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm transition-colors"
                          style={{
                            color: "var(--color-text)",
                            background: "transparent",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--color-surface-3)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                          onClick={() => {
                            setForm((f) => ({ ...f, vendor: v.label }));
                            setVendorOpen(false);
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 16, color: "var(--color-primary)" }}
                          >
                            router
                          </span>
                          {v.label}
                          {v.label === "Juniper" || v.label === "Ruijie" ? (
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 10,
                                background: "rgba(0,200,120,0.15)",
                                color: "#00c878",
                                borderRadius: 4,
                                padding: "1px 6px",
                              }}
                            >
                              live
                            </span>
                          ) : (
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 10,
                                background: "rgba(120,120,255,0.15)",
                                color: "#8888ff",
                                borderRadius: 4,
                                padding: "1px 6px",
                              }}
                            >
                              soon
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {inp("SNMP Community", "snmp_comm", { placeholder: "public" })}
              {inp("Username", "ssh_user", { placeholder: "admin" })}
              {inp("Password", "ssh_pass", { type: "password", placeholder: "••••••••" })}
              <div className="field-group">
                <label className="field-label">Auth Protocol</label>
                <select
                  className="field-input"
                  value={form.auth_protocol ?? "SSH"}
                  onChange={(e) => {
                    const proto = e.target.value;
                    const defaultPort = proto === "TELNET" ? 23 : 22;
                    setForm((f) => ({ ...f, auth_protocol: proto, auth_port: defaultPort }));
                  }}
                >
                  <option value="SSH">SSH</option>
                  <option value="TELNET">Telnet</option>
                  <option value="NETCONF">NETCONF</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Auth Port</label>
                <input
                  className="field-input"
                  type="number"
                  value={form.auth_port ?? 22}
                  onChange={(e) => setForm((f) => ({ ...f, auth_port: Number(e.target.value) }))}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Poll Interval (s)</label>
                <input
                  className="field-input"
                  type="number"
                  value={form.poll_interval ?? 300}
                  onChange={(e) => setForm((f) => ({ ...f, poll_interval: Number(e.target.value) }))}
                />
              </div>
              <div className="field-group flex items-center gap-3 pt-5">
                <input
                  id="auto-discover"
                  type="checkbox"
                  className="w-4 h-4 rounded"
                  checked={form.auto_discover ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, auto_discover: e.target.checked }))}
                />
                <label htmlFor="auto-discover" className="field-label cursor-pointer">
                  Auto-Discover Interfaces
                </label>
              </div>
            </div>

            {error && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                {error}
              </p>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : modal === "add" ? "Add Device" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {modal === "delete" && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-border-hover)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>delete_forever</span>
              </div>
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--color-text)" }}>
                  Delete Device
                </h2>
                <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
                  This action cannot be undone.
                </p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Are you sure you want to delete <strong style={{ color: "var(--color-text)" }}>{selected.name}</strong> ({selected.ip})?
            </p>
            {error && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                {error}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>Cancel</button>
              <button
                className="btn"
                style={{ background: "#ef4444", color: "#fff", border: "none" }}
                onClick={handleDelete}
                disabled={saving}
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
