/**
 * Раскладка главной: какие виджеты на ней стоят, в каком порядке и что у них
 * внутри.
 *
 * Сетка главной — три колонки, и виджет занимает треть, две трети или всю
 * ширину. Ширина у каждого своя и не настраивается: она часть самого виджета,
 * а не раскладки. Человек задаёт порядок и состав.
 *
 * Почти все виджеты — в одном экземпляре: два календаря на экране никому не
 * нужны. Исключение — дорожка кнопок: у неё нет своего содержимого, только
 * набор разделов, и таких дорожек можно поставить сколько угодно. Поэтому у
 * места в раскладке есть и вид (`kind`), и собственный ключ (`key`): у
 * одиночных они совпадают, у дорожек — нет.
 *
 * Здесь только модель и чистые преобразования над ней. Как это рисуется — дело
 * `DashboardView`, где раскладка живёт — дело `useDashboardLayoutStore`.
 */

import { SECONDARY, navSection } from "./navSections";

export type WidgetSpan = 1 | 2 | 3;

export const WIDGET_KINDS = [
  "month",
  "accounts",
  "upcoming",
  "links",
  "cashflow",
  "categories",
  "activity",
  "observations",
] as const;

export type WidgetKind = (typeof WIDGET_KINDS)[number];

export interface WidgetMeta {
  kind: WidgetKind;
  /** Как виджет называется в настройке раскладки. */
  title: string;
  /** Одна строка о том, что внутри: список убранных иначе читается загадкой. */
  hint: string;
  /**
   * Ширина в колонках сетки. Задаётся виджетом и не настраивается: у каждого
   * блока есть ширина, на которой он читается, и разъезжаться ей незачем —
   * календарю нужны семь колонок клеток, списку статей хватает трети.
   */
  span: WidgetSpan;
  /** Рисует себя сам, без поддона с двойным кантом. */
  bare?: boolean;
  /** Высота по содержимому, а не общая высота ряда. */
  autoHeight?: boolean;
  /** Таких виджетов на главной может стоять несколько. */
  multi?: boolean;
  /**
   * В режиме настройки виджет остаётся живым: он настраивается сам, изнутри, а
   * не только ручками обоймы. Содержимое не приглушается и ловит нажатия.
   */
  live?: boolean;
}

/** Сколько кнопок помещается в одну дорожку. Больше — заводите вторую. */
export const MAX_LINKS = 6;

/** Дорожка из нуля кнопок — это отсутствие дорожки. */
export const MIN_LINKS = 1;

/** Кнопки первой дорожки: то, чем «Быстрые переходы» были до всякой настройки. */
export const DEFAULT_LINKS = [
  "/budgets",
  "/goals",
  "/rules",
  "/tags",
  "/compare",
  "/dynamics",
];

/**
 * Порядок здесь — стандартная раскладка главной. Он же задаёт, куда встанет
 * виджет, добавленный в следующих версиях: рядом со своими соседями, а не в
 * конец страницы.
 */
export const WIDGETS: readonly WidgetMeta[] = [
  {
    kind: "month",
    title: "Итоги месяца",
    hint: "Свободные деньги, темп трат, доход и расход",
    span: 1,
    bare: true,
  },
  {
    kind: "accounts",
    title: "Балансы счетов",
    hint: "Совокупный баланс и остаток на каждом счёте",
    span: 1,
  },
  {
    kind: "upcoming",
    title: "Запланированные платежи",
    hint: "Что спишется до конца месяца",
    span: 1,
  },
  {
    kind: "links",
    title: "Дорожка кнопок",
    hint: "Быстрые переходы в разделы, до шести кнопок в ряд",
    // Всегда во всю строку: даже одна кнопка стоит в полноширинной дорожке, а
    // не сжимает ряд — иначе соседний виджет пришлось бы тянуть под её высоту.
    span: 3,
    bare: true,
    autoHeight: true,
    multi: true,
    live: true,
  },
  {
    kind: "cashflow",
    title: "Доходы и расходы",
    hint: "Столбцы за последние двенадцать месяцев и прогноз",
    span: 2,
  },
  {
    kind: "categories",
    title: "Расходы по категориям",
    hint: "На что ушли деньги в этом месяце",
    span: 1,
  },
  {
    kind: "activity",
    title: "Активность в этом месяце",
    hint: "Календарь трат по дням",
    span: 2,
  },
  {
    kind: "observations",
    title: "Авто-наблюдения",
    hint: "Что выбилось из обычного: перерасход, подписки, пропуски",
    span: 1,
  },
];

const BY_KIND = new Map<string, WidgetMeta>(WIDGETS.map((w) => [w.kind, w]));

export function widgetMeta(kind: WidgetKind): WidgetMeta {
  const meta = BY_KIND.get(kind);
  if (!meta) throw new Error(`Неизвестный виджет: ${kind}`);
  return meta;
}

/** Место виджета на главной. Убранный остаётся в списке — чтобы вернуться туда же. */
export interface WidgetPlacement {
  /** Уникален в раскладке. У одиночных виджетов совпадает с видом. */
  key: string;
  kind: WidgetKind;
  hidden?: boolean;
  /** Только у дорожки: пути разделов, стоящих на ней кнопками. */
  links?: string[];
}

export const DEFAULT_LAYOUT: readonly WidgetPlacement[] = WIDGETS.map((w) =>
  w.kind === "links"
    ? { key: "links", kind: "links" as const, links: DEFAULT_LINKS.slice() }
    : { key: w.kind, kind: w.kind }
);

/** Свежая копия стандартной раскладки: списки кнопок в ней свои, не общие. */
export function defaultLayout(): WidgetPlacement[] {
  return DEFAULT_LAYOUT.map((p) => (p.links ? { ...p, links: p.links.slice() } : { ...p }));
}

/* ─────────────────────────────  разбор  ───────────────────────────── */

/**
 * Оставить только существующие разделы, без повторов и не больше шести.
 *
 * Пустой список означает, что дорожки нет: `null` — сигнал выбросить её из
 * раскладки.
 */
function cleanLinks(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !navSection(item) || out.includes(item)) continue;
    out.push(item);
    if (out.length === MAX_LINKS) break;
  }
  return out.length >= MIN_LINKS ? out : null;
}

/**
 * Привести сохранённую раскладку к рабочему виду.
 *
 * Мусор и виджеты, которых больше нет, выкидываем; повторы схлопываем. Виджет,
 * появившийся в новой версии, в сохранённой раскладке отсутствует — его ставим
 * на место по стандартному порядку: сразу за тем соседом, который в раскладке
 * уже есть. Иначе всё новое копилось бы в подвале страницы. Дорожек это не
 * касается: снятую дорожку возвращать против воли человека нельзя, их и
 * заводят по одной.
 */
export function normalizeLayout(raw: unknown): WidgetPlacement[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: WidgetPlacement[] = [];
  const keys = new Set<string>();
  const kinds = new Set<WidgetKind>();

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { key?: unknown; kind?: unknown; hidden?: unknown; links?: unknown };
    const kind = typeof rec.kind === "string" ? BY_KIND.get(rec.kind) : undefined;
    if (!kind) continue;
    // У одиночного виджета вид и есть ключ: второй такой же — уже повтор.
    if (!kind.multi && kinds.has(kind.kind)) continue;
    const key = typeof rec.key === "string" && rec.key ? rec.key : kind.kind;
    if (keys.has(key)) continue;

    const placement: WidgetPlacement = { key, kind: kind.kind };
    if (kind.kind === "links") {
      const links = cleanLinks(rec.links);
      if (!links) continue;
      placement.links = links;
    }
    if (rec.hidden === true) placement.hidden = true;

    keys.add(key);
    kinds.add(kind.kind);
    out.push(placement);
  }

  WIDGETS.forEach((meta, i) => {
    if (meta.multi || kinds.has(meta.kind)) return;
    // Ищем ближайшего соседа слева по стандартному порядку: за ним и встанем.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const anchor = out.findIndex((p) => p.kind === WIDGETS[j].kind);
      if (anchor !== -1) {
        at = anchor + 1;
        break;
      }
    }
    out.splice(at, 0, { key: meta.kind, kind: meta.kind });
    keys.add(meta.kind);
    kinds.add(meta.kind);
  });

  return out;
}

/**
 * Раскладка из хранилища.
 *
 * Отдельно от `normalizeLayout`, потому что «ничего не сохранено» и «сохранена
 * раскладка без дорожки» — разные вещи. В первом случае человек ещё ничего не
 * настраивал, и главная должна открыться стандартной, с дорожкой быстрых
 * переходов. Во втором дорожку сняли руками, и возвращать её нельзя.
 */
export function layoutFromStored(raw: unknown): WidgetPlacement[] {
  if (!Array.isArray(raw) || raw.length === 0) return defaultLayout();
  // Если в сохранённом не узнан НИ ОДИН виджет, это не «человек всё убрал», а
  // раскладка из другой версии или испорченная запись. Молча выдать половину
  // главной хуже, чем собрать её заново.
  const known = raw.some(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { kind?: unknown }).kind === "string" &&
      BY_KIND.has((item as { kind: string }).kind)
  );
  return known ? normalizeLayout(raw) : defaultLayout();
}

/* ─────────────────────────────  порядок  ───────────────────────────── */

/** Перенести виджет на место другого — то же, что перетащить его туда мышью. */
export function moveWidget(
  layout: readonly WidgetPlacement[],
  dragKey: string,
  overKey: string
): WidgetPlacement[] {
  if (dragKey === overKey) return layout.slice();
  const from = layout.findIndex((p) => p.key === dragKey);
  const to = layout.findIndex((p) => p.key === overKey);
  if (from === -1 || to === -1) return layout.slice();
  const next = layout.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Сдвинуть виджет на шаг вперёд или назад — это делают стрелки.
 *
 * Убранные виджеты пропускаем: их на экране нет, и шаг «через невидимое»
 * выглядел бы как нажатие вхолостую.
 */
export function shiftWidget(
  layout: readonly WidgetPlacement[],
  key: string,
  dir: -1 | 1
): WidgetPlacement[] {
  const visible: number[] = [];
  layout.forEach((p, i) => {
    if (!p.hidden) visible.push(i);
  });
  const at = visible.findIndex((i) => layout[i].key === key);
  if (at === -1) return layout.slice();
  const to = at + dir;
  if (to < 0 || to >= visible.length) return layout.slice();
  const next = layout.slice();
  const a = visible[at];
  const b = visible[to];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/* ─────────────────────────────  состав  ───────────────────────────── */

/** Убрать виджет с главной или вернуть его на прежнее место. */
export function setWidgetHidden(
  layout: readonly WidgetPlacement[],
  key: string,
  hidden: boolean
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.key !== key) return p;
    const next: WidgetPlacement = { key: p.key, kind: p.kind };
    if (p.links) next.links = p.links;
    if (hidden) next.hidden = true;
    return next;
  });
}

/**
 * Убрать виджет из раскладки насовсем.
 *
 * Только то, что человек сам и завёл: одиночный виджет так удалить нельзя —
 * его неоткуда взять обратно, для него есть «убрать» с полкой. Дорожку же
 * собирают из разделов за полминуты, и держать снятую вечно на полке, без
 * возможности от неё избавиться, — тупик.
 */
export function removeWidget(
  layout: readonly WidgetPlacement[],
  key: string
): WidgetPlacement[] {
  const p = layout.find((x) => x.key === key);
  if (!p || !widgetMeta(p.kind).multi) return layout.slice();
  return layout.filter((x) => x.key !== key);
}

/** Ключ для новой дорожки: `links`, `links-2`, `links-3`… */
function nextLinksKey(layout: readonly WidgetPlacement[]): string {
  const taken = new Set(layout.map((p) => p.key));
  if (!taken.has("links")) return "links";
  for (let n = 2; ; n++) {
    const key = `links-${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Кнопка для новой дорожки — первый раздел, которого ещё нет ни на одной.
 *
 * Заводить дорожку с той же кнопкой, что уже стоит рядом, бессмысленно; а если
 * на главной собраны уже все разделы, берём первый по порядку «Ещё».
 */
function firstUnusedLink(layout: readonly WidgetPlacement[]): string {
  const used = new Set(layout.flatMap((p) => p.links ?? []));
  return (SECONDARY.find((s) => !used.has(s.to)) ?? SECONDARY[0]).to;
}

/** Завести новую дорожку кнопок — она встаёт в конец раскладки. */
export function addLinksRow(layout: readonly WidgetPlacement[]): WidgetPlacement[] {
  return [
    ...layout,
    {
      key: nextLinksKey(layout),
      kind: "links",
      links: [firstUnusedLink(layout)],
    },
  ];
}

/**
 * Задать набор кнопок дорожки.
 *
 * Последнюю кнопку убрать нельзя: дорожка без кнопок — пустая полоса, которую
 * человеку пришлось бы искать глазами, чтобы снять. Убирают саму дорожку.
 */
export function setRowLinks(
  layout: readonly WidgetPlacement[],
  key: string,
  links: readonly string[]
): WidgetPlacement[] {
  const clean = cleanLinks(links);
  if (!clean) return layout.slice();
  return layout.map((p) => (p.key === key ? { ...p, links: clean } : p));
}

/** Совпадает ли раскладка со стандартной — по ней гаснет кнопка «Сбросить». */
export function isDefaultLayout(layout: readonly WidgetPlacement[]): boolean {
  if (layout.length !== DEFAULT_LAYOUT.length) return false;
  return layout.every((p, i) => {
    const d = DEFAULT_LAYOUT[i];
    if (p.key !== d.key || p.kind !== d.kind || p.hidden) return false;
    return (p.links ?? []).join() === (d.links ?? []).join();
  });
}
