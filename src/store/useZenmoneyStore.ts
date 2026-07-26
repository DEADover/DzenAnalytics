// Zenmoney sync state — token + last sync timestamp + sync action.
//
// The token never leaves IndexedDB on this machine. We never log it, never
// embed it in error messages we display, and never include it in the
// backup/restore JSON path.

import { create } from "zustand";
import * as db from "../lib/db";
import { fetchDiff, checkToken, ZenApiError } from "../lib/zenmoney";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import {
  loadZenCache,
  saveZenCache,
  clearZenCache,
  applyDiff,
  cacheToDiffResponse,
  backfillEntities,
} from "../lib/zenmoneyCache";
import {
  buildPushItems,
  buildBudgetPush,
  buildDeletions,
  buildResurrections,
  buildTagPush,
  buildNewCategoriesPush,
  buildNewMerchantsPush,
  buildMerchantRenamePush,
  buildMerchantDeletions,
  buildMerchantMergePush,
  buildTagDeletionPush,
  detectConflicts,
  sendPush,
  validateDrafts,
  type PushBuildResult,
} from "../lib/zenmoneyPush";
import { useTagEditsStore, loadTagEdits } from "./useTagEditsStore";
import { useNewCategoriesStore, loadNewCategories } from "./useNewCategoriesStore";
import {
  useCounterpartyEditsStore,
  loadCounterpartyEdits,
} from "./useCounterpartyEditsStore";
import {
  useTagDeletionsStore,
  loadTagDeletions,
  toTagDeletions,
} from "./useTagDeletionsStore";
import { useBudgetEditsStore, loadBudgetEdits } from "./useBudgetEditsStore";
import { useDraftsStore, loadDrafts } from "./useDraftsStore";
import { loadSnapshotIndex, takeSnapshot } from "../lib/cloudSnapshots";
import { useDataStore } from "./useDataStore";
import { useCalibrationStore } from "./useCalibrationStore";
import { useOffBalanceStore } from "./useOffBalanceStore";
import { toBase } from "../lib/csv";
import { colorIntToHex } from "../lib/categoryColor";
import { useCategoryMetaStore } from "./useCategoryMetaStore";
import { useEditsStore } from "./useEditsStore";
import { useDeletedStore } from "./useDeletedStore";
import {
  useDeletedPayloadsStore,
  loadDeletedPayloads,
} from "./useDeletedPayloadsStore";
import { useSyncLogStore } from "./useSyncLogStore";
import { useBudgetsStore } from "./useBudgetsStore";
import {
  zenPlanList,
  zenForecastsFromBudgets,
  plannedOpsByTagMonth,
} from "../lib/zenBudgets";
import { formatNum } from "../lib/format";
import { budgetCellKey } from "../lib/budgets";
import type { ImportMeta } from "../types";

const TOKEN_KEY = "zenmoneyToken";
const TIMESTAMP_KEY = "zenmoneyServerTimestamp";
const LAST_SYNC_KEY = "zenmoneyLastSyncAt";
const PUSH_ENABLED_KEY = "zenmoneyPushEnabled";
const PUSH_MODE_KEY = "zenmoneyPushMode";
const LAST_PUSH_KEY = "zenmoneyLastPushAt";
const SNAPSHOT_POLICY_KEY = "zenmoneySnapshotPolicy";
const AUTO_SYNC_ENABLED_KEY = "zenmoneyAutoSyncEnabled";
const AUTO_SYNC_VALUE_KEY = "zenmoneyAutoSyncValue";
const AUTO_SYNC_UNIT_KEY = "zenmoneyAutoSyncUnit";

/**
 * Overlay pending tag edits onto a freshly-mapped `categoryMeta` map so
 * not-yet-pushed changes (обязательность, colour, icon, type) survive a re-map
 * (sync/push rebuild meta from the cache, which still holds the old values until
 * the edit lands in the cloud). Tag edits are keyed by tag id; meta by category
 * title — we resolve via the cache tags. Title/parent renames aren't overlaid
 * here (they'd move the meta key); the editor reflects those from the tag list
 * directly, and a sync finalises them. Mutates and returns `meta`.
 */
function overlayTagEdits<
  M extends {
    required?: boolean | null;
    color?: string | null;
    icon?: string | null;
    showIncome?: boolean;
    showOutcome?: boolean;
  },
>(
  meta: Record<string, M>,
  edits: Record<string, import("./useTagEditsStore").TagEdit>,
  cacheTags: { id: string; title: string; parent: string | null }[]
): Record<string, M> {
  if (Object.keys(edits).length === 0) return meta;
  // Only TOP-LEVEL tags map to a categoryMeta key. Sub-tag edits push to the
  // cloud but never feed the 50/30/20 split, so skip them here.
  const rootTitleById = new Map(
    cacheTags.filter((t) => !t.parent).map((t) => [t.id, t.title])
  );
  for (const [id, edit] of Object.entries(edits)) {
    const title = rootTitleById.get(id);
    if (!title) continue;
    const cur = meta[title];
    if (!cur) continue;
    const patched = { ...cur };
    if (edit.required !== undefined) patched.required = edit.required;
    if (edit.color !== undefined) patched.color = colorIntToHex(edit.color);
    if (edit.icon !== undefined) patched.icon = edit.icon;
    if (edit.showIncome !== undefined) patched.showIncome = edit.showIncome;
    if (edit.showOutcome !== undefined) patched.showOutcome = edit.showOutcome;
    meta[title] = patched;
  }
  return meta;
}

/**
 * Auto-sync interval — how often the background poller wakes up to
 * pull from Zenmoney. Stored as (value, unit) so the UI can show "10
 * минут" instead of "600000 мс".
 *
 * Minimum effective interval is 1 minute regardless of the unit — we
 * don't want to hammer the API.
 */
export type AutoSyncUnit = "min" | "hour" | "day";
const AUTO_SYNC_VALUE_DEFAULT = 30;
const AUTO_SYNC_UNIT_DEFAULT: AutoSyncUnit = "min";

export function autoSyncToMs(value: number, unit: AutoSyncUnit): number {
  const v = Math.max(1, Math.floor(value));
  const base = unit === "min" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  // Hard floor of 1 minute — protects against a misconfigured "0 min"
  // turning into a tight loop.
  return Math.max(60_000, v * base);
}

/**
 * When to take a cloud safety snapshot before pushing local edits.
 *   • "always" — every push triggers a full diff (slowest, safest;
 *     used during debugging).
 *   • "daily"  — at most once per 24h. Snapshot is skipped if a fresh
 *     one already exists. Sensible default for everyday use.
 *   • "never"  — no automatic snapshots. User can still take them
 *     manually from Settings.
 */
export type SnapshotPolicy = "always" | "daily" | "never";
const SNAPSHOT_POLICY_DEFAULT: SnapshotPolicy = "daily";
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SyncStatus = "idle" | "checking" | "syncing" | "ok" | "error";

/**
 * How (and whether) local edits flow back to Zenmoney.
 *   • "off"      — read-only mode. Edits accumulate locally; nothing
 *                  is ever pushed. Safest default.
 *   • "manual"   — Push is enabled, but only fires when the user
 *                  clicks "Отправить N правок" in Settings.
 *   • "auto"     — Push fires automatically ~2 s after the last edit
 *                  (debounce). Closest to "wysiwyg" cloud editing.
 *   • "on-sync"  — Push is attached to every sync (pull): when the
 *                  user clicks "Синхронизировать" (or the scheduler
 *                  fires), we pull first, then push pending edits.
 *                  Lower API pressure than "auto".
 */
export type PushMode = "off" | "manual" | "auto" | "on-sync";
const PUSH_MODE_DEFAULT: PushMode = "off";

/** Retry cap for a budget edit that keeps getting skipped (its tag isn't in the
 *  cache). After this many consecutive skips the queue drops it, on the
 *  assumption the tag was deleted/renamed in Дзен and it can never resolve. High
 *  enough that a transient miss (tag not synced yet) always clears first. */
const MAX_BUDGET_EDIT_SKIPS = 5;

export interface LiveAccount {
  /** Account title — matches Transaction.account / outcomeAccount / incomeAccount. */
  title: string;
  /** Current balance in the account's native currency. */
  balance: number;
  /** ISO short code of the account's native currency. */
  currency: string;
  /** Account type from Zenmoney (ccard / debit / cash / loan / deposit / …). */
  type: string;
  /** True for accounts archived in Zenmoney. We surface these last/dimmed. */
  archive: boolean;
  /** Whether Zenmoney itself includes this account in the user's net worth. */
  inBalance: boolean;
  /** True when the user marked this account as a savings account in Zenmoney.
   *  Independent of `inBalance` — a savings account can be in or out of balance. */
  savings: boolean;
  /** Opening balance (native currency) — the money on the account before any
   *  recorded transaction. Needed to reconstruct net worth over time. */
  startBalance: number;
  /** ISO date the account was opened, or null. Where the opening balance lands
   *  on the net-worth timeline (fallback: account's first transaction, else the
   *  global earliest date). */
  startDate: string | null;
}

/**
 * Returns the live per-account snapshot from the local Zenmoney cache, or null
 * if the cache is empty / user is in CSV mode. Reading from cache happens
 * lazily — call this from a hook or `useEffect`.
 */
export async function getLiveAccountsFromCache(): Promise<LiveAccount[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  const instrumentsById = new Map(cache.instruments.map((i) => [i.id, i]));
  return cache.accounts.map((a) => ({
    title: a.title,
    balance: a.balance || 0,
    currency: instrumentsById.get(a.instrument)?.shortTitle || "RUB",
    type: a.type,
    archive: a.archive,
    inBalance: a.inBalance,
    savings: a.savings,
    startBalance: a.startBalance || 0,
    startDate: a.startDate ?? null,
  }));
}

/**
 * Full brand titles list from the Zenmoney merchant dictionary.
 * That's broader than "brands that appear in the user's transactions" —
 * it includes brands the user has set up but never charged through,
 * brands attached only to deleted operations, etc. Returns null when
 * there's no Zenmoney cache (CSV-only users).
 */
export async function getBrandTitlesFromCache(): Promise<string[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  return cache.merchants
    .map((m) => m.title.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

/** A counterparty (Zenmoney merchant) row for the Справочники editor. */
export interface Counterparty {
  id: string;
  title: string;
  /** How many non-deleted operations reference this merchant. */
  count: number;
  /** Ids of those operations — lets the editor drill into them precisely
   *  (by id, not by title, which collides across same-named merchants). */
  txIds: string[];
}

/**
 * Контрагенты from the Zenmoney cache, with their operations each. Matching
 * goes by the RAW `ZenTransaction.merchant` id — the mapped `Transaction` keeps
 * only the brand TITLE, which collides across same-named merchants. Returns
 * null in CSV mode (no cache). Sorted by title (ru).
 */
export async function getCounterpartiesFromCache(): Promise<Counterparty[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  const byMerchant = new Map<string, string[]>();
  for (const t of cache.transactions) {
    if (t.deleted || !t.merchant) continue;
    const arr = byMerchant.get(t.merchant);
    if (arr) arr.push(t.id);
    else byMerchant.set(t.merchant, [t.id]);
  }
  return cache.merchants
    .map((m) => {
      const txIds = byMerchant.get(m.id) ?? [];
      return { id: m.id, title: m.title, count: txIds.length, txIds };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

/** A category tag (root or sub-tag) for the category editor. */
export interface CategoryTag {
  id: string;
  title: string;
  /** Parent tag id, or null for a top-level category. */
  parent: string | null;
  /** Zenmoney «обязательная» flag (null = not set). */
  required: boolean | null;
  /** Tag accepts income transactions. */
  showIncome: boolean;
  /** Tag accepts expense transactions. */
  showOutcome: boolean;
  /** Raw Zenmoney icon id (e.g. "5001_coat"), or null. */
  icon: string | null;
  /** Raw Zenmoney packed-RGB colour int, or null. */
  color: number | null;
}

/**
 * Category tags from the Zenmoney cache for the «обязательная» editor — roots
 * AND their sub-tags (the editor nests them under their parent). Each tag's
 * own `required` is editable independently and pushes to the cloud; note the
 * 50/30/20 split classifies by the TOP-LEVEL category, so a sub-tag's flag
 * doesn't move the split. Returns null in CSV mode. Sorted by title (ru).
 */
export async function getCategoryTagsFromCache(): Promise<CategoryTag[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  return cache.tags
    .map((t) => ({
      id: t.id,
      title: t.title,
      parent: t.parent ?? null,
      required: t.required ?? null,
      showIncome: !!t.showIncome,
      showOutcome: !!t.showOutcome,
      icon: t.icon ?? null,
      color: t.color ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

/**
 * Zenmoney's OWN auto-forecast amounts («из X»), keyed by zenPlanKey — so the
 * Budgets page can show «≈»-планы that match Дзен instead of a local median.
 * Returns null in CSV mode (no cache).
 */
export async function getZenForecastsFromCache(): Promise<Map<string, number> | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  return zenForecastsFromBudgets(cache.budgets, cache.tags);
}

/**
 * Sum the current balances (in base currency) of the live accounts in cache,
 * honouring the global "include off-balance" setting. Archived accounts never
 * count. Used to anchor the net-worth calibration on sync and whenever the
 * off-balance setting changes.
 */
export async function recalcBalanceCalibration(): Promise<void> {
  const cache = await loadZenCache();
  if (!cache) return; // CSV mode — no live balances, manual calibration stays
  const include = useOffBalanceStore.getState().includeOffBalance;
  const rates = useDataStore.getState().rates;
  const instrById = new Map(cache.instruments.map((i) => [i.id, i]));
  const total = cache.accounts
    .filter((a) => !a.archive && (include || a.inBalance))
    .reduce((s, a) => {
      const cur = instrById.get(a.instrument)?.shortTitle || rates.base;
      return s + toBase(a.balance || 0, cur, rates);
    }, 0);
  const today = new Date().toISOString().slice(0, 10);
  await useCalibrationStore.getState().set({ date: today, amount: Math.round(total) });
}

export interface SyncResult {
  count: number;
  currentBalance: number;
  /** True if this was a full sync (cache was empty or {force:true} was passed). */
  full: boolean;
  /** Delta sizes — how many entities arrived this round (helpful for "Свежее: +N"). */
  delta: {
    transactions: number;
    accounts: number;
    tags: number;
    deletions: number;
  };
}

export interface PushResult {
  /** How many local edits were successfully sent and acknowledged by Zenmoney. */
  pushed: number;
  /** How many newly-created operations (drafts) were sent. */
  created: number;
  /** Edits that couldn't be pushed (with reasons). They stay in the local overlay. */
  skipped: PushBuildResult["skipped"];
  /** ISO timestamp of the snapshot we took right before sending — for audit. */
  snapshotId: string | null;
}

interface ZenmoneyState {
  token: string | null;
  serverTimestamp: number;
  lastSyncAt: string | null;
  status: SyncStatus;
  error: string | null;
  loaded: boolean;

  // ── Phase 1: bi-directional sync (opt-in, off by default) ─────────────
  /** How edits flow back to Zenmoney. Default "off" (read-only). */
  pushMode: PushMode;
  /** Convenience derived flag: true when pushMode !== "off". Read-only
   *  — drive via `setPushMode`. Kept so existing UI checks "is push at
   *  all enabled?" without enumerating modes. */
  pushEnabled: boolean;
  /** ISO timestamp of the last successful push, or null. */
  lastPushAt: string | null;
  /** "idle" / "syncing" while a push is in flight; mirrors regular sync. */
  pushStatus: SyncStatus;
  /** Last push error message (for inline UI display). Cleared on next push. */
  pushError: string | null;
  /** Last push result (counts of pushed / skipped). */
  lastPushResult: PushResult | null;
  /** How often to auto-snapshot before push. See `SnapshotPolicy`. */
  snapshotPolicy: SnapshotPolicy;

  // ── Auto-sync schedule ─────────────────────────────────────────────────
  /** When enabled, a background poller calls `sync()` at the chosen
   *  interval. Default off — manual sync is the safe baseline. */
  autoSyncEnabled: boolean;
  /** Numeric component of the interval, e.g. 30 for "30 минут". */
  autoSyncValue: number;
  /** Unit component of the interval — minutes / hours / days. */
  autoSyncUnit: AutoSyncUnit;

  hydrate: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
  validateAndSaveToken: (token: string) => Promise<boolean>;
  removeToken: () => Promise<void>;
  /**
   * Synchronise with Zenmoney. By default uses the last `serverTimestamp`
   * for an incremental diff; pass `{force: true}` to drop the local cache
   * and re-pull everything (useful after suspected corruption / renames /
   * for support).
   */
  sync: (opts?: { force?: boolean }) => Promise<SyncResult>;

  /** Persist the push mode + recompute `pushEnabled` derived flag. */
  setPushMode: (mode: PushMode) => Promise<void>;
  setSnapshotPolicy: (policy: SnapshotPolicy) => Promise<void>;
  /**
   * Push all currently-pending local edits (`useEditsStore.edits`) to
   * Zenmoney via `POST /v8/diff/`. Side effects:
   *   • takes a fresh cloud snapshot first (Phase 0 safety net);
   *   • merges the server response into local cache + re-runs the
   *     forward mapper so the UI sees the canonical post-push state;
   *   • clears successfully-pushed entries from the local overlay
   *     (the edit is now part of cloud truth, no need to apply it again).
   *
   * Returns `PushResult` describing how many went through and what was
   * skipped (with reasons). Throws on transport / auth errors so the
   * caller can surface an inline message.
   */
  pushPendingEdits: () => Promise<PushResult>;

  /** Persist the auto-sync settings. Enable/disable + interval. */
  setAutoSync: (
    enabled: boolean,
    value: number,
    unit: AutoSyncUnit
  ) => Promise<void>;
  /** Wake-up tick from the App-level poller. Returns true if a sync
   *  fired (so logs can attribute it as auto), false otherwise.
   *  Bails out fast when disabled / no token / sync already in flight. */
  runAutoSyncIfDue: () => Promise<boolean>;
}

export const useZenmoneyStore = create<ZenmoneyState>((set, get) => ({
  token: null,
  serverTimestamp: 0,
  lastSyncAt: null,
  status: "idle",
  error: null,
  loaded: false,
  pushMode: PUSH_MODE_DEFAULT,
  pushEnabled: false,
  lastPushAt: null,
  pushStatus: "idle",
  pushError: null,
  lastPushResult: null,
  snapshotPolicy: SNAPSHOT_POLICY_DEFAULT,
  autoSyncEnabled: false,
  autoSyncValue: AUTO_SYNC_VALUE_DEFAULT,
  autoSyncUnit: AUTO_SYNC_UNIT_DEFAULT,

  hydrate: async () => {
    const [
      token,
      ts,
      last,
      pushEnabled,
      pushMode,
      lastPushAt,
      snapshotPolicy,
      autoSyncEnabled,
      autoSyncValue,
      autoSyncUnit,
    ] = await Promise.all([
      db.loadJSON<string>(TOKEN_KEY),
      db.loadJSON<number>(TIMESTAMP_KEY),
      db.loadJSON<string>(LAST_SYNC_KEY),
      db.loadJSON<boolean>(PUSH_ENABLED_KEY),
      db.loadJSON<PushMode>(PUSH_MODE_KEY),
      db.loadJSON<string>(LAST_PUSH_KEY),
      db.loadJSON<SnapshotPolicy>(SNAPSHOT_POLICY_KEY),
      db.loadJSON<boolean>(AUTO_SYNC_ENABLED_KEY),
      db.loadJSON<number>(AUTO_SYNC_VALUE_KEY),
      db.loadJSON<AutoSyncUnit>(AUTO_SYNC_UNIT_KEY),
    ]);
    // Migration: callers from the boolean-toggle era stored
    // `pushEnabled: true` without a mode. Treat that as "manual" so
    // their behaviour is unchanged after the upgrade.
    const resolvedMode: PushMode =
      pushMode || (pushEnabled === true ? "manual" : PUSH_MODE_DEFAULT);
    set({
      token: token || null,
      serverTimestamp: ts || 0,
      lastSyncAt: last || null,
      pushMode: resolvedMode,
      pushEnabled: resolvedMode !== "off",
      lastPushAt: lastPushAt || null,
      snapshotPolicy: snapshotPolicy || SNAPSHOT_POLICY_DEFAULT,
      autoSyncEnabled: autoSyncEnabled === true,
      autoSyncValue:
        typeof autoSyncValue === "number" && autoSyncValue > 0
          ? autoSyncValue
          : AUTO_SYNC_VALUE_DEFAULT,
      autoSyncUnit: autoSyncUnit || AUTO_SYNC_UNIT_DEFAULT,
      loaded: true,
    });
  },

  saveToken: async (token) => {
    const trimmed = token.trim();
    await db.saveJSON(TOKEN_KEY, trimmed);
    set({ token: trimmed, error: null });
  },

  validateAndSaveToken: async (token) => {
    const trimmed = token.trim();
    if (!trimmed) {
      set({ error: "Введите токен" });
      return false;
    }
    set({ status: "checking", error: null });
    try {
      const ok = await checkToken(trimmed);
      if (!ok) {
        set({ status: "error", error: "Токен отклонён сервером (401)" });
        return false;
      }
      await db.saveJSON(TOKEN_KEY, trimmed);
      set({ token: trimmed, status: "idle", error: null });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось проверить токен";
      set({ status: "error", error: msg });
      return false;
    }
  },

  removeToken: async () => {
    await db.saveJSON(TOKEN_KEY, null);
    await db.saveJSON(TIMESTAMP_KEY, 0);
    await db.saveJSON(LAST_SYNC_KEY, null);
    await clearZenCache();
    await useCategoryMetaStore.getState().clear();
    set({
      token: null,
      serverTimestamp: 0,
      lastSyncAt: null,
      status: "idle",
      error: null,
    });
  },

  sync: async (opts = {}) => {
    const token = get().token;
    if (!token) {
      set({ status: "error", error: "Сначала подключите токен" });
      throw new Error("no token");
    }
    set({ status: "syncing", error: null });
    const startedAt = Date.now();
    try {
      // Incremental by default. `force: true` (or no cache yet) → full sync
      // by sending serverTimestamp=0. The merged cache is then re-mapped
      // in full so renames/deletions propagate everywhere.
      const prevCache = opts.force ? null : await loadZenCache();
      const fromTs = prevCache?.serverTimestamp || 0;
      // One-time back-fills, driven by the cache's schema version: an
      // incremental diff never re-sends entities whose `changed` predates our
      // timestamp, so each newly-consumed entity type must be force-fetched
      // once. Returns [] for a null cache (a full sync pulls everything anyway).
      const backfill = backfillEntities(prevCache);
      const diff = await fetchDiff(
        token,
        fromTs,
        undefined,
        backfill.length > 0 ? backfill : undefined
      );
      const nextCache = applyDiff(prevCache, diff);
      await saveZenCache(nextCache);
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(nextCache));
      const isFull = fromTs === 0;

      // Push transactions + rates into the main data store. setTransactions
      // already runs payee grouping + category rules + recomputes amountBase.
      const meta: ImportMeta = {
        importedAt: new Date().toISOString(),
        fileName: `Zen-мани API · ${mapped.accountsActive} счетов · ${mapped.tagsTotal} тегов`,
        totalRows: nextCache.transactions.length,
        parsed: mapped.transactions.length,
        skipped: nextCache.transactions.length - mapped.transactions.length,
        source: "api",
      };
      // Per-category meta (colour / icon / picture) for UI dots, treemap, etc.
      // Keep any not-yet-pushed «обязательная» edits visible across the re-map.
      overlayTagEdits(
        mapped.categoryMeta,
        await loadTagEdits(),
        nextCache.tags
      );
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);

      // Persist the rates that came with the diff so the next session boots
      // with up-to-date Zenmoney rates.
      await db.saveRates(mapped.rates);
      // Update store rates as well so re-aggregation uses fresh numbers.
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, meta);

      // Auto-calibration: the API exposes current real balance per account,
      // which CSV lacks. Anchor the "Совокупный баланс" chart/KPIs to the real
      // total (respecting the global "include off-balance" setting). Overwrites
      // any existing calibration since the API value is authoritative.
      await recalcBalanceCalibration();

      // Mirror Zenmoney «Планы»/budgets into local budget lines on EVERY sync
      // (not just full) so a plan changed in Дзен shows up here automatically —
      // the incremental diff carries changed budgets too. importFromZen does a
      // three-way merge: new tags are created, unchanged cells adopt Zen's
      // value, and cells the user edited locally but hasn't pushed (tracked in
      // `budgetEdits`) are preserved — see importFromZen for the rationale.
      if (nextCache.budgets && nextCache.budgets.length > 0) {
        // Effective plan = stored budget + planned ops for unlocked cells.
        const planned = plannedOpsByTagMonth(
          nextCache.reminderMarkers,
          nextCache.instruments,
          nextCache.user?.[0]?.currency
        );
        const seeds = zenPlanList(nextCache.budgets, nextCache.tags, planned);
        if (seeds.length > 0) {
          const bs = useBudgetsStore.getState();
          if (!bs.loaded) await bs.hydrate();
          const pendingBudgetEdits = await loadBudgetEdits();
          // A pending edit protects its cell from Zen's value ONLY while it's
          // still unpushed. Once the cloud plan equals the edit, the edit is
          // SATISFIED — the value the user set is live in Дзен — so we must:
          //   • stop protecting the cell (let the line adopt the cloud value,
          //     which equals the edit anyway), and
          //   • drop the edit from the queue.
          // Otherwise a satisfied edit freezes the cell forever: the display
          // sticks at a stale local number while Дзен moved on (this is the
          // «у нас 160000, а в Дзене 305000» bug). Cloud plans come straight
          // from `seeds` (zenPlanList = manual plans), keyed per cell.
          const cloudByCell = new Map(
            seeds.map((s) => [
              budgetCellKey(s.kind, s.category, s.subcategory, s.ym),
              s.amount,
            ])
          );
          const protectedKeys = new Set<string>();
          const satisfiedEditIds: string[] = [];
          for (const [id, e] of Object.entries(pendingBudgetEdits)) {
            const cell = budgetCellKey(e.kind, e.category, e.subcategory, e.ym);
            if (cloudByCell.get(cell) === e.amount) satisfiedEditIds.push(id);
            else protectedKeys.add(cell);
          }
          await useBudgetsStore.getState().importFromZen(seeds, protectedKeys);
          if (satisfiedEditIds.length > 0) {
            await useBudgetEditsStore.getState().clearMany(satisfiedEditIds);
          }
        }
      }

      const now = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, diff.serverTimestamp);
      await db.saveJSON(LAST_SYNC_KEY, now);
      set({
        serverTimestamp: diff.serverTimestamp,
        lastSyncAt: now,
        status: "ok",
        error: null,
      });
      // Log the result. Full vs incremental + non-zero deltas drive
      // the human-readable summary in the log row.
      const deltaTx = diff.transaction?.length || 0;
      const deltaDel = diff.deletion?.length || 0;
      const summary = isFull
        ? `Полная синхронизация: ${formatNum(mapped.transactions.length)} операций`
        : deltaTx === 0 && deltaDel === 0
          ? `Без изменений (всего ${formatNum(mapped.transactions.length)})`
          : `+${formatNum(deltaTx)} новых/изменённых${deltaDel > 0 ? `, ${formatNum(deltaDel)} удалено` : ""}`;
      void useSyncLogStore.getState().append({
        kind: "pull",
        status: "ok",
        title: isFull ? "Полная синхронизация" : "Синхронизация",
        summary,
        details: {
          counts: {
            transactions: deltaTx,
            deletions: deltaDel,
            total: mapped.transactions.length,
          },
        },
        durationMs: Date.now() - startedAt,
      });
      // "on-sync" push mode: piggy-back outgoing edits on every sync.
      // Fire-and-forget — the push has its own status / log entry, and
      // we don't want a failed push to taint the sync's return value.
      // Guarded by there being anything to send (edits, deletions OR
      // locally-created drafts) so the common "nothing changed locally"
      // case stays a no-op.
      if (
        get().pushMode === "on-sync" &&
        (Object.keys(useEditsStore.getState().edits).length > 0 ||
          useDeletedStore.getState().deletedIds.length > 0 ||
          Object.keys(useDraftsStore.getState().drafts).length > 0 ||
          Object.keys(useTagEditsStore.getState().edits).length > 0 ||
          Object.keys(useBudgetEditsStore.getState().edits).length > 0)
      ) {
        // Defer to next microtask so the sync's set() lands first and
        // pushPendingEdits sees `status: "ok"` (its own guard).
        queueMicrotask(() => {
          void get().pushPendingEdits().catch(() => {
            /* logged + surfaced inside pushPendingEdits */
          });
        });
      }
      return {
        count: mapped.transactions.length,
        currentBalance: mapped.currentBalanceTotal,
        full: isFull,
        delta: {
          transactions: diff.transaction?.length || 0,
          accounts: diff.account?.length || 0,
          tags: diff.tag?.length || 0,
          deletions: diff.deletion?.length || 0,
        },
      };
    } catch (e) {
      let msg: string;
      if (e instanceof ZenApiError) {
        msg =
          e.status === 401
            ? "Токен недействителен или истёк (401). Подключите заново."
            : `Сервер: ${e.message}`;
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = "Не удалось синхронизировать";
      }
      set({ status: "error", error: msg });
      void useSyncLogStore.getState().append({
        kind: "pull",
        status: "error",
        title: opts.force ? "Полная синхронизация" : "Синхронизация",
        summary: "Не удалось синхронизировать",
        error: msg,
        durationMs: Date.now() - startedAt,
      });
      throw e;
    }
  },

  setPushMode: async (mode) => {
    // Persist both the new mode key AND the legacy boolean so older
    // builds (or a downgrade) still see push as on/off correctly.
    await Promise.all([
      db.saveJSON(PUSH_MODE_KEY, mode),
      db.saveJSON(PUSH_ENABLED_KEY, mode !== "off"),
    ]);
    set({ pushMode: mode, pushEnabled: mode !== "off", pushError: null });
    // Switching to «auto» must flush whatever was queued while push was off or
    // manual. The auto-push debounce (App.tsx) only fires on a NEW edit, so
    // without this the backlog would sit until the next change — exactly the
    // «внёс правку при выключенном Push, включил Авто, ничего не ушло» case.
    // (manual → user pushes by hand; on-sync → flushes on the next sync.)
    if (mode === "auto") {
      const s = get();
      const hasPending =
        Object.keys(useEditsStore.getState().edits).length > 0 ||
        useDeletedStore.getState().deletedIds.length > 0 ||
        Object.keys(useDraftsStore.getState().drafts).length > 0 ||
        Object.keys(useTagEditsStore.getState().edits).length > 0 ||
        Object.keys(useBudgetEditsStore.getState().edits).length > 0;
      if (s.token && s.pushStatus !== "syncing" && hasPending) {
        void get().pushPendingEdits().catch(() => {
          /* surfaced via pushError + sync log */
        });
      }
    }
  },

  setSnapshotPolicy: async (policy) => {
    await db.saveJSON(SNAPSHOT_POLICY_KEY, policy);
    set({ snapshotPolicy: policy });
  },

  pushPendingEdits: async () => {
    const { token, pushEnabled } = get();
    if (!token) {
      const msg = "Сначала подключите токен";
      set({ pushStatus: "error", pushError: msg });
      throw new Error(msg);
    }
    if (!pushEnabled) {
      const msg = "Двусторонняя синхронизация выключена в настройках";
      set({ pushStatus: "error", pushError: msg });
      throw new Error(msg);
    }
    set({ pushStatus: "syncing", pushError: null });
    const pushStartedAt = Date.now();
    try {
      // 1) Phase 0 safety net — snapshot what's in cloud right before
      //    we touch anything. Frequency depends on `snapshotPolicy`:
      //      • "always" → every push (slow but bulletproof; debug-mode)
      //      • "daily"  → only if no snapshot in the last 24h
      //      • "never"  → user opted out; they take manual snapshots
      //    If push misbehaves, the most recent snapshot is the rollback
      //    source of truth.
      let snapshotId: string | null = null;
      const policy = get().snapshotPolicy;
      let shouldSnapshot = false;
      if (policy === "always") {
        shouldSnapshot = true;
      } else if (policy === "daily") {
        const idx = await loadSnapshotIndex();
        const newest = idx[0]; // sorted newest first by loadSnapshotIndex
        shouldSnapshot =
          !newest || Date.now() - newest.createdAt >= DAILY_WINDOW_MS;
        // Surface the most-recent snapshot id even when we skipped
        // taking a new one — the UI can show "snapshot already exists"
        // rather than blank.
        if (!shouldSnapshot && newest) snapshotId = newest.id;
      }
      if (shouldSnapshot) {
        try {
          const snap = await takeSnapshot(token);
          snapshotId = snap.id;
        } catch (e) {
          // Snapshot failure shouldn't strand the user — log to console
          // but proceed with the push. The risk is bounded: Phase 1 only
          // updates existing transactions and we have the recent cache.
          console.warn("Pre-push snapshot failed:", e);
        }
      }

      // 2) Build push items from the current overlay.
      let cache = await loadZenCache();
      if (!cache) {
        const msg = "Локальный кэш Zenmoney пуст — сначала синхронизируйтесь";
        set({ pushStatus: "error", pushError: msg });
        throw new Error(msg);
      }
      const edits = useEditsStore.getState().edits;

      // 2a) Conflict detection. Pull a fresh diff since our last sync and
      //     check whether any transaction we're about to edit was changed
      //     in the cloud meanwhile (e.g. on the phone). Such edits would
      //     clobber a newer remote version, so we skip them (and keep the
      //     local edit for a retry after the user reviews). Best-effort:
      //     if the fetch fails we fall back to pushing against the cache.
      let conflicts = new Set<string>();
      try {
        const fresh = await fetchDiff(token, cache.serverTimestamp);
        conflicts = detectConflicts(Object.keys(edits), cache, fresh.transaction);
        cache = applyDiff(cache, fresh); // adopt fresh cloud truth
        await saveZenCache(cache);
        set({ serverTimestamp: fresh.serverTimestamp });
        await db.saveJSON(TIMESTAMP_KEY, fresh.serverTimestamp);
      } catch {
        /* best-effort — push against the (possibly stale) cached state */
      }

      const built = buildPushItems(edits, cache, Math.floor(Date.now() / 1000));
      const conflictSkips = built.toPush
        .filter((i) => conflicts.has(i.id))
        .map((i) => ({
          id: i.id,
          reason:
            "операция изменена в облаке после последней синхронизации — обновите и повторите",
        }));
      // A locally-deleted row must NOT also be pushed as an edit/upsert — the
      // deletion wins (issue #19.4). Edits are cleared on delete, but guard here
      // too so an edit can never race a deletion into the same request.
      const deletedIds = useDeletedStore.getState().deletedIds;
      const deletedSet = new Set(deletedIds);
      const toPush = built.toPush.filter(
        (i) => !conflicts.has(i.id) && !deletedSet.has(i.id)
      );
      // Time-of-day edits push as delete-old + create-new-id (Zenmoney ignores
      // a changed `created` on an existing row — verified live; same trick as
      // buildResurrections). Guard against cloud-conflicts and local deletions
      // exactly like toPush.
      const recreates = built.recreates.filter(
        (r) => !conflicts.has(r.oldId) && !deletedSet.has(r.oldId)
      );
      const recreateConflictSkips = built.recreates
        .filter((r) => conflicts.has(r.oldId))
        .map((r) => ({
          id: r.oldId,
          reason:
            "операция изменена в облаке после последней синхронизации — обновите и повторите",
        }));
      const skipped = [
        ...built.skipped,
        ...conflictSkips,
        ...recreateConflictSkips,
      ];
      // Locally-deleted transactions → cloud `deletion` entries. Only
      // ids still present in cache produce a deletion (see buildDeletions).
      // Recreated rows ALSO delete their OLD id in the same request — but not
      // via useDeletedStore/snapshots, so buildResurrections never revives them
      // (they're superseded by a new id, not user-deleted).
      const deletions = [
        ...buildDeletions(deletedIds, cache),
        ...buildDeletions(
          recreates.map((r) => r.oldId),
          cache
        ),
      ];
      // Restored transactions whose cloud row was already deleted → revive
      // them by re-creating under a NEW id (tombstones are sticky — see
      // buildResurrections).
      const resurrections = buildResurrections(
        await loadDeletedPayloads(),
        useDeletedStore.getState().deletedIds,
        cache,
        Math.floor(Date.now() / 1000)
      );
      // Locally-created drafts (new operations not yet in the cloud). Each
      // is a complete ZenTransaction; validate references against the fresh
      // cache and re-stamp `changed`. They ride along in the same request.
      const draftPush = validateDrafts(
        await loadDrafts(),
        cache,
        Math.floor(Date.now() / 1000)
      );
      const draftTxs = draftPush.ready;
      // Draft "skips" don't keep a row in limbo: an "already in cloud" draft
      // is stale (the cleanup below drops it); other reasons go to the log.
      skipped.push(...draftPush.skipped);
      // Pending category-tag edits (the «обязательная» flag). Built against
      // the fresh cache; no-ops and unresolvable ids are skipped.
      const tagEdits = await loadTagEdits();
      const tagPush = buildTagPush(
        tagEdits,
        cache.tags,
        Math.floor(Date.now() / 1000)
      );
      const tagSkips = tagPush.skipped.map((s) => ({
        id: s.id,
        reason: s.reason,
      }));
      skipped.push(...tagSkips);
      // Locally-created categories → brand-new ZenTag[]. The account's numeric
      // user id comes from any existing cached tag (there are always defaults).
      const newCats = await loadNewCategories();
      const newCatUser = cache.tags[0]?.user;
      const newCatTags =
        newCats.length > 0 && newCatUser != null
          ? buildNewCategoriesPush(newCats, newCatUser, Math.floor(Date.now() / 1000))
          : [];
      // Контрагенты (merchants): renames + creates as upserts, removals as
      // generic deletions with object "merchant".
      const cpEdits = await loadCounterpartyEdits();
      const cpStamp = Math.floor(Date.now() / 1000);
      const cpUser = cache.merchants[0]?.user ?? cache.tags[0]?.user;
      const cpRename = buildMerchantRenamePush(cpEdits.renames, cache.merchants, cpStamp);
      const cpNew =
        cpEdits.created.length > 0 && cpUser != null
          ? buildNewMerchantsPush(cpEdits.created, cpUser, cpStamp)
          : [];
      const merchantUpserts = [...cpRename.merchants, ...cpNew];
      const merchantDeletions = buildMerchantDeletions(
        cpEdits.deleted,
        cache.merchants,
        cpStamp
      );
      skipped.push(...cpRename.skipped);
      // Duplicate counterparties folded into one: the operations move to the
      // survivor first, then the duplicate is deleted — both in this request.
      const cpMerge = buildMerchantMergePush(
        Object.entries(cpEdits.merges).map(([id, survivorId]) => ({
          id,
          survivorId,
        })),
        cache,
        cpStamp
      );
      skipped.push(...cpMerge.skipped);
      // Deleted categories: re-tag (or untag) their operations, then drop the
      // tags. Built against the fresh cache so «замена» resolves to a live tag.
      const tagDel = buildTagDeletionPush(
        toTagDeletions(await loadTagDeletions()),
        cache,
        Math.floor(Date.now() / 1000)
      );
      skipped.push(...tagDel.skipped);
      // Pending plan/budget changes → ZenBudget upserts. Built against the
      // fresh cache so the (tag, month) cell and its «other side» are current.
      const budgetEdits = await loadBudgetEdits();
      const budgetPush = buildBudgetPush(
        Object.values(budgetEdits),
        cache.budgets ?? [],
        cache.tags,
        Math.floor(Date.now() / 1000)
      );
      skipped.push(...budgetPush.skipped);
      // Budget edits that aren't skipped are satisfied — either sent below, or a
      // no-op because the cloud already matches. Either way the local intent is
      // done, so they must leave the queue (clear the «ждёт отправки» arrow) in
      // BOTH the normal push path AND the «nothing to send» early-return — else
      // a no-op edit's arrow would stick forever.
      const skippedBudgetIds = new Set(budgetPush.skipped.map((s) => s.id));
      const doneBudgetIds = Object.keys(budgetEdits).filter(
        (id) => !skippedBudgetIds.has(id)
      );
      // Auto-drop budget edits that keep getting skipped: a stale edit whose tag
      // was deleted/renamed in Дзен can never resolve and would retry on every
      // sync forever. A TRANSIENT miss (tag just not synced yet) clears well
      // before the cap because the next sync resolves the tag and pushes it.
      if (skippedBudgetIds.size > 0) {
        const dropped = await useBudgetEditsStore
          .getState()
          .bumpSkips([...skippedBudgetIds], MAX_BUDGET_EDIT_SKIPS);
        if (dropped.length > 0) {
          void useSyncLogStore.getState().append({
            kind: "push",
            status: "partial",
            title: "Планы: отброшены зависшие правки",
            summary: `Правок бюджета не удалось отправить за ${MAX_BUDGET_EDIT_SKIPS} попыток (тег удалён/переименован в Дзене): ${dropped.length}`,
            durationMs: Date.now() - pushStartedAt,
          });
        }
      }
      if (
        toPush.length === 0 &&
        recreates.length === 0 &&
        deletions.length === 0 &&
        resurrections.length === 0 &&
        draftTxs.length === 0 &&
        tagPush.tags.length === 0 &&
        newCatTags.length === 0 &&
        merchantUpserts.length === 0 &&
        merchantDeletions.length === 0 &&
        cpMerge.deletions.length === 0 &&
        tagDel.deletions.length === 0 &&
        budgetPush.budgets.length === 0
      ) {
        const result: PushResult = { pushed: 0, created: 0, skipped, snapshotId };
        set({
          pushStatus: "ok",
          pushError: null,
          lastPushResult: result,
        });
        // Even no-op pushes go to the log — useful to confirm "I clicked
        // sync, what happened?" when there's nothing to send.
        void useSyncLogStore.getState().append({
          kind: "push",
          status: skipped.length > 0 ? "partial" : "ok",
          title: "Push в облако",
          summary:
            skipped.length > 0
              ? `Нет изменений для отправки. Пропущено: ${skipped.length}`
              : "Нет изменений для отправки",
          details: {
            counts: {
              accepted: 0,
              skipped: skipped.length,
              total: cache.transactions.length,
            },
            skipped,
          },
          durationMs: Date.now() - pushStartedAt,
        });
        // Drop no-op budget edits even though we sent nothing — their cloud
        // value already matches, so the «ждёт отправки» arrow should clear.
        if (doneBudgetIds.length > 0) {
          await useBudgetEditsStore.getState().clearMany(doneBudgetIds);
        }
        return result;
      }

      // 3) Send to /v8/diff/. Server applies last-write-wins by `changed`,
      //    returns the saved entities (with possibly bumped `changed`) and
      //    its current `serverTimestamp`. Deletions ride along in the same
      //    request body.
      const response = await sendPush(
        token,
        get().serverTimestamp,
        toPush,
        [
          ...deletions,
          ...merchantDeletions,
          ...cpMerge.deletions,
          ...tagDel.deletions,
        ],
        [
          ...resurrections.map((r) => r.tx),
          ...recreates.map((r) => r.tx),
          ...draftTxs,
          // Operations re-pointed by a merge / category deletion. Whole rows
          // rebuilt from cache, so they ride the raw-transaction channel.
          ...cpMerge.transactions,
          ...tagDel.transactions,
        ],
        [...tagPush.tags, ...newCatTags],
        budgetPush.budgets,
        merchantUpserts
      );

      // 4) Merge server response into local cache so subsequent diffs
      //    are anchored to the post-push state.
      //
      //    IMPORTANT: the Zenmoney `/v8/diff/` response does NOT echo back the
      //    deletions WE just sent — its `deletion` array only reports rows
      //    deleted by OTHER clients since our `serverTimestamp`. So without
      //    folding our own (now server-accepted) deletions into the merge, the
      //    just-deleted rows stay LIVE in the local cache until the next full
      //    sync pulls the tombstone. That made a pushed deletion keep showing
      //    as «Удалено» in the pending-changes list and keep the pending badge
      //    lit, as if it never synced. The push returned 200 → the server
      //    accepted these deletions → apply them to the cache now. (Idempotent:
      //    if the server ever DID echo them, `applyDeletions` dedups by id.)
      const nextCache = applyDiff(cache, {
        ...response,
        deletion: [
          ...(response.deletion ?? []),
          ...deletions,
          ...merchantDeletions,
          ...cpMerge.deletions,
          ...tagDel.deletions,
        ],
      });
      await saveZenCache(nextCache);

      // Prune snapshots that are no longer needed:
      //   • the resurrected `oldId`s — re-created under a new id, so the
      //     snapshot is spent (and keeping it would dup on the next push);
      //   • ids back in the cloud + not hidden locally (deletion was never
      //     pushed, so the original is still live).
      {
        const deletedNow = new Set(useDeletedStore.getState().deletedIds);
        const liveInCacheNow = new Set(
          nextCache.transactions
            .filter((t) => !t.deleted)
            .map((t) => String(t.id))
        );
        const prune = new Set(resurrections.map((r) => r.oldId));
        for (const id of Object.keys(await loadDeletedPayloads())) {
          if (liveInCacheNow.has(id) && !deletedNow.has(id)) prune.add(id);
        }
        if (prune.size > 0) {
          await useDeletedPayloadsStore.getState().removeMany([...prune]);
        }
      }
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(nextCache));

      // 5) Clear successfully-pushed edits from the overlay. The edit's
      //    intent now lives in cloud truth (and in our cache), so
      //    applying it on top again would be a no-op at best, or worse
      //    re-introduce a stale value if cloud later changes the field.
      for (const item of toPush) {
        await useEditsStore.getState().clearEdit(item.id);
      }
      // Time-recreates clear the overlay on their OLD id — its intent now lives
      // in the freshly-created new-id row. Leaving it would re-trigger the
      // recreate on every push (minting the same derived id → server upsert, but
      // still churn) since the old id is gone from cache.
      for (const r of recreates) {
        await useEditsStore.getState().clearEdit(r.oldId);
      }

      // 5b) Drop drafts that now live in the cloud (sent + echoed, or stale
      //     ones that were already there). The mapper re-creates them from
      //     the cache, so keeping the draft would double the row.
      {
        const liveNow = new Set(
          nextCache.transactions
            .filter((t) => !t.deleted)
            .map((t) => String(t.id))
        );
        const sentIds = Object.keys(await loadDrafts()).filter((id) =>
          liveNow.has(id)
        );
        if (sentIds.length > 0) {
          await useDraftsStore.getState().clearMany(sentIds);
        }
      }

      // 6) Refresh main data store. Same pattern as `sync`, minus
      //    calibration (push doesn't move account balances locally).
      const importMeta: ImportMeta = {
        importedAt: new Date().toISOString(),
        fileName: `Zen-мани API · ${mapped.accountsActive} счетов · ${mapped.tagsTotal} тегов`,
        totalRows: nextCache.transactions.length,
        parsed: mapped.transactions.length,
        skipped: nextCache.transactions.length - mapped.transactions.length,
        source: "api",
      };
      // Tag edits that were sent now live in cloud truth + our cache — drop
      // them from the overlay (same reasoning as transaction edits). Any
      // unresolved/no-op ones that remain are overlaid below so the UI keeps
      // showing the intended value until a re-sync resolves them.
      const sentTagIds = tagPush.tags.map((t) => String(t.id));
      if (sentTagIds.length > 0) {
        await useTagEditsStore.getState().clearMany(sentTagIds);
      }
      // Created categories now live in the cloud + our cache — drop the local
      // drafts; they'll come back as normal tags on the next sync.
      const sentNewCatIds = newCatTags.map((t) => String(t.id));
      if (sentNewCatIds.length > 0) {
        await useNewCategoriesStore.getState().removeMany(sentNewCatIds);
      }
      // Counterparty renames/creates/deletions/merges that landed — drop the
      // overlay.
      if (
        cpRename.merchants.length > 0 ||
        cpNew.length > 0 ||
        merchantDeletions.length > 0 ||
        cpMerge.deletions.length > 0
      ) {
        await useCounterpartyEditsStore.getState().clearPushed({
          renamedIds: cpRename.merchants.map((m) => String(m.id)),
          createdIds: cpNew.map((m) => String(m.id)),
          deletedIds: merchantDeletions.map((d) => String(d.id)),
          mergedIds: cpMerge.deletions.map((d) => String(d.id)),
        });
      }
      // Deleted categories that landed — drop them from the queue.
      if (tagDel.deletions.length > 0) {
        await useTagDeletionsStore
          .getState()
          .clearPushed(tagDel.deletions.map((d) => String(d.id)));
      }
      // Budget edits: clear everything that was sent OR a no-op (already in
      // cloud); keep only the ones we skipped (tag not in cache) for retry.
      // `doneBudgetIds` was computed up-front so the early-return path clears
      // the same set.
      if (doneBudgetIds.length > 0) {
        await useBudgetEditsStore.getState().clearMany(doneBudgetIds);
      }
      overlayTagEdits(
        mapped.categoryMeta,
        useTagEditsStore.getState().edits,
        nextCache.tags
      );
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);
      await db.saveRates(mapped.rates);
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, importMeta);

      const nowIso = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, response.serverTimestamp);
      await db.saveJSON(LAST_PUSH_KEY, nowIso);
      const result: PushResult = {
        // Recreates are edits from the user's POV (they changed the time), so
        // count them as pushed operations, not as brand-new `created` rows.
        pushed: toPush.length + recreates.length,
        created: draftTxs.length,
        skipped,
        snapshotId,
      };
      set({
        serverTimestamp: response.serverTimestamp,
        lastPushAt: nowIso,
        pushStatus: "ok",
        pushError: null,
        lastPushResult: result,
      });
      const parts: string[] = [];
      if (toPush.length > 0)
        parts.push(`Отправлено: ${formatNum(toPush.length)}`);
      if (draftTxs.length > 0)
        parts.push(`Создано: ${formatNum(draftTxs.length)}`);
      if (deletions.length > 0)
        parts.push(`Удалено: ${formatNum(deletions.length)}`);
      if (resurrections.length > 0)
        parts.push(`Восстановлено в облаке: ${formatNum(resurrections.length)}`);
      if (tagPush.tags.length > 0)
        parts.push(`Категорий обновлено: ${formatNum(tagPush.tags.length)}`);
      if (newCatTags.length > 0)
        parts.push(`Категорий создано: ${formatNum(newCatTags.length)}`);
      if (merchantUpserts.length > 0)
        parts.push(`Контрагентов обновлено: ${formatNum(merchantUpserts.length)}`);
      if (merchantDeletions.length > 0)
        parts.push(`Контрагентов удалено: ${formatNum(merchantDeletions.length)}`);
      if (cpMerge.deletions.length > 0)
        parts.push(`Контрагентов объединено: ${formatNum(cpMerge.deletions.length)}`);
      if (tagDel.deletions.length > 0)
        parts.push(`Категорий удалено: ${formatNum(tagDel.deletions.length)}`);
      // A merge / category deletion silently rewrites operations — the widest
      // blast radius in a push, so say how many were touched.
      {
        const rewritten = cpMerge.transactions.length + tagDel.transactions.length;
        if (rewritten > 0)
          parts.push(`Операций переназначено: ${formatNum(rewritten)}`);
      }
      if (skipped.length > 0)
        parts.push(
          `Пропущено: ${formatNum(skipped.length)}` +
            (conflictSkips.length > 0
              ? ` (конфликтов: ${formatNum(conflictSkips.length)})`
              : "")
        );
      void useSyncLogStore.getState().append({
        kind: "push",
        status: skipped.length > 0 ? "partial" : "ok",
        title: "Push в облако",
        summary: parts.join(", ") || "Push в облако",
        details: {
          counts: {
            accepted: toPush.length,
            skipped: skipped.length,
            total: mapped.transactions.length,
          },
          skipped,
        },
        durationMs: Date.now() - pushStartedAt,
      });
      return result;
    } catch (e) {
      let msg: string;
      if (e instanceof ZenApiError) {
        msg =
          e.status === 401
            ? "Токен недействителен или истёк (401). Подключите заново."
            : `Сервер: ${e.message}`;
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = "Не удалось отправить правки в облако";
      }
      set({ pushStatus: "error", pushError: msg });
      void useSyncLogStore.getState().append({
        kind: "push",
        status: "error",
        title: "Push в облако",
        summary: "Ошибка отправки правок",
        error: msg,
        durationMs: Date.now() - pushStartedAt,
      });
      throw e;
    }
  },

  setAutoSync: async (enabled, value, unit) => {
    const v = Math.max(1, Math.floor(value));
    await Promise.all([
      db.saveJSON(AUTO_SYNC_ENABLED_KEY, enabled),
      db.saveJSON(AUTO_SYNC_VALUE_KEY, v),
      db.saveJSON(AUTO_SYNC_UNIT_KEY, unit),
    ]);
    set({ autoSyncEnabled: enabled, autoSyncValue: v, autoSyncUnit: unit });
  },

  runAutoSyncIfDue: async () => {
    const s = get();
    // Gate-rails: no token / not enabled / mid-sync ⇒ do nothing.
    if (!s.token || !s.autoSyncEnabled) return false;
    if (s.status === "syncing" || s.status === "checking") return false;
    const intervalMs = autoSyncToMs(s.autoSyncValue, s.autoSyncUnit);
    const lastMs = s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
    if (Date.now() - lastMs < intervalMs) return false;
    try {
      await get().sync();
      return true;
    } catch {
      // sync() already wrote the failure to the log + set error state;
      // we just need to swallow here so the poller doesn't crash.
      return false;
    }
  },
}));
