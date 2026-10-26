import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getZenCache, peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import {
  buildZenPlanRules,
  openingBalance,
  zenPlanSettings,
  type ZenPlanRules,
} from "../lib/zenPlanRules";
import { useDataStore } from "../store/useDataStore";
import { accountKeyOf } from "../lib/accountKey";

/**
 * Правила «Планов» Дзен-мани для бюджета — из кэша: настройки пользователя,
 * счета и справочник категорий. `undefined` — подключения нет (CSV, демо без
 * кэша) или кэш ещё не прочитан: бюджет тогда считает по-своему, как раньше.
 */
export function useZenPlanRules(): ZenPlanRules | undefined {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  useEffect(() => {
    if (cache === undefined) void getZenCache();
  }, [cache]);
  return useMemo(() => {
    if (!cache || !cache.user?.length) return undefined;
    const byId = new Map((cache.tags ?? []).map((t) => [t.id, t]));
    const categories = (cache.tags ?? []).map((t) => {
      const parent = t.parent ? byId.get(t.parent) : undefined;
      return {
        key: parent ? `${parent.title} / ${t.title}` : t.title,
        showIncome: !!t.showIncome,
        showOutcome: !!t.showOutcome,
      };
    });
    // Архивные счета тоже: перевод на закрытый вклад в прошлом месяце — тот
    // же перевод в накопления, и в периметр счёт входит по своему признаку.
    return buildZenPlanRules(
      (cache.accounts ?? []).map((a) => ({ ...a, key: accountKeyOf(a) })),
      zenPlanSettings(cache.user[0]),
      categories
    );
  }, [cache]);
}

/**
 * Входящий баланс периода — остаток на счетах «в балансе» к его первому дню,
 * в базовой валюте. `null` — строку не показываем: правила её не просят, нет
 * подключения или период ещё не начался (входящий баланс будущего месяца
 * неизвестен).
 */
function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function useZenOpeningBalance(
  rules: ZenPlanRules | undefined | null,
  fromIso: string,
  todayIso: string,
  /** Считать и счета вне баланса (настройка бюджета). */
  includeOffBalance = false
): number | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);
  const histDayRates = useDataStore((s) => s.histDayRates);
  const requestRateDates = useDataStore((s) => s.requestRateDates);
  // Курс накануне периода в прогреве может не оказаться — попросим его.
  useEffect(() => {
    if (rules?.openingBalance && fromIso <= todayIso) requestRateDates([shiftDay(fromIso, -1)]);
  }, [rules, fromIso, todayIso, requestRateDates]);
  return useMemo(() => {
    if (!rules?.openingBalance || !cache || fromIso > todayIso) return null;
    const code = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
    // Остаток валютного счёта — по курсу дня НАКАНУНЕ периода: это остаток на
    // конец предыдущего дня, и приложение оценивает его тем днём (сверено:
    // по курсу 1-го выходило на 1 173 ₽ меньше). Нет курса — по текущему.
    const dayBefore = shiftDay(fromIso, -1);
    const toBase = (amount: number, instrument: number) => {
      const cur = code.get(instrument);
      if (!cur || cur === rates.base) return amount;
      const r = rates.base === "RUB" ? histDayRates[dayBefore]?.[cur] : undefined;
      return amount * (r ?? rates.rates[cur] ?? 1);
    };
    return openingBalance(withOffBalance(cache.accounts, includeOffBalance), cache.transactions, fromIso, toBase);
  }, [rules, cache, fromIso, todayIso, rates, histDayRates, includeOffBalance]);
}

/**
 * Остаток на счетах «в балансе» сейчас, в базовой валюте, — отправная точка
 * прогноза входящего баланса будущих месяцев. `null` — правила его не просят
 * или подключения нет.
 */
export function useZenBalanceNow(
  rules: ZenPlanRules | undefined | null,
  /** Считать и счета вне баланса (настройка бюджета). */
  includeOffBalance = false
): number | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);
  return useMemo(() => {
    if (!rules?.openingBalance || !cache) return null;
    const code = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
    let sum = 0;
    for (const a of cache.accounts) {
      if (!a.inBalance && !includeOffBalance) continue;
      const cur = code.get(a.instrument);
      sum += !cur || cur === rates.base ? a.balance : a.balance * (rates.rates[cur] ?? 1);
    }
    return sum;
  }, [rules, cache, rates, includeOffBalance]);
}

/**
 * Остатки на счетах «в балансе» — на начало периода и сейчас, ОБА по
 * сегодняшнему курсу. Из них Дзен-мани считает «Свободно / Не хватает до конца
 * месяца»: изменение остатков за период (плюс входящий баланс, если так в
 * настройках «Планов») + «ещё поступит» − «ещё в планах». Один курс на оба
 * конца — так в приложении: сверено на живом аккаунте до рубля (−108 ₽), а с
 * курсом начала периода переоценка долларового счёта давала −3 817 ₽.
 * `null` — подключения нет или период ещё не начался.
 */
export function useZenBalanceSpan(
  fromIso: string,
  todayIso: string,
  /** Считать и счета вне баланса (настройка бюджета). */
  includeOffBalance = false
): { start: number; now: number } | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);
  return useMemo(() => {
    if (!cache || fromIso > todayIso) return null;
    const code = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
    const toBase = (amount: number, instrument: number) => {
      const cur = code.get(instrument);
      if (!cur || cur === rates.base) return amount;
      return amount * (rates.rates[cur] ?? 1);
    };
    const accounts = withOffBalance(cache.accounts, includeOffBalance);
    let now = 0;
    for (const a of accounts) if (a.inBalance) now += toBase(a.balance, a.instrument);
    return { start: openingBalance(accounts, cache.transactions, fromIso, toBase), now };
  }, [cache, fromIso, todayIso, rates, includeOffBalance]);
}

/** Счета «как в балансе» все разом — когда бюджет считает и счета вне баланса. */
function withOffBalance<T extends { inBalance: boolean }>(accounts: T[], include: boolean): T[] {
  return include ? accounts.map((a) => (a.inBalance ? a : { ...a, inBalance: true })) : accounts;
}
