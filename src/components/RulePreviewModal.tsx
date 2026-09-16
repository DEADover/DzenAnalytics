import { useMemo, useState } from "react";
import { Checkbox } from "./Checkbox";
import { ArrowRight, ListChecks, Info, Loader2, Pencil } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { EditTransactionModal } from "./EditTransactionModal";
import { Tooltip } from "./Tooltip";
import clsx from "clsx";
import { type RulePlan, type RuleRow, skippedByReason } from "../lib/rulePlan";
import { formatMoney, formatNum, formatDate, displayPayee } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";
import { Segmented } from "./Segmented";
import type { Transaction } from "../types";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { SectionEmpty } from "./SectionEmpty";
import { Callout } from "./Callout";
import { Badge, type BadgeTone } from "./Badge";

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

const STATUS_TONE: Record<RuleRow["status"], BadgeTone> = {
  pending: "warn",
  written: "income",
  same: "neutral",
  blocked: "expense",
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
  // Нет категории в справочнике и ярлык сервиса объясняются по-разному.
  const { missing, service } = useMemo(() => skippedByReason(plan), [plan]);
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

  return (
    <>
      <Modal onClose={onClose} width="3xl">
        <ModalHeader
          icon={ListChecks}
          title="Что изменят правила"
          subtitle={
            <>
              Правил включено: {ruleCount} · Совпадений: {formatNum(plan.rows.length)} · К записи:{" "}
              {formatNum(plan.pending.length)}
            </>
          }
        />

        {plan.rows.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b border-border shrink-0 text-xs text-muted flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                // Частичный выбор показываем третьим состоянием: пустая
                // галочка при «Отмечено: 134 из 138» читается как «не выбрано
                // ничего».
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(pendingIds))
                }
                disabled={pendingIds.length === 0}
                indeterminate={selected.size > 0 && !allSelected}
                label="Выбрать все операции"
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

        <ModalBody scroll>
          {visible.length === 0 ? (
            <SectionEmpty variant="inline">
              {ruleCount === 0
                ? "Все правила выключены — включите нужные, и покажу, что они сделают."
                : plan.rows.length === 0
                  ? "Ни одна операция не подходит под выбранные правила."
                  : "Записывать нечего: правила уже применены. Переключитесь на «Все», чтобы увидеть весь разбор."}
            </SectionEmpty>
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
                      <Checkbox
                        checked={selected.has(row.tx.id)}
                        onChange={() => toggle(row.tx.id)}
                        disabled={!selectable}
                        label={`Выбрать операцию: ${rowTitle(row.tx)}, ${formatDate(row.tx.date)}`}
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
                          <Badge className="max-w-[14rem] truncate">{oneRule}</Badge>
                        )}
                        {STATUS_LABEL[row.status] && (
<Badge tone={STATUS_TONE[row.status]}>
                            {STATUS_LABEL[row.status]}
                            {row.status === "blocked" && row.blockedCategory
                              ? row.blockedReason === "service"
                                ? `: «${row.blockedCategory}» — ярлык сервиса`
                                : `: «${row.blockedCategory}»`
                              : row.status === "blocked" && row.blockedPayee
                                ? `: контрагента «${row.blockedPayee}» больше нет`
                                : ""}
                          </Badge>
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
                        className="btn-icon shrink-0"
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
        </ModalBody>

        {(notes.length > 0 || plan.skippedCount > 0) && (
          <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">
            {missing.count > 0 && (
              <Callout tone="warn">
                {formatNum(missing.count)}{" "}
                {pluralRu(missing.count, ["операция", "операции", "операций"])} не
                записать — в справочнике Дзен-мани нет категории{" "}
                {missing.items
                  .slice(0, 3)
                  .map((s) => `«${s.category}»`)
                  .join(", ")}
                {missing.items.length > 3 ? ` и ещё ${missing.items.length - 3}` : ""}.
                Заведите её в справочнике категорий и откройте окно снова.
              </Callout>
            )}
            {/* Ярлыки сервиса заводить в справочнике бесполезно: отправка
                отклоняет их по имени. Совет здесь другой — поправить правило. */}
            {service.count > 0 && (
              <Callout tone="warn">
                {formatNum(service.count)}{" "}
                {pluralRu(service.count, ["операция", "операции", "операций"])} не
                записать —{" "}
                {service.items.map((s) => `«${s.category}»`).join(" и ")} не
                категория, а ярлык сервиса: его ставит сам вид операции. Поменяйте
                категорию в действии правила.
              </Callout>
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

        <ModalFooter>
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
        </ModalFooter>
      </Modal>
      {editing && (
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
