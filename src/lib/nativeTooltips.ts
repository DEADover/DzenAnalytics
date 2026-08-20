// One delegated bridge that replaces EVERY browser-native `title` tooltip with
// the app's own bubble — same look as the <Tooltip> component, one place.
//
// Why a bridge instead of converting call sites: `title` is used on ~250 spots
// across the app (buttons, icons, table cells). Wrapping each in <Tooltip> would
// be a huge diff, and any new `title` written later would silently bring the
// native grey box back. Here the rule holds for everything, forever.
//
// It also absorbs the older truncation rule: a cell that opts into `truncate` /
// `line-clamp-*` shows its tooltip ONLY when the text is actually clipped —
// otherwise hovering a table would pop bubbles that just repeat what you see.
//
// The attribute is stashed (not lost) and restored on mouse-out, so the DOM
// keeps `title` for anything reading it (a11y tooling, tests, copy).

const STASH = "data-native-title";
const DELAY_MS = 120;

let bubble: HTMLDivElement | null = null;
let anchor: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function isTruncationCell(el: HTMLElement): boolean {
  const c = el.className;
  return typeof c === "string" && (/\btruncate\b/.test(c) || c.includes("line-clamp"));
}

function isClipped(el: HTMLElement): boolean {
  // +1 absorbs sub-pixel rounding. Width for single-line `truncate`,
  // height for multi-line `line-clamp`.
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** Should this element show a tooltip at all? */
function wants(el: HTMLElement, text: string): boolean {
  if (!text.trim()) return false;
  // A truncating cell earns its tooltip only while the text doesn't fit.
  if (isTruncationCell(el)) {
    return (el.textContent || "").trim().length > 0 && isClipped(el);
  }
  return true;
}

function ensureBubble(): HTMLDivElement {
  if (bubble) return bubble;
  const b = document.createElement("div");
  b.setAttribute("role", "tooltip");
  // Mirrors the <Tooltip> component's bubble exactly — one visual language.
  b.className =
    "pointer-events-none fixed z-[100] w-max max-w-80 " +
    "rounded-lg border border-border bg-panel2 px-3 py-2 text-xs leading-relaxed " +
    "text-text shadow-lg whitespace-pre-line";
  b.style.opacity = "0";
  b.style.left = "0";
  b.style.top = "0";
  document.body.appendChild(b);
  bubble = b;
  return b;
}

function place(el: HTMLElement): void {
  const b = ensureBubble();
  const a = el.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const m = 8; // viewport margin
  // Prefer above; flip below when there isn't room.
  const below = a.top < r.height + 12;
  const left = Math.min(
    Math.max(a.left + a.width / 2 - r.width / 2, m),
    window.innerWidth - r.width - m
  );
  const top = below ? a.bottom + 6 : a.top - r.height - 6;
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
  b.style.opacity = "1";
}

/**
 * Многострочная подсказка получает структуру: первая строка — заголовком,
 * остальное — пояснением поменьше и потише. Ровно то же самое делает компонент
 * `Tooltip`; здесь повтор нужен потому, что мост строит свой пузырь руками, без
 * React, — а выглядеть подсказки обязаны одинаково независимо от того, откуда
 * взялись.
 *
 * Пояснения на два-три предложения сплошным абзацем не читаются: глазу не за
 * что зацепиться, а на подсказку у человека доли секунды.
 */
function fill(b: HTMLDivElement, text: string): void {
  const nl = text.indexOf("\n");
  if (nl < 0) {
    b.textContent = text;
    return;
  }
  const head = text.slice(0, nl);
  const tail = text.slice(nl + 1).trim();
  if (!tail) {
    b.textContent = head;
    return;
  }
  b.textContent = "";
  const h = document.createElement("div");
  h.className = "font-medium";
  h.textContent = head;
  const t = document.createElement("div");
  t.className = "text-muted mt-1";
  t.textContent = tail;
  b.append(h, t);
}

function show(el: HTMLElement, text: string): void {
  anchor = el;
  const b = ensureBubble();
  fill(b, text);
  b.style.opacity = "0";
  // Measure first, then position — the bubble must be laid out to know its size.
  place(el);
}

function hide(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (bubble) bubble.style.opacity = "0";
  anchor = null;
}

/** Take the native attribute off the element so the OS bubble can't appear,
 *  keeping the value in a data-attribute we own. */
function stash(el: HTMLElement): string | null {
  const live = el.getAttribute("title");
  if (live != null) {
    el.setAttribute(STASH, live);
    el.removeAttribute("title");
    return live;
  }
  return el.getAttribute(STASH);
}

function restore(el: Element): void {
  const saved = el.getAttribute(STASH);
  if (saved == null) return;
  // Пока подсказка висела, компонент мог перерисоваться и поставить НОВЫЙ
  // `title` — так бывает у кнопок-переключателей, где текст зависит от
  // состояния. Возвращать сохранённый в этом случае нельзя: затрём свежий
  // текст старым, и React больше его не поправит — он уверен, что атрибут
  // уже нужного значения. Поэтому кладём обратно, только если атрибута нет.
  if (el.getAttribute("title") == null) el.setAttribute("title", saved);
  el.removeAttribute(STASH);
}

function onOver(e: Event): void {
  const target = e.target as Element | null;
  const el = target?.closest?.(`[title], [${STASH}]`) as HTMLElement | null;
  if (!el) return;
  if (el === anchor) return; // already showing for this element
  const text = stash(el);
  if (text == null) return;
  hide();
  if (!wants(el, text)) return;
  timer = setTimeout(() => {
    timer = null;
    show(el, text);
  }, DELAY_MS);
}

function onOut(e: Event): void {
  const target = e.target as Element | null;
  const el = target?.closest?.(`[${STASH}]`);
  if (!el) return;
  restore(el);
  if (el === anchor || anchor === null) hide();
}

/** Anything that moves the page under the bubble invalidates its position. */
function onScroll(): void {
  if (anchor && bubble && bubble.style.opacity === "1") place(anchor);
}

export function installNativeTooltips(): () => void {
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("mouseout", onOut, true);
  // A click usually changes what's under the cursor (menus, dialogs) — drop the
  // bubble rather than leave it hanging over the new content.
  document.addEventListener("click", hide, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseout", onOut, true);
    document.removeEventListener("click", hide, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    hide();
    bubble?.remove();
    bubble = null;
  };
}
