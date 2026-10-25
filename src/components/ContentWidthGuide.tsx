import { useDisplayStore } from "../store/useDisplayStore";

/**
 * Направляющие ширины сервиса, пока её выбирают бегунком.
 *
 * Применять ширину на каждом шаге перетаскивания — значит перестраивать всю
 * вёрстку шестнадцать раз за секунду: шапка, фильтры и страница дёргались.
 * Пока бегунок тянут, сервис стоит на месте, а здесь двигаются только две
 * линии по краям будущей колонки и затенение за ними — это один лёгкий слой
 * поверх страницы. Отпустили — ширина применяется один раз (см. «Оформление»).
 */
export function ContentWidthGuide() {
  const draft = useDisplayStore((s) => s.contentWidthDraft);
  if (draft === null) return null;
  // «Во весь экран» — колонка по краям окна: линии уходят к краям.
  const half = draft > 0 ? `min(50vw, ${draft / 2}px)` : "50vw";
  const edge = `calc(50vw - ${half})`;
  return (
    <div className="fixed inset-0 z-[90] pointer-events-none" aria-hidden data-content-width-guide>
      <div
        className="absolute inset-y-0 left-0 bg-text/[0.06] motion-safe:transition-[width] duration-150 ease-out"
        style={{ width: edge }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-text/[0.06] motion-safe:transition-[width] duration-150 ease-out"
        style={{ width: edge }}
      />
      <div
        className="absolute inset-y-0 w-px bg-accent motion-safe:transition-[left] duration-150 ease-out"
        style={{ left: edge }}
      />
      <div
        className="absolute inset-y-0 w-px bg-accent motion-safe:transition-[right] duration-150 ease-out"
        style={{ right: edge }}
      />
    </div>
  );
}
