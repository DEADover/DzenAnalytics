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

import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  ChartArea,
  Coins,
  Crosshair,
  Flag,
  Gauge,
  Hash,
  Inbox,
  Landmark,
  LayoutGrid,
  Lightbulb,
  PieChart,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { navSection } from "./navSections";

export type WidgetSpan = 1 | 2 | 3;

export const WIDGET_KINDS = [
  "month",
  "accounts",
  "upcoming",
  "freeMoney",
  "freeMoneyCompact",
  "links",
  "cashflow",
  "capital",
  "monthOverMonth",
  "categories",
  "activity",
  "observations",
  "donutExpense",
  "donutIncome",
  "pace",
  "triage",
  "budget",
  "goals",
  "watch",
  "watchTag",
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
  /**
   * Значок для списка «поставить виджет».
   *
   * Список из одних названий читался как оглавление: одинаковые строки, глазу
   * не за что зацепиться. Значок делает плитку узнаваемой ещё до чтения.
   */
  icon: LucideIcon;
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
   * главная без него — он ждёт в списке «поставить сюда», пока его не вернут.
   */
  offByDefault?: boolean;
  /** Высота по содержимому, а не общая высота ряда. */
  autoHeight?: boolean;
  /** Таких виджетов на главной может стоять несколько. */
  multi?: boolean;
  /**
   * В стандартной раскладке виджета нет вовсе — его заводят сами, из списка
   * «поставить сюда». Нужно виджетам, которым без настройки показать нечего:
   * «Категория под наблюдением» не знает, за какой категорией следить.
   */
  byHand?: boolean;
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
    icon: Scale,
    title: "Итоги месяца",
    // Раньше здесь стояло «Свободные деньги, темп трат, доход и расход». После
    // появления виджета «Свободные деньги» (#96) это вводило в заблуждение: у
    // «Итогов» крупное число — факт периода, доход минус расход, а свободные
    // считаются от остатков на счетах. Разные вопросы, разные ответы.
    hint: "Сальдо месяца, темп трат, доход и расход",
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
    icon: Landmark,
    title: "Балансы счетов",
    hint: "Совокупный баланс и остаток на каждом счёте",
    span: 1,
  },
  {
    kind: "upcoming",
    icon: CalendarClock,
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
        hint: "Запланированные платежи, вычисленные по вашей истории операций",
      },
    ],
  },
  {
    kind: "freeMoney",
    icon: Coins,
    title: "Свободные деньги",
    hint: "Сколько можно потратить до конца периода и сколько из этого — сегодня",
    // Две трети: кольцо с числом и разбивка «из чего сложилось» встают двумя
    // колонками, а план на месяц листается в третьей. В одну колонку это не
    // помещалось, во всю ширину — оставляло пустоту справа.
    span: 2,
    // Стандартно снят, как и узкий вариант: раскладка главной по умолчанию
    // остаётся прежней, а место под виджет в две трети человек находит сам —
    // ряд под него надо перебрать, и решать это за него неправильно.
    offByDefault: true,
  },
  {
    kind: "freeMoneyCompact",
    icon: Gauge,
    title: "Свободные деньги · Кратко",
    hint: "То же самое в треть ширины, но без списка статей плана",
    // Треть: без списка статей остаётся кольцо дня, свободные до конца периода
    // и разбивка — всё это читается в узкой колонке.
    span: 1,
    // Стандартно снят: два расчёта свободных денег на одной главной никому не
    // нужны, узкий — замена широкому, а не добавка к нему.
    offByDefault: true,
  },
  {
    kind: "links",
    icon: LayoutGrid,
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
    icon: BarChart3,
    title: "Доходы и расходы",
    hint: "Столбцы за последние двенадцать месяцев и прогноз",
    span: 2,
  },
  {
    kind: "capital",
    icon: ChartArea,
    title: "Капитал",
    hint: "Совокупный баланс сейчас и как он менялся: график, прирост, максимум",
    // Две трети: слева число и разбивка, справа кривая за период.
    span: 2,
    // Стандартно снят: стандартная главная собрана в ровные ряды, и новый
    // виджет в две трети перебрал бы их все. Ставится из настройки главной.
    offByDefault: true,
  },
  {
    kind: "monthOverMonth",
    icon: ArrowLeftRight,
    title: "Месяц к месяцу",
    hint: "Доходы, расходы и чистый поток рядом с прошлым месяцем",
    span: 1,
    // Стандартная главная собрана в ровные ряды по три, и лишний виджет
    // оставил бы в них дырку у ВСЕХ. Кто захочет — поставит его сам.
    offByDefault: true,
  },
  {
    kind: "categories",
    icon: PieChart,
    title: "Расходы по категориям",
    hint: "На что ушли деньги в этом месяце",
    span: 1,
  },
  {
    kind: "activity",
    icon: CalendarDays,
    title: "Активность в этом месяце",
    hint: "Календарь трат по дням",
    span: 2,
  },
  {
    kind: "observations",
    icon: Lightbulb,
    title: "Автонаблюдения",
    hint: "Что выбилось из обычного: перерасход, подписки, пропуски",
    span: 1,
  },
  {
    kind: "donutExpense",
    icon: TrendingDown,
    title: "Кольцо расходов",
    hint: "Доли статей друг относительно друга, как на «Категориях»",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "donutIncome",
    icon: TrendingUp,
    title: "Кольцо доходов",
    hint: "Откуда приходят деньги, теми же кольцами",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "pace",
    icon: Activity,
    title: "Темп трат",
    hint: "Расходы месяца день за днём рядом с прошлым месяцем",
    span: 1,
    offByDefault: true,
    views: [
      {
        id: "categories",
        title: "Со статьями",
        hint: "Число, линия и крупнейшие статьи рядом с прошлым месяцем",
      },
      {
        id: "chart",
        title: "График",
        hint: "Линия во весь виджет: этот месяц, прошлый и среднее за три",
      },
    ],
  },
  {
    kind: "triage",
    icon: Inbox,
    title: "Разобрать",
    hint: "Новые операции, без категории, неотправленные правки и просроченные платежи",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "budget",
    icon: Wallet,
    title: "Бюджет месяца",
    hint: "Статьи с планом: сколько потрачено и где перерасход",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "goals",
    icon: Flag,
    title: "Цели",
    hint: "Сколько накоплено и когда цель будет достигнута",
    span: 1,
    offByDefault: true,
  },
  {
    kind: "watch",
    icon: Crosshair,
    title: "Категория под наблюдением",
    hint: "Одна категория расходов или доходов: этот месяц, обычный уровень и прошлые месяцы",
    span: 1,
    multi: true,
    byHand: true,
    // Статью выбирают прямо в виджете — в том числе в режиме настройки.
    live: true,
  },
  {
    kind: "watchTag",
    icon: Hash,
    title: "Тег под наблюдением",
    hint: "Один тег: его расходы и доходы за месяц рядом с обычным уровнем",
    span: 1,
    multi: true,
    byHand: true,
    live: true,
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

/**
 * Остаётся ли виджет живым в режиме настройки — ловит нажатия и не приглушён.
 *
 * Полоска с кнопками жива всегда: её и настраивают изнутри. Виджеты наблюдения
 * живы, только пока в них НЕ ВЫБРАНО, за чем следить: без выбора виджет пуст, и
 * выбрать нужно тут же, не выходя из настройки. С выбранной категорией или
 * тегом настраивать в нём нечего — он приглушается, как остальные, и ручки
 * встают по его центру.
 */
export function isLiveWidget(p: WidgetPlacement): boolean {
  if (!widgetMeta(p.kind).live) return false;
  if (p.kind === "watch") return !p.category;
  if (p.kind === "watchTag") return !p.tag;
  return true;
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
  /**
   * Только у «Балансов счетов»: показывать ли счета вне баланса и прибавлять
   * ли их к сумме. Пусто — как в «Расчётах» («Счета вне баланса»). Касается
   * одного виджета: итоги и отчёты сервиса по-прежнему решает настройка.
   */
  offBalance?: boolean;
  /**
   * Только у «Категории под наблюдением»: за какой статьёй следить. Пусто —
   * статья ещё не выбрана. Подкатегория без категории не хранится.
   */
  category?: string;
  subcategory?: string;
  /** У «Категории под наблюдением»: категория доходная, считаем доходы. */
  income?: boolean;
  /**
   * Только у «Тега под наблюдением»: какой тег и что им считается — хэштег в
   * комментарии или вторая категория операции. Режим хранится вместе с тегом:
   * «отпуск» как хэштег и «Отпуск» как вторая категория — разные вещи, и
   * виджет не должен опустеть оттого, что в разделе «Теги» переключили режим.
   */
  tag?: string;
  tagMode?: "hashtags" | "categories";
  /**
   * Сколько пустых клеток оставить слева от виджета в его ряду.
   *
   * Без этого виджет всегда прижат к левому краю своего ряда: раскладка —
   * поток, и «поставить справа, а слева пусто» в ней было невыразимо. Отдельной
   * распорки-виджета для этого заводить не стали — пустота не сущность, а
   * свойство места, и живёт она у того, кого сдвигает.
   *
   * Считается от начала ряда и ограничен так, чтобы виджет в него влезал:
   * у виджета в две трети отступ бывает только 0 или 1.
   */
  offset?: number;
}

export const DEFAULT_LAYOUT: readonly WidgetPlacement[] = WIDGETS.filter((w) => !w.byHand).map((w) => {
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
  for (let i = 0; i < Math.min(raw.length, LINK_SLOTS); i++) {
    const item = raw[i];
    if (typeof item !== "string" || !navSection(item) || seen.has(item)) continue;
    seen.add(item);
    out[i] = item;
  }
  // Пустая полоска — законное состояние: новую заводят именно такой, чтобы
  // человек сам расставил кнопки, а не разбирал чужую подборку. Раньше пустой
  // набор считался мусором и полоска молча теряла все места.
  return out;
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
      offset?: unknown;
      offBalance?: unknown;
      category?: unknown;
      subcategory?: unknown;
      income?: unknown;
      tag?: unknown;
      tagMode?: unknown;
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
    if (kind.kind === "accounts" && typeof rec.offBalance === "boolean") {
      placement.offBalance = rec.offBalance;
    }
    if (kind.kind === "watch" && typeof rec.category === "string" && rec.category) {
      placement.category = rec.category;
      if (typeof rec.subcategory === "string" && rec.subcategory) {
        placement.subcategory = rec.subcategory;
      }
      if (rec.income === true) placement.income = true;
    }
    if (kind.kind === "watchTag" && typeof rec.tag === "string" && rec.tag) {
      placement.tag = rec.tag;
      placement.tagMode = rec.tagMode === "categories" ? "categories" : "hashtags";
    }
    const offset = clampOffset(rec.offset, kind);
    if (offset > 0) placement.offset = offset;

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

/**
 * Поменять два виджета местами — так работает бросок одного на другой.
 *
 * Именно обмен, а не вставка. Раньше брошенный виджет вставал на место цели и
 * сдвигал всех, кто стоял между ними: перенос из последнего ряда в первый
 * перекраивал каждую строку по дороге, выталкивал крайние виджеты на новые ряды
 * и оставлял дыры. Человек же показывает на два виджета — их и надо поменять,
 * не трогая остальных.
 *
 * Отступ остаётся за МЕСТОМ, а не уезжает с виджетом: пустая клетка слева —
 * часть ряда, и тот, кто встал в этот ряд, наследует её (насколько позволяет
 * его ширина).
 */
export function swapWidgets(
  layout: readonly WidgetPlacement[],
  aKey: string,
  bKey: string
): WidgetPlacement[] {
  if (aKey === bKey) return layout.slice();
  const a = layout.findIndex((p) => p.key === aKey);
  const b = layout.findIndex((p) => p.key === bKey);
  if (a === -1 || b === -1) return layout.slice();
  const next = layout.slice();
  const metaA = widgetMeta(layout[a].kind);
  const metaB = widgetMeta(layout[b].kind);
  const atA = clampOffset(layout[a].offset, metaA);
  const atB = clampOffset(layout[b].offset, metaB);
  // Сколько отступа места каждый способен унаследовать. Виджету во всю ширину
  // пустая клетка слева не положена — то, что он взять не смог, уходит со
  // вторым виджетом, иначе обмен с полоской молча стирал бы отступ, и шаг
  // «туда и обратно» не возвращал раскладку на место.
  const takenByB = clampOffset(atA, metaB);
  const takenByA = clampOffset(atB, metaA);
  next[a] = withOffset(layout[b], clampOffset(takenByB + (atB - takenByA), metaB));
  next[b] = withOffset(layout[a], clampOffset(takenByA + (atA - takenByB), metaA));
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

/**
 * Бросок в пустую клетку: виджет встаёт РОВНО В НЕЁ.
 *
 * Одного переноса «перед соседом» для этого мало. Дырка в ряду стоит в его
 * конце, а перенос ставит виджет сразу за последним занятым местом — то есть
 * левее дырки, если в ряду что-то освободилось. Заметнее всего это на своём же
 * ряду: виджет оттуда просто менялся местами с соседом, дырка оставалась на
 * месте, и перетаскивание выглядело сломанным.
 *
 * Поэтому после переноса смотрим, в какую колонку виджет встал сам, и добираем
 * разницу отступом. Если он и так попал куда надо (бросок из другого ряда),
 * отступ выходит нулевым и ничего не меняется.
 *
 * `gapCol` — колонка, с которой дырка начинается, считая от начала ряда.
 */
export function dropIntoGap(
  layout: readonly WidgetPlacement[],
  dragKey: string,
  /** Виджет, перед которым стоит дырка; `null` — дырка в конце раскладки. */
  beforeKey: string | null,
  gapCol: number,
  columns = 3
): WidgetPlacement[] {
  // Где дырка стояла ДО переноса: её ряд и чья она.
  const before = gridOf(layout, columns);
  const gap = before.find(
    (g) => g.cell.type === "gap" && g.cell.before === beforeKey && g.col === gapCol
  );
  const neighbourRow =
    beforeKey === null
      ? null
      : (before.find((g) => g.cell.type === "widget" && g.cell.placement.key === beforeKey)?.row ??
        null);

  const moved = moveWidgetBefore(layout, dragKey, beforeKey);
  const at = moved.findIndex((p) => p.key === dragKey);
  if (at === -1) return moved;

  const meta = widgetMeta(moved[at].kind);
  const actual = columnOf(moved, dragKey, columns);
  if (actual === null) return moved;

  // Отступ подбираем по тому, КУДА виджет при нём встанет, а не арифметикой от
  // текущей колонки. Арифметика знает только колонку и не знает ряда: виджет,
  // который стоял под дыркой в той же колонке (его туда отнёс собственный
  // отступ), при броске в неё получал «сдвиг на ноль клеток» и оставался где
  // был. Перебираем все отступы и берём тот, что ставит виджет в колонку дырки
  // — а из таких тот, что ближе к её ряду.
  const next = moved.slice();
  const offset = clampOffset(moved[at].offset, meta, columns);
  let best: { offset: number; distance: number } | null = null;
  for (let o = 0; o <= maxOffset(meta, columns); o++) {
    const trial = moved.slice();
    trial[at] = withOffset(moved[at], o);
    const pos = gridOf(trial, columns).find(
      (g) => g.cell.type === "widget" && g.cell.placement.key === dragKey
    );
    if (!pos || pos.col !== gapCol) continue;
    const distance = gap ? Math.abs(pos.row - gap.row) : 0;
    if (!best || distance < best.distance) best = { offset: o, distance };
  }
  next[at] = withOffset(
    next[at],
    best ? best.offset : clampOffset(offset + gapCol - actual, meta, columns)
  );

  // Если дырка была ОТСТУПОМ соседа, часть её теперь занята — отдаём соседу
  // ровно то, что осталось. Иначе он уехал бы ещё правее, а дырка выросла.
  // Только отступом: дырка в конце ПРЕДЫДУЩЕГО ряда соседу не принадлежит, и
  // его собственный отступ в своём ряду трогать незачем.
  const ownGap = gap !== undefined && neighbourRow !== null && gap.row === neighbourRow;
  if (ownGap && beforeKey !== null && beforeKey !== dragKey) {
    const bi = next.findIndex((p) => p.key === beforeKey);
    if (bi !== -1) {
      const bMeta = widgetMeta(next[bi].kind);
      const bOffset = clampOffset(next[bi].offset, bMeta, columns);
      if (bOffset > 0) {
        // Сосед должен остаться в СВОЕЙ КОЛОНКЕ. Простое «минус ширина
        // брошенного» этого не даёт, когда брошенный занял весь ряд: сосед
        // уезжает рядом ниже, и отступ ему нужен прежний, а не урезанный.
        const was = before.find(
          (g) => g.cell.type === "widget" && g.cell.placement.key === beforeKey
        );
        let kept: number | null = null;
        for (let o = 0; o <= maxOffset(bMeta, columns) && was; o++) {
          const trial = next.slice();
          trial[bi] = withOffset(next[bi], o);
          const pos = gridOf(trial, columns).find(
            (g) => g.cell.type === "widget" && g.cell.placement.key === beforeKey
          );
          if (pos && pos.col === was.col) {
            kept = o;
            break;
          }
        }
        const span = Math.min(meta.span, columns);
        next[bi] = withOffset(next[bi], kept ?? Math.max(0, bOffset - span));
      }
    }
  }

  // Перенос ВНУТРИ СВОЕГО РЯДА: соседи по ряду остаются в своих колонках, а
  // пустая клетка переезжает туда, откуда виджет ушёл. Без этого сосед
  // съезжал на освободившееся место, и «переставить в третью клетку»
  // сдвигало весь ряд. Так же ведёт себя шаг стрелкой. Виджет, унесённый из
  // другого ряда, такого следа не оставляет: его ряд смыкается, как при снятии.
  const home = before.find((g) => g.cell.type === "widget" && g.cell.placement.key === dragKey);
  if (gap && home && gap.row === home.row) {
    const mates = before.filter(
      (g) => g.row === home.row && g.cell.type === "widget" && g.cell.placement.key !== dragKey
    );
    // Слева направо по НОВОМУ порядку: отступ левого соседа сдвигает правого.
    const order = (g: GridCell) =>
      g.cell.type === "widget" ? next.findIndex((p) => p.key === (g.cell as { placement: WidgetPlacement }).placement.key) : -1;
    for (const mate of [...mates].sort((x, y) => order(x) - order(y))) {
      if (mate.cell.type !== "widget") continue;
      const mk = mate.cell.placement.key;
      const mi = next.findIndex((p) => p.key === mk);
      const mMeta = widgetMeta(next[mi].kind);
      const di = next.findIndex((p) => p.key === dragKey);
      // Отступ соседа и самого виджета подбираются вместе: сосед, вставший на
      // прежнюю колонку, сдвигает виджет, если тот стоит правее него.
      search: for (let o = 0; o <= maxOffset(mMeta, columns); o++) {
        for (let w = 0; w <= maxOffset(meta, columns); w++) {
          const trial = next.slice();
          trial[mi] = withOffset(next[mi], o);
          trial[di] = withOffset(next[di], w);
          const grid = gridOf(trial, columns);
          const pos = grid.find((g) => g.cell.type === "widget" && g.cell.placement.key === mk);
          const self = grid.find(
            (g) => g.cell.type === "widget" && g.cell.placement.key === dragKey
          );
          // Сосед на прежней колонке, виджет — в клетке дырки, оба в одном ряду.
          if (pos && self && pos.col === mate.col && self.col === gapCol && pos.row === self.row) {
            next[mi] = trial[mi];
            next[di] = trial[di];
            break search;
          }
        }
      }
    }
  }
  return next;
}

/**
 * Имеет ли смысл бросок в эту пустую клетку: виджет в неё действительно
 * встанет, и раскладка от этого изменится.
 *
 * Клетка, которая зовёт «Перенести сюда», а потом либо ничего не делает, либо
 * отправляет виджет в другое место, хуже клетки, которая не зовёт. Так бывает:
 * дырка слева от виджета во втором ряду недостижима, пока в первом ряду есть
 * свободное место, — раскладка подтянет виджет наверх.
 */
export function canDropIntoGap(
  layout: readonly WidgetPlacement[],
  dragKey: string,
  beforeKey: string | null,
  gapCol: number,
  columns = 3
): boolean {
  const p = layout.find((x) => x.key === dragKey);
  if (!p || p.hidden) return false;
  if (gapCol + Math.min(widgetMeta(p.kind).span, columns) > columns) return false;
  const next = dropIntoGap(layout, dragKey, beforeKey, gapCol, columns);
  const where = (list: readonly WidgetPlacement[]) =>
    gridOf(list, columns)
      .map((g) => (g.cell.type === "widget" ? `${g.cell.placement.key}@${g.row}:${g.col}` : ""))
      .join("|");
  if (where(next) === where(layout)) return false;
  return columnOf(next, dragKey, columns) === gapCol;
}

/** В какой колонке своего ряда стоит виджет. `null` — его на экране нет. */
function columnOf(
  layout: readonly WidgetPlacement[],
  key: string,
  columns = 3
): number | null {
  let col = 0;
  for (const cell of packLayout(layout.filter((p) => !p.hidden), columns)) {
    if (cell.type === "widget" && cell.placement.key === key) return col;
    const span =
      cell.type === "gap" ? cell.span : Math.min(widgetMeta(cell.placement.kind).span, columns);
    col = (col + span) % columns;
  }
  return null;
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
    const offset = clampOffset(placement.offset, widgetMeta(placement.kind), columns);
    // Отступ едет вместе с виджетом: если вдвоём они в остаток ряда не влезают,
    // на новый ряд переходят оба, и пустота остаётся слева от виджета, а не
    // повисает хвостом предыдущего.
    if (col > 0 && col + offset + span > columns) {
      cells.push({ type: "gap", span: columns - col, before: placement.key });
      col = 0;
    }
    if (offset > 0) {
      cells.push({ type: "gap", span: offset, before: placement.key });
      col += offset;
    }
    cells.push({ type: "widget", placement });
    col = (col + span) % columns;
  }
  if (col > 0) cells.push({ type: "gap", span: columns - col, before: null });
  return cells;
}

/** Отступ, который виджет может себе позволить: дальше он в ряд не влезет. */
export function maxOffset(meta: WidgetMeta, columns = 3): number {
  return Math.max(0, columns - Math.min(meta.span, columns));
}

function clampOffset(
  value: unknown,
  meta: WidgetMeta,
  columns = 3
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.round(value), maxOffset(meta, columns)));
}

/** Ячейка разложенной сетки вместе с рядом, в котором она стоит. */
interface GridCell {
  cell: LayoutCell;
  row: number;
  /** С какой колонки ряда ячейка начинается. */
  col: number;
}

/** Разложить видимые виджеты и назвать ряд каждой ячейки. */
function gridOf(layout: readonly WidgetPlacement[], columns = 3): GridCell[] {
  const out: GridCell[] = [];
  let col = 0;
  let row = 0;
  for (const cell of packLayout(layout.filter((p) => !p.hidden), columns)) {
    out.push({ cell, row, col });
    const span =
      cell.type === "gap" ? cell.span : Math.min(widgetMeta(cell.placement.kind).span, columns);
    col += span;
    if (col >= columns) {
      col = 0;
      row += 1;
    }
  }
  return out;
}

/**
 * Сдвинуть виджет на шаг вперёд или назад — это делают стрелки.
 *
 * ШАГ — ЭТО СОСЕДНЕЕ МЕСТО В ПОРЯДКЕ ЧТЕНИЯ. Если рядом в том же ряду пустая
 * клетка — виджет встаёт в неё. Если рядом другой виджет — они меняются
 * местами. Больше ничего не двигается.
 *
 * Раньше стрелка «вперёд» сначала набирала виджету отступ до упора, даже когда
 * справа стоял сосед: слева появлялась дыра, сосед вылетал на новый ряд, и
 * только с третьего нажатия виджеты наконец менялись местами. Отступ теперь
 * берётся лишь там, где пустое место действительно есть.
 *
 * Сосед при шаге в пустую клетку остаётся на месте: клетка, в которую встали,
 * вычитается из его отступа, а освободившаяся — прибавляется к нему.
 *
 * Убранные виджеты пропускаем: их на экране нет, и шаг «через невидимое»
 * выглядел бы как нажатие вхолостую.
 */
export function shiftWidget(
  layout: readonly WidgetPlacement[],
  key: string,
  dir: -1 | 1
): WidgetPlacement[] {
  const grid = gridOf(layout);
  const at = grid.findIndex((g) => g.cell.type === "widget" && g.cell.placement.key === key);
  if (at === -1) return layout.slice();
  const me = grid[at];
  const idx = layout.findIndex((p) => p.key === key);
  const meta = widgetMeta(layout[idx].kind);
  const offset = clampOffset(layout[idx].offset, meta);

  /** Ближайший виджет в эту сторону — с его рядом. */
  const neighbour = (step: -1 | 1): { key: string; row: number } | null => {
    for (let i = at + step; i >= 0 && i < grid.length; i += step) {
      const c = grid[i].cell;
      if (c.type === "widget") return { key: c.placement.key, row: grid[i].row };
    }
    return null;
  };
  /** Изменить отступ виджета по ключу на `delta`, не выходя за его пределы. */
  const nudge = (list: WidgetPlacement[], k: string, delta: number) => {
    const i = list.findIndex((p) => p.key === k);
    if (i === -1) return;
    const m = widgetMeta(list[i].kind);
    list[i] = withOffset(list[i], clampOffset(clampOffset(list[i].offset, m) + delta, m));
  };

  if (dir === 1) {
    const after = grid[at + 1];
    // Справа в том же ряду пусто — встаём в эту клетку.
    if (after && after.cell.type === "gap" && after.row === me.row) {
      const next = layout.slice();
      next[idx] = withOffset(layout[idx], offset + 1);
      // Пустота была отступом соседа по ряду — он остаётся где стоял.
      const nb = neighbour(1);
      if (nb && nb.row === me.row) nudge(next, nb.key, -1);
      return next;
    }
    const nb = neighbour(1);
    return nb ? swapWidgets(layout, key, nb.key) : layout.slice();
  }

  // Слева своя пустая клетка — отдаём её.
  if (offset > 0) {
    const next = layout.slice();
    next[idx] = withOffset(layout[idx], offset - 1);
    // Сосед справа по ряду остаётся где стоял: освободившаяся клетка — его.
    const nb = neighbour(1);
    if (nb && nb.row === me.row) nudge(next, nb.key, 1);
    return next;
  }
  const nb = neighbour(-1);
  return nb ? swapWidgets(layout, key, nb.key) : layout.slice();
}

/** Есть ли куда шагнуть: на краю раскладки стрелка гаснет. */
export function canShiftWidget(
  layout: readonly WidgetPlacement[],
  key: string,
  dir: -1 | 1
): boolean {
  const next = shiftWidget(layout, key, dir);
  return next.some((p, i) => p !== layout[i]);
}

/** Тот же виджет с другим отступом; ноль поле убирает. */
function withOffset(p: WidgetPlacement, offset: number): WidgetPlacement {
  const next = { ...p };
  if (offset > 0) next.offset = offset;
  else delete next.offset;
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
  hidden: boolean,
  /**
   * Куда поставить возвращаемый виджет: перед этим соседом. `null` — в конец.
   *
   * Возвращают его теперь из той самой пустой клетки, куда и хотят поставить,
   * так что «в конец, а дальше тащите сами» больше не годится.
   */
  beforeKey: string | null = null
): WidgetPlacement[] {
  const at = layout.findIndex((p) => p.key === key);
  if (at === -1) return layout.slice();
  const p = layout[at];
  const next: WidgetPlacement = { key: p.key, kind: p.kind };
  if (p.view) next.view = p.view;
  if (p.links) next.links = p.links;
  if (p.category) next.category = p.category;
  if (p.subcategory) next.subcategory = p.subcategory;
  if (p.income) next.income = true;
  if (p.tag) {
    next.tag = p.tag;
    next.tagMode = p.tagMode;
  }
  if (hidden) next.hidden = true;

  const rest = layout.filter((x) => x.key !== key);
  // Убираем — оставляем на месте: пока виджет снят, его порядок никому не
  // мешает, зато сравнивать раскладку со стандартной становится нечестно.
  if (hidden) {
    const out = rest.slice();
    out.splice(at, 0, next);
    return out;
  }
  return insertBefore(rest, next, beforeKey);
}

/** Вставить перед названным соседом; `null` или незнакомый ключ — в конец. */
function insertBefore(
  layout: readonly WidgetPlacement[],
  item: WidgetPlacement,
  beforeKey: string | null
): WidgetPlacement[] {
  const out = layout.slice();
  const to = beforeKey === null ? -1 : out.findIndex((p) => p.key === beforeKey);
  if (to === -1) out.push(item);
  else out.splice(to, 0, item);
  return out;
}

/**
 * Убрать виджет из раскладки насовсем.
 *
 * Только то, что человек сам и завёл: одиночный виджет так удалить нельзя —
 * его неоткуда взять обратно, для него есть «убрать», и он ждёт в списке.
 * Полоску же собирают из разделов за полминуты, и держать снятую вечно в
 * списке, без возможности от неё избавиться, — тупик.
 */
export function removeWidget(
  layout: readonly WidgetPlacement[],
  key: string
): WidgetPlacement[] {
  const p = layout.find((x) => x.key === key);
  if (!p || !widgetMeta(p.kind).multi) return layout.slice();
  return layout.filter((x) => x.key !== key);
}

/** Ключ для нового экземпляра: `links`, `links-2`, `links-3`… */
function nextKey(layout: readonly WidgetPlacement[], kind: WidgetKind): string {
  const taken = new Set(layout.map((p) => p.key));
  if (!taken.has(kind)) return kind;
  for (let n = 2; ; n++) {
    const key = `${kind}-${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Завести ещё один виджет вида, которого на главной может быть несколько.
 * Одиночный так не добавить: он уже есть в раскладке и ждёт в списке снятых.
 */
export function addWidget(
  layout: readonly WidgetPlacement[],
  kind: WidgetKind,
  /** Перед каким соседом встать; `null` — в конец. */
  beforeKey: string | null = null
): WidgetPlacement[] {
  if (kind === "links") return addLinksRow(layout, beforeKey);
  if (!widgetMeta(kind).multi) return layout.slice();
  return insertBefore(layout, { key: nextKey(layout, kind), kind }, beforeKey);
}

/**
 * Выбрать статью для «Категории под наблюдением». Пустая категория снимает
 * выбор: виджет снова просит назвать статью.
 */
export function setWidgetCategory(
  layout: readonly WidgetPlacement[],
  key: string,
  category: string,
  subcategory = "",
  /** Категория доходная — виджет считает доходы. */
  income = false
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.key !== key || p.kind !== "watch") return p;
    const { category: _c, subcategory: _s, income: _i, ...rest } = p;
    if (!category) return rest;
    const next: WidgetPlacement = subcategory ? { ...rest, category, subcategory } : { ...rest, category };
    if (income) next.income = true;
    return next;
  });
}

/** Выбрать тег для «Тега под наблюдением». Пустой тег снимает выбор. */
export function setWidgetTag(
  layout: readonly WidgetPlacement[],
  key: string,
  tag: string,
  tagMode: "hashtags" | "categories" = "hashtags"
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.key !== key || p.kind !== "watchTag") return p;
    const { tag: _t, tagMode: _m, ...rest } = p;
    return tag ? { ...rest, tag, tagMode } : rest;
  });
}

/** Завести новую полоску с кнопками — она встаёт в конец раскладки. */
export function addLinksRow(
  layout: readonly WidgetPlacement[],
  /** Перед каким соседом встать; `null` — в конец. */
  beforeKey: string | null = null
): WidgetPlacement[] {
  return insertBefore(
    layout,
    {
      key: nextKey(layout, "links"),
      kind: "links",
      // Пустой: подбирать кнопку за человека не наше дело, а «первый неиспользо-
      // ванный раздел» всё равно попадал мимо — его тут же меняли на нужный.
      links: new Array(LINK_SLOTS).fill(null),
    },
    beforeKey
  );
}

/**
 * Задать места полоски.
 *
 * Пустая полоска разрешена: она и заводится пустой, и опустеть может по ходу.
 * Пустым местом на экране она не станет — в режиме настройки все шесть мест
 * зовут плюсом, а вне его пустая полоска просто не рисуется.
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
/**
 * Счета вне баланса в «Балансах счетов». `undefined` — снова как в
 * «Расчётах»: свой выбор не храним, раскладка остаётся стандартной.
 */
export function setWidgetOffBalance(
  layout: readonly WidgetPlacement[],
  key: string,
  value: boolean | undefined
): WidgetPlacement[] {
  return layout.map((p) => {
    if (p.key !== key || p.kind !== "accounts") return p;
    const { offBalance: _dropped, ...rest } = p;
    return value === undefined ? rest : { ...rest, offBalance: value };
  });
}

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
    // Убираем ровно `view`, остальное место виджета не трогаем. Прежде запись
    // собиралась заново из перечисленных полей и теряла `offset`: виджет,
    // отодвинутый пустыми клетками вправо, после возврата вида прыгал к
    // левому краю ряда.
    if (view === meta.views[0].id) {
      const { view: _dropped, ...rest } = p;
      return rest;
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
    // Снятость сверяем со стандартной: часть виджетов стандартно снята.
    if (Boolean(p.hidden) !== Boolean(d.hidden)) return false;
    return String(p.links ?? []) === String(d.links ?? []);
  });
}
