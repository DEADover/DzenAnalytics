import type { ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, XSquare } from "lucide-react";
import clsx from "clsx";
import { formatMoney, formatNum } from "../lib/format";

/**
 * Плавающая панель выделения внизу экрана: сколько выбрано, их суммы по видам
 * и действия над ними. Появляется, пока выбрана хоть одна строка.
 *
 * Одна на ленту «Операций», шторку операций, «Удалённые», «Поиск» и
 * «Дубликаты» — прежде ленту и шторку верстали двумя одинаковыми копиями, а
 * «Поиск» и «Дубликаты» — своей однострочной, без сумм.
 *
 * Две строки: первая — число и суммы, вторая — кнопки, последней всегда
 * «Снять выделение».
 */
export function SelectionBar({
  count,
  totals,
  base,
  onClear,
  overDrawer = false,
  children,
}: {
  count: number;
  /** Суммы выделенного по видам (`kindTotals`). Нули не показываются. */
  totals?: { inc: number; exp: number; xfer: number };
  base: string;
  onClear: () => void;
  /**
   * Над шторкой операций (у неё z-50), но под окном правки (z-60): панель
   * выделения шторки иначе пряталась бы под ней самой.
   */
  overDrawer?: boolean;
  /** Действия над выделенным — перед «Снять выделение». */
  children: ReactNode;
}) {
  const sums = totals && (totals.inc > 0 || totals.exp > 0 || totals.xfer > 0) ? totals : null;
  return (
    <div
      role="region"
      aria-label="Массовые действия"
      className={clsx(
        "fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-border bg-panel shadow-xl max-w-[calc(100vw-1.5rem)] overflow-hidden",
        overDrawer ? "z-[55]" : "z-40"
      )}
    >
      <div className="flex items-center justify-center gap-x-4 gap-y-1 flex-wrap px-4 pt-2.5 pb-2 text-sm">
        <span>
          Выбрано: <strong className="tabular-nums">{formatNum(count)}</strong>
        </span>
        {sums && (
          <span className="flex items-center gap-3 tabular-nums border-l border-border pl-4">
            {sums.inc > 0 && (
              <span className="flex items-center gap-1 text-income">
                <ArrowUp className="w-3.5 h-3.5" />
                {formatMoney(sums.inc, base)}
              </span>
            )}
            {sums.exp > 0 && (
              <span className="flex items-center gap-1 text-expense">
                <ArrowDown className="w-3.5 h-3.5" />
                {formatMoney(sums.exp, base)}
              </span>
            )}
            {sums.xfer > 0 && (
              <span className="flex items-center gap-1 text-muted">
                <ArrowLeftRight className="w-3.5 h-3.5" />
                {formatMoney(sums.xfer, base)}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 flex-wrap px-4 pb-2.5 pt-2 border-t border-border">
        {children}
        <button onClick={onClear} className="btn-ghost text-sm text-muted">
          <XSquare className="w-3.5 h-3.5" />
          Снять выделение
        </button>
      </div>
    </div>
  );
}
