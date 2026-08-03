import { useEffect, useMemo, useState, useCallback } from "react";
import {
  X,
  ChevronDown,
  FilterX,
  Filter,
  SlidersHorizontal,
  Coins,
} from "lucide-react";
import { DateField } from "./DateField";
import { MultiSelect } from "./MultiSelect";
import { AccountLogo } from "./AccountLogo";
import { accountKindLabel } from "../lib/accountType";
import { CategoryFilterPicker } from "./CategoryFilterPicker";
import { MonthPicker } from "./MonthPicker";
import { currencySymbol } from "../lib/format";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { getLiveAccountsFromCache, getCategoryTagsFromCache } from "../store/useZenmoneyStore";
import { useFiltersStore, type DatePreset } from "../store/useFiltersStore";
import type { PeriodController } from "../hooks/useLocalPeriod";
import { FiltersMenu } from "./FiltersMenu";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { currencyFlagEmoji } from "../lib/currencyFlag";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "30d", label: "30 дней" },
  { value: "3m", label: "3 мес" },
  { value: "6m", label: "6 мес" },
  { value: "12m", label: "12 мес" },
  { value: "ytd", label: "С начала года" },
  { value: "all", label: "Всё" },
];

const OP_TYPES: { value: string; label: string }[] = [
  { value: "income", label: "Доходы" },
  { value: "expense", label: "Расходы" },
  { value: "transfer", label: "Переводы" },
];


/** Служебные категории, которые держим наверху списка без заголовка группы. */
const PINNED_CATEGORIES = ["Корректировка"];

export function GlobalFilters({
  showDateRange = true,
  dateRangeHint,
  period,
}: {
  /**
   * Управляет ли эта панель периодом. `false` — контролы дат остаются на месте,
   * но становятся НЕАКТИВНЫМИ.
   *
   * Раньше они просто исчезали, и панель на страницах со своим периодом
   * («Сравнение», «Календарь», «50/30/20») выглядела короче, чем на остальных.
   * Одинаковая на вид панель, часть которой погашена, читается спокойнее, чем
   * панель, у которой каждый раз разный набор контролов.
   */
  showDateRange?: boolean;
  /** Чем объяснить, почему даты недоступны. Показывается подсказкой. */
  dateRangeHint?: string;
  /** Controlled period — when provided, ALL period controls (presets, month
   *  picker, custom range) drive this page-local controller instead of the
   *  global filter store, without touching the global «месяц». Used by history
   *  charts (Cash-flow, Trends). See `useLocalPeriod`. */
  period?: PeriodController;
} = {}) {
  const transactions = useDataStore((s) => s.transactions);
  // Отбор сравнивает суммы в базовой валюте, поэтому и подпись — по ней.
  const base = useDataStore((s) => s.rates.base);
  const f = useFiltersStore();
  const controlledPeriod = period !== undefined;
  // Period slice source: the local controller when controlled, else the store.
  // Both expose the same fields/handlers (preset/monthYM/from/to + setters).
  const periodCtl: PeriodController = controlledPeriod ? period : f;
  const [additionalOpen, setAdditionalOpen] = useState(false);

  // Archived (closed) account titles from the Zenmoney cache — used to sort the
  // archived accounts to the bottom of the filter and group them under a divider.
  const [archivedAccounts, setArchivedAccounts] = useState<Set<string>>(new Set());
  /** Название счёта → его вид («Карта», «Депозит», …). Пусто в режиме CSV: там
   *  метаданных счетов нет, и группировать нечем. */
  const [accountKinds, setAccountKinds] = useState<Map<string, string>>(new Map());
  /** Название категории → расходная она или доходная, по справочнику Дзен-мани.
   *  Пусто в режиме CSV — тогда тип выводим из самих операций. */
  const [tagKinds, setTagKinds] = useState<Map<string, "expense" | "income" | "both">>(
    new Map()
  );

  useEffect(() => {
    let cancelled = false;
    void getCategoryTagsFromCache().then((tags) => {
      if (cancelled || !tags) return;
      const m = new Map<string, "expense" | "income" | "both">();
      for (const t of tags) {
        if (t.parent) continue; // тип задаёт корневая категория
        m.set(
          t.title,
          t.showOutcome && t.showIncome
            ? "both"
            : t.showIncome
              ? "income"
              : "expense"
        );
      }
      setTagKinds(m);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  // Off-balance account titles → the filter store, so `applyFilters` can honour
  // the «исключить внебалансовые» option (which needs account metadata the pure
  // filter can't see). Loaded here since GlobalFilters renders on every page.
  const offBalanceAccounts = f.offBalanceAccounts;
  const setOffBalanceAccounts = f.setOffBalanceAccounts;
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setArchivedAccounts(new Set(live.filter((a) => a.archive).map((a) => a.title)));
      setAccountKinds(
        new Map(live.map((a) => [a.title, accountKindLabel(a.type, a.savings)]))
      );
      setOffBalanceAccounts(
        new Set(live.filter((a) => !a.archive && !a.inBalance).map((a) => a.title))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [transactions, setOffBalanceAccounts]);

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.account) set.add(t.account);
    // Архивные — вниз; внутри активных группируем по виду счёта, чтобы список
    // читался так же, как страница «Счета». Внутри вида — по алфавиту.
    return Array.from(set).sort((a, b) => {
      const aa = archivedAccounts.has(a);
      const ba = archivedAccounts.has(b);
      if (aa !== ba) return aa ? 1 : -1;
      const ka = accountKinds.get(a) ?? "";
      const kb = accountKinds.get(b) ?? "";
      if (ka !== kb) return ka.localeCompare(kb, "ru");
      return a.localeCompare(b, "ru");
    });
  }, [transactions, archivedAccounts, accountKinds]);

  /** Заголовок группы для пикера счетов: архивные идут под своим разделителем,
   *  который рисует сам MultiSelect, поэтому им группу не назначаем. */
  const accountGroup = useCallback(
    (title: string) =>
      archivedAccounts.has(title) ? null : (accountKinds.get(title) ?? null),
    [archivedAccounts, accountKinds]
  );

  // Parent categories each with their observed sub-categories — for the cascade
  // category filter (parent on the left, subs on the right).
  const categoryNodes = useMemo(() => {
    const map = new Map<
      string,
      { subs: Set<string>; hasBare: boolean; seenIncome: boolean; seenExpense: boolean }
    >();
    for (const t of transactions) {
      if (!t.category) continue;
      let e = map.get(t.category);
      if (!e) {
        e = { subs: new Set<string>(), hasBare: false, seenIncome: false, seenExpense: false };
        map.set(t.category, e);
      }
      // A transaction tagged with just the parent (no sub) is "bare" — a
      // distinct leaf from any «Category / Subcategory».
      if (t.subcategory) e.subs.add(t.subcategory);
      else e.hasBare = true;
      if (t.kind === "income") e.seenIncome = true;
      else if (t.kind === "expense" || t.kind === "refund") e.seenExpense = true;
    }
    // Тип берём из справочника Дзен-мани, а если его нет (режим CSV) — выводим
    // из самих операций: категория, встреченная только в доходах, доходная.
    const kindOf = (name: string, e: { seenIncome: boolean; seenExpense: boolean }) => {
      const fromTags = tagKinds.get(name);
      if (fromTags) return fromTags;
      if (e.seenIncome && e.seenExpense) return "both" as const;
      if (e.seenIncome) return "income" as const;
      if (e.seenExpense) return "expense" as const;
      return undefined;
    };
    // Доходных категорий обычно единицы, расходных — десятки, поэтому короткий
    // список идёт первым. Смешанные («и расход, и доход») — в хвост: их мало и
    // они не то, что ищут в первую очередь.
    const ORDER = { income: 0, expense: 1, both: 2 } as const;
    const real = [...map.entries()]
      .filter(([name]) => name !== NO_CATEGORY)
      .map(([name, e]) => ({
        name,
        hasBare: e.hasBare,
        kind: kindOf(name, e),
        subs: [...e.subs].sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort(
        (a, b) =>
          (a.kind ? ORDER[a.kind] : 3) - (b.kind ? ORDER[b.kind] : 3) ||
          a.name.localeCompare(b.name, "ru")
      );
    // Наверх и без заголовка группы — «Без категории» и «Корректировка».
    // Первая всегда под рукой: по ней ищут операции, которым забыли категорию.
    // Вторая формально «и расход, и доход» и заводила бы себе отдельную группу
    // из одной строки — а по смыслу это служебная запись, а не статья бюджета.
    const pinnedNames = new Set([NO_CATEGORY, ...PINNED_CATEGORIES]);
    const pinned = real.filter((n) => pinnedNames.has(n.name)).map((n) => ({
      ...n,
      // Тип убираем намеренно: без него строка не получает заголовок группы.
      kind: undefined,
    }));
    return [
      { name: NO_CATEGORY, hasBare: true, subs: [] },
      ...pinned,
      ...real.filter((n) => !pinnedNames.has(n.name)),
    ];
  }, [transactions, tagKinds]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.currency) set.add(t.currency);
    return Array.from(set).sort();
  }, [transactions]);

  const dataRange = useMemo(() => {
    let min = "";
    let max = "";
    for (const t of transactions) {
      if (!min || t.date < min) min = t.date;
      if (!max || t.date > max) max = t.date;
    }
    return {
      minYM: min.slice(0, 7) || "",
      maxYM: max.slice(0, 7) || "",
    };
  }, [transactions]);

  const currentMonthYM =
    periodCtl.preset === "month" && periodCtl.monthYM
      ? periodCtl.monthYM
      : dataRange.maxYM;

  // Default preset is now "current month"; treat anything else as user-set.
  const now = new Date();
  const defaultMonthYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasExtra =
    f.excludeTransfers ||
    f.minAmount != null ||
    f.maxAmount != null ||
    f.types.size > 0 ||
    f.onlyUncategorized ||
    f.hideZero ||
    f.onlyWithComment ||
    f.onlyNew ||
    f.excludeOffBalance;
  const extraCount =
    (f.excludeTransfers ? 1 : 0) +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.types.size > 0 ? 1 : 0) +
    (f.onlyUncategorized ? 1 : 0) +
    (f.hideZero ? 1 : 0) +
    (f.onlyWithComment ? 1 : 0) +
    (f.onlyNew ? 1 : 0) +
    (f.excludeOffBalance ? 1 : 0);
  const hasFilters =
    f.accounts.size > 0 ||
    f.categories.size > 0 ||
    f.currencies.size > 0 ||
    f.search.length > 0 ||
    hasExtra ||
    !(f.preset === "month" && f.monthYM === defaultMonthYM);

  if (transactions.length === 0) return null;

  return (
    <div className="card p-3 md:card-pad md:p-4 mb-4 md:mb-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* ── Row 1: saved filter · «Дополнительно» │ period │ reset ── */}
        <FiltersMenu />

        {/* «Дополнительно» — right next to the filter button */}
        <div className="relative">
          <button
            onClick={() => setAdditionalOpen((o) => !o)}
            className={clsx(
              "btn-ghost text-xs py-1.5 h-[30px] w-52",
              hasExtra && "border-accent text-accent"
            )}
            title="Дополнительные фильтры"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 min-w-0 text-left truncate">Дополнительно</span>
            {extraCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-fg text-[11px] font-medium leading-none shrink-0">
                {extraCount}
              </span>
            )}
            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
          </button>
          {additionalOpen && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setAdditionalOpen(false)} />
              <div className="absolute z-[80] mt-1 left-0 w-72 card p-2 space-y-3 max-h-[70vh] overflow-auto">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Тип операции</div>
                  <div className="flex gap-1">
                    {OP_TYPES.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => f.toggleType(t.value)}
                        className={clsx(
                          "flex-1 px-2 py-1 text-xs rounded-md border transition-colors",
                          f.types.has(t.value)
                            ? "bg-accent text-accent-fg border-accent"
                            : "border-border text-muted hover:text-text"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">
                    Сумма, {currencySymbol(base)}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="от"
                      value={f.minAmount ?? ""}
                      onChange={(e) =>
                        f.setAmountRange(e.target.value === "" ? null : Number(e.target.value), f.maxAmount)
                      }
                      className="input text-xs py-1.5 flex-1 min-w-0"
                    />
                    <span className="text-muted text-xs">—</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="до"
                      value={f.maxAmount ?? ""}
                      onChange={(e) =>
                        f.setAmountRange(f.minAmount, e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="input text-xs py-1.5 flex-1 min-w-0"
                    />
                  </div>
                </div>

                <div className="space-y-0.5 pt-1 border-t border-border">
                  {[
                    { label: "Без переводов между счетами", checked: f.excludeTransfers, on: f.setExcludeTransfers },
                    { label: "Только без категории", checked: f.onlyUncategorized, on: f.setOnlyUncategorized },
                    { label: "Скрыть нулевые операции", checked: f.hideZero, on: f.setHideZero },
                    { label: "Только с комментарием", checked: f.onlyWithComment, on: f.setOnlyWithComment },
                    { label: "Только новые", checked: f.onlyNew, on: f.setOnlyNew },
                    // Only offered when the user actually HAS off-balance accounts
                    // (savings/brokerage) — otherwise the option would be a no-op.
                    ...(offBalanceAccounts.size > 0
                      ? [
                          {
                            label: "Без внебалансовых счетов",
                            checked: f.excludeOffBalance,
                            on: f.setExcludeOffBalance,
                          },
                        ]
                      : []),
                  ].map((row) => (
                    <label
                      key={row.label}
                      className="flex items-center justify-between gap-2 text-xs px-1.5 py-1.5 rounded hover:bg-panel2 cursor-pointer"
                    >
                      <span>{row.label}</span>
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(e) => row.on(e.target.checked)}
                        className="accent-accent shrink-0"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {
          <>
            {/* Date controls — set apart from the rest with dividers. */}
            <span className="w-px h-6 bg-border mx-1" />
            {/* Обёртка НЕ инертна: на ней висит подсказка, объясняющая, почему
                даты погашены. Инертен только внутренний слой — он убирает
                контролы и из мыши, и из обхода с клавиатуры, иначе по ним можно
                было бы протабиться и нажать. Событие наведения при этом
                проходит наверх, к обёртке, и подсказка показывается. */}
            <div
              className={clsx(
                "flex items-center gap-2 flex-1 min-w-[220px]",
                !showDateRange && "opacity-45"
              )}
              title={!showDateRange ? dateRangeHint : undefined}
              aria-disabled={!showDateRange || undefined}
            >
            <div
              className={clsx("contents", !showDateRange && "pointer-events-none")}
              inert={!showDateRange}
            >
            <div className="flex bg-panel2 rounded-lg p-0.5 border border-border shrink-0">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => periodCtl.setPreset(p.value)}
                  className={clsx(
                    // No weight change on active — keeps the control width stable.
                    "px-2 py-1 text-xs rounded-md transition-colors",
                    periodCtl.preset === p.value
                      ? "bg-accent text-accent-fg"
                      : "text-muted hover:text-text"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Month picker + custom range. Fully live for both the global
                filter store AND a page-local controlled period (Cash-flow,
                Trends) — picking a month/range switches the page's period. */}
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <MonthPicker
                value={currentMonthYM}
                minYM={dataRange.minYM}
                maxYM={dataRange.maxYM}
                active={periodCtl.preset === "month"}
                onSelect={(ym) => periodCtl.setMonth(ym)}
                onStep={(dir) => periodCtl.stepMonth(dir, dataRange.maxYM)}
              />

              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <DateField
                  value={periodCtl.from || ""}
                  onChange={(e) =>
                    periodCtl.setRange(e.target.value || null, periodCtl.to)
                  }
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1 min-w-0"
                />
                <span className="text-muted text-xs">—</span>
                <DateField
                  value={periodCtl.to || ""}
                  onChange={(e) =>
                    periodCtl.setRange(periodCtl.from, e.target.value || null)
                  }
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1 min-w-0"
                />
              </div>
            </div>

            </div>
            </div>
            <span className="w-px h-6 bg-border mx-1" />
          </>
        }

        <button
          onClick={f.reset}
          disabled={!hasFilters}
          title={hasFilters ? "Сбросить все фильтры" : "Фильтры не заданы"}
          aria-label="Сбросить все фильтры"
          // `ml-auto` pins it to the right edge of the row. When the inline date
          // controls are shown they already grow to fill the row (flex-1), so
          // this has no effect there and the reset stays next to the divider.
          className="btn-ghost text-xs py-1.5 px-2 shrink-0 ml-auto disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel2"
        >
          <FilterX className="w-4 h-4" />
        </button>

        {/* Break → row 2 with the data controls, filling the full width. */}
        <div className="basis-full h-0" />

        <MultiSelect
          className="w-52 shrink-0"
          label="Счета"
          options={accounts}
          selected={f.accounts}
          onChange={(s) => f.setSet("accounts", s)}
          renderIcon={(name) => <AccountLogo title={name} size={18} />}
          unitForms={["счёт", "счёта", "счетов"]}
          searchPlaceholder="Поиск счёта"
          archivedSet={archivedAccounts}
          groupOf={accountGroup}
        />

        <CategoryFilterPicker
          className="w-52 shrink-0"
          nodes={categoryNodes}
          selected={f.categories}
          onChange={(s) => f.setSet("categories", s)}
        />

        {currencies.length > 1 && (
          <MultiSelect
            className="w-52 shrink-0"
            menuMinWidth={0}
            label="Валюта"
            options={currencies}
            selected={f.currencies}
            onChange={(s) => f.setSet("currencies", s)}
            unitForms={["валюта", "валюты", "валют"]}
            renderIcon={(code) => {
              const flag = currencyFlagEmoji(code);
              return flag ? (
                <span className="text-base leading-none">{flag}</span>
              ) : (
                <Coins className="w-4 h-4 text-muted" />
              );
            }}
          />
        )}

        <div
          className="relative flex-1 min-w-[220px]"
          title="Фильтр по получателю и комментарию — входит в сохранённый фильтр и влияет на все виджеты"
        >
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-accent2/70 pointer-events-none" />
          <input
            value={f.search}
            onChange={(e) => f.setSearch(e.target.value)}
            placeholder="Фильтр: получатель, комментарий"
            className="input pl-9 pr-9 text-xs py-1.5"
          />
          {f.search && (
            <button
              onClick={() => f.setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
