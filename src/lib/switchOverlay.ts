/**
 * Плавный переход между аккаунтами.
 *
 * Сам переход — перезагрузка страницы на базе другого аккаунта (см.
 * `lib/profiles`): так ни один стор и кэш в памяти не покажут чужие данные.
 * Грубость перезагрузки прячем за экраном-заглушкой: старая страница плавно
 * гаснет в него, перезагрузка идёт под ним, новая страница стартует сразу с
 * него же — без белой вспышки — и заглушка растворяется, когда данные нового
 * аккаунта прочитаны.
 *
 * Заглушка — обычный DOM, а не React: она должна появиться до первого кадра
 * React и пережить монтирование приложения.
 */

const FLAG = "dzenanalytics:switching";
const ID = "profile-switch-overlay";
const FADE_IN_MS = 180;
const FADE_OUT_MS = 320;
/** Метка старше этого — от прерванного перехода, заглушку не показываем. */
const STALE_MS = 15_000;

interface SwitchFlag {
  label: string;
  at: number;
  theme: string | null;
  scheme: string | null;
}

const reduceMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function build(label: string, visible: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.id = ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgb(var(--c-bg))",
    color: "rgb(var(--c-muted))",
    font: '500 14px "Geist Variable", -apple-system, "Segoe UI", system-ui, sans-serif',
    opacity: visible ? "1" : "0",
    transition: reduceMotion() ? "none" : `opacity ${FADE_IN_MS}ms ease-out`,
  } satisfies Partial<CSSStyleDeclaration>);
  const text = document.createElement("div");
  text.textContent = `Открываю профиль ${label}`;
  el.appendChild(text);
  return el;
}

/**
 * Начать переход: запомнить, куда идём, и плавно погасить страницу. `then` —
 * сама перезагрузка — вызывается, когда страница уже закрыта заглушкой.
 */
export function beginSwitch(label: string, then: () => void): void {
  const root = document.documentElement;
  const flag: SwitchFlag = {
    label,
    at: Date.now(),
    theme: root.getAttribute("data-theme"),
    scheme: root.getAttribute("data-scheme"),
  };
  try {
    sessionStorage.setItem(FLAG, JSON.stringify(flag));
  } catch {
    // Без метки новая страница просто не покажет заглушку.
  }
  if (reduceMotion()) {
    then();
    return;
  }
  const el = build(label, false);
  document.body.appendChild(el);
  // Прозрачная заглушка должна лечь до смены прозрачности — иначе переход не
  // сыграет. Пересчёт раскладки, а не кадр отрисовки: в фоновой вкладке кадров
  // нет, и переключение зависло бы до возвращения в неё.
  void el.offsetWidth;
  el.style.opacity = "1";
  setTimeout(then, FADE_IN_MS);
}

/**
 * На старте страницы: если это продолжение перехода — сразу показать
 * заглушку непрозрачной, в той же теме, что была. Тема приложения применяется
 * позже, с первым кадром React, и без этого тёмная тема мигнула бы светлой.
 */
export function resumeSwitch(): void {
  let flag: SwitchFlag | null;
  try {
    const raw = sessionStorage.getItem(FLAG);
    flag = raw ? (JSON.parse(raw) as SwitchFlag) : null;
  } catch {
    flag = null;
  }
  if (!flag || Date.now() - flag.at > STALE_MS) {
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      // ignore
    }
    return;
  }
  const root = document.documentElement;
  if (flag.theme) root.setAttribute("data-theme", flag.theme);
  if (flag.scheme) root.setAttribute("data-scheme", flag.scheme);
  document.body.appendChild(build(flag.label, true));
  // Сторож: что бы ни случилось с загрузкой, заглушка не останется навсегда.
  setTimeout(endSwitch, 6000);
}

/** Данные нового аккаунта прочитаны — растворить заглушку. */
export function endSwitch(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // ignore
  }
  const el = document.getElementById(ID);
  if (!el) return;
  if (reduceMotion()) {
    el.remove();
    return;
  }
  el.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
  el.style.opacity = "0";
  setTimeout(() => el.remove(), FADE_OUT_MS + 20);
}
