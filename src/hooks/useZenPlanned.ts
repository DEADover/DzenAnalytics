/**
 * Планы Дзен-мани для главной.
 *
 * Дзен-мани держит свои запланированные операции сам: то, что человек поставил
 * на дату руками, и то, что Дзен-мани спрогнозировал по регулярному платежу.
 * Они приезжают в том же кэше, что и операции, — отдельная синхронизация не
 * нужна.
 *
 * Это не то же самое, что «Запланированные операции» по умолчанию: там
 * DzenAnalytics сам вычисляет регулярные платежи по истории операций. Два
 * ответа на один вопрос, и виджет даёт выбрать, чей показывать.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getZenCache, peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import { plannedOps, type PlannedOp } from "../lib/plannedOps";
import { useDataStore } from "../store/useDataStore";

/**
 * Планы Дзен-мани на отрезке от сегодня до конца периода.
 *
 * `null` — кэша нет вовсе: человек работает на CSV или ещё не синхронизировался.
 */
export function useZenPlanned(fromIso: string, toIso: string): PlannedOp[] | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);

  useEffect(() => {
    if (cache === undefined) void getZenCache();
  }, [cache]);

  return useMemo(() => {
    if (!cache) return cache === undefined ? [] : null;
    return plannedOps(cache, rates)
      .filter((p) => p.date >= fromIso && p.date <= toIso)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [cache, rates, fromIso, toIso]);
}
