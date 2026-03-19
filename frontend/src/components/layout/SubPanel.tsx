"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "./Sidebar";

type SubPanelProps = {
  activeSectionId: string | null;
  pinned: boolean;
  onPinToggle: () => void;
  onClose: () => void;
};

export default function SubPanel({ activeSectionId, pinned, onPinToggle, onClose }: SubPanelProps) {
  const pathname = usePathname();
  const section = NAV_SECTIONS.find(s => s.id === activeSectionId);

  if (!section) return null;

  return (
    <div
      className="flex flex-col shrink-0 border-r overflow-hidden transition-all duration-200"
      style={{
        width: 220,
        background: "var(--color-surface-1)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Section header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-primary)" }}
        >
          {section.label}
        </span>
        <div className="flex items-center gap-1">
          {/* Pin toggle */}
          <button
            onClick={onPinToggle}
            title={pinned ? "Unpin panel" : "Pin panel"}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: 24,
              height: 24,
              color: pinned ? "var(--color-primary)" : "var(--color-text-dim)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {pinned ? "push_pin" : "push_pin"}
            </span>
          </button>
          {/* Close (only shown when unpinned) */}
          {!pinned && (
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 24, height: 24, color: "var(--color-text-dim)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-links */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {section.subItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100"
              style={{
                background: isActive ? "var(--color-primary-muted)" : "transparent",
                color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
                border: isActive ? "1px solid var(--color-border-hover)" : "1px solid transparent",
              }}
            >
              <span
                className="w-1 h-1 rounded-full shrink-0"
                style={{ background: isActive ? "var(--color-primary)" : "var(--color-text-dim)" }}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
