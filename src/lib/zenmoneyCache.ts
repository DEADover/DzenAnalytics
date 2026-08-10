// Local cache of the Zenmoney "world" between syncs.
//
// We keep a snapshot of every raw entity (instruments, accounts, tags,
// merchants, transactions, user) so that incremental diffs can be merged
// in: the server only returns CHANGED entities since the last sync, but
// our mapper needs the FULL set to produce a complete Transaction[].
//
// The whole snapshot lives under one IndexedDB key as a single JSON blob.
// For typical Zenmoney accounts (~10k transactions + a few hundred refs)
// that's ~5 MB — well within IDB limits and trivial to read/write.

import * as db from "./db";
import type {
  ZenAccount,
  ZenBudget,
  ZenCompany,
  ZenDeletion,
  ZenDiffResponse,
  ZenInstrument,
  ZenMerchant,
  ZenReminderMarker,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";

const CACHE_KEY = "zenmoneyCache";

export interface ZenCache {
  serverTimestamp: number;
  instruments: ZenInstrument[];
  accounts: ZenAccount[];
  tags: ZenTag[];
  merchants: ZenMerchant[];
  transactions: ZenTransaction[];
  user: ZenDiffResponse["user"];
  /** Zenmoney «Планы»/budgets. Optional for backward-compat with caches
   *  written before budget sync existed (default to `[]` on read). */
  budgets?: ZenBudget[];
  /** PLANNED reminder markers only (`state: 'planned'`). Needed to compute a
   *  budget's effective plan when it's unlocked (raw + planned ops). We drop
   *  processed/deleted markers on merge to keep the cache lean and self-cleaning.
   *  `undefined` = never back-filled yet (triggers a one-time forceFetch). */
  reminderMarkers?: ZenReminderMarker[];
  /** Global bank / payment-system dictionary behind `Account.company`.
   *  Read-only reference data, ~1700 rows. `undefined` = never pulled yet
   *  (triggers a one-time forceFetch). */
  companies?: ZenCompany[];
  /** Schema generation of this cache. Drives ONE-TIME back-fills: an
   *  incremental diff never re-sends entities whose `changed` predates our
   *  timestamp, so whenever we start consuming a new entity type we must
   *  `forceFetch` it once. Absent = written before versioning existed. */
  cacheSchemaVersion?: number;
}

/** Bump when a new entity type starts being consumed AND needs a back-fill. */
export const CACHE_SCHEMA_VERSION = 4;

/** Entity types to force-fetch once when upgrading TO that version. */
const BACKFILL_BY_VERSION: Record<number, string[]> = {
  1: ["reminderMarker"],
  2: ["budget"],
  // The bank dictionary is static reference data, so an incremental diff
  // never re-sends it — existing caches have to ask for it explicitly once.
  3: ["company"],
  // Разовый полный перезабор планов: у тех, кто уже накопил осиротевшие
  // маркеры (план удалён в Дзен-мани, а его операции остались у нас), список
  // заменяется ответом сервера целиком — см. `replaceMarkers` в `applyDiff`.
  4: ["reminderMarker"],
};

/**
 * Effective schema version of a cache, including ones written before the field
 * existed: an older build already back-filled `reminderMarkers`, so a cache
 * that has them is (at least) v1 — otherwise those users would needlessly
 * re-pull markers, and — worse — a naive `!cache.reminderMarkers` gate would
 * never fire for them again, which is exactly how the `budget` back-fill was
 * missed in the first place.
 */
export function cacheVersionOf(cache: ZenCache | null | undefined): number {
  if (!cache) return CACHE_SCHEMA_VERSION; // no cache → full sync pulls everything
  if (typeof cache.cacheSchemaVersion === "number") return cache.cacheSchemaVersion;
  return cache.reminderMarkers ? 1 : 0;
}

/** Entity types this cache still has to back-fill to reach the current schema. */
export function backfillEntities(cache: ZenCache | null | undefined): string[] {
  const from = cacheVersionOf(cache);
  const out = new Set<string>();
  for (let v = from + 1; v <= CACHE_SCHEMA_VERSION; v++) {
    for (const e of BACKFILL_BY_VERSION[v] || []) out.add(e);
  }
  return [...out];
}

/** Composite key for a budget row — it has no surface `id`. */
function budgetKey(b: ZenBudget): string {
  return `${b.tag ?? "∅"}|${b.date}`;
}

/** Merge budgets by their (tag, date) natural key — incoming wins. Budgets
 *  have no `id`, so the generic id-merge / deletion path doesn't apply; a
 *  "deleted" budget arrives as a zeroed/unlocked row that simply overwrites. */
function mergeBudgets(prev: ZenBudget[], incoming: ZenBudget[] | undefined): ZenBudget[] {
  const inc = incoming || [];
  if (inc.length === 0) return prev;
  const map = new Map<string, ZenBudget>();
  for (const b of prev) map.set(budgetKey(b), b);
  for (const b of inc) map.set(budgetKey(b), b);
  return Array.from(map.values());
}

/**
 * Merge reminder markers, then KEEP ONLY the planned ones. A marker that gets
 * executed arrives in a later diff with `state: 'processed'` (or 'deleted') —
 * we merge it in by id and then filter it out, so the cache holds exactly the
 * currently-planned operations (what budgets need) and nothing else. Deletions
 * ride the generic `deletion` list keyed by object type "reminderMarker".
 *
 * УДАЛЁННЫЙ ПЛАН уносит с собой свои операции. Дзен-мани сообщает об удалении
 * самого плана (`reminder`), а не каждой его будущей операции по отдельности —
 * и маркеры оставались у нас навсегда. Со стороны это выглядело так: в разделе
 * «Регулярные платежи» висят просроченные операции, которых нет ни в
 * приложении, ни на сайте Дзен-мани, и убрать их нечем (issue #71).
 *
 * `replace` — ответ сервера считается полным списком, а не добавкой. Так идёт
 * разовый перезабор при обновлении схемы: он вычищает то, что уже осиротело.
 */
function mergeReminderMarkers(
  prev: ZenReminderMarker[],
  incoming: ZenReminderMarker[] | undefined,
  deletions: ZenDeletion[],
  replace = false
): ZenReminderMarker[] {
  const inc = incoming || [];
  const deadReminders = new Set(
    deletions.filter((d) => d.object === "reminder").map((d) => String(d.id))
  );
  const alive = (list: ZenReminderMarker[]) =>
    list.filter((m) => m.state === "planned" && !deadReminders.has(String(m.reminder)));
  if (replace) return alive(inc);
  const noChange =
    inc.length === 0 &&
    deletions.every((d) => d.object !== "reminderMarker" && d.object !== "reminder");
  if (noChange) return alive(prev);
  return alive(merge(prev, inc, "reminderMarker", deletions));
}

export async function loadZenCache(): Promise<ZenCache | null> {
  return db.loadJSON<ZenCache>(CACHE_KEY);
}

export async function saveZenCache(cache: ZenCache): Promise<void> {
  await db.saveJSON(CACHE_KEY, cache);
}

export async function clearZenCache(): Promise<void> {
  await db.saveJSON(CACHE_KEY, null);
}

function dedupBy<T, K>(arr: T[], key: (t: T) => K): T[] {
  // Keep last occurrence so incoming wins when ids collide.
  const map = new Map<K, T>();
  for (const item of arr) map.set(key(item), item);
  return Array.from(map.values());
}

function applyDeletions<T extends { id: string | number }>(
  items: T[],
  objectType: string,
  deletions: ZenDeletion[]
): T[] {
  if (deletions.length === 0) return items;
  const toDelete = new Set(
    deletions.filter((d) => d.object === objectType).map((d) => String(d.id))
  );
  if (toDelete.size === 0) return items;
  return items.filter((it) => !toDelete.has(String(it.id)));
}

function merge<T extends { id: string | number }>(
  prev: T[],
  incoming: T[] | undefined,
  objectType: string,
  deletions: ZenDeletion[]
): T[] {
  // 1. Drop deleted ids from previous state.
  // 2. Append incoming and dedup by id (incoming wins thanks to Map order).
  // The API may omit entity sections entirely when nothing changed.
  const after = applyDeletions(prev, objectType, deletions);
  const inc = incoming || [];
  if (inc.length === 0 && deletions.every((d) => d.object !== objectType)) {
    return prev; // hot path: no changes for this entity type
  }
  return dedupBy([...after, ...inc], (it) => it.id);
}

/**
 * Drop transactions that reference an account no longer present in the cache.
 *
 * When an account is deleted in Zenmoney, the incremental diff reliably removes
 * the *account* but doesn't always enumerate a `deletion` entry for each of its
 * (often old) transactions — so those linger as orphans. Their balances/charts
 * re-anchor to the live accounts and drop, but raw flow sums (Поступления/
 * Списания) keep counting the orphans. Pruning here keeps the cache internally
 * consistent and self-heals on the very next sync.
 */
function pruneOrphanTransactions(cache: ZenCache): ZenCache {
  const accountIds = new Set(cache.accounts.map((a) => String(a.id)));
  const transactions = cache.transactions.filter((t) =>
    [t.incomeAccount, t.outcomeAccount]
      .filter((a) => a != null && a !== "")
      .every((a) => accountIds.has(String(a)))
  );
  return transactions.length === cache.transactions.length
    ? cache
    : { ...cache, transactions };
}

/**
 * Apply a server diff onto the previous cache, returning a fresh cache.
 * If `prev` is null this is the initial full sync result.
 */
export function applyDiff(
  prev: ZenCache | null,
  diff: ZenDiffResponse,
  opts: {
    /** Ответ сервера по планам — полный список, а не добавка к нашему. */
    replaceMarkers?: boolean;
  } = {}
): ZenCache {
  if (!prev) {
    // Empty / very-new accounts can come back from the API with whole
    // sections missing (the field is just absent rather than `[]`).
    // Default each to an empty array so downstream code can always
    // iterate without an `is not iterable` runtime error.
    return pruneOrphanTransactions({
      serverTimestamp: diff.serverTimestamp,
      instruments: diff.instrument || [],
      accounts: diff.account || [],
      tags: diff.tag || [],
      merchants: diff.merchant || [],
      transactions: diff.transaction || [],
      user: diff.user || [],
      budgets: diff.budget || [],
      reminderMarkers: (diff.reminderMarker || []).filter(
        (m) => m.state === "planned"
      ),
      companies: diff.company || [],
      cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    });
  }
  const deletions = diff.deletion || [];
  return pruneOrphanTransactions({
    serverTimestamp: diff.serverTimestamp,
    // Any completed merge leaves the cache at the current schema — the caller
    // requested whatever back-fill `backfillEntities` asked for.
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    instruments: merge(prev.instruments, diff.instrument, "instrument", deletions),
    accounts: merge(prev.accounts, diff.account, "account", deletions),
    tags: merge(prev.tags, diff.tag, "tag", deletions),
    merchants: merge(prev.merchants, diff.merchant, "merchant", deletions),
    transactions: merge(
      prev.transactions,
      diff.transaction,
      "transaction",
      deletions
    ),
    // user record rarely changes; if diff omits it, keep previous.
    user: diff.user && diff.user.length > 0 ? diff.user : prev.user,
    budgets: mergeBudgets(prev.budgets || [], diff.budget),
    reminderMarkers: mergeReminderMarkers(
      prev.reminderMarkers || [],
      diff.reminderMarker,
      deletions,
      opts.replaceMarkers
    ),
    companies: merge(prev.companies || [], diff.company, "company", deletions),
  });
}

/**
 * Turn a cache back into the diff-shaped object expected by `mapZenmoneyDiff`.
 */
export function cacheToDiffResponse(cache: ZenCache): ZenDiffResponse {
  return {
    serverTimestamp: cache.serverTimestamp,
    instrument: cache.instruments,
    account: cache.accounts,
    tag: cache.tags,
    merchant: cache.merchants,
    transaction: cache.transactions,
    user: cache.user,
    budget: cache.budgets || [],
    reminderMarker: cache.reminderMarkers || [],
    company: cache.companies || [],
  };
}
