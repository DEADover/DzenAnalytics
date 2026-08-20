/**
 * Раскладка главной: какие виджеты на ней стоят, в каком порядке и какой
 * ширины.
 *
 * Сетка главной — три колонки, и виджет занимает треть, две трети или всю
 * ширину. Других размеров нет намеренно: по такой сетке любая перестановка
 * складывается в ровные ряды, а по произвольным пропорциям — не складывается.
 *
 * Ширина у каждого виджета своя и пока не настраивается: она часть самого
 * виджета, а не раскладки. Человек задаёт порядок и состав.
 *
 * Здесь только модель и чистые преобразования над ней: что за виджеты бывают,
 * какая раскладка считается стандартной и что происходит с раскладкой при
 * переносе, убирании и возврате виджета. Как это рисуется — дело
 * `DashboardView`, где раскладка живёт — дело `useDashboardLayoutStore`.
 */

export type WidgetSpan = 1 | 2 | 3;

export const WIDGET_IDS = [
  "month",
  "accounts",
  "upcoming",
  "quicklinks",
  "cashflow",
  "categories",
  "activity",
  "observations",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export interface WidgetMeta {
  id: WidgetId;
  /** Как виджет называется в настройке раскладки. */
  title: string;
  /** Одна строка о том, что внутри: список скрытых иначе читается загадкой. */
  hint: string;
  /**
   * Ширина в колонках сетки. Задаётся виджетом и пока не настраивается: у
   * каждого блока есть ширина, на которой он читается, и разъезжаться ей
   * незачем — календарю нужны семь колонок клеток, списку статей хватает трети.
   */
  span: WidgetSpan;
  /** Рисует себя сам, без поддона с двойным кантом. */
  bare?: boolean;
  /** Высота по содержимому, а не общая высота ряда. */
  autoHeight?: boolean;
}

/**
 * Порядок здесь — стандартная раскладка главной. Она же задаёт, куда встанет
 * виджет, добавленный в следующих версиях: рядом со своими соседями, а не в
 * конец страницы.
 */
export const WIDGETS: readonly WidgetMeta[] = [
  {
    id: "month",
    title: "Итоги месяца",
    hint: "Свободные деньги, темп трат, доход и расход",
    span: 1,
    bare: true,
  },
  {
    id: "accounts",
    title: "Балансы счетов",
    hint: "Совокупный баланс и остаток на каждом счёте",
    span: 1,
  },
  {
    id: "upcoming",
    title: "Запланированные платежи",
    hint: "Что спишется до конца месяца",
    span: 1,
  },
  {
    id: "quicklinks",
    title: "Быстрые переходы",
    hint: "Кнопки в бюджеты, цели, правила, теги, сравнения и динамику",
    // Дорожка из шести кнопок: на трети от неё остаются одни значки.
    span: 3,
    bare: true,
    autoHeight: true,
  },
  {
    id: "cashflow",
    title: "Доходы и расходы",
    hint: "Столбцы за последние двенадцать месяцев и прогноз",
    span: 2,
  },
  {
    id: "categories",
    title: "Расходы по категориям",
    hint: "На что ушли деньги в этом месяце",
    span: 1,
  },
  {
    id: "activity",
    title: "Активность в этом месяце",
    hint: "Календарь трат по дням",
    span: 2,
  },
  {
    id: "observations",
    title: "Авто-наблюдения",
    hint: "Что выбилось из обычного: перерасход, подписки, пропуски",
    span: 1,
  },
];

const BY_ID = new Map<string, WidgetMeta>(WIDGETS.map((w) => [w.id, w]));

/** Наш ли это виджет: на плитку можно уронить и файл, и ссылку, и просто текст. */
export function isWidgetId(id: string): id is WidgetId {
  return BY_ID.has(id);
}

export function widgetMeta(id: WidgetId): WidgetMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`Неизвестный виджет: ${id}`);
  return meta;
}

/** Место виджета на главной. Убранный остаётся в списке — чтобы вернуться туда же. */
export interface WidgetPlacement {
  id: WidgetId;
  hidden?: boolean;
}

export const DEFAULT_LAYOUT: readonly WidgetPlacement[] = WIDGETS.map((w) => ({ id: w.id }));

/**
 * Привести сохранённую раскладку к рабочему виду.
 *
 * Мусор и виджеты, которых больше нет, выкидываем; повторы схлопываем. Виджет,
 * появившийся в новой версии, в сохранённой раскладке отсутствует — его ставим
 * на место по стандартному порядку: сразу за тем соседом, который в раскладке
 * уже есть. Иначе всё новое копилось бы в подвале страницы.
 */
export function normalizeLayout(raw: unknown): WidgetPlacement[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: WidgetPlacement[] = [];
  const seen = new Set<WidgetId>();

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const meta = BY_ID.get(id);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    const placement: WidgetPlacement = { id: meta.id };
    if ((item as { hidden?: unknown }).hidden === true) placement.hidden = true;
    out.push(placement);
  }

  WIDGETS.forEach((meta, i) => {
    if (seen.has(meta.id)) return;
    // Ищем ближайшего соседа слева по стандартному порядку: за ним и встанем.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const anchor = out.findIndex((p) => p.id === WIDGETS[j].id);
      if (anchor !== -1) {
        at = anchor + 1;
        break;
      }
    }
    out.splice(at, 0, { id: meta.id });
    seen.add(meta.id);
  });

  return out;
}

/** Перенести виджет на место другого — то же, что перетащить его туда мышью. */
export function moveWidget(
  layout: readonly WidgetPlacement[],
  dragId: WidgetId,
  overId: WidgetId
): WidgetPlacement[] {
  if (dragId === overId) return layout.slice();
  const from = layout.findIndex((p) => p.id === dragId);
  const to = layout.findIndex((p) => p.id === overId);
  if (from === -1 || to === -1) return layout.slice();
  const next = layout.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Сдвинуть виджет на шаг вперёд или назад — это делают стрелки с клавиатуры.
 *
 * Убранные виджеты пропускаем: их на экране нет, и шаг «через невидимое»
 * выглядел бы как нажатие вхолостую.
 */
export function shiftWidget(
  layout: readonly WidgetPlacement[],
  id: WidgetId,
  dir: -1 | 1
): WidgetPlacement[] {
  const visible: number[] = [];
  layout.forEach((p, i) => {
    if (!p.hidden) visible.push(i);
  });
  const at = visible.findIndex((i) => layout[i].id === id);
  if (at === -1) return layout.slice();
  const to = at + dir;
  if (to < 0 || to >= visible.length) return layout.slice();
  const next = layout.slice();
  const a = visible[at];
  const b = visible[to];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Убрать виджет с главной или вернуть его на прежнее место. */
export function setWidgetHidden(
  layout: readonly WidgetPlacement[],
  id: WidgetId,
  hidden: boolean
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.id !== id) return p;
    const next: WidgetPlacement = { id: p.id };
    if (hidden) next.hidden = true;
    return next;
  });
}

/** Совпадает ли раскладка со стандартной — по ней гаснет кнопка «Сбросить». */
export function isDefaultLayout(layout: readonly WidgetPlacement[]): boolean {
  if (layout.length !== DEFAULT_LAYOUT.length) return false;
  return layout.every((p, i) => p.id === DEFAULT_LAYOUT[i].id && !p.hidden);
}
