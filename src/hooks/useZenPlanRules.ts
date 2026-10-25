import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getZenCache, peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import {
  buildZenPlanRules,
  openingBalance,
  zenPlanSettings,
  type ZenPlanRules,
} from "../lib/zenPlanRules";
import { useDataStore } from "../store/useDataStore";

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
      cache.accounts ?? [],
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
  todayIso: string
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
    return openingBalance(cache.accounts, cache.transactions, fromIso, toBase);
  }, [rules, cache, fromIso, todayIso, rates, histDayRates]);
}

/**
 * Остаток на счетах «в балансе» сейчас, в базовой валюте, — отправная точка
 * прогноза входящего баланса будущих месяцев. `null` — правила его не просят
 * или подключения нет.
 */
export function useZenBalanceNow(rules: ZenPlanRules | undefined | null): number | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);
  return useMemo(() => {
    if (!rules?.openingBalance || !cache) return null;
    const code = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
    let sum = 0;
    for (const a of cache.accounts) {
      if (!a.inBalance) continue;
      const cur = code.get(a.instrument);
      sum += !cur || cur === rates.base ? a.balance : a.balance * (rates.rates[cur] ?? 1);
    }
    return sum;
  }, [rules, cache, rates]);
}
