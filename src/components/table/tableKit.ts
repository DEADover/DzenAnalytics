/**
 * Табличный стандарт в одном месте.
 *
 * Раньше каждая таблица решала за себя: одна страница ставила деньги по центру,
 * другая прижимала числа влево, третья красила три колонки сумм сразу, а
 * сортировка была написана пятью разными способами. Здесь у колонки есть ТИП,
 * и из него следует всё остальное — выравнивание, начертание, цвет, первое
 * направление сортировки и попадание в выгрузку. Страница выбирает тип и
 * больше не пишет ни `text-right`, ни `text-expense`.
 *
 * Модуль без React: логику сортировки и выгрузки можно проверить тестами.
 */
import clsx from "clsx";

export type SortDir = "asc" | "desc";

/**
 * - `text` — название, контрагент, комментарий. Влево.
 * - `date` — дата. Влево, приглушённо, табличные цифры.
 * - `money` — сумма. Вправо, обычным цветом.
 * - `main` — главная сумма таблицы, одна на таблицу. Вправо, 500, цвет стороны.
 * - `balance` — остаток: сколько лежит на счёте сейчас (или накоплено), а не
 *   сколько прошло за период. Влево, 500, цвет — только у минуса. Главная
 *   колонка «Капитала» вместо `main`.
 * - `number` — число, но не деньги: ставка, дни, σ, «во сколько раз». Вправо.
 * - `pct` — доля. Влево, приглушённо.
 * - `change` — изменение: знак, процент или пилюля. Вправо.
 * - `count` — счётчик: операций, совпадений, упоминаний. Вправо, приглушённо.
 * - `mark` — статус, метка, значок. По центру.
 * - `actions` — кнопки. По центру, не сортируется и не выгружается.
 *
 * Доля и остаток прижаты влево по решению пользователя (14.09.2026): по
 * центру они казались уехавшими, а прижатые вправо узкие колонки с подписью и
 * значком сортировки читались сдвинутыми относительно шапки. Счётчик сначала
 * ушёл туда же, но 15.09.2026 пользователь вернул «Операций» вправо — к числам,
 * как суммы.
 */
export type ColumnType =
  | "text"
  | "date"
  | "money"
  | "main"
  | "balance"
  | "number"
  | "pct"
  | "change"
  | "count"
  | "mark"
  | "actions";

export type Align = "left" | "right" | "center";

/**
 * Цвет главной суммы или метки. `neutral` — без цвета стороны (остаток,
 * баланс); `accent2` — возврат; `muted` — перевод.
 */
export type Tone = "expense" | "income" | "accent2" | "warn" | "muted" | "neutral";

/** Плотность строк: обычная — 37 px, компактная — 32 px (списки на главной). */
export type Density = "regular" | "compact";

interface TypeSpec {
  align: Align;
  /** Классы содержимого ячейки. */
  cell: string;
  /** Направление при первом клике по шапке. */
  firstDir: SortDir;
  sortable: boolean;
  exported: boolean;
}

const NUM = "tabular-nums whitespace-nowrap";

export const COLUMN_TYPES: Record<ColumnType, TypeSpec> = {
  text: { align: "left", cell: "", firstDir: "asc", sortable: true, exported: true },
  date: { align: "left", cell: `${NUM} text-muted`, firstDir: "desc", sortable: true, exported: true },
  money: { align: "right", cell: NUM, firstDir: "desc", sortable: true, exported: true },
  main: { align: "right", cell: `${NUM} font-medium`, firstDir: "desc", sortable: true, exported: true },
  balance: { align: "left", cell: `${NUM} font-medium`, firstDir: "desc", sortable: true, exported: true },
  number: { align: "right", cell: NUM, firstDir: "desc", sortable: true, exported: true },
  pct: { align: "left", cell: `${NUM} text-muted`, firstDir: "desc", sortable: true, exported: true },
  change: { align: "right", cell: NUM, firstDir: "desc", sortable: true, exported: true },
  count: { align: "right", cell: `${NUM} text-muted`, firstDir: "desc", sortable: true, exported: true },
  mark: { align: "center", cell: "whitespace-nowrap", firstDir: "asc", sortable: true, exported: true },
  actions: { align: "center", cell: "whitespace-nowrap", firstDir: "asc", sortable: false, exported: false },
};

export const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export const TONE_CLASS: Record<Tone, string> = {
  expense: "text-expense",
  income: "text-income",
  accent2: "text-accent2",
  warn: "text-warn",
  muted: "text-muted",
  neutral: "",
};

/** Цвет по знаку: минус — расход, ноль и плюс — доход. Для «чистых» сумм. */
export function toneOfSigned(value: number): Tone {
  return value < 0 ? "expense" : "income";
}

export function alignOf(type: ColumnType): Align {
  return COLUMN_TYPES[type].align;
}

/** Классы шапки колонки. */
export function headClass(type: ColumnType, className?: string): string {
  return clsx("table-th", ALIGN_CLASS[alignOf(type)], className);
}

/**
 * Классы ячейки. Цвет берётся только у главной суммы (или остатка) и у метки —
 * правило «цвет у одной суммы на таблицу» держится здесь, а не на каждой
 * странице.
 */
export function cellClass(
  type: ColumnType,
  opts: { muted?: boolean; tone?: Tone; className?: string } = {}
): string {
  const spec = COLUMN_TYPES[type];
  const colored = type === "main" || type === "balance" || type === "mark";
  return clsx(
    "table-td",
    ALIGN_CLASS[spec.align],
    spec.cell,
    opts.muted && "text-muted",
    colored && opts.tone && TONE_CLASS[opts.tone],
    opts.className
  );
}

/** Где стоит уголок дерева первого уровня: поле ячейки 12 + шеврон 16 + промежуток 6. */
export const TREE_ELBOW_LEFT = 34;
/** Сдвиг каждого следующего уровня дерева. */
export const TREE_STEP = 18;

/**
 * Ширина колонки, растущая вместе с настройкой «Размер текста в таблицах».
 *
 * Ширины заданы в `rem` под текст 14 px. Крупнее текст — подпись шапки и
 * числа перестают помещаться в ту же колонку: на «Категориях» «Операций»
 * обрезалось до «Операц…» уже на обычном размере. Множитель `--tbl-scale`
 * (1 при 14 px) ставит вместе с `--tbl-font` сама настройка. Проценты и `auto`
 * — доли таблицы, их не трогаем.
 */
export function scaledWidth(width: string | undefined): string | undefined {
  if (!width) return undefined;
  const w = width.trim();
  if (w === "auto" || w.endsWith("%")) return w;
  return `calc(${w} * var(--tbl-scale, 1))`;
}

/** Левое поле ячейки с подстрокой уровня `depth` (1 — дети, 2 — внуки). */
export function treeIndent(depth: number): number {
  return TREE_ELBOW_LEFT + 16 + (depth - 1) * TREE_STEP;
}

export interface SortState {
  key: string | undefined;
  dir: SortDir;
}

/** Клик по шапке: та же колонка — разворот, другая — её первое направление. */
export function nextSort(current: SortState, key: string, type: ColumnType): SortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: COLUMN_TYPES[type].firstDir };
}

export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

/**
 * Сравнение для сортировки. Пустые значения всегда уходят вниз — и при
 * возрастании, и при убывании: строка без суммы не должна вставать первой
 * только потому, что направление сменили.
 */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bEmpty = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const r =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return dir === "asc" ? r : -r;
}

/** Устойчивая сортировка: равные строки сохраняют исходный порядок. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((x, y) => compareValues(x.v, y.v, dir) || x.i - y.i)
    .map((x) => x.row);
}

/**
 * Ячейка CSV. Формулы обезврежены: значение с «=», «+», «-», «@» в Excel не
 * исполнится. Обычное число, в том числе отрицательное, остаётся числом —
 * иначе расходы со знаком минус уезжали бы в Excel текстом и не суммировались.
 */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  const plainNumber = /^-?\d+(?:[.,]\d+)?$/.test(s);
  if (!plainNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Текст CSV с разделителем «;» — так его без мастера импорта открывает Excel в русской локали. */
export function buildCsv(header: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((line) => line.map(csvEscape).join(";")).join("\n");
}

/** Имя файла выгрузки: `dzenanalytics_<имя>_<дата>.csv`. */
export function csvFileName(name: string | undefined, date: Date = new Date()): string {
  const safe = (name || "table").toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "_");
  return `dzenanalytics_${safe}_${date.toISOString().slice(0, 10)}.csv`;
}

/** Скачать CSV. BOM в начале — чтобы Excel не принял UTF-8 за cp1251. */
export function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
