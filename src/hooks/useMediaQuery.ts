import { useSyncExternalStore } from "react";

/** Узкий экран — телефон. Та же граница, что у `sm:` в Tailwind (640 px). */
export const NARROW_QUERY = "(max-width: 639.98px)";

/**
 * Совпадает ли медиазапрос — и перерисовка, когда перестаёт. Для разметки,
 * которую на узком экране не перестроить одним CSS: шторка операций там
 * показывает строки ленты вместо таблицы на семь колонок.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
