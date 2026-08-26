/** Колонка чисел в строке-мере: своя ширина, свой вес. */
export interface MeterCell {
  text: string;
  /** Класс ширины — общий у ячейки и у её заголовка, иначе колонки разъедутся. */
  width: string;
  muted?: boolean;
}

/**
 * Строка-мера: подпись, доля полосой и числа колонками.
 *
 * Полоса лежит ПОД строкой заливкой, а не отдельной линией под ней. Так пункт
 * занимает одну строку вместо трёх, а пустота между коротким именем и суммой —
 * та самая, что зияла во всю ширину монитора, — превращается в саму меру.
 *
 * Числа стоят колонками фиксированной ширины и подписаны шапкой. Слепленные в
 * одну строчку «18% · 38» читались как одно непонятное значение и не давали
 * сравнить соседние пункты: чтобы понять, где больше операций, приходилось
 * выискивать второе число в каждой строке.
 *
 * Один примитив на все списки долей продукта: статьи, контрагенты, дни недели,
 * категории-движители. Это один и тот же вопрос «какая доля у кого», и отвечать
 * на него разными способами на соседних страницах незачем.
 */
export function MeterRow({
  rank,
  icon,
  label,
  share,
  cells,
  barCls,
  strong,
  onClick,
  title,
}: {
  /** Номер в списке. Пусто — там, где порядок не про рейтинг (дни недели). */
  rank?: number;
  /** Значок вместо номера: направление, тип, цвет категории. */
  icon?: React.ReactNode;
  label: string;
  /** Доля от 0 до 1 — ширина полосы. */
  share: number;
  cells: MeterCell[];
  barCls: string;
  /** Выделить как лидера: полоса плотнее, подпись контрастнее. */
  strong?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-md ${barCls} ${
          strong ? "opacity-30" : "opacity-[0.16]"
        }`}
        style={{ width: `${Math.max(1.5, Math.min(100, share * 100))}%` }}
      />
      {rank !== undefined && (
        <span className="relative text-[11px] text-muted tabular-nums w-4 shrink-0">
          {rank}
        </span>
      )}
      {icon && <span className="relative shrink-0 flex items-center">{icon}</span>}
      <span className={`relative truncate flex-1 min-w-0 ${strong ? "font-medium" : ""}`}>
        {label}
      </span>
      {cells.map((c, i) => (
        <span
          key={i}
          className={`relative tabular-nums whitespace-nowrap shrink-0 text-right ${c.width} ${
            c.muted ? "text-[11px] text-muted" : "font-medium"
          }`}
        >
          {c.text}
        </span>
      ))}
    </>
  );
  const cls =
    "relative w-full flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 overflow-hidden";
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${cls} hover:ring-1 hover:ring-border`}
    >
      {inner}
    </button>
  );
}

/** Шапка колонок строки-меры. Ширины обязаны совпадать с ячейками. */
export function MeterHead({
  columns,
  lead,
}: {
  columns: MeterCell[];
  /** Ширина места под номер или значок слева — как у строк списка. */
  lead?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
      <span className={`shrink-0 ${lead ?? "w-4"}`} />
      <span className="flex-1 min-w-0" />
      {columns.map((c, i) => (
        <span key={i} className={`shrink-0 text-right ${c.width}`}>
          {c.text}
        </span>
      ))}
    </div>
  );
}
