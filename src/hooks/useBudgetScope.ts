import { useEffect, useMemo } from "react";
import type { BudgetScope } from "../lib/budgetScope";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";
import { useAccountDirectory } from "./useAccountDirectory";
import { useOffBalanceExcluded } from "./useInBalanceTransactions";
import { useZenPlanRules } from "./useZenPlanRules";

/**
 * Периметр бюджета — какие счета и переводы считаются в факт — и правила
 * «Планов» Дзен-мани с поправкой на настройки бюджета.
 *
 * Один на раздел «Бюджеты» и «Отчёт за период»: факт бюджета в отчёте обязан
 * совпадать с разделом, а периметр собирается из трёх сторов и настроек, и
 * копия этой сборки разошлась бы с оригиналом при первой же правке.
 */
export function useBudgetScope() {
  const settings = useBudgetSettingsStore();
  const settingsLoaded = settings.loaded;
  const hydrateSettings = settings.hydrate;
  useEffect(() => {
    if (!settingsLoaded) hydrateSettings();
  }, [settingsLoaded, hydrateSettings]);

  // «Все счета» — все, кроме счетов вне баланса, пока они не считаются: то же
  // правило, что во всех итогах сервиса, и так же считает сам Дзен-мани.
  const offBalanceExcluded = useOffBalanceExcluded();
  // Правила «Планов» Дзен-мани: какие переводы идут в бюджет, вычитать ли
  // возвраты, показывать ли входящий баланс — по настройкам самого
  // пользователя в приложении (см. `zenPlanRules`).
  const zenRulesRaw = useZenPlanRules();
  const accountDir = useAccountDirectory();
  // «Счета вне баланса» в настройках бюджета: такие счета считаются, как будто
  // они в балансе, — их траты и поступления идут в факт, переводы между ними и
  // остальными — внутренние, а не строки «Накопления» / «На кредиты». Только в
  // бюджете: остальные итоги решает настройка в «Расчётах».
  const includeOff = settings.includeOffBalance;
  const zenRules = useMemo(() => {
    if (!includeOff || !zenRulesRaw) return zenRulesRaw;
    const inside = new Set(zenRulesRaw.inside);
    for (const e of accountDir.list) if (e.live) inside.add(e.key);
    return { ...zenRulesRaw, inside };
  }, [zenRulesRaw, includeOff, accountDir]);
  const scope = useMemo<BudgetScope>(
    () => ({
      // Счета периметра запоминались названиями — старая запись значит все
      // счета с этим названием.
      accounts: accountDir.resolve(settings.accounts),
      excluded: includeOff ? undefined : offBalanceExcluded,
      perimeterTransfers: settings.perimeterTransfers,
      zen: zenRules,
      labelOf: accountDir.label,
    }),
    [settings.accounts, settings.perimeterTransfers, offBalanceExcluded, includeOff, zenRules, accountDir]
  );
  return { scope, zenRules };
}
