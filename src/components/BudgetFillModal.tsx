import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Wand2, X } from "lucide-react";
import type { Transaction } from "../types";
import type { BudgetKind, BudgetLine } from "../lib/budgets";
import {
  buildForecast,
  previousPlan,
  forecastChanges,
  type ForecastBasis,
  type ForecastScope,
  type ForecastSuggestion,
} from "../lib/budgetForecast";
import type { BudgetScope } from "../lib/budgetScope";
import { formatMoney, monthLabelFull } from "../lib/format";
import { CategoryDot } from "./CategoryDot";
import { Segmented } from "./Segmented";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { Tooltip } from "./Tooltip";

/** Одна статья к применению — ровно то, что уходит в план и в Дзен-мани. */
export interface FillItem {
  kind: BudgetKind;
  category: string;
  subcategory: string | null;
  amount: number;
}

const PERIODS: { value: number; label: string; title: string }[] = [
  { value: 1, label: "Месяц", title: "По прошлому месяцу" },
  { value: 3, label: "Квартал", title: "По трём предыдущим месяцам" },
  { value: 6, label: "Полгода", title: "По шести предыдущим месяцам" },
  { value: 12, label: "Год", title: "По двенадцати предыдущим месяцам" },
];

/**
 * «Заполнить по среднему» — постатейный план на месяц из истории операций.
 *
 * Окно, способ расчёта и охват меняются прямо в окне, и список пересчитывается
 * сразу: суммы видно до применения, каждую строку можно снять. Считает та же
 * чистая функция, что потом и пишет, — предпросмотр не может разойтись с
 * результатом.
 */
export function BudgetFillModal({
  ym,
  transactions,
  lines,
  base,
  scope,
  defaultMonths = 3,
  defaultBasis = "average",
  onApply,
  onClose,
}: {
  /** Месяц, который заполняем. */
  ym: string;
  transactions: Transaction[];
  lines: BudgetLine[];
  base: string;
  /** Периметр бюджета — тот же, что и у сумм на странице. */
  scope: BudgetScope;
  /** Значения из настроек бюджета: с ними окно и открывается. */
  defaultMonths?: number;
  defaultBasis?: ForecastBasis;
  onApply: (items: FillItem[]) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [months, setMonths] = useState(defaultMonths);
  const [basis, setBasis] = useState<ForecastBasis>(defaultBasis);
  const [coverage, setCoverage] = useState<ForecastScope>("empty");
  // Третий способ занести бюджет из issue #25, рядом с «вручную» и «по
  // прогнозу»: скопировать план прошлого месяца как есть. Окно и период при
  // нём не нужны — прячем, чтобы не спрашивать то, что не учитывается.
  const [source, setSource] = useState<"fact" | "prevPlan">("fact");
  // Снятые галочки, а не отмеченные: при смене окна или охвата список строк
  // меняется, и новые статьи должны приходить уже выбранными.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  const rows = useMemo(
    () =>
      source === "prevPlan"
        ? previousPlan(lines, ym)
        : buildForecast(transactions, lines, ym, { months, basis, scope }),
    [source, transactions, lines, ym, months, basis, scope]
  );
  const changes = useMemo(() => forecastChanges(rows, coverage), [rows, coverage]);
  const picked = useMemo(
    () => changes.filter((r) => !excluded.has(r.key)),
    [changes, excluded]
  );

  const toggle = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOn = picked.length === changes.length && changes.length > 0;
  const toggleAll = () =>
    setExcluded(allOn ? new Set(changes.map((r) => r.key)) : new Set());

  const expense = changes.filter((r) => r.kind === "expense");
  const income = changes.filter((r) => r.kind === "income");
  const total = (kind: BudgetKind) =>
    picked.filter((r) => r.kind === kind).reduce((s, r) => s + r.suggested, 0);

  function apply() {
    if (picked.length === 0) return;
    onApply(
      picked.map((r) => ({
        kind: r.kind,
        category: r.category,
        subcategory: r.subcategory,
        amount: r.suggested,
      }))
    );
    onClose();
  }

  const group = (title: string, list: ForecastSuggestion[], kind: BudgetKind) =>
    list.length > 0 && (
      <div>
        <div className="label mb-1 flex items-baseline gap-2">
          <span>{title}</span>
          <span className="text-muted font-normal tabular-nums">
            итого {formatMoney(total(kind), base)}
          </span>
        </div>
        <div className="rounded-xl border border-border divide-y divide-border">
          {list.map((r) => {
            const on = !excluded.has(r.key);
            return (
              <label
                key={r.key}
                className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-panel2/40"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(r.key)}
                  className="shrink-0 accent-[var(--accent)]"
                />
                {r.subcategory ? (
                  <CategoryDot category={r.subcategory} parent={r.category} size="w-6 h-6" />
                ) : (
                  <CategoryDot category={r.category} size="w-6 h-6" />
                )}
                <span className="truncate flex-1 min-w-0">
                  {r.subcategory ? (
                    <>
                      <span className="text-muted">{r.category} / </span>
                      {r.subcategory}
                    </>
                  ) : (
                    r.category
                  )}
                </span>
                {/* Сколько месяцев реально усреднили — иначе сумма выглядит
                    взявшейся ниоткуда, особенно у новой категории. При копии
                    плана усреднять нечего, и число месяцев там только сбивало
                    бы с толку. */}
                {source === "fact" ? (
                  <Tooltip
                    content={`Факт по месяцам: ${r.history
                      .map((v) => formatMoney(v, base))
                      .join(" · ")}`}
                  >
                    <span className="text-xs text-muted shrink-0 whitespace-nowrap">
                      {r.monthsUsed} мес.
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-muted shrink-0 whitespace-nowrap">
                    было в плане
                  </span>
                )}
                <span className="tabular-nums shrink-0 whitespace-nowrap flex items-center gap-1.5">
                  {r.current > 0 && (
                    <>
                      <span className="text-muted line-through">
                        {formatMoney(r.current, base)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-muted" />
                    </>
                  )}
                  <span className={on ? "text-accent" : "text-muted"}>
                    {formatMoney(r.suggested, base)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-fill-title"
        className="w-full max-w-3xl rounded-2xl border border-border bg-panel shadow-2xl outline-none flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-panel2/50 border-b border-border rounded-t-2xl">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-accent/10 text-accent">
            <Wand2 className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] uppercase tracking-wider text-muted"
              id="budget-fill-title"
            >
              Заполнение бюджета
            </div>
            <div className="font-semibold truncate">{monthLabelFull(ym)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              size="sm"
              label="Откуда брать суммы"
              value={source}
              onChange={(v) => setSource(v)}
              options={[
                {
                  value: "fact" as const,
                  label: "По истории",
                  title: "Посчитать по фактическим тратам за период",
                },
                {
                  value: "prevPlan" as const,
                  label: "План прошлого месяца",
                  title: "Скопировать суммы, запланированные на прошлый месяц",
                },
              ]}
            />
            {source === "fact" && (
              <>
            <Segmented
              size="sm"
              label="За какой период считать"
              value={months}
              onChange={setMonths}
              options={PERIODS}
            />
            <Segmented
              size="sm"
              label="Как считать сумму"
              value={basis}
              onChange={(v) => setBasis(v as ForecastBasis)}
              options={[
                { value: "average", label: "Среднее", title: "Среднее арифметическое за период" },
                { value: "median", label: "Медиана", title: "Середина ряда — устойчива к разовым всплескам" },
              ]}
            />
              </>
            )}
            <Segmented
              size="sm"
              label="Какие статьи заполнять"
              value={coverage}
              onChange={(v) => setCoverage(v as ForecastScope)}
              options={[
                { value: "empty", label: "Только без плана", title: "Не трогать уже заданные суммы" },
                { value: "all", label: "Все статьи", title: "Переписать и уже заданные суммы" },
              ]}
            />
            <InfoPopover label="Как считается">
              <p>
                Суммы берутся из истории самих операций за выбранный период{" "}
                <InfoTerm>перед</InfoTerm> заполняемым месяцем: сам он ещё не
                кончился и занизил бы среднее.
              </p>
              <p>
                <InfoTerm>Среднее</InfoTerm> — сумма за период, делённая на
                число месяцев. <InfoTerm>Медиана</InfoTerm> — середина ряда: один
                отпуск или разовая покупка не задирают план на весь год.
              </p>
              <p>
                Месяцы до первой операции по категории не учитываются — иначе у
                категории, появившейся месяц назад, средним за год вышла бы
                двенадцатая часть реальных трат. Пустые месяцы внутри периода
                учитываются: редкая трата честно размазывается по месяцам.
              </p>
              <p>
                Переводы и операции без категории в бюджет не идут, возвраты
                уменьшают факт месяца. Суммы округляются до сотни.
              </p>
              <p>
                <InfoTerm>План прошлого месяца</InfoTerm> — это не то же самое,
                что «по истории» за месяц: копируется сумма, которую вы
                запланировали, а не та, что потратили.
              </p>
            </InfoPopover>
          </div>

          {changes.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              {rows.length === 0
                ? source === "prevPlan"
                  ? "В прошлом месяце планов не было — копировать нечего."
                  : "За выбранный период операций не нашлось — заполнять нечего."
                : "Все статьи уже спланированы. Выберите «Все статьи», чтобы пересчитать суммы."}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-accent hover:underline"
                >
                  {allOn ? "Снять все" : "Выбрать все"}
                </button>
                <span className="text-muted">
                  Выбрано статей: {picked.length} из {changes.length}
                </span>
              </div>
              {group("Расходы", expense, "expense")}
              {group("Доходы", income, "income")}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={picked.length === 0}
            className="btn-primary text-sm"
          >
            {picked.length > 0 ? `Заполнить (${picked.length})` : "Заполнить"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
