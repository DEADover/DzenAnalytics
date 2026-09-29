import { ArrowDownRight, ArrowUpRight, MousePointer2, X } from "lucide-react";
import clsx from "clsx";
import { formatDate, formatMoney, formatNum, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { RangeChange } from "../lib/rangeCompare";

/** Средний месяц в днях — для темпа «в месяц». */
const MONTH_DAYS = 30.4375;

const TONE = {
  up: { text: "text-income", box: "bg-income/5 border-income/25", chip: "bg-income/15" },
  down: { text: "text-expense", box: "bg-expense/5 border-expense/25", chip: "bg-expense/15" },
  flat: { text: "text-muted", box: "bg-panel2 border-border", chip: "bg-panel2" },
} as const;

/**
 * Итог сравнения двух точек графика — блоком в шапке карточки, рядом с
 * переключателями, где место есть всегда.
 *
 * Прежде итог стоял строкой над графиком мелким текстом, и главное —
 * насколько изменилось — терялось среди дат. Здесь крупно изменение и
 * процент, рядом «было → стало» с датами и темп в месяц: за полгода +455 тыс.
 * ничего не говорят без «примерно +76 тыс. в месяц».
 *
 * Без выделения на том же месте — подсказка, как выделить: шапка не
 * перестраивается при первом движении мыши.
 */
export function RangeCompareCard({
  change,
  base,
  hint,
  onClear,
}: {
  change: RangeChange | null;
  base: string;
  hint: string;
  onClear: () => void;
}) {
  if (!change) {
    return (
      <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted max-w-[22rem]">
        <MousePointer2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="truncate">{hint}</span>
      </div>
    );
  }
  const tone = change.delta > 0 ? TONE.up : change.delta < 0 ? TONE.down : TONE.flat;
  const Arrow = change.delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const pct =
    change.pct === null ? null : `${change.pct > 0 ? "+" : ""}${formatPct(change.pct, 2)}`;
  // Темп — в месяц, если отрезок не короче месяца; иначе в день.
  const perMonth = change.days >= 28;
  const pace = change.days > 0
    ? (change.delta / change.days) * (perMonth ? MONTH_DAYS : 1)
    : null;
  return (
    <div
      className={clsx(
        "h-10 flex items-center gap-3 pl-3 pr-1.5 rounded-control-lg border tabular-nums",
        tone.box
      )}
    >
      <div className={clsx("flex items-center gap-1.5 whitespace-nowrap", tone.text)}>
        {change.delta !== 0 && <Arrow className="w-4 h-4 shrink-0" aria-hidden />}
        <span className="text-lg font-semibold leading-none">
          {formatMoney(change.delta, base, { signed: true })}
        </span>
        {pct && (
          <span className={clsx("text-xs font-semibold px-1.5 py-0.5 rounded-control-xs", tone.chip)}>
            {pct}
          </span>
        )}
      </div>
      <span className="w-px h-6 bg-border shrink-0" aria-hidden />
      <div className="text-[11px] leading-4 whitespace-nowrap">
        <div>
          <span className="text-muted">{formatDate(change.from.date, "full")}</span>{" "}
          {formatMoney(change.from.value, base)}
        </div>
        <div>
          <span className="text-muted">{formatDate(change.to.date, "full")}</span>{" "}
          <span className="font-medium">{formatMoney(change.to.value, base)}</span>
        </div>
      </div>
      <span className="w-px h-6 bg-border shrink-0" aria-hidden />
      <div className="text-[11px] leading-4 whitespace-nowrap">
        <div className="text-muted">
          {formatNum(change.days)} {pluralRu(change.days, ["день", "дня", "дней"])}
        </div>
        {pace !== null && (
          <div className={tone.text}>
            ≈ {formatMoney(pace, base, { signed: true })} {perMonth ? "в месяц" : "в день"}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="btn-icon btn-icon-sm shrink-0"
        title="Снять выделение (Esc)"
        aria-label="Снять выделение"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Дата на вертикали выделения — плашкой у верхнего края графика. Начало
 * подписано слева от линии, конец — справа, чтобы у близких точек подписи не
 * наезжали; у края графика плашка переходит на внутреннюю сторону.
 */
export function RangeDatePill({
  viewBox,
  date,
  side,
}: {
  viewBox?: { x?: number; y?: number };
  date: string;
  side: "left" | "right";
}) {
  const x = viewBox?.x;
  const y = viewBox?.y;
  if (x == null || y == null) return null;
  const text = formatDate(date, "full");
  const width = text.length * 6.4 + 14;
  const left = side === "left" ? x - width - 4 : x + 4;
  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={y + 4}
        width={width}
        height={18}
        rx={9}
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-border))"
      />
      <text
        x={left + width / 2}
        y={y + 17}
        textAnchor="middle"
        fontSize={11}
        fill="rgb(var(--c-text))"
        className="tabular-nums"
      >
        {text}
      </text>
    </g>
  );
}
