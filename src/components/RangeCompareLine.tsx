import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { formatDate, formatMoney, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { RangeChange } from "../lib/rangeCompare";

/**
 * Строка итога над графиком: насколько изменилось значение между двумя
 * выбранными точками — как в приложениях брокеров.
 *
 * Высота одна и та же с выделением и без: без него в строке стоит подсказка,
 * как выделить. Иначе график прыгал бы вниз при первом же движении мыши.
 */
export function RangeCompareLine({
  change,
  base,
  hint,
  onClear,
}: {
  change: RangeChange | null;
  base: string;
  /** Что написать, пока ничего не выделено. */
  hint: string;
  onClear: () => void;
}) {
  if (!change) {
    return <div className="h-7 flex items-center text-xs text-muted truncate">{hint}</div>;
  }
  const up = change.delta > 0;
  const tone = change.delta === 0 ? "text-muted" : up ? "text-income" : "text-expense";
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const pct =
    change.pct === null ? null : `${change.pct > 0 ? "+" : ""}${formatPct(change.pct, 2)}`;
  return (
    <div className="h-7 flex items-center gap-3 min-w-0">
      <span className={`flex items-center gap-1 text-sm font-semibold tabular-nums whitespace-nowrap ${tone}`}>
        {change.delta !== 0 && <Arrow className="w-4 h-4" aria-hidden />}
        {formatMoney(change.delta, base, { signed: true })}
        {pct && <span className="font-medium">/ {pct}</span>}
      </span>
      <span className="text-xs text-muted tabular-nums truncate">
        {formatDate(change.from.date, "full")} — {formatDate(change.to.date, "full")} ·{" "}
        {change.days} {pluralRu(change.days, ["день", "дня", "дней"])} ·{" "}
        {formatMoney(change.from.value, base)} → {formatMoney(change.to.value, base)}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="btn-icon btn-icon-sm shrink-0 ml-auto"
        title="Снять выделение (Esc)"
        aria-label="Снять выделение"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
