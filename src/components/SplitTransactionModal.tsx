import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Calculator,
  CalendarDays,
  Check,
  Info,
  Plus,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import type { Transaction } from "../types";
import { CategoryCascadePicker } from "./CategoryCascadePicker";
import { Combobox } from "./Combobox";
import { HashtagTextarea } from "./HashtagTextarea";
import { extractHashtags } from "../lib/aggregations";
import { useCategoryNodes } from "../hooks/useCategoryNodes";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { currencySymbol, formatMoney } from "../lib/format";
import { colorForCategory } from "../lib/categoryColor";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useDataStore } from "../store/useDataStore";
import { useLiveAccounts } from "../hooks/useLiveAccounts";
import {
  evalAmount,
  round2,
  splitProblem,
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
 * оставшимся. Первая часть на старте держит ВСЮ сумму: «разделить» не значит
 * «поровну», и придуманные числа пришлось бы стирать перед вводом своих.
 *
 * Контрагент и счёт — общие: это одна покупка, разносить её по разным
 * магазинам и счетам бессмысленно. Комментарий, наоборот, у каждой части свой.
 */
/** «20 августа 2026, четверг» — дата, которую читают, а не расшифровывают. */
function dayWithWeekday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const weekday = d.toLocaleDateString("ru-RU", { weekday: "long" });
  return `${day.replace(" г.", "")}, ${weekday}`;
}

export function SplitTransactionModal({
  tx,
  onClose,
  onSplit,
}: {
  tx: Transaction;
  onClose: () => void;
  /** Применить разбивку. Возвращает текст ошибки или `null` при успехе. */
  onSplit: (
    parts: SplitDraftPart[],
    payee: string,
    account: string
  ) => Promise<string | null>;
}) {
  const total = round2(Math.abs(tx.amount));
  const nodes = useCategoryNodes(tx.kind);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const allTransactions = useDataStore((s) => s.transactions);

  // Подсказки контрагентов — из тех, что уже встречались в операциях. Полный
  // справочник Дзен-мани тянуть сюда незачем: разбивают обычно операцию с уже
  // знакомым получателем.
  const payeeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const name = t.brand || t.payee;
      if (name) seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "ru")).slice(0, 500);
  }, [allTransactions]);

  // Счета — только существующие: новая операция собирается по НАЗВАНИЮ счёта,
  // и выдуманное имя отправка не примет. Берём и справочник, и историю: свежий
  // счёт, по которому ещё не было операций, в истории не найдётся, а выбрать
  // его надо; архивные не предлагаем — операцию на них не создать.
  const liveAccounts = useLiveAccounts();
  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const a of liveAccounts ?? []) {
      if (!a.archive) seen.add(a.title);
    }
    for (const t of allTransactions) {
      for (const a of [t.account, t.outcomeAccount, t.incomeAccount]) {
        if (a) seen.add(a);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions, liveAccounts]);

  // Метки для автодополнения — из комментариев всех операций: тот же список,
  // что предлагает карточка операции, иначе в разбивке завёлся бы свой набор.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) {
      for (const h of extractHashtags(t.comment)) set.add(h);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions]);

  const [parts, setParts] = useState<SplitDraftPart[]>(() =>
    // Вся сумма в первой части, вторая пустая. Первая при этом «свободная» —
    // она и есть остаток: вводишь сумму во вторую, из первой ровно столько же
    // вычитается. Новые части добавляются закреплёнными на нуле, иначе они
    // растащили бы остаток между собой.
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
  const [payee, setPayee] = useState(tx.brand || tx.payee || "");
  const [account, setAccount] = useState(tx.account);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  /**
   * Закрепить часть с введённой суммой, оставив ровно ОДНУ свободную.
   *
   * Свободная часть принимает остаток, поэтому она нужна всегда: без неё
   * ввод суммы в новую часть не вычитался бы из основной, а выдавал ошибку
   * «больше суммы операции». Если закрепили последнюю свободную — роль
   * остатка переходит к другой части, самой нижней из оставшихся.
   */
  function pinAmount(key: string, amount: number) {
    setParts((prev) => {
      let next = prev.map((p) => (p.key === key ? { ...p, amount, pinned: true } : p));
      if (next.every((p) => p.pinned)) {
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].key !== key) {
            next = next.map((p, j) => (j === i ? { ...p, pinned: false } : p));
            break;
          }
        }
      }
      return spreadRemainder(total, next);
    });
  }

  /** Сумма, набранная в поле: считаем выражение и закрепляем строку. */
  function commitAmount(key: string, raw: string) {
    const value = evalAmount(raw);
    setTyped((t) => {
      const next = { ...t };
      delete next[key];
      return next;
    });
    const current = parts.find((p) => p.key === key);
    // Пустое поле — часть обнуляется и уступает роль остатка другой.
    if (raw.trim() === "") {
      if (current?.amount !== 0) pinAmount(key, 0);
      return;
    }
    if (value === null) return; // Не выражение — оставляем как было.
    const next = round2(Math.abs(value));
    // Ушли из поля, ничего не изменив, — НЕ закрепляем. Иначе часть-остаток
    // теряла эту роль от одного касания, и следующий же ввод в соседнюю
    // часть выдавал ошибку вместо вычитания.
    if (current && current.amount === next) return;
    pinAmount(key, next);
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

  async function apply() {
    if (problem) return;
    setSaving(true);
    setError(null);
    const failed = await onSplit(parts, payee.trim(), account);
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
      <div className="card w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 font-semibold min-w-0">
            <Scissors className="w-4 h-4 text-accent2 shrink-0" />
            Разделить операцию
            <InfoPopover label="Как работает разделение">
              <p>
                Одна покупка часто состоит из разного: в чеке из супермаркета и
                еда, и бытовая химия, и корм коту. Здесь такая операция
                расписывается по категориям — у каждой части своя категория,
                своя сумма и свой комментарий.
              </p>
              <p>
                Части становятся{" "}
                <InfoTerm>настоящими операциями</InfoTerm>: исходная ужимается
                до первой, остальные создаются рядом. Поэтому разбивка видна
                везде, где вы смотрите свои деньги, — и здесь, и в мобильном
                приложении Дзен-мани.
              </p>
              <p>
                <InfoTerm>Контрагент, счёт и дата</InfoTerm> у всех частей
                общие: это одна покупка, разносить её по разным магазинам и
                счетам незачем. Контрагента и счёт можно поменять прямо здесь —
                поменяются сразу у всех частей.
              </p>
              <p>
                Сумму не нужно считать в уме: в поле работают{" "}
                <InfoTerm>сложение, вычитание, умножение, деление и скобки</InfoTerm>.
                Та часть, в которой вы ещё не вводили сумму, забирает остаток —
                вписали сумму в одну, из неё вычлось в другой.
              </p>
              <p>
                Разбивку видно у каждой части значком «ножницы» с номером, и
                отменить её можно в любой момент: исходная операция вернётся к
                своей сумме, а созданные части удалятся.
              </p>
            </InfoPopover>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-muted hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Общая шапка: всё, что НЕ делится между частями. Дата и сумма —
            справа отдельным блоком: их не правят, но от них считается всё
            остальное, и они должны читаться первыми. */}
        <div className="px-5 pt-4">
          <div className="card-sunken px-4 py-3 space-y-3">
            {/* Дата и сумма — отдельным блоком справа, с чертой: их не правят,
                а слева стоят поля. Раньше подпись с датой висела над суммой и
                читалась как ярлык к ней, хотя это разные вещи. */}
            {/* items-start и одинаковая высота значений: при выравнивании по
                НИЗУ подписи разъезжались по вертикали — у поля и у крупной
                суммы разная высота, и «КОНТРАГЕНТ» стоял ниже «СУММЫ». */}
            <div className="flex items-start gap-4 flex-wrap">
              <div className="min-w-[180px] flex-[3]">
                <span className="label block mb-1">Контрагент</span>
                {/* Combobox, а не поле со списком браузера: по сервису все
                    подобные поля выглядят одинаково, и родной `datalist`
                    выбивался из ряда. */}
                <Combobox
                  value={payee}
                  options={payeeOptions}
                  onChange={setPayee}
                  placeholder="Кому платили"
                  searchable
                  portal
                />
              </div>
              <div className="min-w-[180px] flex-[2]">
                <span className="label block mb-1">Счёт</span>
                <Combobox
                  value={account}
                  options={accountOptions}
                  onChange={setAccount}
                  placeholder="Счёт"
                  allowCustom={false}
                  searchable
                  portal
                />
              </div>
              {/* Дата — плашкой, сумма — крупным числом: их не правят, и они
                  разной природы. Раньше они стояли впритык одинаковым текстом
                  и читались одной строкой «30 августа 1 122 ₽». */}
              {/* Черта стоит ПОСЛЕ даты: слева от неё всё, что описывает
                  операцию, справа — её сумма, к которой сходятся части. */}
              <div className="shrink-0">
                <span className="label block mb-1">Дата</span>
                <div className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-panel2 border border-border text-sm whitespace-nowrap">
                  <CalendarDays className="w-4 h-4 shrink-0 text-muted" />
                  {dayWithWeekday(tx.date)}
                </div>
              </div>
              <div className="shrink-0 text-right pl-5 border-l border-border">
                <span className="label block mb-1">Сумма</span>
                <div className="text-2xl font-bold tabular-nums whitespace-nowrap h-9 leading-9">
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
                  // Полоса без подписей молчит о том, ЧЕЙ это кусок: цвет
                  // угадывается только по строке ниже, а при трёх частях уже
                  // не угадывается.
                  title={
                    p.category
                      ? `${p.subcategory ? `${p.category} / ${p.subcategory}` : p.category} — ${formatMoney(p.amount, tx.currency)}${
                          total > 0 && p.amount > 0
                            ? ` · ${Math.round((p.amount / total) * 100)}%`
                            : ""
                        }`
                      : "Категория не выбрана"
                  }
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

        <div
          className="flex-1 overflow-y-auto px-5 py-4 space-y-2"
          style={{ scrollbarGutter: "stable" }}
        >
          {parts.map((p, i) => {
            // Доля есть ВСЕГДА, даже нулевая: пустое место на её месте
            // заставляло строки прыгать по мере заполнения, а «0%» честно
            // говорит, что часть ещё ничего не забрала.
            const share = total > 0 ? Math.round((p.amount / total) * 100) : 0;
            const tint = p.category
              ? colorForCategory(p.category, categoryMeta)
              : null;
            return (
              <div
                key={p.key}
                className="rounded-xl border border-border bg-panel2/30 p-2 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-6 h-6 shrink-0 grid place-items-center rounded-full bg-panel2 border border-border text-[11px] text-muted tabular-nums"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-[240px]">
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
                  {/* Знак валюты у поля: сумма набирается голым числом, и
                      в чём она — видно только по крупной сумме в шапке. У
                      валютной операции это лишний повод ошибиться. */}
                  <div className="relative shrink-0">
                    <span className="absolute left-2.5 inset-y-0 grid place-items-center text-sm text-muted pointer-events-none">
                      {currencySymbol(tx.currency)}
                    </span>
                  <input
                    className="input w-32 pl-7 text-right text-sm tabular-nums"
                    inputMode="decimal"
                    aria-label={`Сумма части ${i + 1}`}
                    placeholder={p.pinned ? "0" : "остаток"}
                    value={typed[p.key] ?? (p.amount ? String(p.amount) : "")}
                    onChange={(e) =>
                      setTyped((t) => ({ ...t, [p.key]: e.target.value }))
                    }
                    onBlur={(e) => commitAmount(p.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitAmount(p.key, (e.target as HTMLInputElement).value);
                      }
                    }}
                  />
                  </div>
                  {/* Доля — плашкой в цвет своей статьи: она отвечает на
                      «сколько это от покупки» и глазом связывается с тем же
                      сегментом полосы наверху. */}
                  <span
                    // `self-stretch`, а не своя высота: поля в строке чуть выше номинальных
                    // 36px из-за канта, и жёсткое число разошлось бы с ними на пиксели.
                    className="w-14 self-stretch shrink-0 grid place-items-center text-[11px] font-medium tabular-nums rounded-lg border border-border text-muted"
                    // Цвет — от статьи; пока её не выбрали, плашка серая, как
                    // и сегмент полосы наверху.
                    style={
                      tint && share > 0
                        ? { color: tint, borderColor: tint }
                        : undefined
                    }
                  >
                    {share}%
                  </span>
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
                {/* Комментарий — второй строкой и помельче: он уточняет часть,
                    а не задаёт её, и в одном ряду со статьёй спорил с ней за
                    внимание. Отступ слева равен ширине кружка с номером, так
                    что поле начинается там же, где статья. */}
                <div style={{ width: "calc(100% - 2rem)", marginLeft: "2rem" }}>
                  <HashtagTextarea
                    value={p.comment ?? ""}
                    onChange={(next) => patch(p.key, { comment: next })}
                    tags={allTags}
                    rows={1}
                    placeholder="Комментарий к части — необязательно"
                    className="input w-full text-xs resize-none"
                  />
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <button onClick={addPart} className="btn-ghost text-sm">
              <Plus className="w-3.5 h-3.5" />
              Добавить часть
            </button>
            {/* Про калькулятор надо сказать словами: поле выглядит обычным, и
                сам никто складывать в нём не попробует. Перечисляем ДЕЙСТВИЯ,
                а не примеры: примеры занимали полстроки и всё равно не
                покрывали всех случаев. */}
            <span className="text-[11px] text-muted inline-flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 shrink-0" />
              В поле суммы считаются выражения:
              <code className="kbd">+</code>
              <code className="kbd">−</code>
              <code className="kbd">×</code>
              <code className="kbd">÷</code>
              <code className="kbd">( )</code>
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
          {/* ТРИ разных состояния, а не два цвета на все случаи.
              «Ещё не заполнено» — не ошибка, а подсказка, что осталось
              сделать; сорвавшаяся отправка — настоящая ошибка, и краснеть
              должна только она. Готовность вообще не кричит: кнопка справа
              и так ожила, а зелёная плашка «Готово: 2 части на 1 122 ₽»
              лишь повторяла заголовок и надпись на кнопке. */}
          {error ? (
            <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-expense/10 text-expense border border-expense/30">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          ) : problem ? (
            <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-warn/10 text-warn border border-warn/30">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{problem}</span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Check className="w-3.5 h-3.5 shrink-0 text-income" />
              Суммы сходятся
            </span>
          )}
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
