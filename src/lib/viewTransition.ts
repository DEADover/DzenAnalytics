import { flushSync } from "react-dom";

/** Идёт ли сейчас перерисовка внутри плавной смены кадров. */
let inTransitionUpdate = false;

/**
 * Рисуется ли экран прямо сейчас внутри `withViewTransition`. Страница по
 * этому решает, играть ли своё появление `.page-enter`: при смене кадров оно
 * задвоило бы движение.
 *
 * Читать только во время отрисовки, которую запустил переход, — и запоминать
 * решение: позже флаг уже снят.
 */
export function isViewTransitionUpdate(): boolean {
  return inTransitionUpdate;
}

/**
 * Сменить экран плавной сменой кадров — View Transitions API браузера.
 *
 * Браузер снимает кадр со старого экрана, мы синхронно перерисовываем новый, и
 * он проявляется поверх гаснущего старого (анимации — в `index.css`,
 * `::view-transition-*`). Панель «Ещё» или меню, закрытые в том же `update`,
 * тают вместе со старым экраном, а не пропадают рывком. Тяжёлая страница,
 * которая рисуется долго, не съедает анимацию: пока она строится, на экране
 * стоит старый кадр.
 *
 * Где браузер этого не умеет или человек просил поменьше движения, `update`
 * просто выполняется — страница появляется своей CSS-анимацией `.page-enter`.
 */
export function withViewTransition(update: () => void): void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function" || reduce) {
    update();
    return;
  }
  document.startViewTransition(() => {
    inTransitionUpdate = true;
    try {
      flushSync(update);
    } finally {
      inTransitionUpdate = false;
    }
  });
}
