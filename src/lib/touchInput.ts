/**
 * Было ли последнее касание экрана только что.
 *
 * На сенсорном экране браузер после касания присылает и мышиные события —
 * `mouseover`, `mouseenter`, — будто курсор навели. Подсказки «по наведению»
 * от этого всплывали на каждое касание кнопки и так и висели: убрать курсор,
 * чтобы их закрыть, на телефоне нечем. Подсказки спрашивают здесь, не касание
 * ли это, и такое «наведение» пропускают.
 */
let lastTouchAt = -Infinity;

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") lastTouchAt = performance.now();
    },
    { capture: true, passive: true }
  );
}

/** Мышиное событие, пришедшее вслед за касанием (в пределах `ms`). */
export function fromTouch(ms = 800): boolean {
  return performance.now() - lastTouchAt < ms;
}
