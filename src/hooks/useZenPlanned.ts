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
import { plannedOps, ownPlannedOps, type PlannedOp } from "../lib/plannedOps";

import { useMembersStore } from "../store/useMembersStore";
import { useDataStore } from "../store/useDataStore";
import { usePlanActionsStore } from "../store/usePlanActionsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { applyPlanActions } from "../lib/planActions";
import type { ZenCache } from "../lib/zenmoneyCache";

/**
 * Кэш Дзен-мани с наложенной очередью действий над планами (факт, связь,
 * правка): закрытая фактом дата пропадает из запланированных сразу, а не
 * после отправки. `undefined`/`null` — как у `peekZenCache`.
 */
export function usePlannedCache(): ZenCache | null | undefined {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const actions = usePlanActionsStore((s) => s.actions);
  const drafts = useDraftsStore((s) => s.drafts);
  useEffect(() => {
    if (cache === undefined) void getZenCache();
  }, [cache]);
  return useMemo(() => {
    if (!cache) return cache;
    // Факт или связь, чью операцию уже удалили, план не закрывают: иначе дата пропала
    // бы до следующей отправки, хотя закрывать её больше нечем.
    const live = new Set(cache.transactions.filter((t) => !t.deleted).map((t) => String(t.id)));
    const list = Object.values(actions).filter(
      (a) =>
        a.kind === "edit" ||
        a.kind === "create" ||
        drafts[a.txId] !== undefined ||
        live.has(a.txId)
    );
    if (list.length === 0) return cache;
    const instrument = new Map(cache.accounts.map((a) => [a.id, a.instrument]));
    const o = applyPlanActions(
      cache.reminderMarkers ?? [],
      cache.reminders ?? [],
      list,
      (id) => instrument.get(id)
    );
    return { ...cache, reminderMarkers: o.markers, reminders: o.reminders };
  }, [cache, actions, drafts]);
}

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
  const cache = usePlannedCache();
  const rates = useDataStore((s) => s.rates);
  const ownerId = useMembersStore((s) => s.ownerId);

  return useMemo(() => {
    if (!cache) return cache === undefined ? [] : null;
    // Только свои: на общем аккаунте по одному токену приезжают планы всех
    // подключённых людей, а мобильное приложение чужие не показывает (#92).
    // Прячем только по ЯВНОМУ выбору участника: угадать владельца токена по
    // ответу API нельзя, а ошибка спрятала бы свои планы и показала чужие.
    return ownPlannedOps(plannedOps(cache, rates), ownerId)
      .filter(
        (p) =>
          p.date <= toIso && (p.date >= fromIso || (withOverdue && !p.forecast))
      )
      // По дате: просроченные старше всех, поэтому они и встают первыми — там,
      // где на них смотрят.
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [cache, rates, fromIso, toIso, withOverdue, ownerId]);
}
