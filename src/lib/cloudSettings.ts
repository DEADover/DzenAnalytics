/**
 * Настройки в облаке Дзен-мани — чистая часть: формат, поиск, слияние.
 *
 * ЗАЧЕМ. Своих данных, которых нет в Дзен-мани, у нас немного — правила,
 * базовые настройки, оформление и главная, — но живут они только в браузере:
 * на втором устройстве всё с нуля. Своего сервера у приложения нет, поэтому
 * переносим их через сам Дзен-мани, тем же приёмом, что и Zerro: JSON в
 * комментарии разового «напоминания» (`reminder`) на служебном счёте.
 *
 * ЧТО ПРОВЕРЕНО НА ЖИВОМ API (16.09.2026, тестовый аккаунт):
 *   • у `comment` своего лимита нет, предел — ~10 МБ на весь запрос;
 *   • разовое напоминание на 01.01.2020 плановых операций не порождает;
 *   • архивный счёт вне баланса создаётся пушем;
 *   • удаление счёта удаляет и его напоминания, и diff сообщает об обоих;
 *   • правку одного объекта сервер решает по `changed`: запись с меньшим
 *     `changed` молча отбрасывается, `changed` из будущего заменяется временем
 *     сервера. Поэтому `changed` ставим не меньше лежащего на сервере.
 *
 * ГЛАВНАЯ КОПИЯ — ЛОКАЛЬНАЯ. Облако только переносит между устройствами: если
 * служебный счёт удалят, в браузере всё останется.
 */

import type { ZenAccount, ZenReminder } from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";

/** Метка наших записей — чтобы не спутать с данными Zerro в том же аккаунте. */
export const CLOUD_APP = "dzenanalytics";
/** Версия формата. Запись новее, чем знает приложение, только читаем. */
export const CLOUD_FORMAT_VERSION = 1;
/** Название служебного счёта. Счёт в архиве и вне баланса. */
export const SERVICE_ACCOUNT_TITLE = "DzenAnalytics Settings";
/** Служебный счёт Zerro — тоже не деньги пользователя, у себя его прячем. */
const ZERRO_ACCOUNT_TITLE = "🤖 [Zerro Data]";
/** Сколько помним удалённые правила, чтобы они не воскресли с другого устройства. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;

export type CloudDocType = "settings" | "rules";
const DOC_TYPES: readonly CloudDocType[] = ["settings", "rules"];

export interface CloudEnvelope<T = unknown> {
  app: typeof CLOUD_APP;
  type: CloudDocType;
  v: number;
  /** Когда запись собрана, мс. */
  at: number;
  data: T;
}

/** Строка JSON с ключами по алфавиту — для сравнения «то же самое или нет». */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}

/** Наша запись из комментария напоминания; чужое и битое — `null`. */
export function parseEnvelope(comment: string | null | undefined): CloudEnvelope | null {
  if (!comment || comment[0] !== "{") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(comment);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<CloudEnvelope>;
  if (e.app !== CLOUD_APP) return null;
  if (!DOC_TYPES.includes(e.type as CloudDocType)) return null;
  if (typeof e.v !== "number" || typeof e.at !== "number") return null;
  if (!e.data || typeof e.data !== "object") return null;
  return e as CloudEnvelope;
}

export function envelopeComment<T>(type: CloudDocType, data: T, at: number): string {
  const env: CloudEnvelope<T> = { app: CLOUD_APP, type, v: CLOUD_FORMAT_VERSION, at, data };
  return JSON.stringify(env);
}

/* ─────────────────────────  служебный счёт и записи  ───────────────────────── */

/** Служебный счёт — наш или Zerro: деньгами пользователя он не является. */
export function isServiceAccountTitle(title: string | null | undefined): boolean {
  return title === SERVICE_ACCOUNT_TITLE || title === ZERRO_ACCOUNT_TITLE;
}

export interface FoundDoc {
  reminder: ZenReminder;
  env: CloudEnvelope;
}

export interface FoundDocs {
  byType: Record<CloudDocType, FoundDoc[]>;
  /** Наш служебный счёт, если он есть. */
  accountId: string | null;
}

/**
 * Наши записи в кэше и служебный счёт.
 *
 * Счёт ищем сначала по записям — название пользователь может поменять, — и
 * только потом по названию.
 */
export function findCloudDocs(cache: Pick<ZenCache, "reminders" | "accounts">): FoundDocs {
  const byType: Record<CloudDocType, FoundDoc[]> = { settings: [], rules: [] };
  const accounts = new Map((cache.accounts ?? []).map((a) => [a.id, a]));
  let accountId: string | null = null;
  for (const reminder of cache.reminders ?? []) {
    const env = parseEnvelope(reminder.comment);
    if (!env) continue;
    byType[env.type].push({ reminder, env });
    if (!accountId && reminder.incomeAccount && accounts.has(reminder.incomeAccount)) {
      accountId = reminder.incomeAccount;
    }
  }
  if (!accountId) {
    accountId = (cache.accounts ?? []).find((a) => a.title === SERVICE_ACCOUNT_TITLE)?.id ?? null;
  }
  return { byType, accountId };
}

/** Архивный счёт вне баланса с нулём — в Дзен-мани он не мешает. */
export function buildServiceAccount(opts: {
  id: string;
  user: number;
  instrument: number;
  nowSec: number;
}): ZenAccount {
  return {
    id: opts.id,
    user: opts.user,
    instrument: opts.instrument,
    type: "cash",
    role: null,
    private: false,
    savings: false,
    title: SERVICE_ACCOUNT_TITLE,
    inBalance: false,
    creditLimit: 0,
    startBalance: 0,
    balance: 0,
    company: null,
    archive: true,
    enableCorrection: false,
    balanceCorrectionType: "request",
    startDate: null,
    capitalization: null,
    percent: null,
    changed: opts.nowSec,
    syncID: null,
    enableSMS: false,
    endDateOffset: null,
    endDateOffsetInterval: null,
    payoffStep: null,
    payoffInterval: null,
  } as unknown as ZenAccount;
}

/**
 * Запись-носитель: разовое «напоминание» на 01.01.2020, переводом со
 * служебного счёта на него же. Проверено: плановых операций не порождает.
 */
export function buildDocReminder(opts: {
  id: string;
  user: number;
  accountId: string;
  instrument: number;
  comment: string;
  changed: number;
}): ZenReminder {
  return {
    id: opts.id,
    user: opts.user,
    income: 1,
    outcome: 0,
    changed: opts.changed,
    incomeInstrument: opts.instrument,
    outcomeInstrument: opts.instrument,
    step: 0,
    points: [0],
    startDate: "2020-01-01",
    endDate: "2020-01-01",
    notify: false,
    interval: null,
    incomeAccount: opts.accountId,
    outcomeAccount: opts.accountId,
    comment: opts.comment,
    payee: null,
    merchant: null,
    tag: null,
  } as unknown as ZenReminder;
}

/**
 * `changed` для отправки. Сервер оставляет запись с бо́льшим `changed`, а
 * меньший молча отбрасывает: устройство с отстающими часами теряло бы свои
 * правки. Поэтому — не меньше лежащего на сервере плюс секунда.
 */
export function nextChanged(serverChanged: number | undefined, nowSec: number): number {
  return Math.max(nowSec, (serverChanged ?? 0) + 1);
}

/* ─────────────────────────────  настройки по полям  ───────────────────────────── */

export interface FieldValue {
  v: unknown;
  /** Когда поле меняли в последний раз, мс; 0 — ни разу с тех пор, как следим. */
  at: number;
}
export type FieldMap = Record<string, FieldValue>;

export interface FieldMergeResult {
  merged: FieldMap;
  /** Поля, которые надо применить у себя: в облаке новее. */
  applyLocally: string[];
  /** В облаке не то, что получилось, — надо отправить. */
  pushNeeded: boolean;
}

/**
 * Слияние по полям: у каждого побеждает более поздняя правка.
 *
 * При равном времени — облако. Так новое устройство (у его настроек время 0)
 * принимает облачные, а не затирает их своими стандартными.
 */
export function mergeFields(local: FieldMap, cloud: FieldMap | null): FieldMergeResult {
  const merged: FieldMap = {};
  const applyLocally: string[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(cloud ?? {})]);
  for (const k of keys) {
    const l = local[k];
    const c = cloud?.[k];
    if (!c) {
      merged[k] = l;
      continue;
    }
    if (!l || c.at >= l.at) {
      merged[k] = c;
      if (!l || stableStringify(l.v) !== stableStringify(c.v)) applyLocally.push(k);
      continue;
    }
    merged[k] = l;
  }
  const pushNeeded = !cloud || stableStringify(merged) !== stableStringify(cloud);
  return { merged, applyLocally, pushNeeded };
}

/** Какие поля поменялись между двумя снимками — им время правки «сейчас». */
export function stampFieldChanges(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fieldAt: Record<string, number>,
  nowMs: number
): Record<string, number> {
  let out = fieldAt;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (stableStringify(prev[k]) === stableStringify(next[k])) continue;
    if (out === fieldAt) out = { ...fieldAt };
    out[k] = nowMs;
  }
  return out;
}

/* ─────────────────────────────  правила поэлементно  ───────────────────────────── */

type Identified = { id: string; createdAt?: string };

export interface RulesDoc<R extends Identified = Identified> {
  items: Record<string, { at: number; rule: R }>;
  order: { ids: string[]; at: number };
  /** Удалённые правила: id → когда удалили, мс. */
  deleted: Record<string, number>;
}

/** Что помним о правилах на этом устройстве для слияния. */
export interface RulesSyncMeta {
  itemAt: Record<string, number>;
  orderAt: number;
  deleted: Record<string, number>;
}

export const EMPTY_RULES_META: RulesSyncMeta = { itemAt: {}, orderAt: 0, deleted: {} };

export function rulesDocFromLocal<R extends Identified>(
  rules: readonly R[],
  meta: RulesSyncMeta
): RulesDoc<R> {
  const items: RulesDoc<R>["items"] = {};
  for (const rule of rules) items[rule.id] = { at: meta.itemAt[rule.id] ?? 0, rule };
  return { items, order: { ids: rules.map((r) => r.id), at: meta.orderAt }, deleted: meta.deleted };
}

export function rulesFromDoc<R extends Identified>(doc: RulesDoc<R>): R[] {
  const out: R[] = [];
  const seen = new Set<string>();
  for (const id of doc.order.ids) {
    const item = doc.items[id];
    if (!item || seen.has(id)) continue;
    seen.add(id);
    out.push(item.rule);
  }
  for (const [id, item] of Object.entries(doc.items)) if (!seen.has(id)) out.push(item.rule);
  return out;
}

export function metaFromRulesDoc(doc: RulesDoc): RulesSyncMeta {
  const itemAt: Record<string, number> = {};
  for (const [id, item] of Object.entries(doc.items)) itemAt[id] = item.at;
  return { itemAt, orderAt: doc.order.at, deleted: doc.deleted };
}

export interface RulesMergeResult<R extends Identified> {
  merged: RulesDoc<R>;
  /** Итог отличается от локальных правил — применить у себя. */
  localChanged: boolean;
  /** Итог отличается от облака — отправить. */
  pushNeeded: boolean;
}

/**
 * Слияние правил.
 *
 *   • каждое правило — само по себе: побеждает более поздняя правка, при
 *     равенстве — облако; правки разных правил на двух устройствах не
 *     затирают друг друга (у Zerro затирают — там блок перезаписывается целиком);
 *   • удаление побеждает, если оно не раньше последней правки правила;
 *     удалённые помним `TOMBSTONE_TTL_MS`, потом забываем;
 *   • порядок — с того устройства, где его меняли позже; незнакомые правила —
 *     в конец, в порядке второго списка.
 */
export function mergeRulesDocs<R extends Identified>(
  local: RulesDoc<R>,
  cloud: RulesDoc<R> | null,
  nowMs: number
): RulesMergeResult<R> {
  const deleted: Record<string, number> = {};
  for (const src of [local.deleted, cloud?.deleted ?? {}]) {
    for (const [id, at] of Object.entries(src)) {
      if (nowMs - at > TOMBSTONE_TTL_MS) continue;
      deleted[id] = Math.max(deleted[id] ?? 0, at);
    }
  }

  const items: RulesDoc<R>["items"] = {};
  const ids = new Set([...Object.keys(local.items), ...Object.keys(cloud?.items ?? {})]);
  for (const id of ids) {
    const l = local.items[id];
    const c = cloud?.items[id];
    const pick = !l ? c! : !c ? l : c.at >= l.at ? c : l;
    if (deleted[id] !== undefined && deleted[id] >= pick.at) continue;
    items[id] = pick;
  }
  // Живое правило снимает свою пометку об удалении: его вернули позже.
  for (const id of Object.keys(items)) {
    if (deleted[id] !== undefined && deleted[id] < items[id].at) delete deleted[id];
  }

  const cloudFirst = !!cloud && cloud.order.at >= local.order.at;
  const primary = cloudFirst ? cloud!.order : local.order;
  const secondary = cloudFirst ? local.order : cloud?.order;
  const orderIds: string[] = [];
  const add = (id: string) => {
    if (items[id] && !orderIds.includes(id)) orderIds.push(id);
  };
  primary.ids.forEach(add);
  secondary?.ids.forEach(add);
  Object.keys(items)
    .sort((a, b) => (items[a].rule.createdAt ?? "").localeCompare(items[b].rule.createdAt ?? "") || a.localeCompare(b))
    .forEach(add);

  const merged: RulesDoc<R> = {
    items,
    order: { ids: orderIds, at: Math.max(local.order.at, cloud?.order.at ?? 0) },
    deleted,
  };
  const localChanged =
    stableStringify(rulesFromDoc(merged)) !== stableStringify(rulesFromDoc(local));
  const pushNeeded = !cloud || stableStringify(merged) !== stableStringify(cloud);
  return { merged, localChanged, pushNeeded };
}

/** Пометить правки правил: новые и изменённые, удалённые, смену порядка. */
export function stampRuleChanges<R extends Identified>(
  prev: readonly R[],
  next: readonly R[],
  meta: RulesSyncMeta,
  nowMs: number
): RulesSyncMeta {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextById = new Map(next.map((r) => [r.id, r]));
  const itemAt = { ...meta.itemAt };
  const deleted = { ...meta.deleted };
  let changed = false;

  for (const r of next) {
    const before = prevById.get(r.id);
    if (!before || stableStringify(before) !== stableStringify(r)) {
      itemAt[r.id] = nowMs;
      delete deleted[r.id];
      changed = true;
    }
  }
  for (const r of prev) {
    if (nextById.has(r.id)) continue;
    deleted[r.id] = nowMs;
    delete itemAt[r.id];
    changed = true;
  }
  const common = (list: readonly R[], other: Map<string, R>) =>
    list.filter((r) => other.has(r.id)).map((r) => r.id).join(" ");
  const orderChanged = common(prev, nextById) !== common(next, prevById);

  if (!changed && !orderChanged) return meta;
  return { itemAt, deleted, orderAt: orderChanged ? nowMs : meta.orderAt };
}

/* ─────────────────────────────  разбор пришедшего  ───────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Поля настроек из облака. Запись мог оставить другой клиент или старая версия,
 * поэтому берём только то, что похоже на `{v, at}`; значения каждое поле
 * проверяет само, когда применяет.
 */
export function sanitizeFieldMap(raw: unknown): FieldMap {
  const out: FieldMap = {};
  if (!isRecord(raw)) return out;
  for (const [k, item] of Object.entries(raw)) {
    if (!isRecord(item) || !isTime(item.at) || !("v" in item)) continue;
    out[k] = { v: item.v, at: item.at };
  }
  return out;
}

/** Документ правил из облака: битые элементы отбрасываются, форма гарантирована. */
export function sanitizeRulesDoc(raw: unknown): RulesDoc {
  const doc: RulesDoc = { items: {}, order: { ids: [], at: 0 }, deleted: {} };
  if (!isRecord(raw)) return doc;
  if (isRecord(raw.items)) {
    for (const [id, item] of Object.entries(raw.items)) {
      if (!isRecord(item) || !isTime(item.at) || !isRecord(item.rule)) continue;
      if (item.rule.id !== id) continue;
      doc.items[id] = { at: item.at, rule: item.rule as Identified };
    }
  }
  if (isRecord(raw.order)) {
    if (Array.isArray(raw.order.ids)) {
      doc.order.ids = raw.order.ids.filter((x): x is string => typeof x === "string");
    }
    if (isTime(raw.order.at)) doc.order.at = raw.order.at;
  }
  if (isRecord(raw.deleted)) {
    for (const [id, at] of Object.entries(raw.deleted)) if (isTime(at)) doc.deleted[id] = at;
  }
  return doc;
}
