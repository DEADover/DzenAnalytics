import { flushSync } from "react-dom";

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
  const root = document.documentElement;
  // Пока идёт смена кадров, `.page-enter` молчит: новая страница и так
  // проявляется целиком, вторая анимация поверх задвоила бы движение.
  root.dataset.viewTransition = "";
  const done = () => {
    delete root.dataset.viewTransition;
  };
  // Переход, прерванный следующим (быстрый двойной клик), отклоняет `finished`
  // — это не ошибка, убираем пометку в обоих случаях.
  document.startViewTransition(() => flushSync(update)).finished.then(done, done);
}
