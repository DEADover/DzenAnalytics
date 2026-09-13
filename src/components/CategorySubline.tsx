import { useLayoutEffect, useRef, useState } from "react";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { fallbackColorForName } from "../lib/categoryColor";
import { Tooltip } from "./Tooltip";

/**
 * Вторая строка категории в ленте операций: подкатегория и вторые категории
 * операции (#69).
 *
 * РАЗМЕТКА ЛЕНТЫ НЕ МЕНЯЕТСЯ. Вторые категории встают туда же, где у операции
 * и так бывает подкатегория, — второй строкой мелким приглушённым шрифтом, той
 * же высоты. Строка из одной подкатегории рисуется ровно как раньше.
 *
 * Отличить вторую категорию от подкатегории помогает цветная точка: у
 * подкатегории её нет, она продолжает название над ней. Показываем короткое
 * имя («Италия», а не «Путешествия / Италия») — полные названия во всплывающей
 * подсказке.
 *
 * ИМЕНА ТОЛЬКО ЦЕЛИКОМ. Колонка категории узкая, а на небольшом экране — совсем:
 * если сжимать все имена поровну, от каждого остаётся по букве («К… ● О ● И»).
 * Поэтому строка переносится, но видна только первая её линия: что не
 * поместилось целиком, уходит на скрытую вторую, а вместо него встаёт «+N».
 * Сколько ушло — считаем по тому, куда элемент перенёсся, без подсчёта ширин.
 */
export function CategorySubline({
  subcategory,
  extras,
  withTitle = false,
}: {
  subcategory: string | null;
  extras?: string[];
  /** Подсказка с подкатегорией — как было в выдвижной ленте. */
  withTitle?: boolean;
}) {
  if (!extras || extras.length === 0) {
    if (!subcategory) return null;
    return (
      <div className="text-[0.85em] text-muted truncate" title={withTitle ? subcategory : undefined}>
        {subcategory}
      </div>
    );
  }
  return <SublineWithExtras subcategory={subcategory} extras={extras} />;
}

function SublineWithExtras({
  subcategory,
  extras,
}: {
  subcategory: string | null;
  extras: string[];
}) {
  const lineRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ hidden: 0, left: 0 });

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const measure = () => {
      // Перенёсшийся элемент стоит ниже первой линии — его и считаем
      // спрятанным. Заодно запоминаем, где кончается последний видимый: «+N»
      // встаёт сразу за ним, а не у правого края колонки, где он отрывался
      // от подписи.
      let hidden = 0;
      let right = 0;
      for (const el of line.children as HTMLCollectionOf<HTMLElement>) {
        if (el.dataset.plus !== undefined) continue;
        if (el.offsetTop > 2) {
          if (el.dataset.extra !== undefined) hidden++;
        } else {
          right = Math.max(right, el.offsetLeft + el.offsetWidth);
        }
      }
      setOverflow((prev) =>
        prev.hidden === hidden && prev.left === right ? prev : { hidden, left: right }
      );
    };
    measure();
    // Место под «+N» резервируется отступом справа: строка сужается, и
    // наблюдатель пересчитывает — вдруг из-за счётчика ушёл ещё один.
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [subcategory, extras]);

  return (
    <Tooltip content={`Вторые категории: ${extras.join(", ")}`}>
      {/* Обёртка обязательна: подсказка вешает свой ref на прямого потомка и
          подменила бы наш — замерять было бы нечего. */}
      <div className="min-w-0">
      <div
        ref={lineRef}
        className="relative flex flex-wrap items-center gap-x-2 min-w-0 h-[1.5em] overflow-hidden text-[0.85em] text-muted leading-normal"
        style={overflow.hidden > 0 ? { paddingRight: "2.25em" } : undefined}
      >
        {subcategory && <span className="truncate max-w-full">{subcategory}</span>}
        {extras.map((full) => (
          <ExtraMark key={full} full={full} />
        ))}
        {overflow.hidden > 0 && (
          <span
            data-plus
            className="absolute top-0 tabular-nums whitespace-nowrap"
            style={{ left: overflow.left > 0 ? `calc(${overflow.left}px + 0.5em)` : 0 }}
          >
            +{overflow.hidden}
          </span>
        )}
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
    <span data-extra className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color ?? fallbackColorForName(full) }}
      />
      {leaf}
    </span>
  );
}
