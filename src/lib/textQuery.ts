import { queryMatcher } from "./keyboardLayout";

/**
 * Запрос текстового поиска с условиями (#135). Один разбор на оба поля —
 * «Фильтр» в общей панели и «Быстрый поиск по таблице».
 *
 *   кофе на вынос      — содержит эту фразу (как и раньше: текст целиком)
 *   -кофе              — не содержит
 *   комм:кофе          — слово есть в комментарии
 *   комм:-кофе         — слова нет в комментарии (то же: -комм:кофе)
 *   комм:нет           — комментария нет
 *   комм:есть          — комментарий есть
 *   сумма:>5000        — сумма больше; ещё <, >=, <=, «сумма:5000», «сумма:1000-5000»
 *   счёт:сбер          — слово есть в названии счёта (у перевода — любого из двух)
 *   кат:еда            — слово есть в категории, подкатегории или второй категории
 *   -"на вынос"        — условие с пробелом берут в кавычки
 *
 * Обычный текст без условий ищется ровно так же, как до появления условий:
 * фразой, в любой раскладке.
 */
export interface TextQuery {
  /** Запрос пуст — отбирать нечем. */
  empty: boolean;
  /**
   * `text` — всё, по чему ищет поле; `comment` — один комментарий; `fields` —
   * то, на что смотрят условия «сумма:», «счёт:» и «кат:». Условие по полю,
   * которого у строки нет, не выполняется.
   */
  test: (text: string, comment: string | null | undefined, fields?: QueryFields) => boolean;
}

/** Поля строки для условий «сумма:», «счёт:», «кат:». */
export interface QueryFields {
  /** Сумма, как она стоит в строке операции; знак не важен. */
  amount?: number | null;
  /** Названия счетов строки одной строкой (у перевода — оба). */
  account?: string | null;
  /** Категория с подкатегорией и вторые категории одной строкой. */
  category?: string | null;
}

export type QueryField = "comment" | "amount" | "account" | "category";

/** Как условие пишется: первым — то написание, которое подставляет Tab. */
const FIELD_PREFIXES: Record<QueryField, readonly string[]> = {
  comment: ["комм", "коммент", "комментарий"],
  amount: ["сумма"],
  account: ["счёт", "счет"],
  category: ["кат", "категория"],
};
const FIELD_OF = new Map<string, QueryField>(
  (Object.entries(FIELD_PREFIXES) as [QueryField, readonly string[]][]).flatMap(([field, list]) =>
    list.map((p) => [p, field] as const)
  )
);
// Длинные написания — первыми, иначе «комм» съел бы начало «комментарий».
const PREFIX_ALT = [...FIELD_OF.keys()].sort((a, b) => b.length - a.length).join("|");

// Пробел после «комм:» не обязателен и не мешает: «комм:-кофе», «комм: -кофе»,
// «комм: нет» читаются одинаково. Минус годится и перед условием, и после.
const TOKEN = new RegExp(`(-?)(?:(${PREFIX_ALT}):\\s*(-?))?(?:"([^"]*)"?|(\\S+))`, "giu");
const PREFIX_ONLY = new RegExp(`^(?:${PREFIX_ALT}):$`, "iu");
// Ровно по одному слову на состояние: чем меньше служебных слов, тем реже
// они совпадут с тем, что человек хотел найти в самом комментарии.
const EMPTY_WORDS = new Set(["нет"]);
const FILLED_WORDS = new Set(["есть"]);

const NO_QUERY: TextQuery = { empty: true, test: () => true };

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const AMOUNT_COMPARE = new RegExp(`^(>=|<=|>|<|=)?(${NUMBER})$`);
const AMOUNT_RANGE = new RegExp(`^(${NUMBER})(?:-|\\.\\.)(${NUMBER})$`);
const num = (v: string) => Number(v.replace(",", "."));
/** Копейки округления: 1000,004 и 1000 — одна сумма. */
const CENT = 0.005;

/**
 * Условие по сумме: «>5000», «<=100», «5000», «1000-5000». `null` — значение
 * ещё набирают («>» без числа) или в нём опечатка.
 */
export function amountPredicate(value: string): ((amount: number) => boolean) | null {
  const range = AMOUNT_RANGE.exec(value);
  if (range) {
    const lo = Math.min(num(range[1]), num(range[2]));
    const hi = Math.max(num(range[1]), num(range[2]));
    return (a) => a >= lo - CENT && a <= hi + CENT;
  }
  const cmp = AMOUNT_COMPARE.exec(value);
  if (!cmp) return null;
  const n = num(cmp[2]);
  switch (cmp[1]) {
    case ">":
      return (a) => a > n + CENT;
    case ">=":
      return (a) => a >= n - CENT;
    case "<":
      return (a) => a < n - CENT;
    case "<=":
      return (a) => a <= n + CENT;
    default:
      return (a) => Math.abs(a - n) < CENT;
  }
}

export function parseTextQuery(raw: string): TextQuery {
  const source = raw.trim();
  if (!source) return NO_QUERY;

  const plain: string[] = [];
  const must: ((t: string) => boolean)[] = [];
  const mustNot: ((t: string) => boolean)[] = [];
  const commentMust: ((t: string) => boolean)[] = [];
  const commentMustNot: ((t: string) => boolean)[] = [];
  /** `true` — комментарий обязан быть пустым, `false` — непустым. */
  let commentEmpty: boolean | null = null;
  /** Условия по сумме, счёту и категории: каждое обязано выполниться. */
  const fieldChecks: ((f: QueryFields) => boolean)[] = [];

  for (const m of source.matchAll(TOKEN)) {
    const field = m[2] !== undefined ? FIELD_OF.get(m[2].toLowerCase()) : undefined;
    // Два минуса («-комм:-кофе») друг друга гасят — это уже «содержит».
    const minus = (m[1] === "-") !== (m[3] === "-");
    const quoted = m[4] !== undefined;
    const value = (quoted ? m[4] : m[5]).trim();
    // «комм:-» — условие ещё набирают.
    if (field && !quoted && value === "-") continue;
    if (!value) {
      // Одинокий «-» или пустые кавычки — условие ещё не дописано.
      if (!field && !quoted && minus) plain.push("-");
      continue;
    }
    if (field === "comment") {
      const word = value.toLowerCase();
      if (!quoted && (EMPTY_WORDS.has(word) || FILLED_WORDS.has(word))) {
        commentEmpty = EMPTY_WORDS.has(word) !== minus;
      } else {
        (minus ? commentMustNot : commentMust).push(queryMatcher(value));
      }
    } else if (field === "amount") {
      const hit = amountPredicate(value);
      // Недописанное или с опечаткой — не условие: иначе на каждой букве
      // набора список пустел бы.
      if (!hit) continue;
      fieldChecks.push((f) => f.amount != null && hit(Math.abs(f.amount)) !== minus);
    } else if (field === "account" || field === "category") {
      const hit = queryMatcher(value);
      const key = field;
      fieldChecks.push((f) => f[key] != null && hit(f[key] ?? "") !== minus);
    } else if (minus) {
      mustNot.push(queryMatcher(value));
    } else if (quoted) {
      must.push(queryMatcher(value));
    } else if (!PREFIX_ONLY.test(m[5])) {
      // «комм:» без значения — условие ещё набирают, искать его буквально незачем.
      plain.push(m[5]);
    }
  }
  // Обычные слова остаются одной фразой — поиск «кофе на вынос» не меняется.
  if (plain.length) must.push(queryMatcher(plain.join(" ")));

  return {
    empty: false,
    test: (text, comment, fields = {}) => {
      const c = comment ?? "";
      const filled = c.trim().length > 0;
      if (commentEmpty === true && filled) return false;
      if (commentEmpty === false && !filled) return false;
      for (const f of must) if (!f(text)) return false;
      for (const f of mustNot) if (f(text)) return false;
      for (const f of commentMust) if (!f(c)) return false;
      for (const f of commentMustNot) if (f(c)) return false;
      for (const f of fieldChecks) if (!f(fields)) return false;
      return true;
    },
  };
}

/** Поля операции для условий — одним местом на все ленты. */
export function txQueryFields(t: {
  amount: number;
  account?: string | null;
  outcomeAccount?: string | null;
  incomeAccount?: string | null;
  categoryFull?: string | null;
  extraCategories?: readonly string[] | null;
}): QueryFields {
  return {
    amount: t.amount,
    account: [t.account, t.outcomeAccount, t.incomeAccount].filter(Boolean).join(" "),
    category: [t.categoryFull, ...(t.extraCategories ?? [])].filter(Boolean).join(" "),
  };
}

/** Кусок запроса для подсветки в поле: `op` — служебная часть условия. */
export interface QueryPiece {
  text: string;
  op: boolean;
}

const OP_PIECE = new RegExp(`(^|\\s)(-?(?:${PREFIX_ALT}):-?|-(?=[^\\s-]))`, "giu");

/**
 * Разбить запрос на куски для подсветки: «комм:», «-комм:», «сумма:» и минус
 * перед словом — служебные, остальное — обычный текст. Склейка кусков даёт
 * запрос символ в символ: слой подсветки лежит поверх поля и обязан с ним
 * совпадать.
 */
export function queryPieces(value: string): QueryPiece[] {
  const out: QueryPiece[] = [];
  let at = 0;
  for (const m of value.matchAll(OP_PIECE)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > at) out.push({ text: value.slice(at, start), op: false });
    out.push({ text: m[2], op: true });
    at = start + m[2].length;
  }
  if (at < value.length) out.push({ text: value.slice(at), op: false });
  return out;
}

/** Что подсказать, когда условие дописывают, и что писать после двоеточия. */
const FIELD_HINTS: Record<QueryField, { suggest: string; values: string; min: number }> = {
  // «ком», «сум» — начала обычных слов («компот», «сумка»): ждём четвёртую букву.
  comment: { suggest: "Искать в комментарии", values: "слово, -слово, есть или нет", min: 4 },
  amount: { suggest: "Искать по сумме", values: ">5000, <100 или 1000-5000", min: 4 },
  account: { suggest: "Искать по счёту", values: "слово или -слово", min: 4 },
  category: { suggest: "Искать по категории", values: "слово или -слово", min: 3 },
};

const PREFIX_START = /(^|\s)(-?)([а-яё]+)$/iu;

/**
 * Человек дописывает «комм…», «сумм…», «счёт» или «кат…» в конце запроса —
 * предложить условие. Возвращает запрос с подставленным условием и подпись
 * подсказки, или `null`.
 */
export function completePrefix(value: string): { next: string; label: string } | null {
  const m = PREFIX_START.exec(value);
  if (!m) return null;
  const typed = m[3].toLowerCase();
  for (const [field, list] of Object.entries(FIELD_PREFIXES) as [QueryField, readonly string[]][]) {
    if (typed.length < FIELD_HINTS[field].min) continue;
    if (!list.some((p) => p.startsWith(typed))) continue;
    return {
      next: value.slice(0, m.index + m[1].length) + m[2] + list[0] + ":",
      label: FIELD_HINTS[field].suggest,
    };
  }
  return null;
}

const AWAITS = new RegExp(`(^|\\s)-?(${PREFIX_ALT}):$`, "iu");

/** Запрос кончается на «комм:» или «сумма:» без значения — подсказать, что писать. */
export function awaitsValue(value: string): string | null {
  const m = AWAITS.exec(value);
  const field = m ? FIELD_OF.get(m[2].toLowerCase()) : undefined;
  return field ? FIELD_HINTS[field].values : null;
}

/** Названия, которые поле подставляет после «счёт:» и «кат:». */
export interface QueryValueLists {
  /** Счета, самые ходовые — первыми. */
  account: readonly string[];
  /** Категории и подкатегории по отдельности, самые ходовые — первыми. */
  category: readonly string[];
}

const fold = (v: string) => v.toLowerCase().replace(/ё/g, "е");

// Значение условия в конце запроса: без кавычек — до пробела, с открытой
// кавычкой — со всеми пробелами внутри.
const VALUE_TAIL = new RegExp(`(^|\\s)(-?)(${PREFIX_ALT}):(\\s*)(-?)(?:"([^"]*)|([^\\s"]+))$`, "iu");

/**
 * Человек набирает значение после «счёт:» или «кат:» — предложить название
 * целиком. Сначала ищем то, что с набранного начинается, потом то, где оно
 * встречается внутри. Название с пробелом подставляется в кавычках, иначе
 * условие оборвалось бы на первом слове. `null` — предложить нечего или
 * название уже дописано.
 */
export function completeValue(
  value: string,
  lists: QueryValueLists
): { next: string; label: string } | null {
  const m = VALUE_TAIL.exec(value);
  if (!m) return null;
  const field = FIELD_OF.get(m[3].toLowerCase());
  if (field !== "account" && field !== "category") return null;
  const typed = fold((m[6] ?? m[7] ?? "").trim());
  if (!typed) return null;
  const names = lists[field];
  const hit = names.find((n) => fold(n).startsWith(typed)) ?? names.find((n) => fold(n).includes(typed));
  if (!hit || fold(hit) === typed) return null;
  const written = /\s/.test(hit) ? `"${hit}"` : hit;
  return {
    next: `${value.slice(0, m.index + m[1].length)}${m[2]}${m[3]}:${m[4]}${m[5]}${written}`,
    label: hit,
  };
}
