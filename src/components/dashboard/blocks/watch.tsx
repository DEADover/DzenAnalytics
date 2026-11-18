import { DeviationPill } from "../../DeviationPill";
import { Tooltip } from "../../Tooltip";
import { dayAndMonth } from "../../../lib/dayLabel";
import { formatMoney, formatNum, monthTitle } from "../../../lib/format";
import { MONTHS, MONTHS_SHORT } from "../../../lib/months";
import { pluralRu } from "../../../lib/plural";
import type { CategoryWatch, WatchKind } from "../../../lib/categoryWatch";

/**
 * Части виджетов наблюдения — за категорией и за тегом: число с отклонением от
 * обычного и столбики по месяцам. Общие, чтобы два виджета не разошлись в
 * подписях и правилах сравнения.
 */

const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? "";
const monthShort = (ym: string) => MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] ?? "";

const FILL: Record<WatchKind, { now: string; past: string }> = {
  expense: { now: "bg-expense", past: "bg-expense/25" },
  income: { now: "bg-income", past: "bg-income/25" },
};

/** Число месяца, отклонение от обычного и чем это «обычное» является. */
export function WatchHead({
  watch,
  kind,
  ym,
  today,
  base,
  onOpen,
  label,
}: {
  watch: CategoryWatch;
  kind: WatchKind;
  ym: string;
  today: string;
  base: string;
  onOpen: () => void;
  /**
   * Своя подпись над числом — «Расходы», «Доходы». Тогда блок компактный: так
   * стоят рядом две стороны одного тега. Без неё — «Потрачено к 15 октября».
   */
  label?: string;
}) {
  const sameDay = watch.running ? " к этому дню" : " за месяц";
  const verb = kind === "income" ? "Получено" : "Потрачено";
  // В узкой колонке (две стороны тега рядом) «к этому дню» не помещается и
  // обрезало сумму; что сравнение на тот же день, говорит подсказка пилюли.
  const usual =
    watch.avgAt !== null
      ? `Обычно${label ? "" : sameDay} — ${formatMoney(watch.avgAt, base)}`
      : "Сравнить пока не с чем";
  const count =
    watch.count === 0
      ? "Операций нет"
      : `${formatNum(watch.count)} ${pluralRu(watch.count, ["операция", "операции", "операций"])}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-watch-head={kind}
      className="min-w-0 text-left rounded-lg -mx-2 px-2 py-1 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted truncate">
        {label ??
          (watch.running
            ? `${verb} к ${dayAndMonth(today)}`
            : `${verb} за ${monthName(ym).toLowerCase()}`)}
      </div>
      <div className="mt-1 flex items-center gap-2.5 flex-wrap">
        <span
          className={`font-bold tracking-[-0.03em] tabular-nums leading-[1.1] whitespace-nowrap ${
            label ? "text-[22px]" : "text-[28px]"
          } ${label ? (kind === "income" ? "text-income" : "text-expense") : ""}`}
          data-testid="watch-total"
        >
          {formatMoney(watch.nowAt, base)}
        </span>
        {watch.avgAt !== null && (
          <span className="text-[13px]">
            <DeviationPill
              current={watch.nowAt}
              baseline={watch.avgAt}
              base={base}
              mode={label ? "pct" : "both"}
              kind={kind}
              upTitle={`Больше, чем обычно${sameDay}`}
              downTitle={`Меньше, чем обычно${sameDay}`}
            />
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[12px] text-muted tabular-nums">
        {label ? (
          <>
            <span className="block truncate">{usual}</span>
            <span className="block truncate">{count}</span>
          </>
        ) : (
          `${usual} · ${count}`
        )}
      </div>
    </button>
  );
}

/**
 * Столбики по месяцам. Одна сторона — столбик на месяц; две (тег с расходами
 * и доходами) — пара столбиков рядом. Месяц виджета залит цветом стороны,
 * прошлые — им же, но бледнее.
 */
export function WatchBars({
  series,
  base,
  onOpen,
}: {
  series: { kind: WatchKind; watch: CategoryWatch }[];
  base: string;
  onOpen: (ym: string) => void;
}) {
  const months = series[0]?.watch.bars ?? [];
  const top = Math.max(1, ...series.flatMap((s) => s.watch.bars.map((b) => b.total)));
  return (
    <div className="flex-1 min-h-[96px] flex items-end gap-2" data-testid="watch-bars">
      {months.map((m, i) => (
        <Tooltip
          key={m.ym}
          data
          content={
            <div className="space-y-0.5">
              <div className="font-medium">{monthTitle(m.ym)}</div>
              {series.map((s) => (
                <div key={s.kind} className="tabular-nums">
                  {series.length > 1 && (s.kind === "income" ? "Доходы: " : "Расходы: ")}
                  {formatMoney(s.watch.bars[i]?.total ?? 0, base)}
                </div>
              ))}
            </div>
          }
        >
          <button
            type="button"
            onClick={() => onOpen(m.ym)}
            aria-label={`${monthTitle(m.ym)}: ${series
              .map((s) => formatMoney(s.watch.bars[i]?.total ?? 0, base))
              .join(" и ")}`}
            className="group flex-1 min-w-0 h-full flex flex-col justify-end items-stretch gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className="flex-1 min-h-0 flex items-end gap-0.5">
              {series.map((s) => {
                const total = s.watch.bars[i]?.total ?? 0;
                return (
                  <span
                    key={s.kind}
                    className={`block flex-1 rounded-md transition-opacity duration-200 group-hover:opacity-80 ${
                      m.current ? FILL[s.kind].now : FILL[s.kind].past
                    }`}
                    style={{ height: `max(3px, ${(Math.max(0, total) / top) * 100}%)` }}
                  />
                );
              })}
            </span>
            <span className={`text-[11px] text-center ${m.current ? "text-text font-medium" : "text-muted"}`}>
              {monthShort(m.ym)}
            </span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
