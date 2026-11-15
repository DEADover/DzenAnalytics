/**
 * Разбор выбранного месяца (#130): какие счета идут в капитал при заданных
 * фильтрах и как план бюджета сопоставляется с фактом.
 */

import { parseDebtKey } from "./debtFilter";
import { MEMBER_SHARED } from "./zenUsers";

/** Метка «ничего не выбрано» у множественных фильтров (см. `useFiltersStore`). */
const NONE = "\u0000__none__";

export interface CapitalAccount {
  key: string;
  /** Чей счёт: номер участника или `null` — общий. */
  member: number | null;
}

/**
 * Счета, по которым считать капитал.
 *
 * `null` — фильтры счета не сужают: берётся обычный набор «в балансе».
 * Отмеченные в фильтре счета идут как есть, даже если они вне баланса: человек
 * выбрал их сам. Фильтр «Чьи операции» оставляет счета этих участников.
 */
export function capitalAccountKeys(input: {
  /** Все счета из Дзен-мани. */
  accounts: readonly CapitalAccount[];
  /** Счета, которые входят в совокупный баланс по настройкам. */
  universe: ReadonlySet<string>;
  pickedAccounts: ReadonlySet<string>;
  pickedUsers: ReadonlySet<string>;
}): string[] | null {
  const { accounts, universe, pickedAccounts, pickedUsers } = input;
  if (pickedAccounts.size === 0 && pickedUsers.size === 0) return null;
  if (pickedAccounts.has(NONE) || pickedUsers.has(NONE)) return [];

  // Долг, отобранный по человеку, — это весь долговой счёт: остатка «по
  // одному контрагенту» у счёта нет.
  const picked = new Set<string>();
  for (const key of pickedAccounts) picked.add(parseDebtKey(key)?.account ?? key);

  const out: string[] = [];
  for (const a of accounts) {
    if (picked.size ? !picked.has(a.key) : !universe.has(a.key)) continue;
    if (pickedUsers.size) {
      const who = a.member == null ? MEMBER_SHARED : String(a.member);
      if (!pickedUsers.has(who)) continue;
    }
    out.push(a.key);
  }
  return out;
}

export interface PlanFactRow {
  plan: number;
  fact: number;
  /** Факт к плану; `null`, когда плана нет. */
  ratio: number | null;
  /** План минус факт: у расхода — сколько осталось, у дохода — сколько недобрали. */
  left: number;
}

/** Строка «план и факт»; `null` — плана на месяц нет. */
export function planFactRow(plan: number, fact: number): PlanFactRow | null {
  if (!(plan > 0)) return null;
  return { plan, fact, ratio: fact / plan, left: plan - fact };
}
