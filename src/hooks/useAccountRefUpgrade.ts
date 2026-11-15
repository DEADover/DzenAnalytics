import { useEffect } from "react";
import { useAccountDirectory } from "./useAccountDirectory";
import { upgradeAccountRefs } from "../lib/accountDirectory";
import { goalSources } from "../lib/goals";
import { useGoalsStore } from "../store/useGoalsStore";
import { useFireStore } from "../store/useFireStore";

/**
 * Цели и FIRE, запомнившие счета названиями, переводятся на ключи — иначе
 * переименование счёта отвязывало его от цели (#131). Вызывается один раз,
 * в `App`; срабатывает, когда справочник счетов узнал название.
 */
export function useAccountRefUpgrade(): void {
  const dir = useAccountDirectory();
  const goals = useGoalsStore((s) => s.goals);
  const goalsLoaded = useGoalsStore((s) => s.loaded);
  const excluded = useFireStore((s) => s.excluded);
  const fireLoaded = useFireStore((s) => s.loaded);

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
}
