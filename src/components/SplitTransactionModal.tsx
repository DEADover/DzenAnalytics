import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Scissors, Trash2, X } from "lucide-react";
import type { Transaction } from "../types";
import { CategoryCascadePicker } from "./CategoryCascadePicker";
import { useCategoryNodes } from "../hooks/useCategoryNodes";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { formatMoney } from "../lib/format";
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

  const [parts, setParts] = useState<SplitDraftPart[]>(() =>
    // Две строки на старте: первая с исходной статьёй, вторая пустая. Обе
    // «свободные», поэтому сумма сразу делится пополам — дальше человек
    // правит одну, и вторая подстраивается.
    spreadRemainder(total, [
      {
        key: "p1",
        category: tx.category,
        subcategory: tx.subcategory,
        amount: 0,
        pinned: false,
      },
      { key: "p2", category: "", subcategory: null, amount: 0, pinned: false },
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
    // Пустое поле — строка снова свободна и участвует в дележе остатка.
    if (raw.trim() === "") {
      patch(key, { amount: 0, pinned: false });
      return;
    }
    if (value === null) return; // Не выражение — оставляем как было.
    patch(key, { amount: round2(Math.abs(value)), pinned: true });
  }

  function addPart() {
    setParts((prev) =>
      spreadRemainder(total, [
        ...prev,
        { key: nextKey(), category: "", subcategory: null, amount: 0, pinned: false },
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

        <div className="px-5 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-sm text-muted truncate min-w-0">
            {tx.payee || tx.categoryFull} · {tx.account}
          </span>
          <span className="text-lg font-bold tabular-nums whitespace-nowrap">
            {formatMoney(total, tx.currency)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2" style={{ scrollbarGutter: "stable" }}>
          {parts.map((p, i) => (
            <div key={p.key} className="flex items-start gap-2">
              <span className="w-5 shrink-0 pt-2 text-xs text-muted tabular-nums">
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
              <input
                className="input w-32 shrink-0 text-right tabular-nums"
                inputMode="decimal"
                aria-label={`Сумма части ${i + 1}`}
                // Пока в поле печатают, показываем набранное; как только
                // ушли из поля — посчитанное число.
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
