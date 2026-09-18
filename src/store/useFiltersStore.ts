import { create } from "zustand";
import { useDisplayStore } from "./useDisplayStore";
import type { Transaction } from "../types";
import { currentPeriod, periodRange, shiftPeriod } from "../lib/period";
import { payeeSearchText } from "../lib/format";
import { hasCategory } from "../lib/operationTags";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { debtSelection, matchesDebtSelection } from "../lib/debtFilter";
import { MEMBER_SHARED } from "../lib/zenUsers";
import { useReportPeriodStore } from "./useReportPeriodStore";

/** Текущий отчётный месяц по действующему первому дню — не календарный. */
const currentYM = () => currentPeriod(useReportPeriodStore.getState().monthStartDay);

/**
 * «year» — КАЛЕНДАРНЫЙ год, который листается стрелками, а не «последние 12
 * месяцев»: «12m» — скользящее окно от сегодняшнего дня, и сравнивать по нему
 * год с годом нельзя. Якорь у обоих один — `monthYM`: у месяца берётся он сам,
 * у года — только его год. Так переключение «Месяц ↔ Год» оставляет человека
 * там же, где он был, а не бросает в текущую дату (issue #64).
 */
/**
 * «month» — КАЛЕНДАРНЫЙ месяц, с первого по последнее число.
 * «period» — ОТЧЁТНЫЙ месяц: тот же отрезок, что считают главная, бюджет и сам
 *   Дзен-мани, — с вашего первого дня месяца. Это значение по умолчанию.
 * «custom» — свои даты: то же, что «period», после того как границы поправили
 *   руками, поэтому в ряду кнопок оба состояния светятся как «Период».
 */
export type DatePreset =
  | "all"
  | "ytd"
  | "12m"
  | "6m"
  | "3m"
  | "30d"
  | "month"
  | "period"
  | "year"
  | "custom";

/**
 * Sentinel for the multi-select filters (accounts / categories / currencies).
 *
 * The set's meaning:
 *   • empty set          → ALL included (the default; forward-compatible, so a
 *     newly-synced account isn't accidentally hidden);
 *   • `{ FILTER_NONE }`  → NONE included (explicit «снять все» — show nothing);
 *   • any other subset   → only those values.
 *
 * Never collides with a real account/category/currency.
 */
export const FILTER_NONE = "\u0000__none__";

/** Множественные фильтры — те, что живут набором значений. */
export type SetFilter = "accounts" | "categories" | "currencies" | "users";

interface FiltersState {
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM: string | null;
  accounts: Set<string>;
  categories: Set<string>;
  currencies: Set<string>;
  /**
   * Чьи операции показывать на общем аккаунте (#92).
   *
   * Значения — номера участников строками плюс `MEMBER_SHARED` для операций на
   * общих счетах. Привязка идёт по `role` СЧЁТА, а не по «кто завёл»: в
   * Дзен-мани такого поля нет вовсе (см. `lib/zenUsers`).
   *
   * Пусто = все, как у остальных множественных фильтров. На личном аккаунте
   * человек этого фильтра не увидит: выбирать не из кого.
   */
  users: Set<string>;
  search: string;
  excludeTransfers: boolean;
  // «Дополнительно» filters — all default to a no-op (null / empty / false).
  minAmount: number | null;
  maxAmount: number | null;
  /**
   * Какие типы операций оставить: `income` | `expense` | `transfer` | `refund`.
   * Пусто — все.
   *
   * `expense` включает И возвраты: возврат гасит трату, и во всём сервисе это
   * одна величина. `refund` — отдельный, более узкий выбор: показать одни
   * возвраты. Выбранные вместе, они дают то же, что «Расходы» сами по себе.
   */
  types: Set<string>;
  onlyUncategorized: boolean;
  hideZero: boolean;
  onlyWithComment: boolean;
  /** Только «новые» — то, что приехало из банка и чего пользователь ещё не
   *  открывал (`viewed: false` в Дзен-мани). У операций из CSV признака нет. */
  onlyNew: boolean;
  /** Exclude operations whose account is off-balance (Zenmoney inBalance:false —
   *  savings/brokerage). Independent of the global «включить внебалансовые»
   *  toggle: this drops such flows from the analytics entirely. */
  excludeOffBalance: boolean;
  /** Titles of off-balance accounts — reference data loaded from the account
   *  cache (not a user choice), kept here so the pure `applyFilters` can honour
   *  `excludeOffBalance` without an account-metadata lookup. Preserved across
   *  `reset()` (it's data, not a filter value). */
  offBalanceAccounts: Set<string>;

  setPreset: (p: DatePreset) => void;
  /**
   * Задать период ЦЕЛИКОМ — все четыре поля разом.
   *
   * Нужно там, где период воспроизводится по сохранённому снимку: сохранённые
   * фильтры и палитра команд. Поштучные сеттеры для этого не годятся —
   * `setPreset` не трогает `from`/`to`, а `setRange` принудительно ставит
   * «Свои даты», так что применённый вид не совпадал сам с собой.
   */
  setPeriod: (p: {
    preset: DatePreset;
    from: string | null;
    to: string | null;
    monthYM: string | null;
  }) => void;
  setRange: (from: string | null, to: string | null) => void;
  /**
   * Каким месяцем человек пользуется — отчётным или календарным. Помним, даже
   * когда выбран другой период: иначе кнопка после «30 дней» забывала, что её
   * просили считать календарные месяцы, и возвращаться приходилось через меню.
   */
  setMonth: (ym: string) => void;
  /** Отчётный месяц целиком — кнопка «Период» в чистом виде. */
  setPeriodMonth: (ym: string) => void;
  setYear: (year: number) => void;
  /** Шагнуть на соседний период — единица берётся из пресета: месяц или год. */
  stepPeriod: (delta: number, fallbackMaxYM: string) => void;
  toggleSet: (kind: SetFilter, value: string) => void;
  /** Replace a multi-select set outright (used by «Выбрать все» / «Снять все»
   *  and the smart toggle that knows the full option list). */
  setSet: (kind: SetFilter, values: Set<string>) => void;
  resetSet: (kind: SetFilter) => void;
  setSearch: (s: string) => void;
  setExcludeTransfers: (v: boolean) => void;
  setAmountRange: (min: number | null, max: number | null) => void;
  toggleType: (kind: string) => void;
  setOnlyUncategorized: (v: boolean) => void;
  setHideZero: (v: boolean) => void;
  setOnlyWithComment: (v: boolean) => void;
  setOnlyNew: (v: boolean) => void;
  setExcludeOffBalance: (v: boolean) => void;
  setOffBalanceAccounts: (titles: Set<string>) => void;
  resetToCurrentPeriod: (startDay: number) => void;
  /**
   * Первый день отчётного месяца сменился — пришёл из Дзен-мани после запуска
   * или его поменяли в настройках. «Текущий месяц» в фильтре переносится на
   * новый отчётный период, но только если человек его не трогал: стоит
   * «Месяц» и ровно текущий период по прежнему дню. Пролистанный вручную
   * месяц и любые другие периоды остаются как были.
   */
  followStartDay: (prevDay: number, nextDay: number) => void;
  reset: () => void;
}

const initial = {
  // Default to the current period — most actions are about "what's
  // happening NOW", and 12-month view drowns the present. Отчётный, а не
  // календарный: так фильтр показывает тот же отрезок, что главная и бюджет.
  // Первый день приезжает позже (см. useReportPeriodStore), и период
  // пересчитывается в App.tsx, когда тот стор поднимется.
  preset: "period" as DatePreset,
  from: null,
  to: null,
  monthYM: currentPeriod(1) as string | null,
  accounts: new Set<string>(),
  categories: new Set<string>(),
  currencies: new Set<string>(),
  users: new Set<string>(),
  search: "",
  // Off by default — transfers are shown unless the user opts to hide them.
  excludeTransfers: false,
  minAmount: null as number | null,
  maxAmount: null as number | null,
  types: new Set<string>(),
  onlyUncategorized: false,
  hideZero: false,
  onlyWithComment: false,
  onlyNew: false,
  excludeOffBalance: false,
  offBalanceAccounts: new Set<string>(),
};

export const useFiltersStore = create<FiltersState>((set, get) => ({
  ...initial,
  // Пресет сам задаёт свой отрезок, поэтому произвольный диапазон при
  // переключении сбрасывается: иначе поля дат продолжали показывать даты
  // прошлого фильтра, хотя данные считались уже по пресету.
  setPreset: (preset) =>
    set(preset === "custom" ? { preset } : { preset, from: null, to: null }),
  setPeriod: ({ preset, from, to, monthYM }) => set({ preset, from, to, monthYM }),
  setRange: (from, to) => set({ from, to, preset: "custom" }),
  // Выбранный вид месяца запоминается в настройках: это привычка человека, а
  // не часть периода. Запись на диск фильтру не важна — если она не удалась
  // (приватное окно, тест без базы), период всё равно должен примениться.
  setMonth: (monthYM) => {
    void useDisplayStore.getState().setMonthKind("month").catch(() => {});
    set({ preset: "month", monthYM });
  },
  /** Отчётный месяц целиком — то же, что кнопка «Период» без правки дат. */
  setPeriodMonth: (monthYM) => {
    void useDisplayStore.getState().setMonthKind("period").catch(() => {});
    set({ preset: "period", monthYM, from: null, to: null });
  },
  // Месяц якоря сохраняем: вернувшись потом в «Месяц», попадаешь в тот же
  // месяц выбранного года, а не в январь.
  setYear: (year) =>
    set((s) => ({
      preset: "year",
      monthYM: `${year}-${(s.monthYM ?? currentYM()).slice(5, 7)}`,
    })),
  stepPeriod: (delta, fallbackMaxYM) => {
    const { preset, monthYM } = get();
    const unit = preset === "year" ? 12 : 1;
    const anchored = preset === "month" || preset === "year" || preset === "period";
    const cur = anchored && monthYM ? monthYM : fallbackMaxYM;
    // Шаг сохраняет единицу: годы листаются годами, отчётные месяцы —
    // отчётными, календарные — календарными.
    const next: DatePreset = preset === "year" ? "year" : preset === "period" ? "period" : "month";
    set({
      preset: next,
      monthYM: shiftPeriod(cur, delta * unit),
      ...(next === "period" ? { from: null, to: null } : null),
    });
  },
  toggleSet: (kind, value) =>
    set((s) => {
      const next = new Set(s[kind]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { [kind]: next } as Pick<FiltersState, typeof kind>;
    }),
  setSet: (kind, values) =>
    set(() => ({ [kind]: new Set(values) }) as Pick<FiltersState, typeof kind>),
  resetSet: (kind) =>
    set(() => ({ [kind]: new Set<string>() }) as Pick<FiltersState, typeof kind>),
  setSearch: (search) => set({ search }),
  setExcludeTransfers: (excludeTransfers) => set({ excludeTransfers }),
  setAmountRange: (minAmount, maxAmount) => set({ minAmount, maxAmount }),
  toggleType: (kind) =>
    set((s) => {
      const next = new Set(s.types);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return { types: next };
    }),
  setOnlyUncategorized: (onlyUncategorized) => set({ onlyUncategorized }),
  setHideZero: (hideZero) => set({ hideZero }),
  setOnlyWithComment: (onlyWithComment) => set({ onlyWithComment }),
  setOnlyNew: (onlyNew) => set({ onlyNew }),
  setExcludeOffBalance: (excludeOffBalance) => set({ excludeOffBalance }),
  setOffBalanceAccounts: (offBalanceAccounts) => set({ offBalanceAccounts }),
  // Текущий период — того вида, который человек выбрал последним: выбрав
  // календарный месяц, он и после перезагрузки должен увидеть календарный, а
  // не отчётный.
  resetToCurrentPeriod: (startDay) => {
    const calendar = useDisplayStore.getState().monthKind === "month";
    set({
      preset: calendar ? "month" : "period",
      monthYM: currentPeriod(calendar ? 1 : startDay),
      from: null,
      to: null,
    });
  },
  followStartDay: (prevDay, nextDay) => {
    if (prevDay === nextDay) return;
    const { preset, monthYM } = get();
    // Календарный месяц за днём не следует — он на то и календарный.
    if (preset !== "period" || monthYM !== currentPeriod(prevDay)) return;
    set({ monthYM: currentPeriod(nextDay) });
  },
  // Preserve the off-balance reference set — it's loaded data, not a filter the
  // user set, so a «сбросить» shouldn't wipe it (only the toggle resets to off).
  reset: () =>
    set((s) => ({
      ...initial,
      monthYM: currentYM(),
      offBalanceAccounts: s.offBalanceAccounts,
    })),
}));

export function presetToRange(
  preset: DatePreset,
  maxDate: string | null,
  monthYM?: string | null,
  monthStartDay: number = 1
): { from: string | null; to: string | null } {
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  if (preset === "month") {
    // КАЛЕНДАРНЫЙ месяц: с первого числа по последнее, чей бы ни был отчётный
    // день. Отчётный отрезок живёт под своим пресетом «period».
    if (!monthYM) return { from: null, to: null };
    return periodRange(monthYM, 1);
  }
  if (preset === "period") {
    if (!monthYM) return { from: null, to: null };
    return periodRange(monthYM, monthStartDay);
  }
  if (preset === "year") {
    // Год — КАЛЕНДАРНЫЙ, с 1 января по 31 декабря, как и «Месяц» рядом: кнопки
    // фильтра говорят о календаре, а свой отсчёт живёт под кнопкой «Период».
    const y = (monthYM ?? "").slice(0, 4);
    if (!y) return { from: null, to: null };
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const today = maxDate ? new Date(maxDate) : new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today);
  if (preset === "ytd") {
    from.setMonth(0, 1);
  } else if (preset === "12m") {
    from.setFullYear(from.getFullYear() - 1);
  } else if (preset === "6m") {
    from.setMonth(from.getMonth() - 6);
  } else if (preset === "3m") {
    from.setMonth(from.getMonth() - 3);
  } else if (preset === "30d") {
    from.setDate(from.getDate() - 30);
  }
  return { from: from.toISOString().slice(0, 10), to };
}

/**
 * Compute the date window for the current filter state.
 *
 * Pass `monthStartDay` when the caller respects the user's reporting
 * period setting (most analytics pages do). Default `1` keeps the old
 * calendar-month behaviour for callers that haven't been updated yet.
 */
export function applyFilters(
  txs: Transaction[],
  state: FiltersState,
  monthStartDay: number = 1,
  opts: {
    /**
     * От какой даты отсчитывать скользящие периоды («30 дней», «12 мес», «С
     * начала года»). По умолчанию — от последней операции в `txs`. Кто
     * фильтрует не ленту целиком, а её часть (удалённые операции), передаёт
     * последнюю дату ВСЕХ операций: иначе «30 дней» на этой странице
     * значили бы другие тридцать дней, чем на соседних.
     */
    maxDate?: string;
  } = {}
): Transaction[] {
  const maxDate = opts.maxDate ?? txs.reduce((m, t) => (t.date > m ? t.date : m), "");
  const range =
    state.preset === "custom"
      ? { from: state.from, to: state.to }
      : presetToRange(state.preset, maxDate, state.monthYM, monthStartDay);
  const search = state.search.trim().toLowerCase();
  // Пары «долговой счёт → контрагент» разбираем один раз на прогон, а не на
  // каждую операцию.
  const debtPicks = debtSelection(state.accounts);
  return txs.filter((t) => {
    // «Без переводов» прячет только настоящие переводы между своими счетами.
    // Долговые операции тоже kind=transfer, но это не перевод — оставляем их.
    if (state.excludeTransfers && t.kind === "transfer" && t.category !== "Долг")
      return false;
    if (range.from && t.date < range.from) return false;
    if (range.to && t.date > range.to) return false;
    // Empty set = all; `{FILTER_NONE}` = none; otherwise a subset.
    // For a TRANSFER `t.account` is only the SOURCE leg, so filtering by the
    // destination account used to hide the transfer entirely — a transfer
    // to/from the picked account must show up (issue #41). Single-leg ops keep
    // matching on `account` alone.
    if (state.accounts.size) {
      if (state.accounts.has(FILTER_NONE)) return false;
      const onPickedAccount =
        state.accounts.has(t.account) ||
        (t.kind === "transfer" &&
          (state.accounts.has(t.outcomeAccount) ||
            state.accounts.has(t.incomeAccount))) ||
        // Долговой счёт можно отобрать не целиком, а по конкретному человеку:
        // в Дзен-мани все долги лежат на одном счёте, и «все долги сразу» —
        // редко то, что нужно.
        matchesDebtSelection(t, debtPicks);
      if (!onPickedAccount) return false;
    }
    // The category filter holds leaf keys equal to `categoryFull`: a bare
    // category «Еда» (a transaction tagged with just the parent) or a full
    // «Еда / Кафе». Matching is STRICTLY by the full name — category and
    // sub-category are distinct in Zenmoney, so selecting a sub never pulls in
    // the parent's bare transactions, and vice-versa.
    //
    // ВТОРЫЕ КАТЕГОРИИ ТОЖЕ СЧИТАЮТСЯ (#69). «Отпуск», поставленный второй,
    // находит операцию так же, как в мобильном приложении Дзен-мани. Суммы по
    // категориям это не задваивает: там операция по-прежнему идёт под основной.
    if (state.categories.size) {
      if (state.categories.has(FILTER_NONE)) return false;
      let picked = false;
      for (const key of state.categories) {
        if (hasCategory(t, key)) {
          picked = true;
          break;
        }
      }
      if (!picked) return false;
    }
    if (state.currencies.size && (state.currencies.has(FILTER_NONE) || !state.currencies.has(t.currency)))
      return false;
    // Чьи операции. Операция на общем счёте не принадлежит никому — у неё
    // свой пункт «Общие»; операции из CSV пометки не имеют вовсе и попадают
    // туда же, других сведений о них нет.
    if (state.users.size) {
      if (state.users.has(FILTER_NONE)) return false;
      const key = t.member == null ? MEMBER_SHARED : String(t.member);
      if (!state.users.has(key)) return false;
    }
    if (search) {
      // Вторые категории — тоже: «Отпуск» ищется, даже если он всегда второй (#69).
      const hay = `${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${(t.extraCategories ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    // ── «Дополнительно» ──
    if (state.minAmount != null || state.maxAmount != null) {
      const amt = Math.abs(t.amountBase);
      if (state.minAmount != null && amt < state.minAmount) return false;
      if (state.maxAmount != null && amt > state.maxAmount) return false;
    }
    if (state.types.size) {
      // «Расходы» показывают траты ВМЕСТЕ с возвратами — так считает весь
      // сервис: возврат гасит трату, и расход без возвратов не сошёлся бы ни с
      // категориями, ни с бюджетом. А «Возвраты» — выбор поуже: только они.
      // Возврат было нечем отобрать вовсе, хотя в ленте он помечен своей
      // стрелкой: увидеть можно, а собрать вместе — нет.
      const ok =
        state.types.has(t.kind) ||
        (t.kind === "refund" && state.types.has("expense"));
      if (!ok) return false;
    }
    if (state.onlyUncategorized && t.category && t.category !== NO_CATEGORY)
      return false;
    if (state.hideZero && t.amountBase === 0) return false;
    if (state.onlyWithComment && !(t.comment && t.comment.trim())) return false;
    if (state.onlyNew && !t.unseen) return false;
    // Off-balance flows: drop the op if its account (or either transfer leg) is
    // an off-balance account (savings/brokerage). Belt-and-suspenders on the
    // legs so a transfer touching an off-balance account is excluded too.
    if (
      state.excludeOffBalance &&
      state.offBalanceAccounts.size > 0 &&
      (state.offBalanceAccounts.has(t.account) ||
        state.offBalanceAccounts.has(t.outcomeAccount) ||
        state.offBalanceAccounts.has(t.incomeAccount))
    )
      return false;
    return true;
  });
}
