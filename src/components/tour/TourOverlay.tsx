import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, GraduationCap, X } from "lucide-react";
import logoDa from "../../assets/logo-da.png";
import {
  TOUR_MORE_EVENT,
  TOUR_OP_EVENT,
  tourChapter,
  type TourChapter,
  type TourOpen,
  type TourStep,
} from "../../lib/tour";
import { useHeaderNavStore } from "../../store/useHeaderNavStore";
import { useTourStore } from "../../store/useTourStore";

/** Поле вокруг подсвеченного элемента и отступ карточки от него. */
const PAD = 8;
const GAP = 16;
const EDGE = 16;
const CARD_W = 380;
/** Перелёт подсветки к новой цели — как `--tour-move` в index.css. */
const MOVE_MS = 420;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** `**так**` — полужирным. Больше разметки шагам не нужно. */
function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="text-text font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/**
 * Раскрыть или закрыть то, что показывает шаг. Вернёт отмену ожидания: лента
 * операций могла ещё не появиться (шаг только что перевёл в раздел), поэтому
 * карточку просим, пока она не откроется.
 */
function setOpened(what: TourOpen, on: boolean): () => void {
  if (what === "more") window.dispatchEvent(new CustomEvent(TOUR_MORE_EVENT, { detail: on }));
  else if (what === "nav-editor") {
    if (on) useHeaderNavStore.getState().openEditor();
    else useHeaderNavStore.getState().closeEditor();
  } else {
    window.dispatchEvent(new CustomEvent(TOUR_OP_EVENT, { detail: on }));
    if (on) {
      let tries = 0;
      const t = setInterval(() => {
        if (document.querySelector('[data-tour="op-actions"]') || ++tries > 20) clearInterval(t);
        else window.dispatchEvent(new CustomEvent(TOUR_OP_EVENT, { detail: true }));
      }, 150);
      return () => clearInterval(t);
    }
  }
  return () => {};
}

/** Первый видимый элемент из меток шага — и его место в списке (0 — основная цель). */
function findTarget(step: TourStep): { el: HTMLElement; rank: number } | null {
  for (const [rank, t] of (step.target ?? []).entries()) {
    // «метка:first» — первый ребёнок: сетка виджетов выше экрана, а показать
    // нужно один виджет, не весь экран.
    const [name, part] = t.split(":");
    const found = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    const el = part === "first" ? (found?.firstElementChild as HTMLElement | null) : found;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el, rank };
  }
  return null;
}

/** Блок выше этой доли экрана — высокий: показываем его начало, а не весь. */
const TALL = 0.7;

/**
 * Рамка подсветки — с полем и в пределах окна. У высокого блока (лента,
 * карточка настроек) — только верхняя половина экрана: иначе подсвечен весь
 * экран, и непонятно, куда смотреть, а карточке негде встать.
 */
function spotBox(r: DOMRect): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(EDGE / 2, r.left - PAD);
  const top = Math.max(EDGE / 2, r.top - PAD);
  const right = Math.min(vw - EDGE / 2, r.right + PAD);
  const tallCut = r.height > vh * TALL ? r.top + vh * 0.5 : Infinity;
  const bottom = Math.min(vh - EDGE / 2, r.bottom + PAD, tallCut);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Затемнение с вырезом: весь экран минус скруглённый прямоугольник. Набор
 * команд пути всегда один и тот же — так браузер плавно перетекает вырез от
 * шага к шагу (`transition: clip-path`). Без выреза — прямоугольник нулевого
 * размера в центре.
 */
function dimPath(b: Box): string {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const r = Math.min(16, b.width / 2, b.height / 2);
  const { left: x, top: y, width: w, height: h } = b;
  return (
    `path(evenodd, "M0 0H${W}V${H}H0Z` +
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z")`
  );
}

const same = (a: Box | null, b: Box | null) =>
  !!a &&
  !!b &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

interface CardPlace {
  left: number;
  top: number;
  width: number;
  /** Карточка легла поверх подсвеченного блока — места вокруг не нашлось. */
  over?: boolean;
}

/** Где встать карточке: под элементом, над ним, сбоку или — если он во весь экран — поверх его низа. */
function cardPosition(spot: Box | null, cardH: number): CardPlace {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - EDGE * 2);
  if (!spot) return { width, left: (vw - width) / 2, top: Math.max(EDGE, (vh - cardH) / 2) };
  const left = Math.min(vw - width - EDGE, Math.max(EDGE, spot.left + spot.width / 2 - width / 2));
  const below = vh - (spot.top + spot.height);
  if (below >= cardH + GAP + EDGE) return { width, left, top: spot.top + spot.height + GAP };
  if (spot.top >= cardH + GAP + EDGE) return { width, left, top: spot.top - cardH - GAP };
  // Ни снизу, ни сверху не помещается — сбоку, вровень с серединой блока.
  const sideTop = Math.min(vh - cardH - EDGE, Math.max(EDGE, spot.top + spot.height / 2 - cardH / 2));
  if (spot.left + spot.width + GAP + width + EDGE <= vw)
    return { width, left: spot.left + spot.width + GAP, top: sideTop };
  if (spot.left - GAP - width >= EDGE) return { width, left: spot.left - GAP - width, top: sideTop };
  // Блок во всю ширину — поверх его низа.
  return { width, left, top: Math.max(EDGE, vh - cardH - EDGE * 2), over: true };
}

/**
 * Обучение поверх живой панели: затемнение с «окном» вокруг нужного элемента,
 * пульсирующая рамка и карточка с объяснением. Окно и карточка перетекают от
 * шага к шагу, содержимое карточки мягко сменяется. Шаг сам переходит в нужный
 * раздел и прокручивает элемент в середину экрана.
 *
 * Клавиши: → и Enter — дальше, ← — назад, Esc — закончить. Перехватываются
 * раньше всех, чтобы шапка не листала разделы стрелками под туром.
 * «Уменьшить движение» в системе выключает анимации (`.tour-*` в index.css).
 */
export function TourOverlay() {
  const chapterId = useTourStore((s) => s.chapter);
  const stepIdx = useTourStore((s) => s.step);
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);
  const stop = useTourStore((s) => s.stop);
  const openHub = useTourStore((s) => s.openHub);
  const chapter = chapterId ? tourChapter(chapterId) : undefined;
  const step = chapter?.steps[stepIdx];
  const loc = useLocation();
  const navigate = useNavigate();

  const [spot, setSpot] = useState<Box | null>(null);
  /** Переход окна и карточки включён — только на время перелёта к новой цели. */
  const [animate, setAnimate] = useState(true);
  /**
   * Какой шаг сейчас на карточке. Меняется в момент перелёта к новой цели,
   * а не сразу: иначе текст сменялся бы на старом месте, а карточка уезжала
   * бы следом — два движения вместо одного.
   */
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [cardH, setCardH] = useState(240);
  const cardRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // Запас прокрутки под страницей, пока идёт глава: блок в самом низу
  // страницы тоже можно поднять под шапку, чтобы карточка встала под ним.
  useEffect(() => {
    if (!chapterId) return;
    document.documentElement.classList.add("tour-on");
    return () => document.documentElement.classList.remove("tour-on");
  }, [chapterId]);

  // Нужный раздел. Параметры адреса сравниваем по вхождению: у настроек они
  // выбирают вкладку, а лишние (например, `?demo`) не мешают.
  useEffect(() => {
    if (!step?.route) return;
    const [path, query = ""] = step.route.split("?");
    const params = new URLSearchParams(loc.search);
    const missing = [...new URLSearchParams(query)].some(([k, v]) => params.get(k) !== v);
    if (loc.pathname !== path || missing) navigate(step.route);
  }, [step, loc.pathname, loc.search, navigate]);

  // Раскрыть то, что показывает шаг, и закрыть, когда тур уйдёт с него. Два
  // шага подряд с одним и тем же — панель не закрывается между ними.
  const open = step?.open;
  useEffect(() => {
    if (!open) return;
    const stopWaiting = setOpened(open, true);
    return () => {
      stopWaiting();
      setOpened(open, false);
    };
  }, [open]);

  // Цель шага. Чтобы подсветка не «догоняла» элемент, пока тот едет
  // (плавная прокрутка, появление раздела), движение идёт в три фазы:
  //   1. «settle» — ищем цель, при нужде прокручиваем к ней и ждём, пока её
  //      место перестанет меняться; подсветка стоит на прежнем месте;
  //   2. «move» — один плавный переход к итоговому месту;
  //   3. «follow» — дальше мелкие сдвиги (подгрузка, размер окна) подсветка
  //      повторяет сразу, без анимации.
  // Раньше она шла за элементом каждый кадр с переходом, и каждый кадр
  // переход начинался заново — отсюда рывки и запаздывающая обводка.
  useEffect(() => {
    if (!step || !chapterId) return;
    const key = `${chapterId}-${stepIdx}`;
    let raf = 0;
    let el: HTMLElement | null = null;
    let rank = 0;
    let phase: "settle" | "move" | "follow" = "settle";
    let last: Box | null = null;
    let stillFrames = 0;
    let phaseAt = performance.now();
    const started = performance.now();
    const begin = (next: HTMLElement) => {
      el = next;
      phase = "settle";
      last = null;
      stillFrames = 0;
      phaseAt = performance.now();
      const r0 = next.getBoundingClientRect();
      const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-h")) || 72;
      const vh = window.innerHeight;
      const behavior = reduceMotion() ? "auto" : "smooth";
      // Высота карточки этого шага — по невидимому двойнику: видимая ещё
      // показывает прошлый шаг.
      const cardH = measureRef.current?.offsetHeight ?? 240;
      const visible = r0.top >= header + EDGE / 2 && r0.bottom <= vh - EDGE / 2;
      // Виден целиком и карточке есть место рядом — не трогаем прокрутку:
      // лишнее движение только мешает.
      if (visible && !cardPosition(spotBox(r0), cardH).over) return;
      // Блок и карточка помещаются друг под другом — блок поднимаем под шапку,
      // и карточка встаёт под ним, а не поверх. Решаем по месту после
      // прокрутки: по центру экрана карточке часто не хватает места ни сверху,
      // ни снизу, хотя до прокрутки хватало.
      const fitsStacked = r0.height + PAD * 2 + GAP + cardH + EDGE <= vh - header - EDGE;
      if (fitsStacked) {
        window.scrollTo({ top: window.scrollY + r0.top - header - EDGE - PAD, behavior });
      } else if (visible) {
        return;
      } else if (r0.height > vh * TALL) {
        // Высокий блок — к его началу, под закреплённую шапку.
        window.scrollTo({ top: window.scrollY + r0.top - header - EDGE, behavior });
      } else {
        next.scrollIntoView({ block: "center", behavior });
      }
    };
    const tick = () => {
      // Стоим на запасной цели — продолжаем искать основную: окно или
      // панель, которые открывает шаг, появляются не сразу.
      if (!el || !el.isConnected || rank > 0) {
        const found = step.target ? findTarget(step) : null;
        if (found && (found.el !== el || !el?.isConnected)) {
          rank = found.rank;
          begin(found.el);
        } else if (!found) {
          el = null;
        }
      }
      const now = performance.now();
      if (el) {
        const box = spotBox(el.getBoundingClientRect());
        if (phase === "settle") {
          stillFrames = same(last, box) ? stillFrames + 1 : 0;
          last = box;
          // Место не меняется несколько кадров подряд (или ждать дольше
          // нечего) — один плавный переход туда.
          if (stillFrames >= 4 || now - phaseAt > 1200) {
            setAnimate(true);
            setSpot(box);
            setShownKey(key);
            phase = "move";
            phaseAt = now;
          }
        } else if (phase === "move") {
          if (now - phaseAt > MOVE_MS) {
            phase = "follow";
            setAnimate(false);
          }
        } else {
          setSpot((prev) => (same(prev, box) ? prev : box));
        }
      } else if (!step.target || now - started > 2500) {
        // Элемента нет (узкое окно, нет подключения) — объясняем по центру.
        setAnimate(true);
        setSpot(null);
        setShownKey(key);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step, chapterId, stepIdx]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  // Клавиши — в фазе перехвата, раньше обработчиков страницы и шапки.
  useEffect(() => {
    if (!chapter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const handled =
        e.key === "ArrowRight" || e.key === "Enter"
          ? (next(), true)
          : e.key === "ArrowLeft"
            ? (back(), true)
            : e.key === "Escape"
              ? (stop(), true)
              : false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chapter, next, back, stop]);

  if (!chapter || !step) return null;

  // На карточке — шаг, к которому подсветка уже перелетела (см. `shownKey`).
  const shownIdx =
    shownKey && shownKey.startsWith(`${chapter.id}-`) ? Number(shownKey.slice(chapter.id.length + 1)) : stepIdx;
  const view = chapter.steps[shownIdx] ?? step;
  const special = view.kind === "welcome" || view.kind === "finish";
  // Особые шаги — всегда по центру и без окна.
  const shownSpot = special ? null : spot;
  const pos = cardPosition(shownSpot, cardH);
  const center = {
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    width: 0,
    height: 0,
  };
  const box = shownSpot ?? center;

  return createPortal(
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label={`Обучение: ${chapter.title}`}>
      {/* Щелчки мимо карточки — не в панель под туром. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      <div className={clsx("tour-dim", !animate && "tour-still")} style={{ clipPath: dimPath(box) }} aria-hidden />
      <div
        className={clsx("tour-spot", !shownSpot && "tour-spot-none", !animate && "tour-still")}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        aria-hidden
      />
      <div
        ref={cardRef}
        className={clsx("tour-card", !animate && "tour-still")}
        style={{ left: pos.left, top: pos.top, width: pos.width }}
      >
        <TourCard chapter={chapter} idx={shownIdx} onNext={next} onBack={back} onStop={stop} onHub={openHub} />
      </div>
      {/* Невидимый двойник карточки нового шага — чтобы заранее знать её высоту. */}
      <div
        ref={measureRef}
        className="tour-card tour-measure"
        style={{ left: -10000, top: 0, width: pos.width }}
        aria-hidden
        inert
      >
        <TourCard chapter={chapter} idx={stepIdx} measure />
      </div>
    </div>,
    document.body
  );
}

interface TourCardProps {
  chapter: TourChapter;
  idx: number;
  /** Невидимый двойник для замера: без фокуса и обработчиков. */
  measure?: boolean;
  onNext?: () => void;
  onBack?: () => void;
  onStop?: (completed?: boolean) => void;
  onHub?: () => void;
}

/** Содержимое карточки шага: заголовок, текст, прогресс и кнопки. */
function TourCard({ chapter, idx, measure, onNext, onBack, onStop, onHub }: TourCardProps) {
  const view = chapter.steps[idx];
  const total = chapter.steps.length;
  const last = idx === total - 1;
  const special = view.kind === "welcome" || view.kind === "finish";
  const stop = (completed?: boolean) => onStop?.(completed);
  return (
    <>
      <div key={`${chapter.id}-${idx}`} className="tour-step-in">
        {view.kind === "welcome" && <WelcomeArt />}
        {view.kind === "finish" && <FinishArt />}
        <div className={clsx("flex items-center gap-2 text-xs text-muted", special && "justify-center")}>
          <GraduationCap className="w-3.5 h-3.5 text-accent" aria-hidden />
          <span>{chapter.title}</span>
          {!special && (
            <span className="tabular-nums">
              · {idx + 1} из {total}
            </span>
          )}
        </div>
        <h2 className={clsx("mt-1.5 text-lg font-semibold tracking-tight text-balance", special && "text-center text-xl")}>
          {view.title}
        </h2>
        <div className={clsx("mt-2 space-y-2 text-sm text-muted leading-relaxed", special && "text-center")}>
          {view.body.map((p, i) => (
            <p key={i}>{rich(p)}</p>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-1" aria-hidden>
        {chapter.steps.map((_, i) => (
          <span key={i} className={clsx("tour-dot", i <= idx && "tour-dot-on")} />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {!last ? (
          <button type="button" className="text-xs text-muted hover:text-text mr-auto" onClick={() => stop()}>
            Пропустить
          </button>
        ) : (
          <span className="mr-auto" />
        )}
        {idx > 0 && !last && (
          <button type="button" className="btn-ghost text-sm" onClick={onBack} aria-label="Назад">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {last ? (
          <>
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => {
                stop(true);
                onHub?.();
              }}
            >
              Другие темы
            </button>
            <button type="button" className="btn-primary text-sm" onClick={() => stop(true)}>
              <Check className="w-3.5 h-3.5" />
              Готово
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary text-sm" onClick={onNext} autoFocus={!measure}>
            {view.kind === "welcome" ? "Начать" : "Далее"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <button
        type="button"
        className="absolute top-3 right-3 p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
        onClick={() => stop()}
        aria-label="Закончить обучение"
      >
        <X className="w-4 h-4" />
      </button>
    </>
  );
}

/** Приветствие: знак сервиса в мягком свечении и орбите точек. */
function WelcomeArt() {
  return (
    <div className="relative h-28 mb-3 flex items-center justify-center" aria-hidden>
      <div className="tour-glow" />
      <div className="tour-orbit">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{ transform: `rotate(${i * 60}deg) translateX(52px)` }} />
        ))}
      </div>
      <img src={logoDa} alt="" className="tour-logo relative w-16 h-auto" />
    </div>
  );
}

/** Финал главы: галочка, которая рисуется, и разлёт искр. */
function FinishArt() {
  return (
    <div className="relative h-24 mb-2 flex items-center justify-center" aria-hidden>
      <div className="tour-glow tour-glow-income" />
      <svg viewBox="0 0 52 52" className="relative w-16 h-16">
        <circle className="tour-check-circle" cx="26" cy="26" r="24" fill="none" />
        <path className="tour-check-mark" fill="none" d="M15 27l7 7 15-16" />
      </svg>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span key={i} className="tour-spark" style={{ ["--a" as string]: `${i * 45}deg` }} />
      ))}
    </div>
  );
}
