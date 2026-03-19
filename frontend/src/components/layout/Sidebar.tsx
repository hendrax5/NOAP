"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavSection = {
  id: string;
  icon: string;
  label: string;
  subItems: { label: string; path: string }[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "dashboard",
    icon: "dashboard",
    label: "Dashboard",
    subItems: [
      { label: "Overview", path: "/dashboard" },
      { label: "NOC Wall", path: "/dashboard/wall" },
    ],
  },
  {
    id: "metrics",
    icon: "monitoring",
    label: "Metrics",
    subItems: [
      { label: "CPU / Mem Charts", path: "/dashboard/metrics" },
    ],
  },
  {
    id: "devices",
    icon: "router",
    label: "Devices",
    subItems: [
      { label: "All Devices", path: "/dashboard/devices" },
      { label: "Add Device", path: "/dashboard/devices/add" },
      { label: "Device Groups", path: "/dashboard/devices/groups" },
    ],
  },
  {
    id: "topology",
    icon: "hub",
    label: "Topology",
    subItems: [
      { label: "L2 Map", path: "/dashboard/topology" },
      { label: "L3 / BGP Map", path: "/dashboard/topology/bgp" },
    ],
  },
  {
    id: "flows",
    icon: "analytics",
    label: "Flow Analytics",
    subItems: [
      { label: "Live Flow", path: "/dashboard/flows" },
      { label: "Top Talkers", path: "/dashboard/flows/talkers" },
      { label: "Flow Queries", path: "/dashboard/flows/query" },
    ],
  },
  {
    id: "events",
    icon: "bolt",
    label: "Events",
    subItems: [
      { label: "Syslog Stream", path: "/dashboard/events" },
      { label: "SNMP Traps", path: "/dashboard/events/traps" },
      { label: "Alert Rules", path: "/dashboard/events/rules" },
    ],
  },
  {
    id: "probes",
    icon: "monitor_heart",
    label: "Probes",
    subItems: [
      { label: "ICMP / HTTP", path: "/dashboard/probes" },
      { label: "SLA Reports", path: "/dashboard/probes/sla" },
    ],
  },
  {
    id: "config",
    icon: "shield_lock",
    label: "Config Mgmt",
    subItems: [
      { label: "Backup History", path: "/dashboard/automation" },
      { label: "Diff Viewer", path: "/dashboard/automation/diff" },
      { label: "Schedule", path: "/dashboard/automation/schedule" },
    ],
  },
  {
    id: "rca",
    icon: "psychology",
    label: "AI RCA",
    subItems: [
      { label: "Incident Analysis", path: "/dashboard/rca" },
    ],
  },
  {
    id: "settings",
    icon: "settings",
    label: "Settings",
    subItems: [
      { label: "Tenants", path: "/dashboard/settings" },
      { label: "Users", path: "/dashboard/settings/users" },
      { label: "API Keys", path: "/dashboard/settings/api-keys" },
    ],
  },
];

type SidebarProps = {
  activeSection: string | null;
  onSectionChange: (sectionId: string) => void;
};

export default function Sidebar({ activeSection, onSectionChange }: SidebarProps) {
  const pathname = usePathname();

  // determine which section owns the current path
  const activeSectionId = activeSection ?? NAV_SECTIONS.find(s =>
    s.subItems.some(i => i.path === pathname) ||
    (s.id === "dashboard" && pathname === "/dashboard")
  )?.id ?? "dashboard";

  return (
    <aside
      className="flex flex-col items-center py-3 gap-1 shrink-0 border-r"
      style={{
        width: 56,
        background: "var(--color-surface-0)",
        borderColor: "var(--color-border)",
      }}
    >
      {NAV_SECTIONS.map((section) => {
        const isActive = activeSectionId === section.id;
        return (
          <button
            key={section.id}
            title={section.label}
            onClick={() => onSectionChange(section.id)}
            aria-label={section.label}
            className="group relative flex items-center justify-center rounded-lg transition-all duration-150"
            style={{
              width: 40,
              height: 40,
              background: isActive ? "var(--color-primary-muted)" : "transparent",
              color: isActive ? "var(--color-primary)" : "var(--color-text-dim)",
              border: isActive ? "1px solid var(--color-border-hover)" : "1px solid transparent",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {section.icon}
            </span>
            {/* Tooltip */}
            <span
              className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded px-2 py-1 text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity z-50"
              style={{
                background: "var(--color-surface-3)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border-hover)",
              }}
            >
              {section.label}
            </span>
          </button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Separator + collapse hint at bottom */}
      <div
        className="w-6 h-px mb-1"
        style={{ background: "var(--color-border)" }}
      />
    </aside>
  );
}
