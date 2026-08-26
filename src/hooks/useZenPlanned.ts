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
export function useZenPlanned(
  fromIso: string,
  toIso: string,
  /**
   * Прибавить ПРОСРОЧЕННЫЕ планы — те, что стоят раньше `fromIso` и никем не
   * исполнены (issue #87).
   *
   * Без них главная молчала о просроченном платеже и вдобавок писала «до конца
   * месяца планов нет», хотя планы были — просто в срок не уложились. Прогнозы
   * Дзена сюда не идут: устаревшая догадка — не то, с чем надо что-то делать,
   * и звать её просроченной было бы враньём. Тем же правилом живёт список
   * просроченных на «Регулярных».
   */
  withOverdue = false
): PlannedOp[] | null {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const rates = useDataStore((s) => s.rates);

  useEffect(() => {
    if (cache === undefined) void getZenCache();
  }, [cache]);

  return useMemo(() => {
    if (!cache) return cache === undefined ? [] : null;
    return plannedOps(cache, rates)
      .filter(
        (p) =>
          p.date <= toIso && (p.date >= fromIso || (withOverdue && !p.forecast))
      )
      // По дате: просроченные старше всех, поэтому они и встают первыми — там,
      // где на них смотрят.
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [cache, rates, fromIso, toIso, withOverdue]);
}
