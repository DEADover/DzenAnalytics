import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import clsx from "clsx";

/** Ширина панели. Подобрана по высоте: на 20rem длинное объяснение вытягивалось
 *  почти во весь экран, а шире 40rem строка становится слишком длинной для
 *  12px. */
const WIDTH = 640; // 40rem
const MARGIN = 8;

/**
 * Знак вопроса, раскрывающий объяснение «как это считается».
 *
 * Одна разметка на весь сервис: раньше она была скопирована в справочники и в
 * «Динамику», и ширина у них уже начала расходиться. Текст — `children`, чтобы
 * в объяснении можно было выделять названия кнопок и колонок.
 *
 * Панель рисуется порталом с фиксированными координатами и прижимается к краям
 * экрана: якорь бывает и у левого края (в «Аномалиях» знак вопроса уезжает под
 * заголовок), и панель в 640px, привязанная к правому краю кнопки, уходила бы
 * за пределы окна. Тот же приём, что у `Tooltip`.
 */
export function InfoPopover({
  label = "Как это считается",
  children,
}: {
  /** Подпись кнопки — она же в подсказке при наведении. */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = btnRef.current?.getBoundingClientRect();
      if (!a) return;
      const h = panelRef.current?.getBoundingClientRect().height ?? 0;
      const vw = window.innerWidth || WIDTH + MARGIN * 2;
      const vh = window.innerHeight || 0;
      const width = Math.min(WIDTH, vw - MARGIN * 2);
      // По умолчанию — правым краем к кнопке; если не влезает, прижимаем к краю.
      const left = Math.min(Math.max(a.right - width, MARGIN), vw - width - MARGIN);
      // Ниже кнопки, а если снизу не хватает места — выше неё.
      const below = a.bottom + 6;
      const top = vh > 0 && below + h > vh - MARGIN ? Math.max(MARGIN, a.top - h - 6) : below;
      setPos({ left, top });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={clsx(
          "p-1.5 rounded-md shrink-0",
          open
            ? "text-accent bg-accent/10"
            : "text-muted hover:text-accent hover:bg-panel2"
        )}
      >
        <HelpCircle className="w-5 h-5" />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              className="fixed z-[91] w-[40rem] max-w-[calc(100vw-1rem)] border border-border rounded-xl bg-panel p-4 shadow-xl space-y-2.5 text-xs text-muted leading-relaxed"
              style={{
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                visibility: pos ? "visible" : "hidden",
              }}
            >
              {children}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/** Выделение внутри объяснения — название кнопки, колонки, порога. */
export function InfoTerm({ children }: { children: ReactNode }) {
  return <strong className="text-text">{children}</strong>;
}
