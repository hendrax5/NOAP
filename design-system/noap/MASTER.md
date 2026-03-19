# NOAP Design System — Master File

> **LOGIC:** When building a specific page, first check `design-system/noap/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** NOAP — Network Observability & Automation Platform
**Generated:** 2026-03-18 20:33
**Category:** Network Monitoring / NOC Dashboard / SaaS
**Mode:** Dark-first (always dark)

---

## Global Rules

### Color Palette

| Role             | Hex        | CSS Variable             | Usage                            |
|------------------|------------|--------------------------|----------------------------------|
| Primary          | `#25f46a`  | `--color-primary`        | Active states, healthy indicators, CTA |
| Primary Hover    | `#1cd45a`  | `--color-primary-hover`  | Button/link hover                |
| Primary Muted    | `#25f46a1a`| `--color-primary-muted`  | Subtle primary backgrounds       |
| Danger           | `#ef4444`  | `--color-danger`         | Alerts, errors, critical status  |
| Warning          | `#f59e0b`  | `--color-warning`        | Warnings, degraded status        |
| Info             | `#3b82f6`  | `--color-info`           | Informational, links             |
| Surface-0        | `#0a1610`  | `--color-surface-0`      | App background, deepest layer    |
| Surface-1        | `#102216`  | `--color-surface-1`      | Sidebar, main content bg         |
| Surface-2        | `#162d1e`  | `--color-surface-2`      | Cards, panels, sections          |
| Surface-3        | `#1e3d28`  | `--color-surface-3`      | Elevated cards, dropdowns        |
| Border           | `#25f46a1a`| `--color-border`         | Card/input borders               |
| Border Hover     | `#25f46a33`| `--color-border-hover`   | Focused / hovered borders        |
| Text Primary     | `#f1f5f9`  | `--color-text`           | Main readable text               |
| Text Secondary   | `#94a3b8`  | `--color-text-muted`     | Labels, captions, secondary info |
| Text Tertiary    | `#64748b`  | `--color-text-dim`       | Disabled text, placeholders      |

**Semantic Status Colors:**

| Status     | Color      | Usage                    |
|------------|------------|--------------------------|
| OK / Up    | `#25f46a`  | Healthy, online, normal  |
| Warning    | `#f59e0b`  | Degraded, high latency   |
| Critical   | `#ef4444`  | Down, error, alert       |
| Unknown    | `#64748b`  | Paused, unknown, no data |
| Info       | `#3b82f6`  | Informational            |

### Typography

- **Font Family:** Inter (already loaded via Google Fonts)
- **Monospace:** JetBrains Mono (for metrics, IPs, OIDs, code)
- **Icon Set:** Material Symbols Outlined (already loaded)

**Google Fonts Link:**
```
https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap
```

**Type Scale:**

| Token          | Size    | Weight | Usage                        |
|----------------|---------|--------|------------------------------|
| `--text-xs`    | `11px`  | 400    | Badge labels, timestamps     |
| `--text-sm`    | `13px`  | 400    | Secondary labels, captions   |
| `--text-base`  | `14px`  | 400    | Body text, table cells       |
| `--text-md`    | `15px`  | 500    | Card titles, nav items       |
| `--text-lg`    | `18px`  | 600    | Section headings             |
| `--text-xl`    | `22px`  | 600    | Page headings                |
| `--text-2xl`   | `28px`  | 700    | Dashboard hero metrics       |
| `--text-metric`| `36px`  | 700    | Large KPI numbers            |

### Spacing

| Token          | Value    | Usage                    |
|----------------|----------|--------------------------|
| `--space-xs`   | `4px`    | Icon-text gaps           |
| `--space-sm`   | `8px`    | Inline spacing, tight    |
| `--space-md`   | `12px`   | Card inner padding       |
| `--space-lg`   | `16px`   | Section padding          |
| `--space-xl`   | `24px`   | Card padding, panel gaps |
| `--space-2xl`  | `32px`   | Section margins          |
| `--space-3xl`  | `48px`   | Page-level gaps          |

### Border Radii

| Token          | Value    | Usage                    |
|----------------|----------|--------------------------|
| `--radius-sm`  | `4px`    | Badges, tags             |
| `--radius-md`  | `8px`    | Buttons, inputs          |
| `--radius-lg`  | `12px`   | Cards, panels            |
| `--radius-xl`  | `16px`   | Modals, overlays         |

### Shadows (Dark-optimized)

| Level          | Value                                           | Usage            |
|----------------|-------------------------------------------------|------------------|
| `--shadow-sm`  | `0 1px 2px rgba(0,0,0,0.3)`                    | Subtle lift      |
| `--shadow-md`  | `0 4px 12px rgba(0,0,0,0.4)`                   | Cards            |
| `--shadow-lg`  | `0 8px 24px rgba(0,0,0,0.5)`                   | Dropdowns        |
| `--shadow-xl`  | `0 16px 48px rgba(0,0,0,0.6)`                  | Modals           |
| `--shadow-glow`| `0 0 20px rgba(37,244,106,0.15)`               | Primary glow     |

---

## Component Specs

### Status Badges

```css
.badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-ok     { background: #25f46a1a; color: #25f46a; }
.badge-warn   { background: #f59e0b1a; color: #f59e0b; }
.badge-crit   { background: #ef44441a; color: #ef4444; }
.badge-info   { background: #3b82f61a; color: #3b82f6; }
.badge-unknown{ background: #64748b1a; color: #64748b; }
```

### Cards (Dashboard Panels)

```css
.card {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.card:hover {
  border-color: var(--color-border-hover);
  box-shadow: var(--shadow-md);
}
```

### Metric Display

```css
.metric-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 36px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1;
}
.metric-label {
  font-size: 13px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}
.metric-unit {
  font-size: 14px;
  color: var(--color-text-dim);
  margin-left: 4px;
}
```

### Buttons

```css
.btn-primary {
  background: #25f46a;
  color: #0a1610;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  transition: background 200ms ease, transform 100ms ease;
  cursor: pointer;
}
.btn-primary:hover { background: #1cd45a; }
.btn-primary:active { transform: scale(0.98); }

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  transition: border-color 200ms ease;
  cursor: pointer;
}
.btn-secondary:hover { border-color: var(--color-border-hover); }

.btn-danger {
  background: #ef44441a;
  color: #ef4444;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  transition: background 200ms ease;
  cursor: pointer;
}
.btn-danger:hover { background: #ef444433; }
```

### Inputs

```css
.input {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--color-text);
  font-size: 14px;
  transition: border-color 200ms ease;
}
.input:focus {
  border-color: #25f46a66;
  outline: none;
  box-shadow: 0 0 0 3px #25f46a1a;
}
.input::placeholder { color: var(--color-text-dim); }
```

### Sidebar Navigation

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 500;
  transition: all 150ms ease;
  cursor: pointer;
}
.nav-item:hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}
.nav-item.active {
  background: #25f46a1a;
  color: #25f46a;
}
```

### Charts / Graphs (Recharts)

| Prop            | Value             |
|-----------------|-------------------|
| Grid stroke     | `#25f46a0d`       |
| Axis tick color | `#64748b`         |
| Axis font size  | `11px`            |
| Tooltip bg      | `#162d1e`         |
| Tooltip border  | `#25f46a33`       |
| Area fill       | `#25f46a1a`       |
| Area stroke     | `#25f46a`         |
| Danger stroke   | `#ef4444`         |
| Warning stroke  | `#f59e0b`         |
| Cursor stroke   | `#25f46a33`       |

---

## Layout Rules

- **Sidebar:** Fixed left, 240px wide, `surface-1` bg
- **Top bar:** Sticky, 56px height, `surface-1` bg + bottom border
- **Content area:** `surface-0` bg, max-width uncapped (fluid)
- **Grid:** Use CSS Grid or Tailwind grid, 16px gap (`space-lg`)
- **Cards:** Always use `surface-2` bg with `border` color borders
- **Tables:** Striped rows alternating `surface-1`/`surface-2`, 14px font

---

## Animation & Transitions

| Type          | Duration | Easing              |
|---------------|----------|---------------------|
| Hover states  | 150ms    | `ease`              |
| Panel expand  | 200ms    | `ease-out`          |
| Modal open    | 250ms    | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Chart paint   | 300ms    | `ease-in-out`       |
| Skeleton pulse| 1500ms   | `ease-in-out` loop  |

---

## Anti-Patterns (Do NOT Use)

- ❌ Light backgrounds on any surface
- ❌ Pure white text (`#ffffff`) — use `#f1f5f9` instead
- ❌ Pure black backgrounds (`#000000`) — use `#0a1610`
- ❌ Emojis as icons — use Material Symbols Outlined
- ❌ Missing `cursor:pointer` on clickable elements
- ❌ Layout-shifting hover transforms
- ❌ Low contrast text (maintain 4.5:1 minimum)
- ❌ Instant state changes — always use transitions (150-300ms)
- ❌ Invisible focus states
- ❌ Non-monospace for IP addresses, OIDs, metrics
- ❌ Color-only status indicators (always pair with text/icon)
- ❌ Horizontal scroll on any viewport

---

## Pre-Delivery Checklist

- [ ] All surfaces use dark palette (`surface-0` through `surface-3`)
- [ ] Status indicators use semantic colors (green/amber/red/blue/gray)
- [ ] Metric values use monospace font
- [ ] All clickable elements have `cursor: pointer`
- [ ] Hover states with 150-200ms transitions
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive breakpoints: 375px, 768px, 1024px, 1440px+
- [ ] No content behind fixed sidebar/topbar
- [ ] Charts use consistent color tokens
- [ ] All IP/MAC addresses rendered in JetBrains Mono
