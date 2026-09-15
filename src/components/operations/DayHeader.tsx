import { useMemo } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, List } from "lucide-react";
import type { Transaction } from "../../types";
import { kindTotals } from "../../lib/aggregations";
import { formatMoney } from "../../lib/format";
import { pluralOps } from "../../lib/plural";
import { formatDayHeader } from "../../lib/dayLabel";

/**
 * Шапка дня в ленте: «Сегодня, 15 сентября» с днём недели и суммы дня — число
 * операций, переводы, поступления, траты и итог.
 *
 * Одна на ленту «Операций» и «Удалённые».
 */
export function DayHeader({
  ymd,
  title,
  txs,
  base,
  showTransfers,
}: {
  /** День группы, `YYYY-MM-DD`. Пустая строка — день неизвестен. */
  ymd: string;
  /** Своя подпись вместо «Сегодня, 15 сентября» — например, «Удалены вчера, 14 сентября». */
  title?: string;
  txs: Transaction[];
  base: string;
  showTransfers: boolean;
}) {
  const { label, weekday } = useMemo(() => formatDayHeader(ymd), [ymd]);
  const totals = useMemo(() => kindTotals(txs), [txs]);

  return (
    <div className="px-4 py-2 border-b border-t border-border bg-panel2/60 flex items-center gap-3 text-sm">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-semibold truncate">{title ?? label}</span>
        {weekday && <span className="text-[13px] text-muted capitalize">{weekday}</span>}
      </div>
      <div className="ml-auto flex items-center gap-3 sm:gap-4 text-sm tabular-nums">
        <span
          className="flex items-center gap-1 text-muted whitespace-nowrap"
          title={`${txs.length} ${pluralOps(txs.length)}`}
        >
          <List className="w-4 h-4" aria-hidden />
          {txs.length}
        </span>
        {showTransfers && totals.xfer > 0 && (
          <span
            className="flex items-center gap-1 text-muted whitespace-nowrap"
            title="Переводы за день"
          >
            <ArrowLeftRight className="w-4 h-4" aria-hidden />
            {formatMoney(totals.xfer, base)}
          </span>
        )}
        {totals.inc > 0 && (
          <span
            className="flex items-center gap-1 text-income whitespace-nowrap"
            title="Поступления за день"
          >
            <ArrowUp className="w-4 h-4" aria-hidden />
            {formatMoney(totals.inc, base)}
          </span>
        )}
        {totals.exp > 0 && (
          <span
            className="flex items-center gap-1 text-expense whitespace-nowrap"
            title="Траты за день"
          >
            <ArrowDown className="w-4 h-4" aria-hidden />
            {formatMoney(totals.exp, base)}
          </span>
        )}
        <span
          className={`px-2 py-0.5 rounded-md font-medium tabular-nums whitespace-nowrap ${totals.net >= 0 ? "bg-income/15 text-income" : "bg-expense/15 text-expense"}`}
          title="Итог за день"
        >
          {formatMoney(totals.net, base, { signed: true })}
        </span>
      </div>
    </div>
  );
}
