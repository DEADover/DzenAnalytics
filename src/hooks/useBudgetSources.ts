import { useEffect, useMemo, useState } from "react";
import type { BudgetMonthSources } from "../lib/budgetMonth";
import { plannedOps, type PlannedOp } from "../lib/plannedOps";
import { plannedPlans } from "../lib/plannedPlans";
import { loadZenCache } from "../lib/zenmoneyCache";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { getZenForecastsFromCache } from "../store/useZenmoneyStore";
import { useBudgetScope } from "./useBudgetScope";
import { useLiveCategoryPaths } from "./useDictionaries";

/**
 * Всё, из чего считается бюджет месяца (`lib/budgetMonth`), — один набор на
 * раздел «Бюджеты» и «Отчёт за период», чтобы их итоги совпадали.
 *
 * `enabled = false` — ничего не читаем из кэша (отчёт закрыт).
 */
export function useBudgetSources(enabled = true) {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const histDayRates = useDataStore((s) => s.histDayRates);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const lines = useBudgetsStore((s) => s.lines);
  const rowOrder = useBudgetSettingsStore((s) => s.rowOrder);
  // Периметр и правила «Планов» Дзен-мани.
  const { scope, zenRules } = useBudgetScope();
  // Живые категории — чтобы статьи с именем, которого в справочнике больше
  // нет, не висели в бюджете (#77). Без подключения — `null`.
  const livePaths = useLiveCategoryPaths();

  // Прогнозы самого Дзен-мани («из X»). `zenLoaded` отличает «ещё не прочитано»
  // от «без подключения» (тогда своя медиана).
  const [zenForecasts, setZenForecasts] = useState<Map<string, number> | null>(null);
  const [zenLoaded, setZenLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getZenForecastsFromCache().then((m) => {
      if (!alive) return;
      setZenForecasts(m);
      setZenLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, transactions]);

  // Назначенные операции Дзен-мани: ещё не исполненные — для графика и «Ещё в
  // планах», вместе с исполненными — для плана статей без своего плана (у
  // Дзен-мани их план — все плановые операции месяца).
  const [zenPlanned, setZenPlanned] = useState<PlannedOp[]>([]);
  const [zenPlannedAll, setZenPlannedAll] = useState<PlannedOp[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadZenCache().then((c) => {
      if (!alive) return;
      setZenPlanned(plannedOps(c, rates));
      setZenPlannedAll(plannedOps(c, rates, { withProcessed: true, histRate: (d, code) => histDayRates[d]?.[code] ?? null }));
    });
    return () => {
      alive = false;
    };
  }, [enabled, transactions, rates, histDayRates]);

  // План из назначенных операций. Строки групп переводов («Кредиты и
  // кредитки», «Накопления»…) плана не получают — в приложении у них только
  // «Платежи на …».
  const plannedAsPlan = useMemo(
    () => plannedPlans(zenPlannedAll, scope, undefined, monthStartDay, !!zenRules?.forecasts).filter((p) => !p.planGroup),
    [zenPlannedAll, scope, monthStartDay, zenRules]
  );

  const sources = useMemo<BudgetMonthSources>(
    () => ({ lines, transactions, monthStartDay, zenForecasts, zenLoaded, zenRules, plannedAsPlan, livePaths, rowOrder }),
    [lines, transactions, monthStartDay, zenForecasts, zenLoaded, zenRules, plannedAsPlan, livePaths, rowOrder]
  );

  return { sources, scope, zenRules, zenPlanned, zenPlannedAll, plannedAsPlan, livePaths };
}
