import type { Transaction } from "../types";
import { swapLayout } from "./keyboardLayout";

/**
 * Подсказка в поле комментария: серое продолжение того, что набирается, по
 * прежним комментариям человека. Принимается клавишей Tab.
 *
 * Два уровня:
 *  - **фраза** — набранное совпадает с началом прежнего комментария: «Обед с»
 *    → «Обед с коллегами»;
 *  - **слово** — иначе дописываем начатое слово самым частым словом из
 *    комментариев: «пят» → «пятёрочка».
 *
 * Чем чаще и чем свежее, тем выше; комментарии у того же получателя и в той
 * же категории — ещё выше: «Обед» у «Столовой» продолжится иначе, чем у
 * «Ресторана». Подсказываем только повторяющееся — разовая опечатка
 * подсказкой не станет.
 *
 * Набрали в другой раскладке — подсказка исправит и её: «Lt» → «День».
 * Тогда принятие заменяет набранное слово целиком, а не дописывает его.
 *
 * Всё считается в браузере из уже загруженных операций — никуда не уходит.
 */

/** Одна запись: фраза или слово, с весом по всем её появлениям. */
interface Entry {
  /** Как написано в последний раз — так и подставим. */
  text: string;
  /** Нижний регистр и «е» вместо «ё» — по нему сравниваем. */
  key: string;
  /** Сколько раз встречалось — для порога «повторяется». */
  count: number;
  /** Вес без контекста: каждое появление, свежие — тяжелее. */
  weight: number;
  /** Вес появлений у получателя / в категории — по их ключам. */
  byPayee: Map<string, number>;
  byCategory: Map<string, number>;
  /** Дата последнего появления — у одинаковых `text` берём свежее написание. */
  last: string;
}

export interface CommentIndex {
  phrases: Entry[];
  words: Entry[];
}

export interface SuggestContext {
  payee?: string | null;
  category?: string | null;
}

export interface CommentSuggestion {
  /** С какого места заменить набранное (длина текста — значит просто дописать). */
  from: number;
  /** Что вставить с `from`. */
  insert: string;
  /** Что показать серым после курсора. */
  ghost: string;
}

/** Слово меньше этой длины не подсказываем: на «в» и «на» подсказка только мешает. */
const MIN_WORD = 3;
/** Сколько букв слова набрать, прежде чем подсказывать. */
const MIN_TYPED = 2;
/** Сколько раз должно встретиться, чтобы стать подсказкой. */
const MIN_COUNT = 2;
/** Разделители слов — пробелы и знаки препинания; «#» и «-» — части слова. */
const WORD_SPLIT = /[\s,.;:!?()«»"'/\\]+/u;

const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const ctxKey = (s: string | null | undefined) => fold((s ?? "").trim());

/** Свежесть: операция этого года весит единицу, двухлетней давности — треть. */
function recency(date: string, today: number): number {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return 0.5;
  const years = Math.max(0, (today - t) / (365 * 24 * 3600 * 1000));
  return 1 / (1 + years);
}

function add(
  map: Map<string, Entry>,
  text: string,
  date: string,
  w: number,
  payee: string,
  category: string
) {
  const key = fold(text);
  let e = map.get(key);
  if (!e) {
    e = { text, key, count: 0, weight: 0, byPayee: new Map(), byCategory: new Map(), last: date };
    map.set(key, e);
  }
  e.count++;
  e.weight += w;
  if (payee) e.byPayee.set(payee, (e.byPayee.get(payee) ?? 0) + w);
  if (category) e.byCategory.set(category, (e.byCategory.get(category) ?? 0) + w);
  if (date >= e.last) {
    e.last = date;
    e.text = text;
  }
}

/** Собрать подсказки из операций. Дорого только один раз — на смену данных. */
export function buildCommentIndex(
  txs: readonly Pick<Transaction, "comment" | "date" | "payee" | "brand" | "categoryFull">[],
  today: number = Date.now()
): CommentIndex {
  const phrases = new Map<string, Entry>();
  const words = new Map<string, Entry>();
  for (const t of txs) {
    const comment = (t.comment ?? "").trim().replace(/\s+/g, " ");
    if (!comment) continue;
    const w = recency(t.date, today);
    const payee = ctxKey(t.brand || t.payee);
    const category = ctxKey(t.categoryFull);
    add(phrases, comment, t.date, w, payee, category);
    for (const word of comment.split(WORD_SPLIT)) {
      // Хэштеги подсказывает свой список после «#», числа — не слова.
      if (word.length < MIN_WORD || word.startsWith("#") || /^[\d\s.,]+$/.test(word)) continue;
      add(words, word, t.date, w, payee, category);
    }
  }
  const keep = (m: Map<string, Entry>) => [...m.values()].filter((e) => e.count >= MIN_COUNT);
  return { phrases: keep(phrases), words: keep(words) };
}

function score(e: Entry, ctx: { payee: string; category: string }): number {
  // Своё у получателя втрое важнее общего, своё в категории — вдвое.
  return e.weight + 3 * (e.byPayee.get(ctx.payee) ?? 0) + 2 * (e.byCategory.get(ctx.category) ?? 0);
}

/** Лучшая запись, которая начинается с `prefix` и длиннее него. */
function best(list: Entry[], prefix: string, ctx: { payee: string; category: string }): Entry | null {
  let top: Entry | null = null;
  let topScore = -1;
  for (const e of list) {
    if (e.key.length <= prefix.length || !e.key.startsWith(prefix)) continue;
    const s = score(e, ctx);
    if (s > topScore) {
      top = e;
      topScore = s;
    }
  }
  return top;
}

/**
 * Подсказка к набранному `text`. Курсор — в конце: подсказывать посреди
 * фразы значило бы гадать, что человек правит. `null` — подсказать нечего.
 */
export function suggestComment(
  index: CommentIndex,
  text: string,
  context: SuggestContext = {}
): CommentSuggestion | null {
  // Пробел в конце — слово закончено, фразу ещё можно продолжить.
  const typed = text.replace(/^\s+/, "");
  if (typed.trim().length < MIN_TYPED) return null;
  const lead = text.length - typed.length;
  const ctx = { payee: ctxKey(context.payee), category: ctxKey(context.category) };

  // 1. Фраза целиком: набранное — начало прежнего комментария.
  const folded = fold(typed);
  const phrase = best(index.phrases, folded, ctx);
  if (phrase) {
    const tail = phrase.text.slice(typed.length);
    return { from: text.length, insert: tail, ghost: tail };
  }

  // 2. Слово: начатое последнее слово.
  const m = /[^\s,.;:!?()«»"'/\\]+$/u.exec(text);
  const word = m?.[0] ?? "";
  if (word.length < MIN_TYPED || word.startsWith("#")) return null;
  const hit = best(index.words, fold(word), ctx);
  if (hit) {
    const tail = hit.text.slice(word.length);
    return { from: text.length, insert: tail, ghost: tail };
  }

  // 3. То же в другой раскладке — заменяем набранное правильным.
  const swappedTyped = swapLayout(typed.toLowerCase());
  const swappedPhrase = best(index.phrases, fold(swappedTyped), ctx);
  if (swappedPhrase) {
    return { from: lead, insert: swappedPhrase.text, ghost: ` → ${swappedPhrase.text}` };
  }
  const swappedWord = best(index.words, fold(swapLayout(word.toLowerCase())), ctx);
  if (swappedWord) {
    return { from: text.length - word.length, insert: swappedWord.text, ghost: ` → ${swappedWord.text}` };
  }
  return null;
}

/** Текст после принятия подсказки. */
export function acceptSuggestion(text: string, s: CommentSuggestion): string {
  return text.slice(0, s.from) + s.insert;
}
