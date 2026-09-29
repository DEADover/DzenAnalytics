import { Link } from "react-router-dom";
import { Layers, SlidersHorizontal } from "lucide-react";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { HeaderSwitcher } from "./HeaderSwitcher";

/**
 * Переключатель разреза данных в шапке (issue #14).
 *
 * Появляется, только когда разрезов больше одного: у большинства он один,
 * и постоянная плашка «Все данные» была бы шумом. Пока разрез один, всё
 * работает как раньше, и в шапке ничего не прибавляется.
 */
export function SliceSwitcher() {
  const slices = useSlicesStore((s) => s.slices);
  const activeId = useSlicesStore((s) => s.activeId);
  const setActive = useSlicesStore((s) => s.setActive);
  if (slices.length < 2) return null;
  const current = activeSlice({ slices, activeId });
  return (
    <HeaderSwitcher
      icon={Layers}
      current={current.name}
      title="Разрез данных — что учитывается в аналитике"
      ariaLabel={`Разрез данных: ${current.name}`}
      heading="Разрез данных"
      items={slices.map((s) => ({ id: s.id, label: s.name }))}
      activeId={current.id}
      onPick={(id) => void setActive(id)}
      footer={(close) => (
        <Link
          to="/settings?tab=processing"
          onClick={close}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted hover:bg-panel2 hover:text-text"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Настроить
        </Link>
      )}
    />
  );
}
