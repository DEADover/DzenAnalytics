import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Calculator, Check, Plus, Scissors, Trash2, X } from "lucide-react";
import type { Transaction } from "../types";
import { CategoryCascadePicker } from "./CategoryCascadePicker";
import { useCategoryNodes } from "../hooks/useCategoryNodes";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { formatDate, formatMoney } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { colorForCategory } from "../lib/categoryColor";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useDataStore } from "../store/useDataStore";
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
  onSplit: (parts: SplitDraftPart[], payee: string) => Promise<string | null>;
}) {
  const total = round2(Math.abs(tx.amount));
  const nodes = useCategoryNodes(tx.kind);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  // Подсказки контрагентов — из тех, что уже встречались в операциях. Полный
  // справочник Дзен-мани тянуть сюда не за чем: разбивают обычно операцию с
  // уже знакомым получателем.
  const allTransactions = useDataStore((s) => s.transactions);
  const payeeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const name = t.brand || t.payee;
      if (name) seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "ru")).slice(0, 500);
  }, [allTransactions]);

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
  // Контрагент один на все части: это одна покупка, и разносить её по разным
  // магазинам бессмысленно. Правится здесь же — часто разбивают как раз ту
  // операцию, у которой заодно и получатель кривой.
  const [payee, setPayee] = useState(tx.brand || tx.payee || "");
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
    const failed = await onSplit(parts, payee.trim());
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
      <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
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
            <div className="flex items-end justify-between gap-4">
              <label className="min-w-0 flex-1 block">
                <span className="label block mb-1">Контрагент — у всех частей</span>
                <input
                  className="input w-full"
                  value={payee}
                  placeholder="Кому платили"
                  onChange={(e) => setPayee(e.target.value)}
                  list="split-payees"
                />
                <datalist id="split-payees">
                  {payeeOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <div className="text-right shrink-0">
                <div className="text-[11px] text-muted whitespace-nowrap">
                  {formatDate(tx.date)} · {tx.account}
                </div>
                <div className="text-xl font-bold tabular-nums whitespace-nowrap">
                  {formatMoney(total, tx.currency)}
                </div>
              </div>
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
              <div className="flex-[3] min-w-[190px]">
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
              {/* Комментарий свой у каждой части: «корм коту» и «шампунь» —
                  разные покупки, и через полгода по одной статье их уже не
                  различить. */}
              <input
                className="input flex-[2] min-w-[130px]"
                aria-label={`Комментарий части ${i + 1}`}
                placeholder="Комментарий"
                value={p.comment ?? ""}
                onChange={(e) => patch(p.key, { comment: e.target.value })}
              />
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

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <button onClick={addPart} className="btn-ghost text-sm">
              <Plus className="w-3.5 h-3.5" />
              Добавить часть
            </button>
            {/* Про калькулятор надо сказать словами: поле выглядит обычным, и
                сам никто складывать в нём не попробует. */}
            <span className="text-[11px] text-muted inline-flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 shrink-0" />
              В поле суммы считаются выражения: <code className="kbd">1200+300</code>
              <code className="kbd">2400/2</code>
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
          {/* ОДНА строка состояния, а не две. Раньше «Разнесено полностью»
              зелёным и «У каждой части должна быть статья» красным стояли
              рядом и противоречили друг другу: сумма-то сошлась, а сохранить
              всё равно нельзя. Показываем то, что мешает; мешать нечему —
              говорим, что готово. */}
          <div
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs min-w-0 ${
              error || problem
                ? "bg-warn/10 text-warn border border-warn/30"
                : "bg-income/10 text-income border border-income/30"
            }`}
          >
            {error || problem ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Check className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {error ??
                problem ??
                `Готово: ${parts.length} ${pluralRu(parts.length, [
                  "часть",
                  "части",
                  "частей",
                ])} на ${formatMoney(total, tx.currency)}`}
            </span>
            {/* Все части заполнены руками, а сумма не сошлась — деть остаток
                некуда, и он повис бы без выхода. */}
            {remainder !== 0 && parts.every((p) => p.pinned) && (
              <button
                onClick={() => pushRemainder(parts[parts.length - 1].key)}
                className="shrink-0 underline underline-offset-2 hover:no-underline"
              >
                дослать в последнюю
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
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
