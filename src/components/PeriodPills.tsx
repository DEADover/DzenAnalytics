import type { DatePreset } from "../store/useFiltersStore";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "30d", label: "30 дней" },
  { value: "3m", label: "3 мес" },
  { value: "6m", label: "6 мес" },
  { value: "12m", label: "12 мес" },
  { value: "ytd", label: "С начала года" },
  { value: "all", label: "Всё" },
];

/**
 * Compact period selector (preset pills) for the history charts (Cash-flow,
 * Trends) that want their own period independent of the global «месяц» filter,
 * so they default to a meaningful span instead of a single current month.
 */
export function PeriodPills({
  value,
  onChange,
}: {
  value: DatePreset;
  onChange: (p: DatePreset) => void;
}) {
  return (
    <div className="flex gap-0.5 bg-panel2 rounded-full p-1 border border-border shadow-tray flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          aria-pressed={value === p.value}
          className={`px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors duration-200 ${
            value === p.value
              ? "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]"
              : "text-muted hover:text-text hover:bg-panel/70"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
