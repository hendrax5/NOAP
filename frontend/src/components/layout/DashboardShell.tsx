"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Sidebar, { NAV_SECTIONS } from "./Sidebar";
import SubPanel from "./SubPanel";
import type { ReactNode } from "react";

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Derive active section from current path
  const deriveSection = (path: string) => {
    // exact dashboard root
    if (path === "/dashboard") return "dashboard";
    for (const s of NAV_SECTIONS) {
      for (const item of s.subItems) {
        if (path === item.path) return s.id;
      }
      // prefix match for deeper routes (e.g. /dashboard/devices/123)
      if (path.startsWith(`/dashboard/${s.id === "dashboard" ? "_" : s.subItems[0].path.split("/")[2]}`)) {
        return s.id;
      }
    }
    return "dashboard";
  };

  const [activeSection, setActiveSection] = useState<string>(() => deriveSection(pathname));
  const [subPanelOpen, setSubPanelOpen] = useState(true);
  const [pinned, setPinned] = useState(true);

  // sync section with route  
  useEffect(() => {
    setActiveSection(deriveSection(pathname));
  }, [pathname]);

  const handleSectionChange = (sectionId: string) => {
    if (activeSection === sectionId && subPanelOpen) {
      // clicking same icon toggles sub-panel
      if (!pinned) setSubPanelOpen(false);
    } else {
      setActiveSection(sectionId);
      setSubPanelOpen(true);
    }
  };

  const handlePinToggle = () => setPinned(p => !p);
  const handleClose = () => setSubPanelOpen(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--color-surface-0)" }}>
      {/* ── Top Header ── */}
      <header
        className="flex items-center justify-between px-4 shrink-0 border-b z-20"
        style={{
          height: 56,
          background: "var(--color-surface-1)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Left: Logo + health */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-sm tracking-wide" style={{ color: "var(--color-primary)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>hub</span>
            <span className="hidden sm:inline">NOAP</span>
          </Link>
          <div
            className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
            style={{ background: "rgba(37,244,106,0.08)", color: "var(--color-primary)", border: "1px solid var(--color-border-hover)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
            All Systems Nominal
          </div>
        </div>

        {/* Center: Global search trigger */}
        <button
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{
            background: "var(--color-surface-2)",
            color: "var(--color-text-dim)",
            border: "1px solid var(--color-border)",
            minWidth: 200,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
          <span>Search devices, events...</span>
          <kbd
            className="ml-auto rounded px-1.5 py-0.5 text-xs"
            style={{ background: "var(--color-surface-3)", color: "var(--color-text-dim)" }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Right: alerts, tenant, profile */}
        <div className="flex items-center gap-2">
          {/* Alert bell */}
          <button
            className="relative flex items-center justify-center rounded-lg transition-colors"
            style={{ width: 36, height: 36, color: "var(--color-text-dim)" }}
            title="Alerts"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>notifications</span>
            {/* Red dot */}
            <span
              className="absolute top-1 right-1 w-2 h-2 rounded-full"
              style={{ background: "var(--color-danger)" }}
            />
          </button>
          {/* Divider */}
          <div className="w-px h-5" style={{ background: "var(--color-border)" }} />
          {/* Profile */}
          <button
            className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors text-sm font-medium"
            style={{ color: "var(--color-text-muted)" }}
            title="Profile"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "var(--color-primary-muted)", color: "var(--color-primary)", border: "1px solid var(--color-border-hover)" }}
            >
              AD
            </div>
          </button>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Icon rail */}
        <Sidebar activeSection={activeSection} onSectionChange={handleSectionChange} />

        {/* Sub-panel */}
        {subPanelOpen && (
          <SubPanel
            activeSectionId={activeSection}
            pinned={pinned}
            onPinToggle={handlePinToggle}
            onClose={handleClose}
          />
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Breadcrumb strip */}
          <div
            className="flex items-center gap-2 px-6 py-2 border-b text-xs"
            style={{ background: "var(--color-surface-0)", borderColor: "var(--color-border)", color: "var(--color-text-dim)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>home</span>
            <span>/</span>
            <span style={{ color: "var(--color-text-muted)" }}>
              {NAV_SECTIONS.find(s => s.id === activeSection)?.label ?? "Dashboard"}
            </span>
          </div>
          {/* Page content */}
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
