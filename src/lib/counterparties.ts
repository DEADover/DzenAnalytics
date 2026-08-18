/**
 * Контрагенты: связывание имени с записью справочника и заведение недостающих.
 *
 * Отдельным модулем, а не внутри разбора Excel: тем же занята и форма создания
 * операции, а тащить в неё ридер .xlsx ради одной функции — значит тащить его
 * в основной бандл. Всё чистое, без ввода-вывода.
 */

import type { ZenTransaction } from "./zenmoney";
import { merchantKey, type NewCounterpartyDraft } from "./zenmoneyPush";

/** Убрать то, чего пользователь не видит: неразрывные пробелы, хвосты, апостроф. */
function tidy(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/^'/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Что разбор решил про контрагента строки. */
export interface CounterpartyHit {
  id: string;
  /** Написание, под которым запись уедет в справочник. */
  title: string;
  /** Такой записи ещё нет — заведём. */
  isNew: boolean;
}

export interface CounterpartyMinter {
  /** Найти контрагента по имени или завести нового. Пустое имя — `null`. */
  resolve: (raw: string) => CounterpartyHit | null;
  /** Заведённые за этот прогон — в порядке первой встречи. */
  minted: () => NewCounterpartyDraft[];
}

/**
 * Связыватель имён с записями справочника, заводящий недостающие.
 *
 * Один на прогон разбора: два раза встреченное имя обязано дать ОДИН id,
 * иначе в справочник уедут две одинаковые записи, а операции разъедутся по
 * ним. Написание берётся у первой встреченной строки — какое-то выбрать
 * всё равно надо, а первое человек видит в отчёте выше остальных.
 *
 * Порядок поиска: облако → уже заведённые локально → заведённые в этом
 * прогоне. Облако первым, потому что запись с таким именем там уже есть, и
 * вторая была бы дублем.
 */
export function createCounterpartyMinter(
  cached: { id: string; title: string }[],
  pending: NewCounterpartyDraft[] = [],
  mintId: () => string = () => crypto.randomUUID()
): CounterpartyMinter {
  const known = new Map<string, string>();
  for (const m of [...cached, ...pending]) {
    const key = merchantKey(m.title);
    if (key && !known.has(key)) known.set(key, m.id);
  }
  const fresh = new Map<string, NewCounterpartyDraft>();
  return {
    resolve(raw) {
      const title = tidy(raw);
      const key = merchantKey(title);
      if (!key) return null;
      const hit = known.get(key);
      if (hit) return { id: hit, title, isNew: false };
      const already = fresh.get(key);
      if (already) return { ...already, isNew: true };
      const item = { id: mintId(), title };
      fresh.set(key, item);
      return { ...item, isNew: true };
    },
    minted: () => [...fresh.values()],
  };
}

/** «ё» и «е» — одна буква, когда ищем ПОХОЖЕЕ имя (но не когда сверяем точно). */
const loose = (v: string) => merchantKey(v).replace(/ё/g, "е");

/**
 * Ближайшее имя из справочника — для подсказки, а не для подмены.
 *
 * «Пятерочка» при живой «Пятёрочке» почти наверняка опечатка, но решать
 * человеку: бывает и вправду вторая лавка с похожим именем.
 */
export function nearestPayee(raw: string, payees: string[]): string | undefined {
  const name = loose(raw);
  if (!name) return undefined;
  return (
    payees.find((p) => loose(p) === name) ??
    payees.find((p) => loose(p).startsWith(name)) ??
    payees.find((p) => loose(p).includes(name)) ??
    payees.find((p) => name.includes(loose(p)))
  );
}

/**
 * Переклеить операции на записи, появившиеся, пока человек смотрел отчёт.
 *
 * Между разбором файла и нажатием «Создать» проходит время: за него того же
 * контрагента могли завести руками в справочниках или он мог приехать из
 * облака синхронизацией. Тогда заводить второго нельзя — надо сослаться на
 * существующего. Сверка чистая и делается ровно в момент записи.
 */
export function reconcileNewCounterparties(
  txs: ZenTransaction[],
  minted: NewCounterpartyDraft[],
  cached: { id: string; title: string }[],
  pending: NewCounterpartyDraft[] = []
): { txs: ZenTransaction[]; toCreate: NewCounterpartyDraft[] } {
  const known = new Map<string, string>();
  for (const m of [...cached, ...pending]) {
    const key = merchantKey(m.title);
    if (key && !known.has(key)) known.set(key, m.id);
  }
  const remap = new Map<string, string>();
  const toCreate: NewCounterpartyDraft[] = [];
  for (const m of minted) {
    const hit = known.get(merchantKey(m.title));
    if (hit) remap.set(m.id, hit);
    else toCreate.push(m);
  }
  if (remap.size === 0) return { txs, toCreate };
  return {
    txs: txs.map((t) => {
      const to = t.merchant ? remap.get(String(t.merchant)) : undefined;
      return to ? { ...t, merchant: to } : t;
    }),
    toCreate,
  };
}
