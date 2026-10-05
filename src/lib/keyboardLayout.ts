/**
 * Поиск, которому всё равно, в какой раскладке набрали: «ghjl» находит
 * «Продукты», «ьфп» — «magnit». Так умела веб-версия Дзен-мани, и без этого
 * приходилось стирать набранное и переключать раскладку.
 *
 * Заодно «ё» и «е» считаются одной буквой: «Ёлочка» находится по «елочка».
 */

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const EN_TO_RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Строка, набранная в другой раскладке: латиница ↔ кириллица по клавишам. */
export function swapLayout(s: string): string {
  let out = "";
  for (const c of s) out += EN_TO_RU.get(c) ?? RU_TO_EN.get(c) ?? c;
  return out;
}

/** Нижний регистр и «ё» → «е» — чтобы сравнивать по смыслу, а не по написанию. */
function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

/**
 * Подходит ли `text` под набранное `query` — как есть или в другой
 * раскладке. `query` можно передавать как угодно: регистр и «ё» не важны.
 */
export function textMatches(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = fold(text);
  return t.includes(fold(q)) || t.includes(fold(swapLayout(q)));
}

/**
 * То же, что `textMatches`, но запрос готовится один раз — для поиска по
 * тысячам операций на каждое нажатие клавиши.
 */
export function queryMatcher(query: string): (text: string) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  const direct = fold(q);
  const swapped = fold(swapLayout(q));
  return (text) => {
    const t = fold(text);
    return t.includes(direct) || (swapped !== direct && t.includes(swapped));
  };
}

/**
 * Начинается ли `text` с набранного `query` — как есть или в другой раскладке.
 * Для подсказок, которые дописывают начатое слово: «#Jngecr» → «Отпуск».
 * Сначала проверяется прямое совпадение, поэтому в списке оно идёт первым,
 * если отсортировать по `rank`.
 */
export function prefixMatcher(query: string): { test: (text: string) => boolean; rank: (text: string) => number } {
  const direct = fold(query);
  const swapped = fold(swapLayout(query.toLowerCase()));
  const rank = (text: string) => {
    const t = fold(text);
    if (t.startsWith(direct)) return 0;
    if (swapped !== direct && t.startsWith(swapped)) return 1;
    return -1;
  };
  return { test: (text) => rank(text) >= 0, rank };
}
