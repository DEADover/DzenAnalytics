import { useEffect } from "react";
import { useAccountDirectory } from "./useAccountDirectory";
import { upgradeAccountRefs } from "../lib/accountDirectory";
import { goalSources } from "../lib/goals";
import { useGoalsStore } from "../store/useGoalsStore";
import { useFireStore } from "../store/useFireStore";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";
import { useSlicesStore } from "../store/useSlicesStore";
import { useAccountsViewStore } from "../store/useAccountsViewStore";
import { useSavedViewsStore } from "../store/useSavedViewsStore";

/**
 * Настройки, запомнившие счета названиями, переводятся на ключи — иначе
 * переименование счёта отвязывало его от цели, бюджета, разреза (#131).
 * Вызывается один раз, в `App`; срабатывает, когда справочник счетов узнал
 * название. Записи с ключами не трогает, поэтому после перевода молчит.
 */
export function useAccountRefUpgrade(): void {
  const dir = useAccountDirectory();
  const goals = useGoalsStore((s) => s.goals);
  const goalsLoaded = useGoalsStore((s) => s.loaded);
  const excluded = useFireStore((s) => s.excluded);
  const fireLoaded = useFireStore((s) => s.loaded);
  const budgetAccounts = useBudgetSettingsStore((s) => s.accounts);
  const budgetLoaded = useBudgetSettingsStore((s) => s.loaded);
  const slices = useSlicesStore((s) => s.slices);
  const slicesLoaded = useSlicesStore((s) => s.loaded);
  const chartAccounts = useAccountsViewStore((s) => s.chartAccounts);
  const viewLoaded = useAccountsViewStore((s) => s.loaded);
  const views = useSavedViewsStore((s) => s.views);
  const viewsLoaded = useSavedViewsStore((s) => s.loaded);

  useEffect(() => {
    if (!goalsLoaded) return;
    let changed = false;
    const next = goals.map((g) => {
      const refs = upgradeAccountRefs(goalSources(g), dir);
      if (!refs) return g;
      changed = true;
      return { ...g, accountTitle: refs[0] ?? null, accountTitles: refs };
    });
    if (changed) void useGoalsStore.getState().replaceAll(next);
  }, [dir, goals, goalsLoaded]);

  useEffect(() => {
    if (!fireLoaded) return;
    const refs = upgradeAccountRefs(excluded, dir);
    if (refs) void useFireStore.getState().replaceExcluded(refs);
  }, [dir, excluded, fireLoaded]);

  // Счета бюджета.
  useEffect(() => {
    if (!budgetLoaded) return;
    const refs = upgradeAccountRefs(budgetAccounts, dir);
    if (refs) void useBudgetSettingsStore.getState().update({ accounts: refs });
  }, [dir, budgetAccounts, budgetLoaded]);

  // Счета, исключённые из разрезов аналитики.
  useEffect(() => {
    if (!slicesLoaded) return;
    let changed = false;
    const next = slices.map((x) => {
      const refs = upgradeAccountRefs(x.excludedAccounts, dir);
      if (!refs) return x;
      changed = true;
      return { ...x, excludedAccounts: refs };
    });
    if (changed) void useSlicesStore.getState().replaceAll(next);
  }, [dir, slices, slicesLoaded]);

  // Счета графика на странице «Счета».
  useEffect(() => {
    if (!viewLoaded) return;
    const refs = upgradeAccountRefs(chartAccounts, dir);
    if (refs) void useAccountsViewStore.getState().patch({ chartAccounts: refs });
  }, [dir, chartAccounts, viewLoaded]);

  // Счета в сохранённых фильтрах.
  useEffect(() => {
    if (!viewsLoaded) return;
    let changed = false;
    const next = views.map((v) => {
      const refs = upgradeAccountRefs(v.accounts ?? [], dir);
      if (!refs) return v;
      changed = true;
      return { ...v, accounts: refs };
    });
    if (changed) void useSavedViewsStore.getState().replaceAll(next);
  }, [dir, views, viewsLoaded]);
}
