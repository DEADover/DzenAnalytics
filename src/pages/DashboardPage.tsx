/**
 * Главная страница — тонкая оболочка над `DashboardView`.
 *
 * Здесь остались только три состояния: данных нет, данные едут, данные есть.
 * Вся раскладка и все расчёты живут в `components/dashboard`.
 */

import { EmptyState } from "../components/EmptyState";
import { DashboardView } from "../components/dashboard/DashboardView";
import { DashboardSkeleton } from "../components/dashboard/DashboardSkeleton";
import { useDataStore } from "../store/useDataStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";

export function DashboardPage() {
  const hasData = useDataStore((s) => s.transactions.length > 0);
  const dataLoaded = useDataStore((s) => s.loaded);
  const syncStatus = useZenmoneyStore((s) => s.status);

  // «Нет данных» — это утверждение, а не ожидание. Пока идёт первая
  // синхронизация или ещё не поднялось локальное хранилище, показываем форму
  // будущей страницы, а не приглашение подключить то, что уже подключено.
  if (!hasData) {
    const busy = !dataLoaded || syncStatus === "checking" || syncStatus === "syncing";
    return busy ? <DashboardSkeleton /> : <EmptyState />;
  }

  return <DashboardView />;
}
