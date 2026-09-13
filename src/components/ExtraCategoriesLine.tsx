import { useLayoutEffect, useRef, useState } from "react";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { fallbackColorForName } from "../lib/categoryColor";
import { Tooltip } from "./Tooltip";

/**
 * Вторые категории операции в ленте (#69) — своей строкой под категорией: под
 * названием, если подкатегории нет, и под подкатегорией, если она есть.
 *
 * Отдельная строка, а не продолжение подкатегории: так подкатегория никогда не
 * обрезается ради тегов, а сами теги не сжимаются до буквы. Строка
 * прокручивается вбок — тачпадом, свайпом или колесом с Shift. Полосы прокрутки
 * нет: под мелким текстом она была бы толще самих подписей. Что там есть ещё,
 * подсказывает мягкое затухание у края, а весь список целиком — всплывающая
 * подсказка.
 *
 * Отличить вторую категорию от подкатегории помогает цветная точка: у
 * подкатегории её нет. Имя короткое («Италия», а не «Путешествия / Италия») —
 * полные названия в подсказке.
 */
export function ExtraCategoriesLine({ extras }: { extras?: string[] }) {
  if (!extras || extras.length === 0) return null;
  return <ScrollingLine extras={extras} />;
}

/** Ширина затухания у края — примерно на полбуквы больше точки с отступом. */
const FADE = "1.5em";

function ScrollingLine({ extras }: { extras: string[] }) {
  const lineRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const update = () => {
      const left = line.scrollLeft > 1;
      const right = line.scrollLeft + line.clientWidth < line.scrollWidth - 1;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    line.addEventListener("scroll", update, { passive: true });
    // Колонка сужается вместе с окном — и то, что влезало, может перестать.
    const observer = new ResizeObserver(update);
    observer.observe(line);
    return () => {
      line.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [extras]);

  // Затухание только с той стороны, где действительно есть скрытое: иначе
  // крайняя подпись бледнела бы без причины.
  const mask =
    edges.left && edges.right
      ? `linear-gradient(to right, transparent, #000 ${FADE}, #000 calc(100% - ${FADE}), transparent)`
      : edges.right
        ? `linear-gradient(to right, #000 calc(100% - ${FADE}), transparent)`
        : edges.left
          ? `linear-gradient(to right, transparent, #000 ${FADE})`
          : undefined;

  return (
    <Tooltip content={`Вторые категории: ${extras.join(", ")}`}>
      {/* Обёртка обязательна: подсказка вешает свой ref на прямого потомка и
          подменила бы наш — следить за прокруткой было бы не у кого. */}
      <div className="min-w-0">
        <div
          ref={lineRef}
          className="scroll-soft-x flex items-center gap-2 whitespace-nowrap text-[0.85em] text-muted leading-normal"
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        >
          {extras.map((full) => (
            <ExtraMark key={full} full={full} />
          ))}
        </div>
      </div>
    </Tooltip>
  );
}

/** Одна вторая категория: точка её цвета и короткое имя. */
function ExtraMark({ full }: { full: string }) {
  const parts = full.split(/\s*\/\s*/);
  const leaf = parts[parts.length - 1] ?? full;
  const parent = parts.length > 1 ? parts[0] : null;
  // Тот же порядок, что у значка категории: свой цвет, цвет родителя, а без
  // них — постоянный цвет по названию, чтобы точка не пропадала.
  const color = useCategoryMetaStore(
    (s) => s.meta[full]?.color ?? (parent ? s.meta[parent]?.color : null) ?? null
  );
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color ?? fallbackColorForName(full) }}
      />
      {leaf}
    </span>
  );
}
