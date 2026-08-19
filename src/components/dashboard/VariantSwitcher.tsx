/**
 * Переключатель вариантов главной — временный, на время выбора оформления.
 *
 * Стоит прямо на странице, а не в настройках: сравнивать раскладки имеет смысл
 * только переключая их подряд на своих данных, и ради каждого переключения
 * ходить в настройки никто не станет.
 */

import { Layers } from "lucide-react";
import { Segmented } from "../Segmented";
import {
  useDashboardVariantStore,
  DASHBOARD_VARIANTS,
  type DashboardVariant,
} from "../../store/useDashboardVariantStore";

export function VariantSwitcher() {
  const variant = useDashboardVariantStore((s) => s.variant);
  const setVariant = useDashboardVariantStore((s) => s.setVariant);
  const hint = DASHBOARD_VARIANTS.find((v) => v.value === variant)?.hint;

  return (
    <div className="card card-pad flex flex-wrap items-center gap-x-4 gap-y-3 border-dashed">
      <div className="flex items-center gap-2 shrink-0">
        <Layers className="w-4 h-4 text-accent" />
        <span className="font-semibold text-[14px]">Вариант главной</span>
      </div>
      <Segmented<DashboardVariant>
        label="Вариант оформления главной страницы"
        size="sm"
        value={variant}
        onChange={(v) => void setVariant(v)}
        options={DASHBOARD_VARIANTS.map((v) => ({ value: v.value, label: v.label }))}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
      <span className="text-xs text-muted ml-auto">
        Выбор временный — нужен, чтобы сравнить раскладки на своих данных
      </span>
    </div>
  );
}
