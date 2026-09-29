import { Layers } from "lucide-react";
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
      settings={{ to: "/settings?tab=processing", label: "Настроить разрезы" }}
    />
  );
}
