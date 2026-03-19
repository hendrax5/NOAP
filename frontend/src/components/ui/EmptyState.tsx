type EmptyStateProps = {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
};

export default function EmptyState({ icon = "cloud_off", title, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl py-20 text-center"
      style={{ background: "var(--color-surface-1)", border: "1px dashed var(--color-border)" }}
    >
      <span
        className="material-symbols-outlined mb-4"
        style={{ fontSize: 48, color: "var(--color-text-dim)" }}
      >
        {icon}
      </span>
      <p className="text-base font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
        {title}
      </p>
      {description && (
        <p className="text-sm max-w-xs" style={{ color: "var(--color-text-dim)" }}>
          {description}
        </p>
      )}
      {action && (
        <a
          href={action.href}
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
          style={{
            background: "var(--color-primary-muted)",
            color: "var(--color-primary)",
            border: "1px solid var(--color-border-hover)",
          }}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
