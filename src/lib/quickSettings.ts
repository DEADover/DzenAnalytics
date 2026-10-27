import {
  CalendarClock,
  Coins,
  Columns3,
  EyeOff,
  History,
  PanelTop,
  ReceiptText,
  RefreshCw,
  Scale,
  Type,
  Upload,
  Users,
  TextWrap,
  type LucideIcon,
} from "lucide-react";

/**
 * Быстрые настройки — то, что переключают на ходу, не уходя в «Настройки»:
 * панель открывается шестерёнкой в шапке (`QuickSettingsMenu`), набор и
 * порядок пунктов человек собирает сам (`QuickSettingsModal`).
 *
 * Здесь — только перечень и его порядок по умолчанию; как каждый пункт
 * читает и меняет свою настройку, решает сама панель. Темы здесь нет: для неё
 * в шапке своя кнопка.
 *
 * `kind` задаёт вид: плитка-тумблер (`toggle`), переключатель из нескольких
 * вариантов (`choice`), бегунок (`range`) или действие (`action`).
 */
export interface QuickSetting {
  id: string;
  label: string;
  /** Что делает — для окна настройки панели. */
  hint: string;
  icon: LucideIcon;
  kind: "toggle" | "choice" | "range" | "action";
}

export const QUICK_SETTINGS: readonly QuickSetting[] = [
  { id: "hideAmounts", label: "Скрыть суммы", hint: "Точки вместо денег на экране", icon: EyeOff, kind: "toggle" },
  { id: "offBalance", label: "Счета вне баланса", hint: "Учитывать их во всех итогах", icon: Scale, kind: "toggle" },
  { id: "feedPlanned", label: "Запланированные в ленте", hint: "Скрыть, строкой или в ленте", icon: CalendarClock, kind: "choice" },
  { id: "kopecks", label: "Копейки", hint: "Дробная часть сумм", icon: Coins, kind: "toggle" },
  { id: "tableFont", label: "Размер текста в таблицах", hint: "Шрифт списков операций", icon: Type, kind: "range" },
  { id: "statementLine", label: "Строка из выписки", hint: "Исходный текст банка под операцией", icon: ReceiptText, kind: "toggle" },
  { id: "commentWrap", label: "Длинные комментарии", hint: "Переносить, а не обрезать", icon: TextWrap, kind: "toggle" },
  { id: "rememberFilters", label: "Запоминать фильтры", hint: "Свои фильтры у каждого раздела", icon: History, kind: "toggle" },
  { id: "filtersMode", label: "Панель фильтров", hint: "На странице или по кнопке в шапке", icon: PanelTop, kind: "choice" },
  { id: "columnResize", label: "Своя ширина столбцов", hint: "Двигать границы столбцов мышью", icon: Columns3, kind: "toggle" },
  { id: "hideForeign", label: "Чужие личные счета", hint: "Скрывать счета других людей", icon: Users, kind: "toggle" },
  { id: "pushMode", label: "Отправка в Дзен-мани", hint: "Когда отправлять правки", icon: Upload, kind: "choice" },
  { id: "sync", label: "Синхронизировать", hint: "Забрать свежие данные из Дзен-мани", icon: RefreshCw, kind: "action" },
];

const BY_ID = new Map(QUICK_SETTINGS.map((s) => [s.id, s]));

export function quickSetting(id: string): QuickSetting | undefined {
  return BY_ID.get(id);
}

/** Набор по умолчанию — то, что переключают чаще всего. */
export const DEFAULT_QUICK_SETTINGS: readonly string[] = [
  "hideAmounts",
  "offBalance",
  "kopecks",
  "commentWrap",
  "feedPlanned",
  "tableFont",
];

/**
 * Сохранённый (или пришедший с другого устройства) набор: только знакомые
 * пункты, без повторов. Не массив — набор по умолчанию; пустой массив —
 * осознанно пустая панель, его не подменяем.
 */
export function normalizeQuickSettings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_SETTINGS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isDefaultQuickSettings(items: readonly string[]): boolean {
  return (
    items.length === DEFAULT_QUICK_SETTINGS.length &&
    items.every((id, i) => id === DEFAULT_QUICK_SETTINGS[i])
  );
}
