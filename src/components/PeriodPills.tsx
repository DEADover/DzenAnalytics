import type { DatePreset } from "../store/useFiltersStore";
import { Segmented } from "./Segmented";

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
    <Segmented
      tight
      label="Период"
      value={value}
      onChange={onChange}
      className="flex-wrap"
      options={PRESETS}
    />
  );
}
