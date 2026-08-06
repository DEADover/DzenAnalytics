import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ListChecks, Info, Loader2, Pencil } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { EditTransactionModal } from "./EditTransactionModal";
import { Tooltip } from "./Tooltip";
import clsx from "clsx";
import { type RulePlan, type RuleRow } from "../lib/rulePlan";
import { formatMoney, formatNum, formatDate, displayPayee } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";
import { Segmented } from "./Segmented";
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

/**
 * Пометка состояния строки. У «к записи» её нет намеренно: окно и открывается
 * на таких строках, метка стояла бы у каждой и не сообщала бы ничего. Метка
 * нужна там, где строка ведёт себя НЕ так, как ожидаешь.
 */
const STATUS_LABEL: Record<RuleRow["status"], string> = {
  pending: "",
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
  notes,
  onApply,
  onClose,
}: {
  plan: RulePlan;
  /** Сколько правил включено — заголовок должен отвечать «по чему это». */
  ruleCount: number;
  /** Что случится после записи: режим отправки, откат, необратимость. */
  notes: string[];
  onApply: (rows: RuleRow[]) => Promise<void>;
  onClose: () => void;
}) {
  const pendingIds = useMemo(
    () => plan.pending.map((r) => r.tx.id),
    [plan]
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pendingIds));
  const [applying, setApplying] = useState(false);
  // Показываем сразу то, ради чего окно чаще всего и открывают: строки к записи.
  // В общем списке они тонули — уже записанные и совпадающие совпадения бывают
  // на порядок многочисленнее, а выбрать их всё равно нельзя.
  const [filter, setFilter] = useState<"pending" | "all">(
    plan.pending.length > 0 ? "pending" : "all"
  );
  // Правка операции прямо отсюда: увидел в разборе, что правило хочет не того, —
  // поправил операцию, не теряя окно. План пересчитается сам, он считается от
  // тех же данных.
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Открываем ОТОБРАЖАЕМУЮ операцию, а не строку плана: план считается по
  // исходникам (правки ещё не наложены), и редактор показал бы старые значения.
  const displayed = useDataStore((s) => s.transactions);
  const openEditor = (id: string, fallback: Transaction) =>
    setEditing(displayed.find((t) => t.id === id) ?? fallback);

  useEffect(() => {
    // Пока сверху открыт редактор операции, Escape принадлежит ему: иначе одно
    // нажатие закрывало бы оба окна разом.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

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

  const visible = filter === "pending" ? plan.pending : plan.rows;
  const shown = visible.slice(0, RENDER_LIMIT);

  /**
   * Называть правило есть смысл, только когда их в разборе несколько. С одним
   * правилом подпись повторялась бы у каждой строки, ничего не добавляя: оно
   * названо в шапке окна и на странице.
   */
  const showRule = useMemo(() => {
    const names = new Set<string>();
    for (const row of plan.rows) {
      for (const c of row.changes) if (c.rule) names.add(c.rule);
      if (names.size > 1) return true;
    }
    return false;
  }, [plan]);

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
                Правил включено: {ruleCount} · Совпадений:{" "}
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
          <div className="flex items-center gap-3 px-5 py-2 border-b border-border shrink-0 text-xs text-muted flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                // Частичный выбор показываем третьим состоянием: пустая
                // галочка при «Отмечено: 134 из 138» читается как «не выбрано
                // ничего».
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !allSelected;
                }}
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
            {/* Переключатель показываем, только когда наборы РАЗНЫЕ. Если всё
                совпадение и есть «к записи», обе кнопки дают один и тот же
                список с одинаковым числом — контрол, который ничего не
                переключает. */}
            {plan.pending.length !== plan.rows.length && (
              <Segmented
                size="sm"
                label="Какие строки показывать"
                value={filter}
                onChange={(v) => setFilter(v)}
                options={[
                  {
                    value: "pending" as const,
                    label: `К записи (${formatNum(plan.pending.length)})`,
                    title: "Только то, что правила изменят",
                  },
                  {
                    value: "all" as const,
                    label: `Все (${formatNum(plan.rows.length)})`,
                    title: "Весь разбор: и уже записанное, и совпадающее",
                  },
                ]}
              />
            )}
            {visible.length > RENDER_LIMIT && (
              <span className="ml-auto">
                Показаны первые {RENDER_LIMIT} из {formatNum(visible.length)} —
                выбор и запись работают по всему списку
              </span>
            )}
          </div>
        )}

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {visible.length === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              {ruleCount === 0
                ? "Все правила выключены — включите нужные, и покажу, что они сделают."
                : plan.rows.length === 0
                  ? "Ни одна операция не подходит под выбранные правила."
                  : "Записывать нечего: правила уже применены. Переключитесь на «Все», чтобы увидеть весь разбор."}
            </div>
          ) : (
            <div className="space-y-0.5">
              {shown.map((row) => {
                const selectable = row.status === "pending";
                // Строки «было = станет» показываем, только если у операции
                // больше ничего нет. Иначе они пустой шум: «Еда дома → Еда
                // дома» рядом с настоящей правкой ничего не сообщает.
                const meaningful = row.changes.filter((c) => c.state !== "same");
                const changes = meaningful.length > 0 ? meaningful : row.changes;
                // Одно правило на всю операцию — подписываем строку один раз, а
                // не каждое изменение.
                const rowRules = new Set(
                  changes.map((c) => c.rule).filter((r): r is string => !!r)
                );
                const oneRule = rowRules.size === 1 ? [...rowRules][0] : null;
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
                        {/* Чьё это изменение. Пока правило одно на весь разбор,
                            подпись молчит: она повторялась бы в каждой строке,
                            а её и так видно в шапке окна. */}
                        {showRule && oneRule && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel2 text-muted whitespace-nowrap max-w-[14rem] truncate">
                            {oneRule}
                          </span>
                        )}
                        {STATUS_LABEL[row.status] && (
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
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {changes.map((c) => (
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
                            {/* Построчная подпись — только когда поля операции
                                достались РАЗНЫМ правилам. Если правило одно,
                                оно уже названо в шапке строки. */}
                            {showRule && !oneRule && c.rule && (
                              <Tooltip content={`Правило: ${c.rule}`}>
                                <span className="ml-auto shrink-0 text-[10px] text-muted max-w-[12rem] truncate">
                                  {c.rule}
                                </span>
                              </Tooltip>
                            )}
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
                    {/* Правка доступна у ЛЮБОЙ строки, включая уже записанные и
                        совпадающие: разбор часто и открывают затем, чтобы
                        поправить саму операцию. */}
                    <Tooltip content="Открыть операцию">
                      <button
                        type="button"
                        onClick={() => openEditor(row.tx.id, row.tx)}
                        className="btn-ghost !p-1.5 text-muted hover:text-accent shrink-0"
                        aria-label={`Открыть операцию: ${rowTitle(row.tx)}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </Tooltip>
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

      {editing && (
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>,
    document.body
  );
}
