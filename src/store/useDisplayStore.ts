// User display preferences (persisted): the "show kopecks" toggle and the
// table text-size scale.
//
// Money formatting lives in lib/format.ts as a module variable
// (`setMoneyFractionDigits`) so every formatMoney call follows it without
// threading the setting through props. This store mirrors it into React
// state so components re-render when it changes (App subscribes to it,
// cascading a re-render across the tree).
//
// The table font scale is applied as a CSS variable (`--tbl-font`) on the
// document root; the operation tables / feed read it, so changing the level
// rescales their text with no React re-render needed.

import { create } from "zustand";
import * as db from "../lib/db";
import { setMoneyFractionDigits } from "../lib/format";
import { contentMaxCss, normalizeContentWidth } from "../lib/contentWidth";

const KEY = "displaySettings";

export type FeedPlannedMode = "bar" | "inline";
export const isFeedPlannedMode = (v: unknown): v is FeedPlannedMode => v === "bar" || v === "inline";

type FractionDigits = 0 | 2;

/**
 * Где живут общие фильтры: `button` — панелью из-под шапки по кнопке (не
 * занимают места, вызываются с любой прокрутки), `page` — первым блоком
 * страницы, как было раньше; кнопки в шапке тогда нет вовсе.
 */
export type FiltersMode = "button" | "page";
/** Отчётный месяц (со своего первого дня) или календарный. */
export type MonthKind = "period" | "month";
/** Скользящее окно у кнопки окон в фильтре. */
export type WindowKind = "30d" | "3m" | "6m" | "12m";
const WINDOW_KINDS: readonly WindowKind[] = ["30d", "3m", "6m", "12m"];
export const isWindowKind = (v: unknown): v is WindowKind =>
  typeof v === "string" && (WINDOW_KINDS as readonly string[]).includes(v);

/** 1 (smallest) … 5 (largest); 3 is the default 14px baseline. */
export type TableFontLevel = 1 | 2 | 3 | 4 | 5;

/** Ступени «Размера текста в таблицах» словами — в «Настройках» и быстрой панели. */
export const TABLE_FONT_LABELS: Record<TableFontLevel, string> = {
  1: "Мелкий",
  2: "Компактный",
  3: "Обычный",
  4: "Крупный",
  5: "Очень крупный",
};

// Level → font-size for operation tables. Each step is 1px at a 16px root.
// Level 3 = 0.875rem (14px) is the unified default.
const TABLE_FONT_REM: Record<TableFontLevel, string> = {
  1: "0.75rem", // 12px
  2: "0.8125rem", // 13px
  3: "0.875rem", // 14px (default)
  4: "0.9375rem", // 15px
  5: "1rem", // 16px
};

export const DEFAULT_TABLE_FONT_LEVEL: TableFontLevel = 3;

/** Во сколько раз текст таблиц крупнее обычных 14 px — множитель ширин колонок. */
const TABLE_FONT_SCALE: Record<TableFontLevel, string> = {
  1: String(12 / 14),
  2: String(13 / 14),
  3: "1",
  4: String(15 / 14),
  5: String(16 / 14),
};

function applyTableFont(level: TableFontLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--tbl-font", TABLE_FONT_REM[level]);
  document.documentElement.style.setProperty("--tbl-scale", TABLE_FONT_SCALE[level]);
}

/** Ширина колонки сервиса — CSS-переменной на корне, как размер текста таблиц. */
function applyContentWidth(width: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--content-max", contentMaxCss(width));
}

function normalizeLevel(n: unknown): TableFontLevel {
  const v = Math.round(Number(n));
  return (v >= 1 && v <= 5 ? v : DEFAULT_TABLE_FONT_LEVEL) as TableFontLevel;
}

interface DisplayState {
  /** Fraction digits for money: 0 = whole amounts, 2 = kopecks/cents. */
  fractionDigits: FractionDigits;
  /** Operation-table text size, 1 (small) … 5 (large). */
  tableFontLevel: TableFontLevel;
  /**
   * Что показывать второй строкой под контрагентом в ленте «Операции»:
   * `false` — свободный текст получателя (как было), `true` — строку из
   * банковской выписки. Второе полезно при оплате по СБП и через
   * посредников: контрагент говорит «AliExpress», а деньги ушли «Сергей Г.».
   */
  statementLine: boolean;
  /**
   * Длинный комментарий в лентах операций — до двух строк с переносом по
   * словам, а не одной строкой с многоточием. По умолчанию включено: в одну
   * строку обрезалось как раз то, ради чего комментарий пишут.
   */
  commentWrap: boolean;
  /**
   * Своя ширина столбцов: границы в шапках таблиц и лент можно тянуть мышью,
   * ширины запоминаются по таблицам (`useColumnWidthsStore`). Пока опыт —
   * по умолчанию выключено.
   */
  columnResize: boolean;
  /**
   * Закреплённая шапка лент операций: панель с поиском и кнопками и строка
   * названий колонок остаются вверху экрана при прокрутке. Включается
   * кнопкой-булавкой в самой ленте; по умолчанию выключено — шапка уезжает
   * вместе с лентой, как раньше.
   */
  feedHeadSticky: boolean;
  /**
   * Строка «Запланировано» над лентой «Операций»: сколько планов Дзен-мани
   * просрочено и осталось до конца месяца, года и всего; щелчок открывает
   * ленту одних планов с действиями как в приложении. По умолчанию включено;
   * выключается в «Оформлении».
   */
  feedPlanned: boolean;
  /**
   * Как показывать запланированные, когда они включены (`feedPlanned`):
   * «bar» — строкой «Запланировано» над лентой (щелчок — лента одних планов),
   * «inline» — прямо в ленте среди операций, по выбранному периоду: за
   * отчётный месяц — до его конца, за год — до конца года и так далее.
   */
  feedPlannedMode: FeedPlannedMode;
  /**
   * Раскрыт ли журнал синхронизаций.
   *
   * По умолчанию свёрнут: это отладочная история, её открывают, когда что-то
   * пошло не так, а место она занимала на пол-экрана постоянно.
   *
   * Живёт здесь, а не в состоянии компонента, по трём причинам сразу: вид
   * должен пережить перезагрузку, вернуться при следующем заходе и попасть в
   * копию данных сервиса. `displaySettings` уже умеет всё три — он один
   * объект под одним ключом и входит в бэкап.
   */
  syncLogOpen: boolean;
  /**
   * Спрятать значок-сердечко «Отблагодарить автора» в шапке и строку в меню
   * телефона. По умолчанию значок есть: раньше ссылка стояла в подвале.
   */
  hideThanks: boolean;
  /**
   * Шестерёнка в шапке открывает панель быстрых настроек. Выключено —
   * шестерёнка сразу ведёт в «Настройки», как раньше. По умолчанию включено.
   */
  quickSettings: boolean;
  filtersMode: FiltersMode;
  /**
   * Какой месяц подставляет кнопка месяца в фильтре: отчётный (со своего
   * первого дня) или календарный. Живёт здесь, а не в самом фильтре: это
   * привычка человека, а не часть периода, — иначе она терялась при каждой
   * перезагрузке и на каждом новом устройстве.
   */
  monthKind: MonthKind;
  /**
   * Каким окном подписана кнопка окон в фильтре — последним выбранным. Та же
   * привычка, что и вид месяца: без неё после перезагрузки кнопка снова
   * показывала «30 дней».
   */
  windowKind: WindowKind;
  /**
   * Ширина сервиса в пикселях: шапка, фильтры и страница — колонкой не шире
   * этого по центру экрана. 0 — во весь экран (по умолчанию). См.
   * `lib/contentWidth`.
   */
  contentWidth: number;
  /**
   * Ширина, которую сейчас выбирают бегунком, — ещё не применённая. Пока
   * бегунок тянут, сервис стоит на месте, а края будущей колонки показывают
   * направляющие (`ContentWidthGuide`): перестраивать всю вёрстку на каждом
   * шаге было тяжело и дёргано. `null` — бегунок не трогают. Не сохраняется.
   */
  contentWidthDraft: number | null;
  setContentWidthDraft: (width: number | null) => void;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setFractionDigits: (n: FractionDigits) => Promise<void>;
  setTableFontLevel: (level: TableFontLevel) => Promise<void>;
  setStatementLine: (on: boolean) => Promise<void>;
  setCommentWrap: (on: boolean) => Promise<void>;
  setColumnResize: (on: boolean) => Promise<void>;
  setFeedHeadSticky: (on: boolean) => Promise<void>;
  setFeedPlanned: (on: boolean) => Promise<void>;
  setFeedPlannedMode: (mode: FeedPlannedMode) => Promise<void>;
  setSyncLogOpen: (on: boolean) => Promise<void>;
  setHideThanks: (on: boolean) => Promise<void>;
  setQuickSettings: (on: boolean) => Promise<void>;
  setFiltersMode: (mode: FiltersMode) => Promise<void>;
  setMonthKind: (kind: MonthKind) => Promise<void>;
  setWindowKind: (kind: WindowKind) => Promise<void>;
  setContentWidth: (width: number) => Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set, get) => ({
  fractionDigits: 0,
  tableFontLevel: DEFAULT_TABLE_FONT_LEVEL,
  statementLine: false,
  commentWrap: true,
  columnResize: false,
  feedHeadSticky: false,
  feedPlanned: true,
  feedPlannedMode: "bar",
  syncLogOpen: false,
  hideThanks: false,
  quickSettings: true,
  filtersMode: "page",
  monthKind: "period",
  windowKind: "30d",
  contentWidth: 0,
  contentWidthDraft: null,
  setContentWidthDraft: (width) =>
    set({ contentWidthDraft: width === null ? null : normalizeContentWidth(width) }),
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<{
      fractionDigits?: number;
      tableFontLevel?: number;
      statementLine?: boolean;
      commentWrap?: boolean;
      columnResize?: boolean;
      feedHeadSticky?: boolean;
      feedPlanned?: boolean;
      feedPlannedMode?: unknown;
      syncLogOpen?: boolean;
      hideThanks?: boolean;
      quickSettings?: boolean;
      filtersMode?: string;
      monthKind?: string;
      windowKind?: string;
      contentWidth?: number;
    }>(KEY);
    const fd: FractionDigits = stored?.fractionDigits === 2 ? 2 : 0;
    const level = normalizeLevel(stored?.tableFontLevel);
    setMoneyFractionDigits(fd); // sync the formatter before first paint
    applyTableFont(level); // sync the CSS var before first paint
    const contentWidth = normalizeContentWidth(stored?.contentWidth);
    applyContentWidth(contentWidth);
    set({
      fractionDigits: fd,
      tableFontLevel: level,
      statementLine: stored?.statementLine === true,
      commentWrap: stored?.commentWrap !== false,
      columnResize: stored?.columnResize === true,
      feedHeadSticky: stored?.feedHeadSticky === true,
      feedPlanned: stored?.feedPlanned !== false,
      feedPlannedMode: isFeedPlannedMode(stored?.feedPlannedMode) ? stored.feedPlannedMode : "bar",
      syncLogOpen: stored?.syncLogOpen === true,
      hideThanks: stored?.hideThanks === true,
      quickSettings: stored?.quickSettings !== false,
      // По умолчанию фильтры стоят на странице; панель по кнопке — выбор человека.
      filtersMode: stored?.filtersMode === "button" ? "button" : "page",
      monthKind: stored?.monthKind === "month" ? "month" : "period",
      windowKind: isWindowKind(stored?.windowKind) ? stored.windowKind : "30d",
      contentWidth,
      loaded: true,
    });
  },

  setFractionDigits: async (n) => {
    setMoneyFractionDigits(n); // update the formatter FIRST…
    set({ fractionDigits: n }); // …then trigger a re-render of subscribers
    await db.saveJSON(KEY, { ...persisted(get()), fractionDigits: n });
  },

  setTableFontLevel: async (level) => {
    const lvl = normalizeLevel(level);
    applyTableFont(lvl);
    set({ tableFontLevel: lvl });
    await db.saveJSON(KEY, { ...persisted(get()), tableFontLevel: lvl });
  },

  setStatementLine: async (on) => {
    set({ statementLine: on });
    await db.saveJSON(KEY, { ...persisted(get()), statementLine: on });
  },

  setCommentWrap: async (on) => {
    set({ commentWrap: on });
    await db.saveJSON(KEY, { ...persisted(get()), commentWrap: on });
  },

  setColumnResize: async (on) => {
    set({ columnResize: on });
    await db.saveJSON(KEY, { ...persisted(get()), columnResize: on });
  },

  setFeedHeadSticky: async (on) => {
    set({ feedHeadSticky: on });
    await db.saveJSON(KEY, { ...persisted(get()), feedHeadSticky: on });
  },

  setFeedPlanned: async (on) => {
    set({ feedPlanned: on });
    await db.saveJSON(KEY, { ...persisted(get()), feedPlanned: on });
  },

  setFeedPlannedMode: async (mode) => {
    set({ feedPlannedMode: mode });
    await db.saveJSON(KEY, { ...persisted(get()), feedPlannedMode: mode });
  },

  setSyncLogOpen: async (on) => {
    set({ syncLogOpen: on });
    await db.saveJSON(KEY, { ...persisted(get()), syncLogOpen: on });
  },

  setHideThanks: async (on) => {
    set({ hideThanks: on });
    await db.saveJSON(KEY, { ...persisted(get()), hideThanks: on });
  },

  setQuickSettings: async (on) => {
    set({ quickSettings: on });
    await db.saveJSON(KEY, { ...persisted(get()), quickSettings: on });
  },

  setFiltersMode: async (filtersMode) => {
    set({ filtersMode });
    await db.saveJSON(KEY, { ...persisted(get()), filtersMode });
  },

  setMonthKind: async (monthKind) => {
    if (get().monthKind === monthKind) return;
    set({ monthKind });
    await db.saveJSON(KEY, { ...persisted(get()), monthKind });
  },

  setWindowKind: async (windowKind) => {
    if (get().windowKind === windowKind) return;
    set({ windowKind });
    await db.saveJSON(KEY, { ...persisted(get()), windowKind });
  },

  setContentWidth: async (width) => {
    const contentWidth = normalizeContentWidth(width);
    applyContentWidth(contentWidth);
    if (get().contentWidth === contentWidth) return;
    set({ contentWidth });
    await db.saveJSON(KEY, { ...persisted(get()), contentWidth });
  },
}));

/** Всё, что кладём в IDB, — одним местом, чтобы сеттеры не забывали поля. */
function persisted(s: DisplayState) {
  return {
    fractionDigits: s.fractionDigits,
    tableFontLevel: s.tableFontLevel,
    statementLine: s.statementLine,
    commentWrap: s.commentWrap,
    columnResize: s.columnResize,
    feedHeadSticky: s.feedHeadSticky,
    feedPlanned: s.feedPlanned,
    feedPlannedMode: s.feedPlannedMode,
    syncLogOpen: s.syncLogOpen,
    hideThanks: s.hideThanks,
    quickSettings: s.quickSettings,
    filtersMode: s.filtersMode,
    monthKind: s.monthKind,
    windowKind: s.windowKind,
    contentWidth: s.contentWidth,
  };
}
