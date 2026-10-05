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
 *
 * На заглушке — аватар аккаунта, на который переходим (фото или буквы на его
 * цвете), вокруг него крутится дуга акцентного цвета, подпись выезжает снизу.
 * При «уменьшить движение» в системе — тот же экран без движения.
 */

const FLAG = "dzenanalytics:switching";
const ID = "profile-switch-overlay";
const FADE_IN_MS = 180;
const FADE_OUT_MS = 320;
/** Метка старше этого — от прерванного перехода, заглушку не показываем. */
const STALE_MS = 15_000;

/** Как выглядит аккаунт на заглушке: фото или буквы на постоянном оттенке. */
export interface SwitchFace {
  avatar?: string | null;
  initials: string;
  hue: number;
}

interface SwitchFlag {
  label: string;
  face?: SwitchFace | null;
  at: number;
  theme: string | null;
  scheme: string | null;
}

const STYLE_ID = "profile-switch-style";
/** Анимации заглушки — один раз на страницу: инлайн-стили ключевых кадров не умеют. */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
@keyframes psw-spin { to { transform: rotate(360deg); } }
@keyframes psw-pop { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: scale(1); } }
@keyframes psw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes psw-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
#${ID} .psw-ring { position: absolute; inset: -7px; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0 55%, rgb(var(--c-accent) / .15) 70%, rgb(var(--c-accent)) 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
  animation: psw-spin .9s linear infinite; }
#${ID} .psw-face { animation: psw-pop .42s cubic-bezier(.2,.8,.2,1) both, psw-breathe 2.4s ease-in-out .5s infinite; }
#${ID} .psw-text { animation: psw-rise .4s cubic-bezier(.2,.8,.2,1) .08s both; }
#${ID}.psw-out .psw-avatar { transform: scale(1.08); opacity: 0; transition: transform ${FADE_OUT_MS}ms ease-in, opacity ${FADE_OUT_MS}ms ease-in; }
@media (prefers-reduced-motion: reduce) {
  #${ID} .psw-ring, #${ID} .psw-face, #${ID} .psw-text { animation: none; }
  #${ID} .psw-ring { background: rgb(var(--c-accent) / .35); }
}`;
  document.head.appendChild(st);
}

/** Аватар: фото или буквы. */
function faceEl(face: SwitchFace | null | undefined, label: string): HTMLElement {
  const size = 64;
  if (face?.avatar) {
    const img = document.createElement("img");
    img.src = face.avatar;
    img.alt = "";
    Object.assign(img.style, { width: `${size}px`, height: `${size}px`, borderRadius: "50%", objectFit: "cover", display: "block" });
    return img;
  }
  const el = document.createElement("div");
  const letters = face?.initials ?? (label.trim()[0] ?? "?").toUpperCase();
  const hue = face?.hue ?? 210;
  el.textContent = letters;
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "600",
    fontSize: `${letters.length > 1 ? 24 : 28}px`,
    background: `hsl(${hue} 70% 90%)`,
    color: `hsl(${hue} 50% 32%)`,
  });
  return el;
}

const reduceMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function build(label: string, visible: boolean, face?: SwitchFace | null): HTMLDivElement {
  ensureStyles();
  const el = document.createElement("div");
  el.id = ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "18px",
    background: "rgb(var(--c-bg))",
    color: "rgb(var(--c-muted))",
    font: '500 14px "Geist Variable", -apple-system, "Segoe UI", system-ui, sans-serif',
    opacity: visible ? "1" : "0",
    transition: reduceMotion() ? "none" : `opacity ${FADE_IN_MS}ms ease-out`,
  } satisfies Partial<CSSStyleDeclaration>);
  const avatar = document.createElement("div");
  avatar.className = "psw-avatar";
  avatar.style.position = "relative";
  const ring = document.createElement("div");
  ring.className = "psw-ring";
  const faceBox = document.createElement("div");
  faceBox.className = "psw-face";
  faceBox.appendChild(faceEl(face, label));
  avatar.append(ring, faceBox);
  const text = document.createElement("div");
  text.className = "psw-text";
  text.style.textAlign = "center";
  const small = document.createElement("div");
  small.textContent = "Переключаюсь на аккаунт";
  const name = document.createElement("div");
  name.textContent = label;
  Object.assign(name.style, { marginTop: "4px", color: "rgb(var(--c-text))", fontSize: "16px", fontWeight: "600" });
  text.append(small, name);
  el.append(avatar, text);
  return el;
}

/**
 * Начать переход: запомнить, куда идём, и плавно погасить страницу. `then` —
 * сама перезагрузка — вызывается, когда страница уже закрыта заглушкой.
 */
export function beginSwitch(label: string, then: () => void, face?: SwitchFace | null): void {
  const root = document.documentElement;
  const flag: SwitchFlag = {
    label,
    face: face ?? null,
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
  const el = build(label, false, face);
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
  document.body.appendChild(build(flag.label, true, flag.face));
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
  el.classList.add("psw-out");
  el.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
  el.style.opacity = "0";
  setTimeout(() => el.remove(), FADE_OUT_MS + 20);
}
