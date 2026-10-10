import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, GraduationCap, X } from "lucide-react";
import logoDa from "../../assets/logo-da.png";
import { TOUR_MORE_EVENT, TOUR_OP_EVENT, tourChapter, type TourOpen, type TourStep } from "../../lib/tour";
import { useHeaderNavStore } from "../../store/useHeaderNavStore";
import { useTourStore } from "../../store/useTourStore";

/** Поле вокруг подсвеченного элемента и отступ карточки от него. */
const PAD = 8;
const GAP = 16;
const EDGE = 16;
const CARD_W = 380;

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

/** Где встать карточке: под элементом, над ним, сбоку или — если он во весь экран — поверх его низа. */
function cardPosition(spot: Box | null, cardH: number): { left: number; top: number; width: number } {
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
  return { width, left, top: Math.max(EDGE, vh - cardH - EDGE * 2) };
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
  const [cardH, setCardH] = useState(240);
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Цель шага: ищем, прокручиваем к ней один раз и дальше следим за её
  // местом каждый кадр — страница могла догрузиться, сдвинуться, прокрутиться.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let el: HTMLElement | null = null;
    let rank = 0;
    let scrolled = false;
    const started = performance.now();
    const tick = () => {
      // Стоим на запасной цели — продолжаем искать основную: окно или
      // панель, которые открывает шаг, появляются не сразу.
      if (!el || !el.isConnected || rank > 0) {
        const found = step.target ? findTarget(step) : null;
        if (found && (found.el !== el || !el?.isConnected)) {
          el = found.el;
          rank = found.rank;
          scrolled = false;
        } else if (!found) {
          el = null;
        }
      }
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r0 = el.getBoundingClientRect();
          const behavior = reduceMotion() ? "auto" : "smooth";
          if (r0.height > window.innerHeight * TALL) {
            // Высокий блок — к его началу, под закреплённую шапку.
            const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-h")) || 72;
            window.scrollTo({ top: window.scrollY + r0.top - header - EDGE, behavior });
          } else {
            el.scrollIntoView({ block: "center", behavior });
          }
        }
        const box = spotBox(el.getBoundingClientRect());
        setSpot((prev) => (same(prev, box) ? prev : box));
      } else if (!step.target || performance.now() - started > 2500) {
        // Элемента нет (узкое окно, нет подключения) — объясняем по центру.
        setSpot(null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

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

  const total = chapter.steps.length;
  const last = stepIdx === total - 1;
  const special = step.kind === "welcome" || step.kind === "finish";
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
      <div className="tour-dim" style={{ clipPath: dimPath(box) }} aria-hidden />
      <div
        className={clsx("tour-spot", !shownSpot && "tour-spot-none")}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        aria-hidden
      />
      <div
        ref={cardRef}
        className="tour-card"
        style={{ left: pos.left, top: pos.top, width: pos.width }}
      >
        <div key={`${chapter.id}-${stepIdx}`} className="tour-step-in">
          {step.kind === "welcome" && <WelcomeArt />}
          {step.kind === "finish" && <FinishArt />}
          <div className={clsx("flex items-center gap-2 text-xs text-muted", special && "justify-center")}>
            <GraduationCap className="w-3.5 h-3.5 text-accent" aria-hidden />
            <span>{chapter.title}</span>
            {!special && (
              <span className="tabular-nums">
                · {stepIdx + 1} из {total}
              </span>
            )}
          </div>
          <h2 className={clsx("mt-1.5 text-lg font-semibold tracking-tight text-balance", special && "text-center text-xl")}>
            {step.title}
          </h2>
          <div className={clsx("mt-2 space-y-2 text-sm text-muted leading-relaxed", special && "text-center")}>
            {step.body.map((p, i) => (
              <p key={i}>{rich(p)}</p>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-1" aria-hidden>
          {chapter.steps.map((_, i) => (
            <span key={i} className={clsx("tour-dot", i <= stepIdx && "tour-dot-on")} />
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
          {stepIdx > 0 && !last && (
            <button type="button" className="btn-ghost text-sm" onClick={back} aria-label="Назад">
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
                  openHub();
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
            <button type="button" className="btn-primary text-sm" onClick={next} autoFocus>
              {step.kind === "welcome" ? "Начать" : "Далее"}
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
      </div>
    </div>,
    document.body
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
