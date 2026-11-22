/**
 * «Крупные траты месяца» — самые большие расходные операции и их доля в
 * расходах. Клик открывает саму операцию.
 */

import { useMemo } from "react";
import { BlockTitle } from "./blocks/shared";
import { CategoryDot } from "../CategoryDot";
import { ProgressBar } from "../ProgressBar";
import { SectionEmpty } from "../SectionEmpty";
import { buildBigExpenses } from "../../lib/bigExpenses";
import { displayPayee, formatMoney, formatNum, formatPct, monthTitle } from "../../lib/format";
import { pluralRu } from "../../lib/plural";
import type { Transaction } from "../../types";

/** «5 октября» — без года: месяц виджета и так один. */
function dayMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function BigExpensesWidget({
  transactions,
  ym,
  base,
  onOpen,
}: {
  /** Операции выбранного месяца. */
  transactions: readonly Transaction[];
  ym: string;
  base: string;
  onOpen: (title: string, txs: Transaction[], subtitle: string) => void;
}) {
  const big = useMemo(() => buildBigExpenses(transactions), [transactions]);
  const shown = big.rows.length;

  return (
    <>
      <BlockTitle
        title="Крупные траты месяца"
        info={
          <p>
            Самые большие расходные операции месяца с комментарием и какая доля
            расходов на них пришлась. Сумма — в основной валюте, по курсу дня операции. Возвраты
            и переводы в список не входят. Клик открывает операцию.
          </p>
        }
        to="/transactions"
        linkLabel="Операции"
      />
      {shown === 0 ? (
        <SectionEmpty variant="compact">Расходов за {monthTitle(ym).toLowerCase()} нет</SectionEmpty>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2" data-testid="big-expenses">
          <div className="text-[13px] text-muted" data-testid="big-expenses-summary">
            {shown < big.count ? (
              <>
                {formatNum(shown)} из {formatNum(big.count)}{" "}
                {pluralRu(big.count, ["операции", "операций", "операций"])} —{" "}
                <span className="font-semibold text-text tabular-nums">{formatPct(big.topShare, 0)}</span> расходов
              </>
            ) : (
              <>
                {shown === 1 ? "Единственный расход" : `Все ${formatNum(shown)} ${pluralRu(shown, ["расход", "расхода", "расходов"])}`}{" "}
                месяца
              </>
            )}
          </div>
          <div className="scroll-soft flex flex-col gap-0.5 flex-1 min-h-0 -mx-2 px-2">
            {big.rows.map(({ tx, share }) => {
              const name = displayPayee(tx) || tx.subcategory || tx.category;
              const category = tx.subcategory ?? tx.category;
              const comment = tx.comment?.trim() ?? "";
              return (
                <button
                  key={tx.id}
                  type="button"
                  data-big-expense={tx.id}
                  onClick={() => onOpen(`${name} · ${dayMonth(tx.date)}`, [tx], "Крупная трата месяца")}
                  className="w-full shrink-0 text-left group flex items-start gap-2 py-1.5 px-2 rounded-lg transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <CategoryDot
                    category={category}
                    parent={tx.subcategory ? tx.category : undefined}
                    size="w-7 h-7"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] flex-1 group-hover:text-accent">{name}</span>
                      <span className="shrink-0 text-[14px] font-semibold tabular-nums">
                        {formatMoney(tx.amountBase, base)}
                      </span>
                    </div>
                    <ProgressBar value={share} className="mt-1.5" />
                    <div className="mt-1 flex items-baseline justify-between gap-2 text-[12px] text-muted tabular-nums">
                      {/* Комментарий — в этой же строке: отдельной строкой он
                          делал карточки разной высоты и выталкивал пятую
                          операцию за край виджета. Длинный виден в подсказке. */}
                      <span className="truncate" title={comment || undefined}>
                        {dayMonth(tx.date)} · {category}
                        {comment && (
                          <>
                            {" · "}
                            <span className="text-text/80" data-big-expense-comment>
                              {comment}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="shrink-0">{formatPct(share, 0)}</span>
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
