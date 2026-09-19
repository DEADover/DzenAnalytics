import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Подпись, которая занимает место по САМОМУ ДЛИННОМУ из своих вариантов.
 *
 * Нужна там, где текст меняется, а контрол двигаться не должен: «Май 26 г.» →
 * «Сентябрь 26 г.» в выборе месяца, «Отчётный месяц» → «Календарный месяц» в
 * ряду фильтров. Иначе от каждой смены значения ряд перекладывается: соседние
 * кнопки едут вбок, а на границе ширины окна ещё и переносятся на другую
 * строку.
 *
 * Ширину держит сама вёрстка, без измерений в JS: все варианты лежат в одной
 * ячейке сетки друг под другом, лишние — невидимы. Ячейка берёт ширину самого
 * широкого, и это честная ширина ИМЕННО ЭТОГО шрифта, а не догадка по числу
 * символов.
 */
export function StableWidth({
  value,
  candidates,
  align = "center",
  className,
}: {
  /** Что показывать сейчас. */
  value: ReactNode;
  /** Все варианты подписи, включая текущий. */
  candidates: readonly string[];
  /**
   * Куда прижимать подпись в зарезервированном месте. По умолчанию по центру;
   * пара дат вокруг тире равняется К НЕМУ — иначе короткая дата уплывала от
   * тире, и просветы вокруг него выходили разной ширины.
   */
  align?: "center" | "start" | "end";
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "grid",
        align === "start" ? "justify-items-start" : align === "end" ? "justify-items-end" : "justify-items-center",
        className
      )}
    >
      {candidates.map((text, i) => (
        <span
          key={`${text}-${i}`}
          aria-hidden="true"
          className="col-start-1 row-start-1 invisible whitespace-nowrap"
        >
          {text}
        </span>
      ))}
      <span className="col-start-1 row-start-1 whitespace-nowrap">{value}</span>
    </span>
  );
}
