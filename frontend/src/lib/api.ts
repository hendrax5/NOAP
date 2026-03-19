/**
 * Centralized API helper for NOAP frontend.
 * All routes are relative – Next.js rewrites /api/* → backend /api/v1/*.
 */

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") ?? "";
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  _retry = true
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });

  // Auto-logout: if the server says our token is invalid/expired, clear it
  // and redirect to login so the user gets a fresh session immediately.
  if (res.status === 401 && path !== "/api/auth/login") {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("role");
      localStorage.removeItem("tenant_id");
      window.location.href = "/login";
    }
    throw new Error("Session expired. Please log in again.");
  }

  // Auto-retry on 429: wait retry_after seconds then try once more.
  // This handles burst spikes during dashboard auto-refresh cycles.
  if (res.status === 429 && _retry) {
    let waitMs = 5_000; // default 5 s
    try {
      const body = await res.clone().json();
      if (typeof body?.retry_after === "number") {
        waitMs = body.retry_after * 1_000;
      }
    } catch { /* ignore parse errors */ }
    await new Promise((r) => setTimeout(r, waitMs));
    return apiFetch<T>(path, options, false); // one retry only
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiFetch<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      tenant_id: number;
      role: string;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  // Dashboard
  getDashboardMetrics: () => apiFetch("/api/metrics/dashboard"),

  // Devices
  getDevices: () => apiFetch<any[]>("/api/devices"),
  createDevice: (body: object) =>
    apiFetch("/api/devices", { method: "POST", body: JSON.stringify(body) }),
  updateDevice: (id: number, body: object) =>
    apiFetch(`/api/devices/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteDevice: (id: number) =>
    apiFetch(`/api/devices/${id}`, { method: "DELETE" }),
  discoverInterfaces: (id: number) =>
    apiFetch(`/api/devices/${id}/discover`, { method: "POST" }),
  getInterfaces: (id: number) => apiFetch(`/api/devices/${id}/interfaces`),

  // Probes / SLA
  getProbes: () => apiFetch<any[]>("/api/probes"),
  createProbe: (body: object) =>
    apiFetch("/api/probes", { method: "POST", body: JSON.stringify(body) }),
  getSLAMetrics: (probeId: number) =>
    apiFetch(`/api/metrics/sla?probe_id=${probeId}`),

  // Events
  getSyslogEvents: (limit = 200) =>
    apiFetch<any[]>(`/api/events/syslog?limit=${limit}`),
  getTrapEvents: (limit = 50) =>
    apiFetch<any[]>(`/api/events/traps?limit=${limit}`),

  // Metrics
  getICMPMetrics: (deviceId?: number, range = "24h") =>
    apiFetch(`/api/metrics/icmp?device_id=${deviceId ?? 0}&range=${range}`),
  getSystemMetrics: (deviceId?: number, range = "24h") =>
    apiFetch(`/api/metrics/system?device_id=${deviceId ?? 0}&range=${range}`),
  getBGPMetrics: () => apiFetch("/api/metrics/bgp"),
  getMPLSMetrics: () => apiFetch("/api/metrics/mpls"),
  getTopology: () => apiFetch("/api/metrics/topology"),
  getTopTalkers: () => apiFetch("/api/metrics/flows/top-talkers"),
  getFlowBandwidth: () => apiFetch("/api/metrics/flows/bandwidth"),
  getFlowTimeSeries: () => apiFetch("/api/metrics/flows/timeseries"),
  getTopApplications: () => apiFetch("/api/metrics/flows/apps"),
  getTopASNs: () => apiFetch("/api/metrics/flows/asns"),
  getGeoFlows: () => apiFetch("/api/metrics/flows/geo"),
  getSankeyFlows: () => apiFetch("/api/metrics/flows/sankey"),
  getInterfaceMetrics: (deviceId?: number) =>
    apiFetch(`/api/metrics/interfaces${deviceId ? `?device_id=${deviceId}` : ""}`),
  getInterfaceSparklines: (deviceId: number) =>
    apiFetch(`/api/metrics/interfaces/sparklines?device_id=${deviceId}`),
  getOpticalSparklines: (deviceId: number, range = "24h") =>
    apiFetch(`/api/metrics/optical/sparklines?device_id=${deviceId}&range=${range}`),

  // Configs
  getDeviceConfigs: (deviceId: number) =>
    apiFetch(`/api/configs/${deviceId}`),
  getConfigDiff: (deviceId: number, baseId: number) =>
    apiFetch(`/api/configs/${deviceId}/diff/${baseId}`),
  rollbackConfig: (deviceId: number, targetId: number) =>
    apiFetch(`/api/configs/${deviceId}/rollback/${targetId}`, { method: "POST" }),

  // RCA
  getRCAEvents: () => apiFetch("/api/rca/events"),

  // Tenant / Settings
  getTenantSettings: () => apiFetch("/api/tenant/settings"),
  updateTenantSettings: (body: object) =>
    apiFetch("/api/tenant/settings", { method: "PUT", body: JSON.stringify(body) }),

  // Alert Deliveries
  getAlertDeliveries: (params?: { channel?: string; status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set("channel", params.channel);
    if (params?.status)  q.set("status",  params.status);
    if (params?.limit)   q.set("limit",   String(params.limit));
    if (params?.offset)  q.set("offset",  String(params.offset));
    return apiFetch<{ total: number; limit: number; offset: number; deliveries: any[] }>(
      `/api/alert-deliveries?${q.toString()}`
    );
  },
};
