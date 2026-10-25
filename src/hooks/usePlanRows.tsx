import { useState } from "react";
import { CalendarCheck, CalendarClock, Link2, MoreHorizontal, Pencil, X } from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../types";
import { formatPlanDate as formatShort, planTitle, plannedAsTransaction, type PlannedOp } from "../lib/plannedOps";
import { localToday } from "./usePlannedFeed";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { confirm } from "../store/useConfirmStore";
import { operationTone } from "../lib/txKindStyle";
import { TONE_CLASS } from "../components/table/tableKit";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { MenuItem } from "../components/MenuItem";
import { Popover } from "../components/Popover";
import { OperationListRow } from "../components/operations/OperationList";
import { OperationAmount, OperationCategory, OperationComment, OperationPayee } from "../components/operations/OperationCells";
import { PlanLinkModal } from "../components/operations/PlanLinkModal";
import { PlanEditModal } from "../components/operations/PlanEditModal";
import { AccountName } from "../components/AccountName";

/**
 * Строки планов и всё, что к ним прилагается: меню «⋯» с действиями,
 * подтверждения удаления и окна «Сохранить как факт», «Связать», «Изменить».
 *
 * Общее для ленты одних планов (`PlannedFeedList`) и для планов прямо в ленте
 * операций («Запланированные в ленте» → «В ленте»): строка плана везде одна.
 * `overlay` ставится в разметку один раз — там живут меню и окна.
 */
export function usePlanRows(template: string) {
  const today = localToday();
  const [menu, setMenu] = useState<{ op: PlannedOp; anchor: HTMLElement } | null>(null);
  const [fact, setFact] = useState<PlannedOp | null>(null);
  const [link, setLink] = useState<PlannedOp | null>(null);
  const [edit, setEdit] = useState<PlannedOp | null>(null);

  async function removeDate(p: PlannedOp) {
    const oneOff = p.repeating === false;
    const ok = await confirm({
      title: oneOff ? "Удалить план?" : `Удалить план на ${formatShort(p.date)}?`,
      message: oneOff
        ? "Это разовый план — он удалится целиком."
        : "Уберётся только эта дата, остальные повторения останутся.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    await usePlannedDeletionsStore
      .getState()
      .remove({ id: p.id, wholePlan: oneOff, date: p.date, title: planTitle(p) });
  }

  async function removeChain(p: PlannedOp) {
    const ok = await confirm({
      title: "Удалить всю цепочку?",
      message: "Удалится сам план со всеми будущими повторениями. Проведённые операции останутся.",
      confirmLabel: "Удалить цепочку",
      tone: "danger",
    });
    if (!ok) return;
    await usePlannedDeletionsStore
      .getState()
      .remove({ id: p.id, wholePlan: true, date: p.date, title: planTitle(p) });
  }

  /** Строка плана; `grouped` — лента по дням, дата стоит в шапке дня. */
  const renderRow = (p: PlannedOp, grouped: boolean) => {
    const tx: Transaction = plannedAsTransaction(p);
    const late = p.date < today;
    return (
      <OperationListRow
        key={p.id}
        template={template}
        selected={menu?.op.id === p.id}
        // Действия — только по «⋯»: щелчок по строке ничего не делает, чтобы
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
              setMenu({ op: p, anchor: e.currentTarget });
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </OperationListRow>
    );
    };

  const anchorRef = { current: menu?.anchor ?? null };
  const m = menu?.op;

  const overlay = (
    <>
      <Popover
        open={!!menu}
        anchorRef={anchorRef}
        onClose={() => setMenu(null)}
        align="right"
        className="card p-1 w-max text-[13px] [&_button]:py-1"
      >
        {m && (
          <>
            <MenuItem
              icon={CalendarCheck}
              onClick={() => {
                setMenu(null);
                setFact(m);
              }}
            >
              Сохранить как факт
            </MenuItem>
            <MenuItem
              icon={Link2}
              onClick={() => {
                setMenu(null);
                setLink(m);
              }}
            >
              Связать план с фактом
            </MenuItem>
            <MenuItem
              icon={Pencil}
              onClick={() => {
                setMenu(null);
                setEdit(m);
              }}
            >
              Изменить
            </MenuItem>
            <div className="border-t border-border my-1" />
            <MenuItem
              icon={X}
              danger
              onClick={() => {
                setMenu(null);
                void removeDate(m);
              }}
            >
              {m.repeating === false ? "Удалить план" : `Удалить план на ${formatShort(m.date)}`}
            </MenuItem>
            {m.repeating !== false && (
              <MenuItem
                icon={X}
                danger
                onClick={() => {
                  setMenu(null);
                  void removeChain(m);
                }}
              >
                Удалить всю цепочку
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      {fact && (
        <EditTransactionModal
          key={`fact-${fact.id}`}
          template={plannedAsTransaction(fact)}
          planMarker={{ id: fact.id, date: fact.date, title: planTitle(fact) }}
          onClose={() => setFact(null)}
        />
      )}
      {link && <PlanLinkModal plan={link} title={planTitle(link)} onClose={() => setLink(null)} />}
      {edit && <PlanEditModal plan={edit} title={planTitle(edit)} onClose={() => setEdit(null)} />}
    </>
  );

  return { renderRow, overlay, today };
}

