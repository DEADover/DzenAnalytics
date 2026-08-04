import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ListChecks, Info, Loader2 } from "lucide-react";
import clsx from "clsx";
import { type RulePlan, type RuleRow } from "../lib/rulePlan";
import { formatMoney, formatNum, formatDate, displayPayee } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";
import type { Transaction } from "../types";

/**
 * Окно «Что изменят правила» — предпросмотр и применение (пункты 9–12 issue #49).
 * Сам план считает `buildRulePlan`; здесь только показ и выбор строк.
 */

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/** Чем подписать строку: получателем, а если его нет — комментарием. У операций
 *  из #49 получателя как раз и не бывает, так что пустая подпись — обычное дело. */
function rowTitle(t: Transaction): string {
  const payee = displayPayee(t);
  if (payee && payee.trim()) return payee;
  return dash(t.comment);
}

/** Больше этого строк за раз не рисуем: список на 5000 операций иначе
 *  подвешивает вкладку, а листать его руками всё равно никто не станет.
 *  Выбор и запись работают по всему набору, не только по видимой части. */
const RENDER_LIMIT = 300;

const STATUS_LABEL: Record<RuleRow["status"], string> = {
  pending: "К записи",
  written: "Уже записано",
  same: "Уже соответствует",
  blocked: "Нет категории в Дзен-мани",
};

const STATUS_TONE: Record<RuleRow["status"], string> = {
  pending: "bg-warn/10 text-warn",
  written: "bg-income/10 text-income",
  same: "bg-panel2 text-muted",
  blocked: "bg-expense/10 text-expense",
};

export function RulePreviewModal({
  plan,
  ruleCount,
  preselect,
  notes,
  onApply,
  onClose,
}: {
  plan: RulePlan;
  /** Сколько правил выбрано — заголовок должен отвечать «по чему это». */
  ruleCount: number;
  /** «Применить правила» открывает окно с уже отмеченными строками, «Проверить
   *  правила» — с пустым выбором. План при этом один и тот же. */
  preselect: boolean;
  /** Что случится после записи: режим отправки, откат, необратимость. */
  notes: string[];
  onApply: (rows: RuleRow[]) => Promise<void>;
  onClose: () => void;
}) {
  const pendingIds = useMemo(
    () => plan.pending.map((r) => r.tx.id),
    [plan]
  );
  const [selected, setSelected] = useState<Set<string>>(() =>
    preselect ? new Set(pendingIds) : new Set()
  );
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allSelected = pendingIds.length > 0 && selected.size === pendingIds.length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    const rows = plan.pending.filter((r) => selected.has(r.tx.id));
    if (rows.length === 0) return;
    setApplying(true);
    try {
      await onApply(rows);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  const shown = plan.rows.slice(0, RENDER_LIMIT);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Что изменят правила"
        className="card w-full max-w-3xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
              <ListChecks className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold truncate">Что изменят правила</div>
              <div className="text-xs text-muted">
                Правил выбрано: {ruleCount} · Совпадений:{" "}
                {formatNum(plan.rows.length)} · К записи:{" "}
                {formatNum(plan.pending.length)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
            title="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {plan.rows.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b border-border shrink-0 text-xs text-muted">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(pendingIds))
                }
                disabled={pendingIds.length === 0}
                aria-label="Выбрать все операции"
                className="accent-accent w-4 h-4"
              />
              Выбрать все
            </label>
            <span className="tabular-nums">
              Отмечено: {formatNum(selected.size)} из {formatNum(pendingIds.length)}
            </span>
            {plan.rows.length > RENDER_LIMIT && (
              <span className="ml-auto">
                Показаны первые {RENDER_LIMIT} из {formatNum(plan.rows.length)} —
                выбор и запись работают по всему списку
              </span>
            )}
          </div>
        )}

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {plan.rows.length === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              {ruleCount === 0
                ? "Отметьте правила в колонке «Выбор» — покажу, что они сделают."
                : "Ни одна операция не подходит под выбранные правила."}
            </div>
          ) : (
            <div className="space-y-0.5">
              {shown.map((row) => {
                const selectable = row.status === "pending";
                return (
                  <div
                    key={row.tx.id}
                    className={clsx(
                      "rounded-lg -mx-2 px-2 py-2 flex items-start gap-3 text-sm",
                      selectable ? "hover:bg-panel2/60" : "opacity-70"
                    )}
                  >
                    <span className="w-4 shrink-0 flex items-center justify-center pt-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(row.tx.id)}
                        onChange={() => toggle(row.tx.id)}
                        disabled={!selectable}
                        aria-label={`Выбрать операцию: ${rowTitle(row.tx)}, ${formatDate(row.tx.date)}`}
                        className="accent-accent w-4 h-4 disabled:opacity-40"
                      />
                    </span>
                    <CategoryDot category={row.tx.category} size="w-7 h-7" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium truncate">{rowTitle(row.tx)}</span>
                        <span className="text-xs text-muted whitespace-nowrap">
                          {formatDate(row.tx.date)}
                        </span>
                        <span
                          className={clsx(
                            "text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap",
                            STATUS_TONE[row.status]
                          )}
                        >
                          {STATUS_LABEL[row.status]}
                          {row.status === "blocked" && row.blockedCategory
                            ? `: «${row.blockedCategory}»`
                            : row.status === "blocked" && row.blockedPayee
                              ? `: контрагента «${row.blockedPayee}» больше нет`
                              : ""}
                        </span>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {row.changes.map((c) => (
                          <div
                            key={c.label}
                            className="flex items-baseline gap-2 text-xs"
                          >
                            <span className="text-muted shrink-0 min-w-[7rem]">
                              {c.label}:
                            </span>
                            <span className="text-muted line-through truncate">
                              {c.from}
                            </span>
                            <ArrowRight className="w-3 h-3 text-muted shrink-0" />
                            <span
                              className={clsx(
                                "truncate",
                                c.state === "pending" ? "text-text" : "text-muted"
                              )}
                            >
                              {c.to}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div
                      className={clsx(
                        "text-right shrink-0 tabular-nums whitespace-nowrap",
                        row.tx.kind === "income" ? "text-income" : "text-text"
                      )}
                    >
                      {formatMoney(row.tx.amount, row.tx.currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {(notes.length > 0 || plan.skippedCount > 0) && (
          <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">
            {plan.skippedCount > 0 && (
              <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                {formatNum(plan.skippedCount)}{" "}
                {pluralRu(plan.skippedCount, ["операция", "операции", "операций"])} не
                записать — в справочнике Дзен-мани нет категории{" "}
                {plan.skipped
                  .slice(0, 3)
                  .map((s) => `«${s.category}»`)
                  .join(", ")}
                {plan.skipped.length > 3 ? ` и ещё ${plan.skipped.length - 3}` : ""}.
                Заведите её в справочнике категорий и откройте окно снова.
              </div>
            )}
            {notes.length > 0 && (
              <div className="flex gap-2 text-xs text-muted">
                <Info className="w-4 h-4 text-accent shrink-0 mt-px" aria-hidden />
                <div className="space-y-1">
                  {notes.map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Закрыть
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={selected.size === 0 || applying}
            className="btn-primary text-sm"
          >
            {applying ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : null}
            Применить правила ({formatNum(selected.size)})
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
