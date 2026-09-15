import { SortButton } from "./table/TableParts";
import { alignOf, scaledWidth, type ColumnType, type SortDir } from "./table/tableKit";

/**
 * Промежуток между именем и колонками — общий у строки и у её шапки. Разойдись
 * они хоть на четыре пикселя, подписи колонок встанут не над своими числами.
 */
// Не экспортируется: файл с компонентами, а лишний экспорт ломает горячую
// перезагрузку — правило `react-refresh/only-export-components`.
const METER_GAP = { underlay: "gap-2", track: "gap-3" } as const;

/** Колонка чисел в строке-мере: своя ширина, свой вес. */
export interface MeterCell {
  text: string;
  /**
   * Ширина (`rem`) — общая у ячейки и у её заголовка, иначе колонки разъедутся.
   * Растёт вместе с размером текста таблиц, как ширины колонок `DataTable`.
   */
  width: string;
  /** Второстепенное число — приглушённо, того же размера. Главное — 500. */
  muted?: boolean;
  /** Ключ сортировки — у колонки шапки, если список сортируется по ней. */
  sortKey?: string;
  /**
   * Тип колонки из табличного стандарта — от него выравнивание, одно у ячейки и
   * у её заголовка: доля и счётчик влево, суммы вправо. По умолчанию — сумма.
   */
  type?: ColumnType;
}

const CELL_ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
const HEAD_ALIGN = { left: "justify-start", right: "justify-end", center: "justify-center" } as const;

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
  bar = "underlay",
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
  /**
   * Как нарисована мера.
   *
   * `underlay` — заливка под строкой: полоса и есть строка. Годится там, где
   * доля берётся ОТ ЦЕЛОГО и пункты стоят по убыванию: полосы сходят на нет
   * сверху вниз, и заливка читается как «столько от всего».
   *
   * `track` — отдельная тонкая дорожка под именем. Нужна там, где доля не от
   * целого, а от самого большого в списке: заливка во всю высоту строки в
   * таком списке читается как подсветка выделенной строки, а её правый край
   * обрывается посреди пустоты — мера ниоткуда и никуда.
   */
  bar?: "underlay" | "track";
  /** Выделить как лидера: полоса плотнее, подпись контрастнее. */
  strong?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const numbers = cells.map((c, i) => (
    <span
      key={i}
      className={`relative tabular-nums whitespace-nowrap shrink-0 ${CELL_ALIGN[alignOf(c.type ?? "money")]} ${
        c.muted ? "text-muted" : "font-medium"
      }`}
      style={{ width: scaledWidth(c.width) }}
    >
      {c.text}
    </span>
  ));
  const width = `${Math.max(1.5, Math.min(100, share * 100))}%`;

  const inner =
    bar === "track" ? (
      <>
        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 min-w-0">
            {icon && <span className="shrink-0 flex items-center">{icon}</span>}
            <span className={`truncate ${strong ? "font-medium" : ""}`}>{label}</span>
          </span>
          <span className="relative h-1 rounded-full bg-panel2">
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 rounded-full ${barCls}`}
              style={{ width }}
            />
          </span>
        </span>
        {numbers}
      </>
    ) : (
      <>
        {/* Дорожка полосы кончается там, где начинаются колонки чисел: полная
            полоса раньше уходила ПОД суммы, и число читалось на цветной
            заливке, а сама мера будто продолжалась за край. Растянута на всю
            высоту строки отрицательными полями — чтобы заливка по-прежнему
            смотрелась подложкой строки, а не полоской внутри неё. */}
        <span className="relative flex-1 min-w-0 flex items-center gap-2 self-stretch -my-1.5 py-1.5 rounded-md overflow-hidden">
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 rounded-md ${barCls} ${
              strong ? "opacity-30" : "opacity-[0.16]"
            }`}
            style={{ width }}
          />
          {rank !== undefined && (
            <span className="relative text-muted tabular-nums w-5 shrink-0">
              {rank}
            </span>
          )}
          {icon && <span className="relative shrink-0 flex items-center">{icon}</span>}
          <span className={`relative truncate min-w-0 ${strong ? "font-medium" : ""}`}>
            {label}
          </span>
        </span>
        {numbers}
      </>
    );
  const cls = [
    "meter-list relative w-full flex items-center text-left rounded-md px-2 py-1.5",
    bar === "track" ? METER_GAP.track : METER_GAP.underlay,
  ].join(" ");
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
  bar = "underlay",
  nameLabel,
  sort,
  onSort,
}: {
  columns: MeterCell[];
  /** Ширина места под номер или значок слева — как у строк списка. */
  lead?: string;
  /** Тот же режим, что у строк: от него зависит промежуток до колонок. */
  bar?: "underlay" | "track";
  /** Подпись колонки имени. */
  nameLabel?: string;
  /** Текущая сортировка списка; колонки с `sortKey` становятся кнопками. */
  sort?: { key: string; dir: SortDir };
  onSort?: (key: string) => void;
}) {
  const sortOf = (key?: string) =>
    key && sort && onSort
      ? { active: sort.key === key, dir: sort.dir, onToggle: () => onSort(key) }
      : undefined;
  return (
    // Поля 6 и 5 с чертой снизу — 32 px, как строка списка.
    <div className={`list-head flex items-center ${METER_GAP[bar]} px-2 pt-1.5 pb-[5px] mb-1`}>
      {lead !== "" && <span className={`shrink-0 ${lead ?? "w-5"}`} />}
      <span className="flex-1 min-w-0 flex">
        {nameLabel &&
          (sortOf("name") ? <SortButton label={nameLabel} sort={sortOf("name")!} /> : nameLabel)}
      </span>
      {columns.map((c, i) => {
        const s = sortOf(c.sortKey);
        return (
          <span
            key={i}
            className={`shrink-0 flex ${HEAD_ALIGN[alignOf(c.type ?? "money")]}`}
            style={{ width: scaledWidth(c.width) }}
          >
            {s ? <SortButton label={c.text} sort={s} /> : c.text}
          </span>
        );
      })}
    </div>
  );
}
