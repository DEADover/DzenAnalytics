import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import clsx from "clsx";

/** ПРЕДЕЛ ширины панели, а не сама ширина: короткое пояснение в одну строку
 *  растягивалось на весь предел и выглядело нелепо рядом со своим значком.
 *  Панель считается по содержимому и упирается в этот предел.
 *
 *  40rem были явно много: строка при 12px набирала под сто двадцать знаков —
 *  вдвое больше удобной длины, глаз не находил начало следующей строки. Но и
 *  26rem оказались тесноваты: длинное пояснение вытягивалось в узкий столбец
 *  во весь экран и накрывало собой то, к чему относится. 30rem — около
 *  восьмидесяти знаков в строке: ещё комфортно читать, но панель заметно ниже. */
const WIDTH = 480; // 30rem
const MARGIN = 8;

/** Сколько места снизу считаем достаточным, чтобы раскрыться вниз.
 *
 *  Без порога решение принималось перевесом в считанные пиксели: снизу 315,
 *  сверху 325 — и панель уезжала вверх, накрывая пол-страницы, хотя вниз она
 *  помещалась почти целиком. Панель прокручивается внутри себя, так что «вниз»
 *  работает всегда; вверх идём, только когда снизу и правда негде — кнопка у
 *  самого низа экрана. */
const MIN_BELOW = 240;

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
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(
    null
  );

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = btnRef.current?.getBoundingClientRect();
      if (!a) return;
      const box = panelRef.current?.getBoundingClientRect();
      const h = box?.height ?? 0;
      const vw = window.innerWidth || WIDTH + MARGIN * 2;
      const vh = window.innerHeight || 0;
      // Ширину берём измеренную: панель теперь по содержимому, и правый край
      // выравнивается по кнопке только если считать по факту, а не по пределу.
      const width = Math.min(box?.width || WIDTH, vw - MARGIN * 2);
      // По умолчанию — правым краем к кнопке; если не влезает, прижимаем к краю.
      const left = Math.min(Math.max(a.right - width, MARGIN), vw - width - MARGIN);
      // ВНИЗ по умолчанию — так панель не накрывает собой то, к чему относится,
      // и знак вопроса остаётся на виду. Раньше правило было «не помещается
      // снизу — открываем вверх», и длинное пояснение уезжало под потолок,
      // закрывая заголовок и кнопки страницы.
      const below = a.bottom + 6;
      const spaceBelow = vh > 0 ? vh - below - MARGIN : h;
      const spaceAbove = a.top - 6 - MARGIN;
      // Наверх уходим, только когда снизу СОВСЕМ негде (кнопка у нижнего края)
      // и сверху места больше. Во всех остальных случаях — вниз, а слишком
      // длинное содержимое прокручивается внутри панели.
      const flip = vh > 0 && spaceBelow < MIN_BELOW && spaceAbove > spaceBelow;
      const top = flip ? Math.max(MARGIN, a.top - Math.min(h, spaceAbove) - 6) : below;
      setPos({ left, top, maxH: Math.max(120, flip ? spaceAbove : spaceBelow) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Escape закрывает панель. Клика мимо мало: с клавиатуры её было не убрать
  // вовсе, а по всему сервису Escape закрывает любой слой поверх страницы —
  // и здесь он должен работать так же.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Возвращаем фокус на знак вопроса — иначе он повисает в пустоте.
      btnRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          "p-1.5 rounded-full shrink-0",
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
              className="fixed z-[91] w-max max-w-[min(30rem,calc(100vw-1rem))] overflow-y-auto border border-border rounded-xl bg-panel p-4 shadow-xl space-y-2.5 text-xs text-muted leading-relaxed"
              style={{
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                // Предел высоты ставим ТОЛЬКО после замера: до него панель
                // должна вырасти во всю свою высоту, иначе мерить нечего и
                // она сама себя обрежет по стартовому пределу.
                maxHeight: pos ? pos.maxH : undefined,
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
