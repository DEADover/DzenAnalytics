import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHeaderSlotStore } from "../store/useHeaderSlotStore";

/**
 * Настройки раздела — сторона («Расходы / Доходы»), вкладка, вид, год,
 * бегунок, действия над показанным: всё, что меняет показанное ниже целиком.
 *
 * Стоят в шапке раздела, справа от крошек (решение 26.10.2026). Прежде это
 * был отдельный ряд между общим фильтром и итогами: две-три кнопки на всю
 * ширину и пустая полоса рядом. Страница ставит компонент там, где ей
 * удобно, — он сам уходит порталом в шапку (`PageHeader`, слот
 * `useHeaderSlotStore`). Поэтому на странице с ним обязана быть шапка.
 */
export function SectionControls({ children }: { children: ReactNode }) {
  const slot = useHeaderSlotStore((s) => s.el);
  return slot ? createPortal(<>{children}</>, slot) : null;
}
