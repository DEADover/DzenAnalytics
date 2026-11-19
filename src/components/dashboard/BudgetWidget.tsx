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
import { buildBudgetWidget, type BudgetWidgetRow } from "../../lib/budgetWidget";
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
  const total = widget.total;

  const open = (r: BudgetWidgetRow, branch: boolean) => {
    const name = r.subcategory ?? r.category;
    onOpen(
      `${name} · ${monthTitle(ym)}`,
      transactionsForCell(
        sources.transactions as Transaction[],
        scope,
        { kind: "expense", category: r.category, subcategory: r.subcategory, branch },
        ym,
        sources.monthStartDay
      ),
      branch ? "Расходы по категории бюджета с подкатегориями" : "Расходы по статье бюджета"
    );
  };

  return (
    <>
      <BlockTitle
        title="Бюджет месяца"
        info={
          <>
            <p>
              Расходные статьи, у которых на этот месяц есть план, — от самой
              потраченной. Полоса показывает долю плана, штрих на ней — где статья
              была бы к сегодняшнему дню при ровных тратах. Суммы те же, что в
              разделе «Бюджет»; общие фильтры главной на них не действуют. Клик
              открывает операции статьи за месяц.
            </p>
            <p>
              У категории с подкатегориями показана вся ветка целиком, а
              подкатегории стоят под ней. Если на категории замок, её сумма
              уже включает подкатегории; без замка план категории — её своя
              сумма плюс планы подкатегорий.
            </p>
            <p>
              Перерасход и остаток в строке над списком сложены по статьям:
              перебор одной не гасится остатком соседней. Под замком статья —
              категория целиком.
            </p>
          </>
        }
        to="/budgets"
        linkLabel="Бюджет"
      />
      {widget.rows.length === 0 ? (
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
          {/* Два куска, каждый не рвётся: когда места мало, второй переезжает
              строкой ниже целиком, а не оставляет «в планах» сиротой. */}
          <div className="text-[13px] text-muted flex flex-wrap gap-x-3" data-testid="budget-summary">
            <span className="whitespace-nowrap">
              {widget.over > 0 ? (
                <>
                  План превышен у{" "}
                  <span className="font-semibold text-expense tabular-nums">{formatNum(widget.over)}</span>{" "}
                  из {formatNum(total)} {pluralRu(total, ["статьи", "статей", "статей"])} на{" "}
                  <span className="font-semibold text-expense tabular-nums">{formatMoney(widget.overBy, base)}</span>
                </>
              ) : (
                <>
                  {total === 1 ? "Статья" : `Все ${formatNum(total)} ${pluralRu(total, ["статья", "статьи", "статей"])}`}{" "}
                  в пределах плана
                </>
              )}
            </span>
            {widget.left > 0.5 && (
              <span className="whitespace-nowrap">
                Ещё <span className="font-semibold text-text tabular-nums">{formatMoney(widget.left, base)}</span> в
                планах
              </span>
            )}
          </div>
          <div className="scroll-soft flex flex-col gap-1 flex-1 min-h-0 -mx-2 px-2">
            {widget.rows.map((r) => (
              <div key={r.key} className="shrink-0 flex flex-col">
                <BudgetRow
                  row={r}
                  base={base}
                  progress={progress}
                  onClick={() => open(r, !!r.children)}
                />
                {r.children?.map((c, i) => (
                  <BudgetRow
                    key={c.key}
                    row={c}
                    base={base}
                    progress={progress}
                    nested={{ more: i < r.children!.length - 1 }}
                    onClick={() => open(c, false)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Строка статьи. `nested` — подкатегория под своей категорией: со сдвигом и
 * уголком к ней, как подстатьи в «Свободных деньгах».
 */
function BudgetRow({
  row: r,
  base,
  progress,
  nested,
  onClick,
}: {
  row: BudgetWidgetRow;
  base: string;
  progress: number | null;
  nested?: { more: boolean };
  onClick: () => void;
}) {
  const tone = budgetTone(r.ratio, false);
  const left = r.planned - r.fact;
  const name = r.subcategory ?? r.category;
  return (
    <button
      type="button"
      data-budget-row={r.key}
      onClick={onClick}
      className={`relative w-full shrink-0 text-left group flex items-start gap-2 py-1.5 px-2 rounded-lg transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        nested ? "pl-7" : ""
      }`}
    >
      {/* Уголок к категории: вертикаль идёт насквозь, пока ниже есть ещё
          подкатегория, и обрывается на середине последней. */}
      {nested && (
        <>
          {/* По вертикали — под центром кружка категории (отступ 8 + 14 px),
              по горизонтали — до кружка подкатегории, к его середине. */}
          <span
            className={`absolute left-[1.375rem] -top-1 w-px bg-border ${nested.more ? "bottom-0" : "h-5"}`}
            aria-hidden="true"
          />
          <span className="absolute left-[1.375rem] top-4 w-1.5 h-px bg-border" aria-hidden="true" />
        </>
      )}
      <CategoryDot
        category={name}
        parent={r.subcategory ? r.category : undefined}
        size={nested ? "w-5 h-5" : "w-7 h-7"}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={`truncate flex-1 group-hover:text-accent ${nested ? "text-[13.5px] text-muted" : "text-[15px]"}`}
          >
            {name}
          </span>
          <span
            className={`shrink-0 text-[13px] font-medium tabular-nums ${
              left < -0.5 ? "text-expense" : "text-muted"
            }`}
          >
            {left < -0.5 ? `Перерасход ${formatMoney(-left, base)}` : `Осталось ${formatMoney(left, base)}`}
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
}
