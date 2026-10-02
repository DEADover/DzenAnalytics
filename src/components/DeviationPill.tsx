import { formatMoney, formatPct } from "../lib/format";
import type { DiffMode } from "../lib/diffMode";

/**
 * Пилюля отклонения: насколько текущее значение выше или ниже того, с чем его
 * сравнивают, — в деньгах, в процентах или деньгами с процентом в скобках.
 *
 * Цвет семантический, а не «больше значит красное»: для расхода потратить
 * МЕНЬШЕ — хорошо (зелёная), для дохода наоборот. Поэтому направление «хорошо»
 * задаётся видом величины, а не знаком разницы.
 *
 * Одна разметка на «Категории» (там сравнивают со средним за N месяцев) и на
 * «Сравнение периодов» (там — с периодом Б). Раньше жила внутри «Категорий», и
 * второй экран неминуемо завёл бы свою копию с чуть другими порогами.
 */
export function DeviationPill({
  current,
  baseline,
  base,
  mode,
  kind,
  comparable = true,
  sameLabel = "≈ поровну",
  upTitle = "Больше",
  downTitle = "Меньше",
  formatAmount,
}: {
  current: number;
  /** С чем сравниваем. `undefined` — сравнивать не с чем. */
  baseline: number | undefined;
  /** Базовая валюта для денежного вида. */
  base: string;
  /**
   * Деньгами, процентом или деньгами с процентом в скобках — «▲ 25 000 ₽
   * (20%)» (#115). Процента нет там, где его не бывает: смена знака, база около
   * нуля, — тогда показываем деньги.
   */
  mode: DiffMode;
  /** Расход или доход — от этого зависит, какая сторона «хорошая». */
  kind: "expense" | "income";
  /** Есть ли вообще с чем сравнивать (например, нет предыдущих периодов). */
  comparable?: boolean;
  /** Подпись, когда разница пренебрежимо мала. */
  sameLabel?: string;
  upTitle?: string;
  downTitle?: string;
  /** Как записать разницу: по умолчанию деньгами в базовой валюте. */
  formatAmount?: (abs: number) => string;
}) {
  // Все три состояния — «не с чем сравнивать», «без изменений» и сама пилюля —
  // занимают ОДИНАКОВУЮ коробку. Иначе строка таблицы становится ниже там, где
  // изменений нет, и высота блока пляшет от данных.
  // Строка 16 px, по середине строки и с отрицательным полем в 2 px: в ячейке
  // таблицы пилюля не раздвигает строку дальше стандартных 37 px.
  const box =
    "inline-flex items-center gap-0.5 px-1.5 py-0.5 -my-0.5 rounded-full text-[0.85em] leading-4 align-middle tabular-nums";
  const quiet = `${box} bg-panel2 text-muted`;
  if (!comparable)
    return (
      <span className={quiet} title="Сравнивать не с чем">
        —
      </span>
    );
  const from = baseline ?? 0;
  const diff = current - from;
  // Полтинник копеек — это не изменение, а шум округления.
  if (Math.abs(diff) < 0.5) {
    return (
      <span className={quiet} title={sameLabel}>
        —
      </span>
    );
  }
  const up = diff > 0;
  const good = kind === "expense" ? !up : up;
  const cls = good ? "text-income bg-income/10" : "text-expense bg-expense/10";
  // Относительное изменение считается от МОДУЛЯ базы. Раньше здесь стояло
  // `from < 0.5`, и любая ОТРИЦАТЕЛЬНАЯ база (например чистый поток −107 915 ₽)
  // попадала в ветку «делить не на что» и выдавала «∞», хотя проценты тут
  // прекрасно считаются: дефицит вырос на 52%.
  const scale = Math.abs(from);
  // Через ноль относительного изменения не существует: рост с +9 387 до
  // −110 179 давал «1274%», хотя это не рост в 12 раз, а смена знака. В таких
  // случаях показываем разницу деньгами — она осмысленна всегда.
  const flipped = from !== 0 && current !== 0 && Math.sign(from) !== Math.sign(current);
  const amount = formatAmount ? formatAmount(Math.abs(diff)) : formatMoney(Math.abs(diff), base);
  const pctOf = (share: number) => (share < 0.005 ? "менее 1%" : formatPct(share, 0));
  let label: string;
  if (mode === "both") {
    label = flipped || scale < 0.5 ? amount : `${amount} (${pctOf(Math.abs(diff) / scale)})`;
  } else if (mode === "money" || flipped) {
    label = amount;
  } else if (scale < 0.5) {
    // Роста «с нуля» в процентах действительно не существует.
    label = "∞";
  } else {
    // Округлённый до целого ноль — это не «ничего не изменилось», а «изменилось
    // меньше процента». Цветная пилюля с надписью «0%» читается как ошибка.
    label = pctOf(Math.abs(diff) / scale);
  }
  return (
    <span
      className={`${box} ${cls} whitespace-nowrap`}
      title={up ? upTitle : downTitle}
    >
      {up ? "▲" : "▼"} {label}
    </span>
  );
}
