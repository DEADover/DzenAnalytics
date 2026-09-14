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
 * Свой период раздела — пресеты пилюлями, независимо от периода в общем
 * фильтре: раздел по умолчанию смотрит на осмысленный отрезок, а не на один
 * текущий месяц. Стоит в ряду контролов раздела, поэтому ступень крупная, 42.
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
      label="Период"
      value={value}
      onChange={onChange}
      className="flex-wrap"
      options={PRESETS}
    />
  );
}
