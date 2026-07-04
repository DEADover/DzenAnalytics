import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Search,
  X,
  ChevronDown,
  FilterX,
  Filter,
  SlidersHorizontal,
  Coins,
} from "lucide-react";
import { DateField } from "./DateField";
import { AccountLogo } from "./AccountLogo";
import { CategoryFilterPicker } from "./CategoryFilterPicker";
import { MonthPicker } from "./MonthPicker";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { useFiltersStore, FILTER_NONE, type DatePreset } from "../store/useFiltersStore";
import type { PeriodController } from "../hooks/useLocalPeriod";
import { FiltersMenu } from "./FiltersMenu";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { currencyFlagEmoji } from "../lib/currencyFlag";
import { pluralRu } from "../lib/plural";

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

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  renderIcon,
  unitForms,
  searchPlaceholder,
  archivedSet,
  className,
  menuMinWidth,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional leading icon per option (e.g. account logo / category dot). */
  renderIcon?: (opt: string) => ReactNode;
  /** Russian [one, few, many] noun for the count header (e.g. счёт/счёта/счетов). */
  unitForms?: [string, string, string];
  /** Override the search placeholder. */
  searchPlaceholder?: string;
  /** Options in this set are «archived» — rendered below an «Архивные»
   *  divider (the caller must place them last in `options`). */
  archivedSet?: Set<string>;
  /** Extra classes for the outer wrapper (e.g. `flex-1` to fill a row). */
  className?: string;
  /** Minimum dropdown width in px. Default 288; pass 0 to match the button. */
  menuMinWidth?: number;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Search appears only for longer lists (currency etc. don't need it).
  const showSearch = options.length > 8;
  const q = query.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;

  // Set semantics: empty = ALL, {FILTER_NONE} = NONE, else a subset.
  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const isChecked = (opt: string) => isAll || (!isNone && selected.has(opt));

  // Toggle one option, normalising the result back to the canonical empty
  // set (all) or the {FILTER_NONE} marker (none).
  const toggle = (opt: string) => {
    const eff = isNone
      ? new Set<string>()
      : isAll
        ? new Set(options)
        : new Set(selected);
    eff.delete(FILTER_NONE);
    if (eff.has(opt)) eff.delete(opt);
    else eff.add(opt);
    if (eff.size >= options.length) onChange(new Set()); // all → empty
    else if (eff.size === 0) onChange(new Set([FILTER_NONE])); // none
    else onChange(eff);
  };

  const summary = isNone
    ? "Ничего"
    : isAll
      ? `Все (${options.length})`
      : `${selected.size} из ${options.length}`;

  // The menu renders in a portal (position: fixed) so it floats above the
  // table below — `absolute` left it under a later stacking context. Its
  // left edge lines up with the button; it flips up if there's more room
  // above (and the menu fits there).
  type MenuPos = {
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const MENU_W = menuMinWidth ?? 288;

  useLayoutEffect(() => {
    const el = btnRef.current;
    let next: MenuPos | null = null;
    if (open && el) {
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, MENU_W);
      const estH = Math.min(options.length * 32 + 44 + (showSearch ? 40 : 0), 360);
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      next = flipUp
        ? {
            left: r.left,
            width,
            bottom: window.innerHeight - r.top + 4,
            maxHeight: Math.min(estH, above),
          }
        : {
            left: r.left,
            width,
            top: r.bottom + 4,
            maxHeight: Math.min(estH, below),
          };
    }
    setPos(next);
  }, [open, options.length, showSearch]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={clsx(
          "btn-ghost text-xs py-1.5 h-[30px] w-full justify-between",
          selected.size > 0 && "border-accent text-accent"
        )}
      >
        <span className="truncate max-w-[180px]">
          {label}: {summary}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-[80] overflow-auto card p-2"
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
              }}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1 mb-1 border-b border-border/60">
                <span className="text-xs text-muted">
                  {options.length}{" "}
                  {pluralRu(
                    options.length,
                    unitForms ?? ["вариант", "варианта", "вариантов"]
                  )}
                </span>
                <button
                  onClick={() => onChange(isAll ? new Set([FILTER_NONE]) : new Set())}
                  className="text-xs text-accent hover:underline"
                >
                  {isAll ? "Снять все" : "Выбрать все"}
                </button>
              </div>
              {showSearch && (
                <div className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-border/60">
                  <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder ?? `Поиск: ${label.toLowerCase()}`}
                    className="bg-transparent text-xs w-full outline-none"
                  />
                </div>
              )}
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filteredOptions.map((opt, i) => {
                  // First archived option → render an «Архивные» divider above it.
                  const showArchivedHeader =
                    !!archivedSet?.has(opt) &&
                    (i === 0 || !archivedSet.has(filteredOptions[i - 1]));
                  return (
                    <Fragment key={opt}>
                      {showArchivedHeader && (
                        <div className="mt-1 pt-1 border-t border-border px-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted">
                          Архивные
                        </div>
                      )}
                      <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 rounded cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={isChecked(opt)}
                          onChange={() => toggle(opt)}
                          className="accent-accent shrink-0"
                        />
                        {renderIcon && (
                          <span className="shrink-0">{renderIcon(opt)}</span>
                        )}
                        <span className="truncate">{opt}</span>
                      </label>
                    </Fragment>
                  );
                })
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export function GlobalFilters({
  showDateRange = true,
  period,
}: {
  showDateRange?: boolean;
  /** Controlled period — when provided, ALL period controls (presets, month
   *  picker, custom range) drive this page-local controller instead of the
   *  global filter store, without touching the global «месяц». Used by history
   *  charts (Cash-flow, Trends). See `useLocalPeriod`. */
  period?: PeriodController;
} = {}) {
  const transactions = useDataStore((s) => s.transactions);
  const f = useFiltersStore();
  const controlledPeriod = period !== undefined;
  // Period slice source: the local controller when controlled, else the store.
  // Both expose the same fields/handlers (preset/monthYM/from/to + setters).
  const periodCtl: PeriodController = controlledPeriod ? period : f;
  const [additionalOpen, setAdditionalOpen] = useState(false);

  // Archived (closed) account titles from the Zenmoney cache — used to sort the
  // archived accounts to the bottom of the filter and group them under a divider.
  const [archivedAccounts, setArchivedAccounts] = useState<Set<string>>(new Set());
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
    // Active accounts first (alpha), archived grouped at the bottom (alpha).
    return Array.from(set).sort((a, b) => {
      const aa = archivedAccounts.has(a);
      const ba = archivedAccounts.has(b);
      if (aa !== ba) return aa ? 1 : -1;
      return a.localeCompare(b, "ru");
    });
  }, [transactions, archivedAccounts]);

  // Parent categories each with their observed sub-categories — for the cascade
  // category filter (parent on the left, subs on the right).
  const categoryNodes = useMemo(() => {
    const map = new Map<string, { subs: Set<string>; hasBare: boolean }>();
    for (const t of transactions) {
      if (!t.category) continue;
      let e = map.get(t.category);
      if (!e) {
        e = { subs: new Set<string>(), hasBare: false };
        map.set(t.category, e);
      }
      // A transaction tagged with just the parent (no sub) is "bare" — a
      // distinct leaf from any «Category / Subcategory».
      if (t.subcategory) e.subs.add(t.subcategory);
      else e.hasBare = true;
    }
    const real = [...map.entries()]
      .filter(([name]) => name !== NO_CATEGORY)
      .map(([name, e]) => ({
        name,
        hasBare: e.hasBare,
        subs: [...e.subs].sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // Pin «Без категории» first (mirrors the edit-modal picker) so the
    // uncategorized leaf is always an obvious, selectable filter — handy for
    // hunting down operations that still need a category.
    return [{ name: NO_CATEGORY, hasBare: true, subs: [] }, ...real];
  }, [transactions]);

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
    f.excludeOffBalance;
  const extraCount =
    (f.excludeTransfers ? 1 : 0) +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.types.size > 0 ? 1 : 0) +
    (f.onlyUncategorized ? 1 : 0) +
    (f.hideZero ? 1 : 0) +
    (f.onlyWithComment ? 1 : 0) +
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
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Сумма, ₽</div>
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

        {showDateRange && (
          <>
            {/* Date controls — set apart from the rest with dividers. */}
            <span className="w-px h-6 bg-border mx-1" />
            <div className="flex bg-panel2 rounded-lg p-0.5 border border-border">
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

            <span className="w-px h-6 bg-border mx-1" />
          </>
        )}

        <button
          onClick={f.reset}
          disabled={!hasFilters}
          title={hasFilters ? "Сбросить все фильтры" : "Фильтры не заданы"}
          aria-label="Сбросить все фильтры"
          className="btn-ghost text-xs py-1.5 px-2 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel2"
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
