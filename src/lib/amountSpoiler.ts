/**
 * Частицы вместо сумм — режим «Скрыть суммы», как в банковских приложениях.
 *
 * `formatMoney` в этом режиме отдаёт вместо суммы заглушку (`HIDDEN_AMOUNT`):
 * пустое место постоянной ширины между невидимыми метками. Здесь один
 * прозрачный холст поверх страницы находит такие заглушки в тексте — где бы
 * он ни стоял: в таблице, подсказке, подписи графика — и рисует на их месте
 * мерцающие частицы цветом самого текста.
 *
 * Почему холст, а не элемент в каждой сумме: сумма везде — просто строка, её
 * собирают сотни мест, и в подписи SVG-графика элемент не вставить вовсе.
 *
 * Заглушку, закрытую окном или уехавшую за край прокручиваемой области, не
 * рисуем: проверяем, что в её центре сверху лежит она сама.
 */

const MARK = "⁠";
const RE = /⁠ +⁠/g;

interface Item {
  node: Text;
  start: number;
  end: number;
  color: string;
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

/** Запустить слой частиц. Возвращает остановку. */
export function startAmountSpoiler(): () => void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.amountSpoiler = "";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "2147483000",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let items: Item[] = [];
  let dirty = true;
  let lastScan = 0;
  let lastOcclusion = 0;
  let raf = 0;
  let last = performance.now();

  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();

  /**
   * Знак перед суммой — «+», «−» — многие места дописывают сами, вне
   * `formatMoney`. Прятать надо сумму целиком, поэтому знак вплотную перед
   * заглушкой стираем прямо в тексте: в том же узле или в соседнем перед ним
   * (`−{formatMoney(…)}` в разметке — это два текстовых узла). При выключении
   * режима страница пересобирается заново, и знаки возвращаются.
   */
  const SIGN = /[+\u2212-]$/;
  const stripSign = (n: Text, at: number) => {
    if (at > 0) {
      if (SIGN.test(n.data.slice(0, at))) n.deleteData(at - 1, 1);
      return;
    }
    const prev = n.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      const t = prev as Text;
      if (SIGN.test(t.data)) t.deleteData(t.data.length - 1, 1);
      return;
    }
    // Знак отдельным элементом перед суммой (`<span>−</span><span>сумма</span>`):
    // ближайший предыдущий текст на странице, если он — один только знак.
    const back = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    back.currentNode = n;
    for (let p = back.previousNode() as Text | null; p; p = back.previousNode() as Text | null) {
      const trimmed = p.data.trim();
      if (trimmed === "") continue;
      if (/^[+\u2212-]$/.test(trimmed)) p.data = p.data.replace(trimmed, "");
      return;
    }
  };

  const scan = () => {
    const found: Item[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        (n as Text).data.includes(MARK) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes: Text[] = [];
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) nodes.push(n);
    for (const n of nodes) {
      // Сначала знаки — после правки текста позиции заглушек сдвигаются.
      for (let i = n.data.lastIndexOf(MARK + "\u2007"); i >= 0; i = i > 0 ? n.data.lastIndexOf(MARK + "\u2007", i - 1) : -1) {
        stripSign(n, i);
      }
      const color = textColor(n);
      RE.lastIndex = 0;
      for (let m = RE.exec(n.data); m; m = RE.exec(n.data)) {
        found.push({ node: n, start: m.index, end: m.index + m[0].length, color, visible: true });
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
    const hit = document.elementFromPoint(x, y);
    const owner = it.node.parentElement;
    if (!hit || !owner) return true;
    return !(hit === owner || owner.contains(hit) || hit.contains(owner));
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

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const it of items) {
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
    ctx.globalAlpha = 1;
  };

  const observer = new MutationObserver(() => {
    dirty = true;
  });
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
    window.removeEventListener("resize", onResize);
    range.detach?.();
    canvas.remove();
  };
}
