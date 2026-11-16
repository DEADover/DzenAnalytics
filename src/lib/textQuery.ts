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
 *   -"на вынос"        — условие с пробелом берут в кавычки
 *
 * Обычный текст без условий ищется ровно так же, как до появления условий:
 * фразой, в любой раскладке.
 */
export interface TextQuery {
  /** Запрос пуст — отбирать нечем. */
  empty: boolean;
  /** `text` — всё, по чему ищет поле; `comment` — один комментарий. */
  test: (text: string, comment: string | null | undefined) => boolean;
}

// Пробел после «комм:» не обязателен и не мешает: «комм:-кофе», «комм: -кофе»,
// «комм: нет» читаются одинаково. Минус годится и перед «комм:», и после.
const TOKEN = /(-?)(?:(комментарий|коммент|комм):\s*(-?))?(?:"([^"]*)"?|(\S+))/giu;
const PREFIX_ONLY = /^(комментарий|коммент|комм):$/iu;
// Ровно по одному слову на состояние: чем меньше служебных слов, тем реже
// они совпадут с тем, что человек хотел найти в самом комментарии.
const EMPTY_WORDS = new Set(["нет"]);
const FILLED_WORDS = new Set(["есть"]);

const NO_QUERY: TextQuery = { empty: true, test: () => true };

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

  for (const m of source.matchAll(TOKEN)) {
    const inComment = m[2] !== undefined;
    // Два минуса («-комм:-кофе») друг друга гасят — это уже «содержит».
    const minus = (m[1] === "-") !== (m[3] === "-");
    const quoted = m[4] !== undefined;
    const value = (quoted ? m[4] : m[5]).trim();
    // «комм:-» — условие ещё набирают.
    if (inComment && !quoted && value === "-") continue;
    if (!value) {
      // Одинокий «-» или пустые кавычки — условие ещё не дописано.
      if (!inComment && !quoted && minus) plain.push("-");
      continue;
    }
    if (inComment) {
      const word = value.toLowerCase();
      if (!quoted && (EMPTY_WORDS.has(word) || FILLED_WORDS.has(word))) {
        commentEmpty = EMPTY_WORDS.has(word) !== minus;
      } else {
        (minus ? commentMustNot : commentMust).push(queryMatcher(value));
      }
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
    test: (text, comment) => {
      const c = comment ?? "";
      const filled = c.trim().length > 0;
      if (commentEmpty === true && filled) return false;
      if (commentEmpty === false && !filled) return false;
      for (const f of must) if (!f(text)) return false;
      for (const f of mustNot) if (f(text)) return false;
      for (const f of commentMust) if (!f(c)) return false;
      for (const f of commentMustNot) if (f(c)) return false;
      return true;
    },
  };
}

/** Кусок запроса для подсветки в поле: `op` — служебная часть условия. */
export interface QueryPiece {
  text: string;
  op: boolean;
}

const OP_PIECE = /(^|\s)(-?(?:комментарий|коммент|комм):-?|-(?=[^\s-]))/giu;

/**
 * Разбить запрос на куски для подсветки: «комм:», «-комм:» и минус перед
 * словом — служебные, остальное — обычный текст. Склейка кусков даёт запрос
 * символ в символ: слой подсветки лежит поверх поля и обязан с ним совпадать.
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

const COMMENT_START = /(^|\s)(-?)(комм[а-яё]*)$/iu;

/**
 * Человек дописывает «комм…» в конце запроса — предложить условие по
 * комментарию. Возвращает запрос с подставленным «комм:» или `null`.
 */
export function completeCommentPrefix(value: string): string | null {
  const m = COMMENT_START.exec(value);
  if (!m) return null;
  if (!"комментарий".startsWith(m[3].toLowerCase())) return null;
  return value.slice(0, m.index + m[1].length) + m[2] + "комм:";
}

/** Запрос кончается на «комм:» без значения — самое время подсказать, что писать. */
export function awaitsCommentValue(value: string): boolean {
  return /(^|\s)-?(?:комментарий|коммент|комм):$/iu.test(value);
}
