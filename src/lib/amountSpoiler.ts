/**
 * Частицы вместо сумм — режим «Скрыть суммы», как в банковских приложениях.
 *
 * Каждая сумма на странице обёрнута невидимыми метками (`formatMoney`,
 * `AMOUNT_OPEN` … `AMOUNT_CLOSE`). При включении режима слой сам подменяет НА
 * МЕСТЕ текст каждой суммы — вместе со знаком перед ней — на заглушку:
 * пустое место постоянной ширины. Страница не перерисовывается: меняется
 * только текст сумм, а при выключении он возвращается ровно туда же.
 * Суммы, появившиеся позже (новая страница, подсказка, обновлённые данные),
 * маскируются наблюдателем изменений ещё до того, как браузер их нарисует.
 *
 * На месте заглушек один прозрачный холст рисует мерцающие частицы цветом
 * самого текста — где бы сумма ни стояла: в таблице, подсказке, подписи
 * SVG-графика. Почему холст, а не элемент в каждой сумме: сумма везде —
 * просто строка, её собирают сотни мест, и в подпись графика элемент не
 * вставить вовсе.
 *
 * Заглушку, закрытую окном или уехавшую за край прокручиваемой области, не
 * рисуем: проверяем, что в её центре сверху лежит она сама.
 */

const OPEN = "\u2060";
const CLOSE = "\u2063";
const FILL = "\u2007";
/** Заглушка: метки вокруг неразрывных пробелов шириной в цифру. */
const PLACEHOLDER_RE = /\u2060\u2007+\u2063/g;
/** Настоящая сумма (не заглушка) — со знаком вплотную перед ней. */
const AMOUNT_RE = /[+\u2212-]?\u2060([^\u2060\u2063]*)\u2063/g;
const SIGN_TAIL = /[+\u2212-]$/;
const SIGN_ONLY = /^\s*[+\u2212-]\s*$/;

function placeholderFor(inner: string): string {
  // Длина одна на любую сумму — по ней не прочитать порядок. Короче — у
  // коротких подписей (оси графиков), где места мало.
  const n = inner.replace(/[\s\u00a0\u202f]/g, "").length <= 5 ? 4 : 6;
  return `${OPEN}${FILL.repeat(n)}${CLOSE}`;
}

interface Item {
  node: Text;
  start: number;
  end: number;
  color: string;
  /** Сумма на самой странице (в `main`) — рисуется слоем ПОД шапкой. */
  onPage: boolean;
  /** Видна ли (не закрыта окном, не обрезана прокруткой) — по последней проверке. */
  visible: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
}

/** Частицы держатся за свою заглушку между пересборками, чтобы не прыгать. */
const swarms = new WeakMap<Text, Map<number, Particle[]>>();

function swarmFor(node: Text, start: number, count: number): Particle[] {
  let byStart = swarms.get(node);
  if (!byStart) {
    byStart = new Map();
    swarms.set(node, byStart);
  }
  let list = byStart.get(start);
  if (!list || list.length !== count) {
    list = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2,
      speed: 1.5 + Math.random() * 2.5,
    }));
    byStart.set(start, list);
  }
  return list;
}

function textColor(node: Text): string {
  const el = node.parentElement;
  if (!el) return "rgb(128,128,128)";
  const cs = getComputedStyle(el);
  // У подписей SVG-графиков цвет — в `fill`.
  if (el instanceof SVGElement) {
    const fill = cs.fill;
    if (fill && fill !== "none" && !fill.startsWith("url(")) return fill;
  }
  return cs.color || "rgb(128,128,128)";
}

/**
 * Прозрачный слой во весь экран без фона и размытия — ловушка кликов, а не
 * окно: под ним всё видно.
 */
function isClickShield(el: Element): boolean {
  if (!(el instanceof HTMLElement) || el.childElementCount > 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < window.innerWidth - 2 || r.height < window.innerHeight - 2) return false;
  const cs = getComputedStyle(el);
  if (cs.position !== "fixed") return false;
  const bg = cs.backgroundColor;
  const clear = bg === "transparent" || /rgba\([^)]*,\s*0\)$/.test(bg);
  const blur = cs.backdropFilter && cs.backdropFilter !== "none";
  return clear && !blur && cs.backgroundImage === "none";
}

/** Запустить слой частиц. Возвращает остановку. */
export function startAmountSpoiler(): () => void {
  /**
   * Два слоя. Суммы самой страницы рисуются слоем ПОД шапкой (z 20 < 30 у
   * шапки): прокрученные под её стекло частицы закрываются и размываются им,
   * как и остальное содержимое, а не висят поверх. Суммы в окнах, боковой
   * панели, всплывающих меню и подсказках — слоем поверх всего, иначе их
   * частицы ушли бы под само окно.
   *
   * Слои залипающие, первыми в странице, а не `fixed` поверх окна: неподвижный
   * слой отрывался от сумм — «пружина» у края при резкой прокрутке и
   * проявление страницы при переходе сдвигают содержимое мимо координат
   * элементов. Залипающий браузер сдвигает вместе со страницей, как и шапку.
   * Места слой не занимает: отрицательный нижний отступ во всю его высоту.
   */
  const makeLayer = (z: string) => {
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    c.dataset.amountSpoiler = "";
    Object.assign(c.style, {
      position: "sticky",
      top: "0",
      display: "block",
      pointerEvents: "none",
      zIndex: z,
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.prepend(c);
    return { canvas: c, ctx: c.getContext("2d")! };
  };
  const page = makeLayer("20");
  const over = makeLayer("2147483000");
  const layers = [page, over];
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let items: Item[] = [];
  let dirty = true;
  let lastScan = 0;
  let lastOcclusion = 0;
  let raf = 0;
  let last = performance.now();

  // Ширина — без полосы прокрутки: 100vw дал бы прокрутку вбок.
  let vw = 0;
  let vh = 0;
  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    vw = document.documentElement.clientWidth;
    vh = window.innerHeight;
    for (const { canvas, ctx } of layers) {
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      canvas.style.marginBottom = `-${vh}px`;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };
  size();

  /**
   * Подменённые узлы: исходный текст и то, что мы туда записали. По второму
   * отличаем свою правку от чужой: React переписал узел — значит, это свежая
   * сумма, её запоминаем и маскируем заново.
   */
  const original = new Map<Text, string>();
  const written = new WeakMap<Text, string>();
  const write = (n: Text, next: string) => {
    if (!original.has(n)) original.set(n, n.data);
    written.set(n, next);
    n.data = next;
  };
  const ours = (n: Text) => written.get(n) === n.data;

  /**
   * Знак перед суммой — «+», «−» — многие места дописывают сами, вне
   * `formatMoney`, отдельным текстовым узлом или элементом. Прятать надо сумму
   * целиком, поэтому стираем и его: в соседнем узле перед суммой или в
   * ближайшем предыдущем тексте, если тот — один только знак.
   */
  const signNodes = new Set<Text>();
  const stripSignBefore = (n: Text) => {
    const prev = n.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      const t = prev as Text;
      if (SIGN_TAIL.test(t.data)) {
        signNodes.add(t);
        write(t, t.data.slice(0, -1));
      }
      return;
    }
    const back = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    back.currentNode = n;
    for (let p = back.previousNode() as Text | null; p; p = back.previousNode() as Text | null) {
      if (p.data.trim() === "") continue;
      if (SIGN_ONLY.test(p.data)) {
        signNodes.add(p);
        write(p, "");
      }
      return;
    }
  };

  /** Замаскировать суммы в узле, если там есть настоящие. */
  const maskNode = (n: Text) => {
    if (!n.data.includes(OPEN) || ours(n)) return;
    let real = false;
    let startsWithAmount = false;
    const next = n.data.replace(AMOUNT_RE, (whole, inner: string, offset: number) => {
      if (/^\u2007+$/.test(inner)) return whole; // уже заглушка
      real = true;
      if (offset === 0 && whole.startsWith(OPEN)) startsWithAmount = true;
      return placeholderFor(inner);
    });
    if (!real) return;
    // Свежий текст от React — он и есть исходный для этого узла.
    original.set(n, n.data);
    written.set(n, next);
    n.data = next;
    if (startsWithAmount) stripSignBefore(n);
    dirty = true;
  };

  /** Узел-знак, который React переписал обратно, — стереть снова. */
  const recheckSign = (n: Text) => {
    if (ours(n)) return;
    original.set(n, n.data);
    if (SIGN_ONLY.test(n.data)) write(n, "");
    else if (SIGN_TAIL.test(n.data)) write(n, n.data.slice(0, -1));
  };

  const maskTree = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) {
      maskNode(root as Text);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) =>
        (t as Text).data.includes(OPEN) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes: Text[] = [];
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) nodes.push(t);
    nodes.forEach(maskNode);
  };

  /** Где рисовать частицы — все заглушки на странице. */
  const scan = () => {
    const found: Item[] = [];
    for (const n of original.keys()) {
      if (!n.isConnected) {
        original.delete(n);
        signNodes.delete(n);
        continue;
      }
      if (!n.data.includes(OPEN)) continue;
      const color = textColor(n);
      PLACEHOLDER_RE.lastIndex = 0;
      for (let m = PLACEHOLDER_RE.exec(n.data); m; m = PLACEHOLDER_RE.exec(n.data)) {
        found.push({
          node: n,
          start: m.index,
          end: m.index + m[0].length,
          color,
          onPage: !!n.parentElement?.closest("main"),
          visible: true,
        });
      }
    }
    items = found;
    dirty = false;
    lastOcclusion = 0; // новые заглушки — сразу проверить, видны ли
  };

  const range = document.createRange();
  const rectsOf = (it: Item): DOMRect[] => {
    if (!it.node.isConnected) return [];
    try {
      range.setStart(it.node, it.start);
      range.setEnd(it.node, it.end);
    } catch {
      return [];
    }
    return Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  };

  const occluded = (it: Item, r: DOMRect): boolean => {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true;
    // Холст с `pointer-events: none` — сквозь него поиск видит страницу.
    // Прозрачные «ловушки кликов» во весь экран (за всплывающим меню, чтобы
    // закрыть его кликом мимо) ничего не закрывают — их пропускаем. Иначе с
    // открытой панелью частицы пропадали со всей страницы.
    const owner = it.node.parentElement;
    if (!owner) return true;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (isClickShield(hit)) continue;
      return !(hit === owner || owner.contains(hit) || hit.contains(owner));
    }
    return true;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dirty && now - lastScan > 120) {
      lastScan = now;
      scan();
    }
    const checkOcclusion = now - lastOcclusion > 250;
    if (checkOcclusion) lastOcclusion = now;

    for (const { ctx } of layers) ctx.clearRect(0, 0, vw, vh);
    for (const it of items) {
      const ctx = it.onPage ? page.ctx : over.ctx;
      const rects = rectsOf(it);
      if (rects.length === 0) continue;
      if (checkOcclusion) it.visible = !occluded(it, rects[0]);
      if (!it.visible) continue;
      ctx.fillStyle = it.color;
      rects.forEach((r, ri) => {
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        // Заглушка выше строки текста не бывает — частицы держим по высоте цифр.
        const h = Math.max(4, r.height * 0.62);
        const top = r.top + (r.height - h) / 2;
        const dot = Math.max(1, Math.min(2, r.height / 14));
        const count = Math.max(8, Math.min(220, Math.round((r.width * h) / 9)));
        const swarm = swarmFor(it.node, it.start * 16 + ri, count);
        for (const p of swarm) {
          if (!reduce) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < 0) p.x += 1;
            else if (p.x > 1) p.x -= 1;
            if (p.y < 0) p.y += 1;
            else if (p.y > 1) p.y -= 1;
            p.phase += p.speed * dt;
          }
          ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(p.phase));
          ctx.fillRect(r.left + p.x * r.width, top + p.y * h, dot, dot);
        }
      });
    }
    for (const { ctx } of layers) ctx.globalAlpha = 1;
  };

  // Маскируем сразу, в той же микрозадаче, что и правка страницы: браузер
  // ещё не успел её нарисовать, и цифры не мелькают.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") {
        const t = r.target as Text;
        if (signNodes.has(t)) recheckSign(t);
        else maskNode(t);
      } else {
        r.addedNodes.forEach((n) => {
          if (n !== page.canvas && n !== over.canvas) maskTree(n);
        });
      }
    }
    dirty = true;
  });
  maskTree(document.body);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const onResize = () => {
    size();
    dirty = true;
  };
  window.addEventListener("resize", onResize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    // Вернуть текст на место — только там, где он всё ещё наш.
    for (const [n, text] of original) {
      if (n.isConnected && ours(n)) n.data = text;
    }
    original.clear();
    signNodes.clear();
    window.removeEventListener("resize", onResize);
    range.detach?.();
    for (const { canvas } of layers) canvas.remove();
  };
}
