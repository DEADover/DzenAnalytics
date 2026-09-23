import type { CurrencyRates } from "../types";

/**
 * Прогресс цели по нескольким счетам (#103).
 *
 * Цель копится не обязательно на одном счёте: подушка лежит частью на вкладе,
 * частью на накопительном, частью в долларах. Прогресс — сумма их балансов в
 * базовой валюте по ТЕКУЩЕМУ курсу ЦБ: цель про то, сколько денег есть сейчас,
 * а не про курс, по которому их когда-то положили.
 */

/** То, что цели нужно знать о счёте. */
export interface GoalAccount {
  title: string;
  balance: number;
  currency: string;
  savings: boolean;
}

/** Курсы ЦБ на сегодня: сколько рублей за единицу валюты. */
export type RubRates = Record<string, number>;

/**
 * Счета-источники цели.
 *
 * Раньше цель знала один счёт (`accountTitle`), теперь — список
 * (`accountTitles`). Старые цели, в том числе пришедшие с устройства на
 * прежней версии, читаются как список из одного счёта.
 */
export function goalSources(g: {
  accountTitles?: readonly string[] | null;
  accountTitle?: string | null;
}): string[] {
  if (g.accountTitles && g.accountTitles.length > 0) return [...new Set(g.accountTitles)];
  return g.accountTitle ? [g.accountTitle] : [];
}

/**
 * Сумма в базовой валюте по курсу ЦБ на сегодня.
 *
 * ЦБ котирует всё к рублю, поэтому для нерублёвой базы курс перекрёстный:
 * валюта → рубли → база. Если ЦБ валюту не знает или курсы ещё не пришли,
 * берём курсы из настроек сервиса — лучше приблизительная сумма, чем пустая.
 */
export function toBaseNow(
  amount: number,
  currency: string,
  rates: CurrencyRates,
  cbr: RubRates
): number {
  if (currency === rates.base) return amount;
  const rub = (c: string) => (c === "RUB" ? 1 : cbr[c]);
  const from = rub(currency);
  const to = rub(rates.base);
  if (from != null && to != null && to > 0) return (amount * from) / to;
  const fallback = rates.rates[currency];
  return fallback ? amount * fallback : amount;
}

/** Один источник в прогрессе цели. */
export interface GoalSourceBalance {
  title: string;
  /** Баланс в валюте счёта; `null` — счёта больше нет. */
  balance: number | null;
  currency: string | null;
  /** Баланс в базовой валюте; у пропавшего счёта 0. */
  balanceBase: number;
}

export interface GoalProgress {
  /** Накоплено: сумма источников или введённое вручную. */
  current: number;
  sources: GoalSourceBalance[];
  /** Прогресс берётся со счетов, а не из ручного поля. */
  bound: boolean;
  /** Каких счетов не нашлось — переименованы, в архиве или удалены. */
  missing: string[];
}

/**
 * Накопленное по цели.
 *
 * Пропавший счёт не обнуляет цель: складываем те, что нашлись. Если не
 * нашлось ни одного — берём ручную сумму, чтобы цель не читалась пустой.
 */
export function goalProgress(
  g: { accountTitles?: readonly string[] | null; accountTitle?: string | null; current: number },
  accounts: readonly GoalAccount[],
  rates: CurrencyRates,
  cbr: RubRates
): GoalProgress {
  const titles = goalSources(g);
  if (titles.length === 0) return { current: g.current, sources: [], bound: false, missing: [] };

  const byTitle = new Map(accounts.map((a) => [a.title, a]));
  const sources: GoalSourceBalance[] = titles.map((title) => {
    const a = byTitle.get(title);
    return a
      ? {
          title,
          balance: a.balance,
          currency: a.currency,
          balanceBase: toBaseNow(a.balance, a.currency, rates, cbr),
        }
      : { title, balance: null, currency: null, balanceBase: 0 };
  });
  const missing = sources.filter((s) => s.balance == null).map((s) => s.title);
  if (missing.length === titles.length) {
    return { current: g.current, sources, bound: false, missing };
  }
  const current = sources.reduce((sum, s) => sum + s.balanceBase, 0);
  return { current, sources, bound: true, missing };
}

/** Валюты, для которых нужен курс ЦБ: валюты счетов и сама база. */
export function currenciesToQuote(
  accounts: readonly GoalAccount[],
  base: string
): string[] {
  const set = new Set(accounts.map((a) => a.currency));
  set.add(base);
  set.delete("RUB");
  return [...set].sort();
}
