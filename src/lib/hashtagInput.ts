/**
 * Подсказка хэштегов в полях ввода: где под кареткой набирается «#слово»,
 * какие теги ему подходят и как подставить выбранный. Одно на поле комментария
 * и поля поиска, чтобы подсказка вела себя в них одинаково.
 */

import { prefixMatcher } from "./keyboardLayout";

export const HASHTAG_MENU_LIMIT = 50;

export interface HashFragment {
  /** Где стоит «#». */
  start: number;
  /** Что набрано после неё. */
  query: string;
}

/**
 * Набираемый под кареткой тег. Символы — те же, что у тега в комментарии, плюс
 * клавиши, на которых в другой раскладке стоят «х ъ ж э б ю ё» («[j,,b» — это
 * «хобби»): подойдёт ли такое начало, решит поиск.
 */
export function hashFragment(text: string, caret: number): HashFragment | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf("#");
  if (start === -1) return null;
  const query = upto.slice(start + 1);
  return /^[\p{L}\p{N}_\-[\];',.`]*$/u.test(query) ? { start, query } : null;
}

/** Подходящие теги: прямые совпадения первыми, потом набранные в другой раскладке. */
export function matchHashtags(
  tags: readonly string[],
  query: string,
  limit: number = HASHTAG_MENU_LIMIT
): string[] {
  const m = prefixMatcher(query);
  return tags
    .map((t) => ({ t, r: m.rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.t)
    .slice(0, limit);
}

/** Заменить набираемый фрагмент выбранным тегом; пробел после него — один. */
export function insertHashtag(
  value: string,
  fragment: HashFragment,
  tag: string
): { next: string; caret: number } {
  const before = value.slice(0, fragment.start);
  const after = value.slice(fragment.start + 1 + fragment.query.length);
  const insert = `#${tag}`;
  const sep = after.startsWith(" ") ? "" : " ";
  return { next: before + insert + sep + after, caret: (before + insert + sep).length };
}
