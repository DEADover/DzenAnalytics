import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Scissors, Trash2, X } from "lucide-react";
import type { Transaction } from "../types";
import { CategoryCascadePicker } from "./CategoryCascadePicker";
import { useCategoryNodes } from "../hooks/useCategoryNodes";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { formatDate, formatMoney } from "../lib/format";
import { colorForCategory } from "../lib/categoryColor";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import {
  evalAmount,
  round2,
  splitProblem,
  splitRemainder,
  spreadRemainder,
  type SplitDraftPart,
} from "../lib/splitTransaction";

/**
 * Окно «Разделить операцию» (issue #69).
 *
 * Одна покупка часто состоит из разного: в чеке из супермаркета и еда, и
 * бытовая химия, и корм коту. Здесь такая операция расписывается по статьям.
 *
 * Главное в поведении — остаток. Строка, в которую человек ввёл сумму,
 * считается заполненной и больше не меняется сама; остаток разносится по
 * оставшимся. При разбивке надвое это даёт ровно то, чего ждёшь: ввёл сумму
 * в одну строку — вторая стала остатком.
 *
 * Поле суммы понимает выражения: «1200+300» посчитается само. В чеке редко
 * стоит готовое число — обычно складывают несколько позиций или делят счёт.
 */
export function SplitTransactionModal({
  tx,
  onClose,
  onSplit,
}: {
  tx: Transaction;
  onClose: () => void;
  /** Применить разбивку. Возвращает текст ошибки или `null` при успехе. */
  onSplit: (parts: SplitDraftPart[]) => Promise<string | null>;
}) {
  const total = round2(Math.abs(tx.amount));
  const nodes = useCategoryNodes(tx.kind);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  const [parts, setParts] = useState<SplitDraftPart[]>(() =>
    // На старте вся сумма лежит в ПЕРВОЙ части, а вторая пустая. Делить
    // пополам за человека нельзя: «разделить» не значит «поровну», и
    // придуманные числа пришлось бы стирать перед вводом своих.
    //
    // Первая часть «свободная» — она и есть остаток: вводишь сумму во вторую,
    // из первой ровно столько же вычитается. Новые части добавляются
    // закреплёнными на нуле, чтобы не растащить остаток между собой.
    spreadRemainder(total, [
      {
        key: "p1",
        category: tx.category,
        subcategory: tx.subcategory,
        amount: 0,
        pinned: false,
      },
      { key: "p2", category: "", subcategory: null, amount: 0, pinned: true },
    ])
  );
  // Что человек НАБРАЛ в поле суммы — до того, как выражение посчиталось.
  // Отдельно от чисел: пока строка «1200+» дописывается, числа у неё нет.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainder = splitRemainder(total, parts);
  const problem = useMemo(() => splitProblem(total, parts), [total, parts]);
  const nextKey = () => `p${Date.now().toString(36)}${parts.length}`;

  function patch(key: string, next: Partial<SplitDraftPart>) {
    setParts((prev) =>
      spreadRemainder(
        total,
        prev.map((p) => (p.key === key ? { ...p, ...next } : p))
      )
    );
  }

  /** Сумма, набранная в поле: считаем выражение и закрепляем строку. */
  function commitAmount(key: string, raw: string) {
    const value = evalAmount(raw);
    setTyped((t) => {
      const next = { ...t };
      delete next[key];
      return next;
    });
    // Пустое поле — часть обнуляется, но остаётся закреплённой: иначе она
    // начала бы делить остаток с первой, и обе показывали бы половину.
    if (raw.trim() === "") {
      patch(key, { amount: 0, pinned: true });
      return;
    }
    if (value === null) return; // Не выражение — оставляем как было.
    patch(key, { amount: round2(Math.abs(value)), pinned: true });
  }

  function addPart() {
    setParts((prev) =>
      spreadRemainder(total, [
        ...prev,
        { key: nextKey(), category: "", subcategory: null, amount: 0, pinned: true },
      ])
    );
  }

  function removePart(key: string) {
    setParts((prev) => spreadRemainder(total, prev.filter((p) => p.key !== key)));
  }

  /** Дослать остаток в строку — когда все заполнены руками и не сходится. */
  function pushRemainder(key: string) {
    setParts((prev) =>
      prev.map((p) =>
        p.key === key
          ? { ...p, amount: round2(p.amount + splitRemainder(total, prev)), pinned: true }
          : p
      )
    );
  }

  async function apply() {
    if (problem) return;
    setSaving(true);
    setError(null);
    const failed = await onSplit(parts);
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 font-semibold min-w-0">
            <Scissors className="w-4 h-4 text-accent2 shrink-0" />
            Разделить операцию
            <InfoPopover label="Как работает разделение">
              <p>
                Операция расписывается по статьям и превращается в{" "}
                <InfoTerm>несколько настоящих операций</InfoTerm>: исходная
                ужимается до первой части, остальные создаются рядом — та же
                дата, тот же счёт, тот же контрагент.
              </p>
              <p>
                Так сделано не от хорошей жизни: у операции в Дзен-мани ровно
                одна сумма, и хранить суммы по статьям там негде. Зато разбивка
                видна везде — и здесь, и в мобильном приложении, и в любом
                другом клиенте.
              </p>
              <p>
                Сумму можно не считать в уме: поле понимает{" "}
                <InfoTerm>выражения</InfoTerm> — «1200+300», «2400/2». Строка,
                в которую вы ввели сумму, дальше не меняется сама, а остаток
                расходится по остальным.
              </p>
              <p>
                Разбивку видно у каждой части и всегда можно отменить — вернём
                исходную сумму и удалим созданные операции.
              </p>
            </InfoPopover>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-muted hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="card-sunken px-4 py-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {tx.payee || tx.categoryFull}
                </div>
                <div className="text-[11px] text-muted truncate">
                  {formatDate(tx.date)} · {tx.account}
                </div>
              </div>
              <span className="text-xl font-bold tabular-nums whitespace-nowrap">
                {formatMoney(total, tx.currency)}
              </span>
            </div>
            {/* Полоса пропорций: разбивка — это про доли, и одним взглядом
                видно, что во что превратилось. Незанятый хвост показывает
                неразнесённое, поэтому полоса всегда во всю ширину. */}
            <div className="flex h-2 rounded-full overflow-hidden bg-border/60">
              {parts.map((p, i) => (
                <div
                  key={p.key}
                  className="h-full first:rounded-l-full transition-all"
                  style={{
                    width: `${total > 0 ? (Math.max(0, p.amount) / total) * 100 : 0}%`,
                    background: p.category
                      ? colorForCategory(p.category, categoryMeta)
                      : "rgb(var(--c-muted))",
                    // Волосяная щель между сегментами: соседние части могут
                    // получить близкие цвета из палитры и слиться в один
                    // кусок — тогда полоса врёт о числе частей.
                    boxShadow:
                      i < parts.length - 1
                        ? "inset -1.5px 0 0 rgb(var(--c-panel))"
                        : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2" style={{ scrollbarGutter: "stable" }}>
          {parts.map((p, i) => (
            <div
              key={p.key}
              className="flex items-center gap-2 rounded-xl border border-border bg-panel2/30 p-2"
            >
              <span
                className="w-6 h-6 shrink-0 grid place-items-center rounded-full bg-panel2 border border-border text-[11px] text-muted tabular-nums"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <CategoryCascadePicker
                  category={p.category}
                  subcategory={p.subcategory ?? ""}
                  categories={nodes}
                  portal
                  onChange={(category, subcategory) =>
                    patch(p.key, { category, subcategory: subcategory || null })
                  }
                />
              </div>
              {/* Доля части — рядом с суммой: «сколько это от покупки» тут
                  спрашивают чаще, чем точное число. */}
              <span className="w-11 shrink-0 text-right text-[11px] text-muted tabular-nums">
                {total > 0 && p.amount > 0
                  ? `${Math.round((p.amount / total) * 100)}%`
                  : ""}
              </span>
              <input
                className="input w-28 shrink-0 text-right tabular-nums"
                inputMode="decimal"
                aria-label={`Сумма части ${i + 1}`}
                // Пока в поле печатают, показываем набранное; как только
                // ушли из поля — посчитанное число.
                placeholder={p.pinned ? "0" : "остаток"}
                value={typed[p.key] ?? (p.amount ? String(p.amount) : "")}
                onChange={(e) => setTyped((t) => ({ ...t, [p.key]: e.target.value }))}
                onBlur={(e) => commitAmount(p.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAmount(p.key, (e.target as HTMLInputElement).value);
                  }
                }}
              />
              <button
                onClick={() => removePart(p.key)}
                disabled={parts.length <= 2}
                aria-label={`Убрать часть ${i + 1}`}
                title={
                  parts.length <= 2
                    ? "В разбивке должно остаться хотя бы две части"
                    : "Убрать часть"
                }
                className="btn-ghost !p-2 shrink-0 text-muted hover:text-expense"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <button onClick={addPart} className="btn-ghost text-sm">
            <Plus className="w-3.5 h-3.5" />
            Добавить часть
          </button>
        </div>

        <div className="px-5 py-3 border-t border-border space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={remainder === 0 ? "text-income" : "text-muted"}>
              {remainder === 0 ? "Разнесено полностью" : "Осталось разнести"}
            </span>
            <span className="flex items-center gap-2">
              {/* Ноль остатка не показываем числом: «Разнесено полностью 0 ₽»
                  заставляет искать, что это за ноль. Слов достаточно. */}
              {remainder !== 0 && (
                <span className="tabular-nums font-semibold text-warn">
                  {formatMoney(remainder, tx.currency)}
                </span>
              )}
              {/* Все строки заполнены руками, а сумма не сошлась — деть
                  остаток некуда, и он повис бы без выхода. Кнопка дописывает
                  его в последнюю строку. */}
              {remainder !== 0 && parts.every((p) => p.pinned) && (
                <button
                  onClick={() => pushRemainder(parts[parts.length - 1].key)}
                  className="btn-ghost !py-1 text-xs"
                >
                  В последнюю
                </button>
              )}
            </span>
          </div>
          {(problem || error) && (
            <div className="text-xs text-expense">{error ?? problem}</div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">
              <X className="w-3.5 h-3.5" />
              Отмена
            </button>
            <button
              onClick={apply}
              disabled={!!problem || saving}
              className="btn-primary text-sm"
            >
              <Scissors className="w-3.5 h-3.5" />
              {saving ? "Делю…" : `Разделить на ${parts.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
