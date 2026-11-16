import { queryMatcher } from "./keyboardLayout";

/**
 * Запрос текстового поиска с условиями (#135). Один разбор на оба поля —
 * «Фильтр» в общей панели и «Быстрый поиск по таблице».
 *
 *   кофе на вынос      — содержит эту фразу (как и раньше: текст целиком)
 *   -кофе              — не содержит
 *   комм:кофе          — слово есть в комментарии
 *   -комм:кофе         — слова нет в комментарии
 *   комм:пусто         — комментария нет
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

/** Подсказка об условиях — одна на все поля, где они работают. */
export const TEXT_QUERY_HINT =
  "Условия поиска:\n" +
  "-слово — не содержит\n" +
  "комм:слово — есть в комментарии\n" +
  "-комм:слово — нет в комментарии\n" +
  "комм:пусто — без комментария\n" +
  "комм:есть — с комментарием\n" +
  "Условие с пробелом — в кавычках: -\"на вынос\"";

const TOKEN = /(-?)(?:(комментарий|коммент|комм):)?(?:"([^"]*)"?|(\S+))/giu;
const PREFIX_ONLY = /^(комментарий|коммент|комм):$/iu;
const EMPTY_WORDS = new Set(["пусто", "пустой", "нет"]);
const FILLED_WORDS = new Set(["есть", "непусто", "непустой"]);

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
    const minus = m[1] === "-";
    const inComment = m[2] !== undefined;
    const quoted = m[3] !== undefined;
    const value = (quoted ? m[3] : m[4]).trim();
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
    } else if (!PREFIX_ONLY.test(m[4])) {
      // «комм:» без значения — условие ещё набирают, искать его буквально незачем.
      plain.push(m[4]);
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
