import { EXIT_MS } from "../hooks/usePresence";

/**
 * Уход окна «слепком».
 *
 * Окна снимаются с дерева вместе с условием, которое их показывало
 * (`{open && <Modal …/>}`, `if (!open) return null`), — держать каждое до
 * конца анимации пришлось бы во всех местах вызова. Вместо этого в момент
 * закрытия на экране остаётся неживая копия окна: затемнение гаснет, панель
 * (метка `data-exit-panel`) гаснет и чуть уменьшается, потом копия удаляется
 * (`.exit-ghost` в index.css).
 *
 * Копия не принимает кликов и фокуса и невидима для скринридера; id, метки
 * обучения и тестов с неё сняты, чтобы ничто не спутало её с настоящим окном.
 * Одновременно живёт одна копия: следующая убирает предыдущую.
 */
let ghost: { key: string; el: HTMLElement; timer: number } | null = null;

/** Убрать копию сразу — например, когда окно сменилось другим без ухода. */
export function dropGhost(key?: string) {
  if (!ghost || (key !== undefined && ghost.key !== key)) return;
  window.clearTimeout(ghost.timer);
  ghost.el.remove();
  ghost = null;
}

/** Оставить на экране гаснущую копию `node`. Вызывать до снятия узла с дерева. */
export function leaveGhost(node: HTMLElement | null, key = "") {
  if (!node || !node.isConnected) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  dropGhost();
  const copy = node.cloneNode(true) as HTMLElement;
  copy.classList.add("exit-ghost");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  const from = node.querySelectorAll<HTMLElement>("*");
  const to = copy.querySelectorAll<HTMLElement>("*");
  for (const el of [copy, ...to]) {
    el.removeAttribute("id");
    el.removeAttribute("data-tour");
    el.removeAttribute("data-testid");
  }
  document.body.appendChild(copy);
  // Прокрученное тело окна гаснет на том же месте, а не прыгает к началу.
  from.forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) {
      to[i].scrollTop = el.scrollTop;
      to[i].scrollLeft = el.scrollLeft;
    }
  });
  ghost = { key, el: copy, timer: window.setTimeout(() => dropGhost(), EXIT_MS) };
}
