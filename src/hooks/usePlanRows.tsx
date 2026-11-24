import { localToday } from "../lib/period";
import { CalendarClock, MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../types";
import { formatPlanDate as formatShort, plannedAsTransaction, type PlannedOp } from "../lib/plannedOps";
import { usePlanActions } from "./usePlanActions";
import { operationTone } from "../lib/txKindStyle";
import { TONE_CLASS } from "../components/table/tableKit";
import { OperationListRow } from "../components/operations/OperationList";
import { OperationAmount, OperationCategory, OperationComment, OperationPayee } from "../components/operations/OperationCells";
import { AccountName } from "../components/AccountName";

/**
 * Строки планов с меню «⋯» (само меню и его окна — в `usePlanActions`).
 *
 * Общее для ленты одних планов (`PlannedFeedList`) и для планов прямо в ленте
 * операций («Запланированные в ленте» → «В ленте»): строка плана везде одна.
 * `overlay` ставится в разметку один раз — там живут меню и окна.
 */
/** `time` — в сетке есть столбец «Время» ленты: у плана времени нет, ячейка пустая. */
export function usePlanRows(template: string, time = false) {
  const today = localToday();
  const { openMenu, menuOpId, overlay } = usePlanActions();

  /** Строка плана; `grouped` — лента по дням, дата стоит в шапке дня. */
  const renderRow = (p: PlannedOp, grouped: boolean) => {
    const tx: Transaction = plannedAsTransaction(p);
    const late = p.date < today;
    return (
      <OperationListRow
        key={p.id}
        template={template}
        selected={menuOpId === p.id}
        // Действия — только по «⋯»: клик по строке ничего не делает, чтобы
        // случайное касание не открывало меню.
        // Будущие — приглушены: их время ещё не пришло. Просроченные — в
        // полную силу, с красной полосой слева и лёгкой заливкой: с ними надо
        // что-то сделать — провести, связать или удалить.
        className={
          late
            ? "bg-expense/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-expense))]"
            : "[&_.op-muted]:opacity-60"
        }
      >
        <span data-cell="select" className="grid place-items-center" aria-hidden>
          <CalendarClock className={clsx("w-4 h-4", late ? "text-expense" : "text-muted")} />
        </span>
        {!grouped && (
          <div className={clsx("tabular-nums whitespace-nowrap", late ? "text-expense" : "text-muted")}>
            {formatShort(p.date)}
          </div>
        )}
        <div data-cell="category" className="op-muted min-w-0 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <OperationCategory tx={tx} edited={false} />
          </div>
          {p.forecast && (
            <span
              className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted"
              title="Прогноз Дзен-мани по регулярному платежу"
            >
              Прогноз
            </span>
          )}
        </div>
        {time && <span aria-hidden />}
        <AccountName
          className="op-muted truncate block"
          accountKey={p.accountKey ?? p.account}
          title={p.account}
          toKey={p.toAccount ? (p.toAccountKey ?? p.toAccount) : null}
          toTitle={p.toAccount}
        />
        <div data-cell="payee" className="op-muted min-w-0">
          <OperationPayee tx={tx} />
        </div>
        <div className="op-muted min-w-0">
          <OperationComment text={p.comment} />
        </div>
        <div
          data-cell="amount"
          className={`op-muted text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
        >
          <OperationAmount tx={tx} />
        </div>
        <div data-cell="actions" className="flex items-center justify-center">
          <button
            type="button"
            className="btn-icon"
            data-plan-menu={p.id}
            aria-label="Действия с запланированной операцией"
            title="Сохранить как факт, связать, изменить или удалить"
            onClick={(e) => {
              e.stopPropagation();
              openMenu(p, e.currentTarget);
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </OperationListRow>
    );
    };

  return { renderRow, overlay, today };
}

