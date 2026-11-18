/**
 * «Бюджет месяца» — расходные статьи с планом, от самой потраченной к самой
 * спокойной: сколько ушло из лимита и где статья должна быть к этому дню.
 *
 * Считает сам, а не получает готовое от главной: источники бюджета (прогнозы
 * и назначенные операции Дзен-мани) читаются из кэша, и держать это чтение на
 * главной у всех, кто виджет не ставил, незачем. План и факт — из расчёта
 * раздела «Бюджет», поэтому числа здесь и там одни и те же.
 */

import { useMemo } from "react";
import { BlockTitle } from "./blocks/shared";
import { CategoryDot } from "../CategoryDot";
import { ProgressBar } from "../ProgressBar";
import { SectionEmpty } from "../SectionEmpty";
import { SmoothNavLink } from "../SmoothNavLink";
import { useBudgetSources } from "../../hooks/useBudgetSources";
import { budgetPlanRows } from "../../lib/budgetMonth";
import { buildBudgetWidget } from "../../lib/budgetWidget";
import { budgetTone } from "../../lib/budgets";
import { transactionsForCell } from "../../lib/budgetScope";
import { formatMoney, formatNum, monthTitle } from "../../lib/format";
import { pluralRu } from "../../lib/plural";
import type { Transaction } from "../../types";

export function BudgetWidget({
  ym,
  base,
  progress,
  onOpen,
}: {
  ym: string;
  base: string;
  /** Какая доля месяца прошла; `null` — месяц закончился, отметки дня нет. */
  progress: number | null;
  onOpen: (title: string, txs: Transaction[], subtitle: string) => void;
}) {
  const { sources, scope } = useBudgetSources();
  const widget = useMemo(
    () => buildBudgetWidget(budgetPlanRows(sources, ym, scope)),
    [sources, ym, scope]
  );
  const total = widget.rows.length;

  return (
    <>
      <BlockTitle
        title="Бюджет месяца"
        info={
          <p>
            Расходные статьи, у которых на этот месяц есть план, — от самой
            потраченной. Полоса показывает долю плана, штрих на ней — где статья
            была бы к сегодняшнему дню при ровных тратах. Суммы те же, что в
            разделе «Бюджет»; общие фильтры главной на них не действуют. Клик
            открывает операции статьи за месяц.
          </p>
        }
        to="/budgets"
        linkLabel="Бюджет"
      />
      {total === 0 ? (
        <SectionEmpty
          variant="compact"
          action={
            <SmoothNavLink to="/budgets" className="btn-ghost text-sm">
              Задать планы
            </SmoothNavLink>
          }
        >
          Планов расходов на {monthTitle(ym).toLowerCase()} нет
        </SectionEmpty>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2" data-testid="budget-widget">
          <div className="text-[13px] text-muted">
            {widget.over > 0 ? (
              <>
                План превышен у{" "}
                <span className="font-semibold text-expense tabular-nums">{formatNum(widget.over)}</span>{" "}
                из {formatNum(total)} {pluralRu(total, ["статьи", "статей", "статей"])}
              </>
            ) : (
              <>
                {total === 1 ? "Статья" : `Все ${formatNum(total)} ${pluralRu(total, ["статья", "статьи", "статей"])}`}{" "}
                в пределах плана
              </>
            )}
          </div>
          <div className="scroll-soft flex flex-col gap-1 flex-1 min-h-0 -mx-2 px-2">
            {widget.rows.map((r) => {
              const tone = budgetTone(r.ratio, false);
              const left = r.planned - r.fact;
              const name = r.subcategory ?? r.category;
              return (
                <button
                  key={r.key}
                  type="button"
                  data-budget-row={r.key}
                  onClick={() =>
                    onOpen(
                      `${name} · ${monthTitle(ym)}`,
                      transactionsForCell(
                        sources.transactions as Transaction[],
                        scope,
                        { kind: "expense", category: r.category, subcategory: r.subcategory },
                        ym,
                        sources.monthStartDay
                      ),
                      "Расходы по статье бюджета"
                    )
                  }
                  className="w-full shrink-0 text-left group flex items-start gap-2 py-1.5 px-2 rounded-lg transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <CategoryDot
                    category={name}
                    parent={r.subcategory ? r.category : undefined}
                    size="w-7 h-7"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] flex-1 group-hover:text-accent">{name}</span>
                      <span
                        className={`shrink-0 text-[13px] font-medium tabular-nums ${
                          left < -0.5 ? "text-expense" : "text-muted"
                        }`}
                      >
                        {left < -0.5
                          ? `Перерасход ${formatMoney(-left, base)}`
                          : `Осталось ${formatMoney(left, base)}`}
                      </span>
                    </div>
                    <div className="relative mt-1.5">
                      <ProgressBar value={r.ratio} tone={tone} />
                      {progress !== null && (
                        <span
                          className="absolute -top-[3px] h-3 w-0.5 rounded-full bg-text/60"
                          style={{ left: `calc(${Math.min(1, Math.max(0, progress)) * 100}% - 1px)` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="mt-1 text-[12px] text-muted tabular-nums">
                      {formatMoney(r.fact, base)} из {formatMoney(r.planned, base)}
                      {r.forecast && " · Прогноз"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
