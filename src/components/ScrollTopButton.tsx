import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp } from "lucide-react";
import clsx from "clsx";

/**
 * Круглая кнопка «Наверх» в правом нижнем углу длинного списка. Появляется,
 * когда список прокручен дальше первого экрана.
 *
 * Две постановки:
 * - без `container` — страница. Стоит ОДНА на всё приложение (в `App`), а не
 *   на каждой странице: раньше она была только в четырёх лентах, и на
 *   «Поиске», «Аномалиях», «Правилах», в справочниках и отчётах вернуться к
 *   началу было нечем. Пока в том же углу висит плашка загрузки курсов
 *   (`HistRatesProgress`), кнопка стоит над ней — плашка выставляет
 *   `--corner-stack`.
 * - с `container` — блок со своей прокруткой: шторка операций, тело окна.
 *   Кнопка встаёт в правый нижний угол этого блока поверх всего (порталом в
 *   `body`), разметку самого блока не трогает.
 */
export function ScrollTopButton({
  threshold = 600,
  container,
}: {
  threshold?: number;
  container?: RefObject<HTMLElement | null>;
}) {
  const [show, setShow] = useState(false);
  const [corner, setCorner] = useState<{ right: number; bottom: number } | null>(null);

  useEffect(() => {
    const el = container?.current ?? null;
    if (container && !el) return;
    const target: HTMLElement | Window = el ?? window;
    const update = () => {
      setShow((el ? el.scrollTop : window.scrollY) > threshold);
      if (el) {
        const r = el.getBoundingClientRect();
        const right = Math.round(window.innerWidth - r.right + 16);
        const bottom = Math.round(window.innerHeight - r.bottom + 16);
        setCorner((c) => (c && c.right === right && c.bottom === bottom ? c : { right, bottom }));
      }
    };
    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [threshold, container]);

  if (!show || (container && !corner)) return null;

  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    (container?.current ?? window).scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  const button = (
    <button
      type="button"
      onClick={toTop}
      className={clsx(
        "btn btn-square-lg fixed border-border bg-panel shadow-xl text-muted hover:text-accent",
        container ? "z-[70]" : "z-30"
      )}
      style={
        container && corner
          ? { right: corner.right, bottom: corner.bottom }
          : { right: "1.5rem", bottom: "var(--corner-stack, 1.5rem)" }
      }
      title="Наверх"
      aria-label="Вернуться к началу списка"
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
  return container ? createPortal(button, document.body) : button;
}
