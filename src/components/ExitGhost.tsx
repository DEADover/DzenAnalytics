import { useId, useLayoutEffect, useRef } from "react";
import { dropGhost, leaveGhost } from "../lib/exitGhost";

/**
 * Ставится ВНУТРЬ окна, которое закрывается через `if (!open) return null`;
 * само окно помечается `data-exit-root`.
 *
 * Когда окно снимают с дерева, React сначала прогоняет очистку эффектов у его
 * потомков и только потом убирает узел — в этот момент окно ещё на экране, и
 * с него снимается гаснущий слепок (`leaveGhost`). Эффект самого окна для
 * этого не годится: при смене `open` его очистка идёт уже после удаления
 * узла. И ref на само окно тоже: React отвязывает его раньше, чем доходит до
 * потомков, — поэтому окно находим от своей метки.
 */
export function ExitGhost() {
  const key = useId();
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // В разработке React монтирует эффекты дважды — слепок от этого мнимого
    // закрытия убираем сразу.
    dropGhost(key);
    const ref = marker;
    return () => {
      const root = ref.current?.closest<HTMLElement>("[data-exit-root]") ?? null;
      leaveGhost(root, key);
    };
  }, [key]);
  return <span ref={marker} hidden />;
}
