/**
 * Раскладка главной: какие виджеты на ней стоят, в каком порядке и что у них
 * внутри.
 *
 * Сетка главной — три колонки, и виджет занимает треть, две трети или всю
 * ширину. Ширина у каждого своя и не настраивается: она часть самого виджета,
 * а не раскладки. Человек задаёт порядок и состав.
 *
 * Почти все виджеты — в одном экземпляре: два календаря на экране никому не
 * нужны. Исключение — полоска с кнопками: у неё нет своего содержимого, только
 * набор разделов, и таких полосок можно поставить сколько угодно. Поэтому у
 * места в раскладке есть и вид (`kind`), и собственный ключ (`key`): у
 * одиночных они совпадают, у полосок — нет.
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
  "monthOverMonth",
  "categories",
  "activity",
  "observations",
  "donutExpense",
  "donutIncome",
] as const;

export type WidgetKind = (typeof WIDGET_KINDS)[number];

/**
 * Вариант оформления виджета: одно и то же место на главной, разный ответ.
 * Первый в списке — тот, что стоит по умолчанию.
 */
export interface WidgetView {
  id: string;
  title: string;
  hint: string;
  /** Этот вариант рисует себя сам, без поддона с двойным кантом. */
  bare?: boolean;
  /**
   * Утопленная плоскость вместо поддона: одна коробка, залитая глубже фона
   * страницы, с мягкой тенью и без канта. Выделяет виджет из ряда белых
   * соседей, не заводя вокруг него ещё одну рамку.
   */
  sunken?: boolean;
}

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
  /** Варианты оформления, между которыми человек выбирает в настройке. */
  views?: readonly WidgetView[];
  /**
   * Стандартно снят: место в раскладке за виджетом закреплено, но открывается
   * главная без него — он ждёт на полке, пока его не вернут.
   */
  offByDefault?: boolean;
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

/**
 * Сколько мест в полоске. Ровно шесть, и место может пустовать: ряд из шести
 * плиток ещё читается с одного взгляда, а где в нём стоят кнопки и где дырки —
 * дело человека. Нужно больше кнопок — заводится вторая полоска.
 */
export const LINK_SLOTS = 6;

/** Места полоски: путь раздела или пустое место. Длина всегда `LINK_SLOTS`. */
export type LinkSlots = (string | null)[];

/** Кнопки первой полоски: то, чем «Быстрые переходы» были до всякой настройки. */
export const DEFAULT_LINKS: LinkSlots = [
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
    views: [
      {
        id: "open",
        title: "Открытый",
        hint: "Крупное число прямо на фоне страницы, без поддона",
        bare: true,
      },
      {
        id: "framed",
        title: "В рамке",
        hint: "То же, что «Открытый», но на утопленной подложке с тенью",
        sunken: true,
      },
      {
        id: "split",
        title: "Разворот",
        hint: "В поддоне: типографика слева, числа рейкой справа",
      },
    ],
  },
  {
    kind: "accounts",
    title: "Балансы счетов",
    hint: "Совокупный баланс и остаток на каждом счёте",
    span: 1,
  },
  {
    kind: "upcoming",
    title: "Запланированные операции",
    hint: "Что спишется и что придёт до конца месяца",
    span: 1,
    views: [
      {
        id: "zen",
        title: "Из Дзен-мани",
        hint: "Расходные планы и прогнозы, заведённые в самом Дзен-мани",
      },
      {
        id: "own",
        title: "Свои",
        hint: "Регулярные платежи, вычисленные по вашей истории операций",
      },
    ],
  },
  {
    kind: "links",
    title: "Полоска с кнопками",
    hint: "Быстрые переходы в разделы, до шести кнопок в ряд",
    // Всегда во всю строку: даже одна кнопка стоит в полноширинной полоске, а
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
    kind: "monthOverMonth",
    title: "Месяц к месяцу",
    hint: "Доходы, расходы и чистый поток рядом с прошлым месяцем",
    span: 1,
    // Стандартная главная собрана в ровные ряды по три, и лишний виджет
    // оставил бы в них дырку у ВСЕХ. Кто захочет — включит его на полке.
    offByDefault: true,
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
  {
    kind: "donutExpense",
    title: "Кольцо расходов",
    hint: "Доли статей друг относительно друга, как на «Категориях»",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "donutIncome",
    title: "Кольцо доходов",
    hint: "Откуда приходят деньги, теми же кольцами",
    span: 1,
    offByDefault: true,
  },
];

const BY_KIND = new Map<string, WidgetMeta>(WIDGETS.map((w) => [w.kind, w]));

export function widgetMeta(kind: WidgetKind): WidgetMeta {
  const meta = BY_KIND.get(kind);
  if (!meta) throw new Error(`Неизвестный виджет: ${kind}`);
  return meta;
}

/**
 * Выбранный вариант оформления. Неизвестный или отсутствующий — первый в
 * списке: у виджета без вариантов вариантов и нет.
 */
export function widgetView(meta: WidgetMeta, id?: string): WidgetView | undefined {
  if (!meta.views || meta.views.length === 0) return undefined;
  return meta.views.find((v) => v.id === id) ?? meta.views[0];
}

/** Рисует ли виджет себя сам — зависит от варианта, а не только от вида. */
export function isBareWidget(meta: WidgetMeta, id?: string): boolean {
  return widgetView(meta, id)?.bare ?? meta.bare ?? false;
}

/** Место виджета на главной. Убранный остаётся в списке — чтобы вернуться туда же. */
export interface WidgetPlacement {
  /** Уникален в раскладке. У одиночных виджетов совпадает с видом. */
  key: string;
  kind: WidgetKind;
  hidden?: boolean;
  /** Выбранный вариант оформления. Пусто — тот, что первым в списке видов. */
  view?: string;
  /** Только у полоски: что стоит на каждом из шести мест. */
  links?: LinkSlots;
}

export const DEFAULT_LAYOUT: readonly WidgetPlacement[] = WIDGETS.map((w) => {
  const placement: WidgetPlacement = { key: w.kind, kind: w.kind };
  if (w.kind === "links") placement.links = DEFAULT_LINKS.slice();
  if (w.offByDefault) placement.hidden = true;
  return placement;
});

/** Свежая копия стандартной раскладки: списки кнопок в ней свои, не общие. */
export function defaultLayout(): WidgetPlacement[] {
  return DEFAULT_LAYOUT.map((p) => (p.links ? { ...p, links: p.links.slice() } : { ...p }));
}

/* ─────────────────────────────  разбор  ───────────────────────────── */

/**
 * Привести места полоски к шести: существующие разделы, без повторов.
 *
 * Место, на котором стояло неизвестно что, становится пустым, а не съезжает
 * влево: положение кнопок в ряду человек выбирал сам. Полоска, где не осталось
 * ни одной кнопки, — это отсутствие полоски: `null` говорит выбросить её.
 */
function cleanLinks(raw: unknown): LinkSlots | null {
  if (!Array.isArray(raw)) return null;
  const out: LinkSlots = new Array(LINK_SLOTS).fill(null);
  const seen = new Set<string>();
  let filled = 0;
  for (let i = 0; i < Math.min(raw.length, LINK_SLOTS); i++) {
    const item = raw[i];
    if (typeof item !== "string" || !navSection(item) || seen.has(item)) continue;
    seen.add(item);
    out[i] = item;
    filled++;
  }
  return filled > 0 ? out : null;
}

/**
 * Привести сохранённую раскладку к рабочему виду.
 *
 * Мусор и виджеты, которых больше нет, выкидываем; повторы схлопываем. Виджет,
 * появившийся в новой версии, в сохранённой раскладке отсутствует — его ставим
 * на место по стандартному порядку: сразу за тем соседом, который в раскладке
 * уже есть. Иначе всё новое копилось бы в подвале страницы. Дорожек это не
 * касается: снятую полоску возвращать против воли человека нельзя, их и
 * заводят по одной.
 */
export function normalizeLayout(raw: unknown): WidgetPlacement[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: WidgetPlacement[] = [];
  const keys = new Set<string>();
  const kinds = new Set<WidgetKind>();

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      key?: unknown;
      kind?: unknown;
      hidden?: unknown;
      view?: unknown;
      links?: unknown;
    };
    const kind = typeof rec.kind === "string" ? BY_KIND.get(rec.kind) : undefined;
    if (!kind) continue;
    // У одиночного виджета вид и есть ключ: второй такой же — уже повтор.
    if (!kind.multi && kinds.has(kind.kind)) continue;
    const key = typeof rec.key === "string" && rec.key ? rec.key : kind.kind;
    if (keys.has(key)) continue;

    const placement: WidgetPlacement = { key, kind: kind.kind };
    // Вариант оформления берём только известный: сохранённый мог прийти из
    // версии, где вариантов было больше.
    if (typeof rec.view === "string" && kind.views?.some((v) => v.id === rec.view)) {
      placement.view = rec.view;
    }
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
    const fresh: WidgetPlacement = { key: meta.kind, kind: meta.kind };
    // Стандартно снятый и в чужую раскладку приходит снятым: незнакомый виджет,
    // сам собой вставший посреди собранной главной, читается как сбой.
    if (meta.offByDefault) fresh.hidden = true;
    out.splice(at, 0, fresh);
    keys.add(meta.kind);
    kinds.add(meta.kind);
  });

  return out;
}

/**
 * Раскладка из хранилища.
 *
 * Отдельно от `normalizeLayout`, потому что «ничего не сохранено» и «сохранена
 * раскладка без полоски» — разные вещи. В первом случае человек ещё ничего не
 * настраивал, и главная должна открыться стандартной, с полоской быстрых
 * переходов. Во втором полоску сняли руками, и возвращать её нельзя.
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
 * Перенести виджет на место перед другим; `null` — в самый конец.
 *
 * Так работает бросок в пустое место ряда: пустого места в раскладке нет, есть
 * виджет, который в этот ряд не поместился и уехал ниже. Встать «в дырку» —
 * значит встать прямо перед ним.
 */
export function moveWidgetBefore(
  layout: readonly WidgetPlacement[],
  dragKey: string,
  beforeKey: string | null
): WidgetPlacement[] {
  if (dragKey === beforeKey) return layout.slice();
  const from = layout.findIndex((p) => p.key === dragKey);
  if (from === -1) return layout.slice();
  const next = layout.slice();
  const [item] = next.splice(from, 1);
  if (beforeKey === null) {
    next.push(item);
    return next;
  }
  const to = next.findIndex((p) => p.key === beforeKey);
  if (to === -1) return layout.slice();
  next.splice(to, 0, item);
  return next;
}

/* ─────────────────────────────  раскладка по рядам  ───────────────────────────── */

/** Ячейка сетки: виджет или пустое место, оставшееся до конца ряда. */
export type LayoutCell =
  | { type: "widget"; placement: WidgetPlacement }
  | {
      type: "gap";
      /** Сколько колонок пустует. */
      span: number;
      /** Перед каким виджетом стоит дырка; `null` — она в самом конце. */
      before: string | null;
    };

/**
 * Разложить виджеты по рядам и назвать пустые места.
 *
 * Сетка сама переносит на новую строку то, что не влезло, и оставляет позади
 * дырку — но дырки этой в разметке нет, а значит и уронить в неё виджет нельзя.
 * Поэтому ряды считаем сами: где сетка перенесёт, там и выпускаем ячейку-дырку,
 * в которую уже можно целиться.
 *
 * Хвостовая дырка (ряд закончился, а место осталось) тоже выпускается: бросок
 * туда ставит виджет в конец.
 */
export function packLayout(
  visible: readonly WidgetPlacement[],
  columns = 3
): LayoutCell[] {
  const cells: LayoutCell[] = [];
  let col = 0;
  for (const placement of visible) {
    const span = Math.min(widgetMeta(placement.kind).span, columns);
    if (col > 0 && col + span > columns) {
      cells.push({ type: "gap", span: columns - col, before: placement.key });
      col = 0;
    }
    cells.push({ type: "widget", placement });
    col = (col + span) % columns;
  }
  if (col > 0) cells.push({ type: "gap", span: columns - col, before: null });
  return cells;
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

/**
 * Убрать виджет с главной или вернуть его обратно.
 *
 * Возвращается он В КОНЕЦ, а не на прежнее место. Прежнее место к этому времени
 * уже занято — соседи сомкнулись, — и виджет, всплывающий посреди собранной
 * раскладки, читается сбоем: человек нажал «вернуть», а поменялось что-то в
 * середине экрана. В конце его видно сразу, и оттуда он переносится куда нужно.
 */
export function setWidgetHidden(
  layout: readonly WidgetPlacement[],
  key: string,
  hidden: boolean
): WidgetPlacement[] {
  const at = layout.findIndex((p) => p.key === key);
  if (at === -1) return layout.slice();
  const p = layout[at];
  const next: WidgetPlacement = { key: p.key, kind: p.kind };
  if (p.view) next.view = p.view;
  if (p.links) next.links = p.links;
  if (hidden) next.hidden = true;

  const rest = layout.filter((x) => x.key !== key);
  // Убираем — оставляем на месте: пока виджет на полке, его порядок никому не
  // мешает, зато сравнивать раскладку со стандартной становится нечестно.
  if (hidden) {
    const out = rest.slice();
    out.splice(at, 0, next);
    return out;
  }
  return [...rest, next];
}

/**
 * Убрать виджет из раскладки насовсем.
 *
 * Только то, что человек сам и завёл: одиночный виджет так удалить нельзя —
 * его неоткуда взять обратно, для него есть «убрать» с полкой. Полоску же
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

/** Ключ для новой полоски: `links`, `links-2`, `links-3`… */
function nextLinksKey(layout: readonly WidgetPlacement[]): string {
  const taken = new Set(layout.map((p) => p.key));
  if (!taken.has("links")) return "links";
  for (let n = 2; ; n++) {
    const key = `links-${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Кнопка для новой полоски — первый раздел, которого ещё нет ни на одной.
 *
 * Заводить полоску с той же кнопкой, что уже стоит рядом, бессмысленно; а если
 * на главной собраны уже все разделы, берём первый по порядку «Ещё».
 */
function firstUnusedLink(layout: readonly WidgetPlacement[]): string {
  const used = new Set(layout.flatMap((p) => p.links ?? []).filter(Boolean));
  return (SECONDARY.find((s) => !used.has(s.to)) ?? SECONDARY[0]).to;
}

/** Завести новую полоску с кнопками — она встаёт в конец раскладки. */
export function addLinksRow(layout: readonly WidgetPlacement[]): WidgetPlacement[] {
  return [
    ...layout,
    {
      key: nextLinksKey(layout),
      kind: "links",
      links: [firstUnusedLink(layout), null, null, null, null, null],
    },
  ];
}

/**
 * Задать места полоски.
 *
 * Последнюю кнопку убрать нельзя: без единой кнопки полоска превращается в
 * пустое место, которое человеку пришлось бы искать глазами, чтобы снять.
 * Убирают саму полоску.
 */
export function setRowLinks(
  layout: readonly WidgetPlacement[],
  key: string,
  links: readonly (string | null)[]
): WidgetPlacement[] {
  const clean = cleanLinks(links);
  if (!clean) return layout.slice();
  return layout.map((p) => (p.key === key ? { ...p, links: clean } : p));
}

/** Выбрать вариант оформления виджета. */
export function setWidgetView(
  layout: readonly WidgetPlacement[],
  key: string,
  view: string
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.key !== key) return p;
    const meta = widgetMeta(p.kind);
    if (!meta.views?.some((v) => v.id === view)) return p;
    // Вариант по умолчанию не храним: раскладка тогда остаётся стандартной.
    if (view === meta.views[0].id) {
      const next: WidgetPlacement = { key: p.key, kind: p.kind };
      if (p.links) next.links = p.links;
      if (p.hidden) next.hidden = true;
      return next;
    }
    return { ...p, view };
  });
}

/** Совпадает ли раскладка со стандартной — по ней гаснет кнопка «Сбросить». */
export function isDefaultLayout(layout: readonly WidgetPlacement[]): boolean {
  if (layout.length !== DEFAULT_LAYOUT.length) return false;
  return layout.every((p, i) => {
    const d = DEFAULT_LAYOUT[i];
    if (p.key !== d.key || p.kind !== d.kind || p.view) return false;
    // Снятость сверяем со стандартной: часть виджетов стандартно на полке.
    if (Boolean(p.hidden) !== Boolean(d.hidden)) return false;
    return String(p.links ?? []) === String(d.links ?? []);
  });
}
