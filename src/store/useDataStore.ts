import { create } from "zustand";
import type { Transaction, CurrencyRates, ImportMeta } from "../types";
import * as db from "../lib/db";
import {
  baseWithHistory,
  fetchHistoricalRubRates,
  type HistDayRates,
} from "../lib/historicalRates";
import { buildPayeeAliasMap } from "../lib/payeeNormalize";
import { restoreRuleCategories, type StoredRule } from "../lib/ruleEngine";
import { autoApplyPatches } from "../lib/ruleAutoApply";
import { makeCategoryChecker } from "../lib/zenmoneyPush";

import { applyEdits } from "../lib/applyEdits";
import { useEditsStore } from "./useEditsStore";
import { useDeletedStore, loadDeletedSet } from "./useDeletedStore";
import { useDeletedPayloadsStore } from "./useDeletedPayloadsStore";
import { loadZenCache } from "../lib/zenmoneyCache";
import type { ZenTransaction } from "../lib/zenmoney";
import { loadDrafts, useDraftsStore } from "./useDraftsStore";
import { draftsToTransactions } from "../lib/draftsMap";
import { aliasesToMap, type PayeeAlias } from "./usePayeeAliasStore";

// Rough cross-rates relative to RUB — purely a starting point so the rates UI
// is populated out of the box. Users adjust to their own actual rates.
const DEFAULT_RATES: CurrencyRates = {
  base: "RUB",
  rates: {
    RUB: 1,
    USD: 90,
    EUR: 95,
    GBP: 110,
    CNY: 12.5,
    JPY: 0.6,
    KZT: 0.18,
    BYN: 28,
    GEL: 33,
    AMD: 0.23,
    AED: 24,
    TRY: 2.4,
    THB: 2.5,
  },
};

function mergeRatesWithDefaults(saved: CurrencyRates | null): CurrencyRates {
  if (!saved) return DEFAULT_RATES;
  // Keep user's values, but add any default currencies they don't have yet.
  return {
    base: saved.base,
    rates: { ...DEFAULT_RATES.rates, ...saved.rates },
  };
}

function ensureCurrenciesInRates(rates: CurrencyRates, txs: Transaction[]): CurrencyRates {
  const known = new Set(Object.keys(rates.rates));
  const next = { ...rates.rates };
  let changed = false;
  for (const t of txs) {
    for (const c of [t.currency, t.outcomeCurrency, t.incomeCurrency]) {
      if (c && !known.has(c)) {
        next[c] = 1;
        known.add(c);
        changed = true;
      }
    }
  }
  return changed ? { ...rates, rates: next } : rates;
}

interface DataState {
  /** Post-rules transactions with user edits applied. This is what charts/pages render. */
  transactions: Transaction[];
  /**
   * Post-rules transactions WITHOUT user edits applied. Mirrors what's in IDB.
   * Pipeline actions always start from this so edits don't compound and so
   * `clearEdit` can correctly revert to original values.
   */
  transactionsRaw: Transaction[];
  rates: CurrencyRates;
  /** CBR rate index (op-date → currency → RUB/unit) used to reprice
   *  foreign-currency operations at their own date. Warmed in the background. */
  histDayRates: HistDayRates;
  /** Background warm progress, or null when idle/done. Drives the UI chip. */
  histWarming: { done: number; total: number } | null;
  /** Сколько дат прошлый прогрев так и не смог разрешить — сервис курсов ЦБ был
   *  недоступен. Больше нуля = в аналитике часть валютных операций посчитана по
   *  текущему курсу, а не по курсу на свою дату. Показывается пользователем
   *  предупреждением: раньше об этом можно было узнать только из консоли
   *  (issue #53). */
  histRatesUnavailable: number;
  importMeta: ImportMeta | null;
  payeeGroupingEnabled: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Fetch CBR rates for every foreign-currency op date not yet resolved,
   *  then reprice. Fire-and-forget; safe to call repeatedly (only fetches the
   *  gaps). No-op when the base currency isn't RUB (CBR is RUB-centric). */
  warmHistoricalRates: () => Promise<void>;
  /** Убрать предупреждение о недогруженных курсах, ничего не перезапрашивая. */
  dismissHistRatesWarning: () => void;
  setTransactions: (txs: Transaction[], meta: ImportMeta) => Promise<void>;
  mergeTransactions: (
    incoming: Transaction[],
    meta: ImportMeta
  ) => Promise<{ added: number; duplicates: number }>;
  clearAll: () => Promise<void>;
  setRate: (currency: string, value: number) => Promise<void>;
  setBase: (newBase: string) => Promise<void>;
  setPayeeGrouping: (enabled: boolean) => Promise<void>;
  reapplyRules: () => Promise<void>;
  /** Recompute the visible list from the unchanged raw set. Cheap — used
   *  when only the overlay changed (e.g. a draft was added/removed), so we
   *  don't need to rebuild `transactionsRaw`. */
  refresh: () => Promise<void>;
  /** Hide a transaction locally (soft-delete) and recompute the
   *  visible list. Cloud-side deletion (when push is on) is handled
   *  separately by the Zenmoney store's push path. */
  deleteTransaction: (id: string) => Promise<void>;
  /** Hide many transactions at once (one recompute). */
  deleteTransactionMany: (ids: string[]) => Promise<void>;
  /** Un-hide a previously deleted transaction. */
  restoreTransaction: (id: string) => Promise<void>;
  /** Un-hide many at once (one recompute). */
  restoreTransactionMany: (ids: string[]) => Promise<void>;
  /** Permanently empty the local trash: drop hidden rows from storage,
   *  clear the hidden-id set and the cloud-restore snapshots. No cloud
   *  writes — irreversible locally. */
  purgeDeleted: () => Promise<void>;
}

// Key under which the resolved CBR day→currency rate index is persisted, so a
// reload reprices instantly without re-fetching (and without a sync-time flash).
const HIST_RATES_KEY = "histDayRates";

function recalcBase(
  txs: Transaction[],
  rates: CurrencyRates,
  hist: HistDayRates
): Transaction[] {
  return txs.map((t) => ({
    ...t,
    amountBase: baseWithHistory(t.amount, t.currency, t.date, rates, hist),
  }));
}

/**
 * The last step of the transactions pipeline: apply the user's edit
 * overlay, then drop any locally-deleted (hidden) rows. Everything that
 * sets `transactions` goes through here so the deletion filter is
 * impossible to forget at a call site.
 */
async function finalize(
  raw: Transaction[],
  rates: CurrencyRates
): Promise<Transaction[]> {
  // The historical-rate index is read from the store here (rather than
  // threaded through all ~13 finalize call sites) — it's global state that
  // never differs between simultaneous calls. Any action that just changed it
  // (warmHistoricalRates) sets it before calling finalize.
  const hist = useDataStore.getState().histDayRates;
  const withEdits = applyEdits(raw, await loadEditsFromStore(), rates, hist);
  const deleted = await loadDeletedSet();
  const visible =
    deleted.size === 0
      ? withEdits
      : withEdits.filter((t) => !deleted.has(t.id));
  // Append locally-created drafts (not-yet-pushed). Dedup by id against the
  // visible set: once a draft is pushed and echoed back into the cache, its
  // cloud row wins (and we then drop the draft from the store).
  const drafts = await loadDraftRows(rates, visible);
  return drafts.length === 0 ? visible : [...visible, ...drafts];
}

/**
 * Forward-map drafts for display and recompute `amountBase` against the
 * user's effective rates (the canonical mapper uses Zenmoney's own rates;
 * we re-anchor so drafts aggregate consistently with everything else).
 * Skips any draft id already present in `existing` (post-push window).
 */
async function loadDraftRows(
  rates: CurrencyRates,
  existing: Transaction[]
): Promise<Transaction[]> {
  const drafts = await loadDrafts();
  if (Object.keys(drafts).length === 0) return [];
  const cache = await loadZenCache();
  const seen = new Set(existing.map((t) => t.id));
  const hist = useDataStore.getState().histDayRates;
  return draftsToTransactions(drafts, cache)
    .filter((t) => !seen.has(t.id))
    .map((t) => ({
      ...t,
      amountBase: baseWithHistory(t.amount, t.currency, t.date, rates, hist),
    }));
}

/**
 * API mode only: stash the full Zenmoney payload of the given ids before
 * a cloud deletion purges them from cache, so a later restore can revive
 * them in the cloud. Best-effort — a snapshot failure never blocks the
 * (local) delete.
 */
async function snapshotForCloudRestore(ids: string[]): Promise<void> {
  try {
    const cache = await loadZenCache();
    if (!cache) return; // CSV mode — no cloud to restore to
    const byId = new Map(cache.transactions.map((t) => [String(t.id), t]));
    const found: ZenTransaction[] = [];
    for (const id of ids) {
      const zt = byId.get(id);
      if (zt && !zt.deleted) found.push(zt);
    }
    if (found.length > 0) {
      await useDeletedPayloadsStore.getState().saveMany(found);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * After a restore, push so the resurrection reaches the cloud right away.
 * Restoring a cloud-deleted row inherently needs a cloud write (the row is
 * re-created there), and it's an explicit user action — so we push under
 * ANY two-way mode, not just "auto". A no-op when there's nothing to
 * resurrect. Dynamic import avoids a static cycle with useZenmoneyStore.
 */
async function pushAfterRestore(): Promise<void> {
  try {
    const { useZenmoneyStore } = await import("./useZenmoneyStore");
    const zen = useZenmoneyStore.getState();
    if (zen.pushMode !== "off" && zen.token && zen.pushStatus !== "syncing") {
      await zen.pushPendingEdits();
    }
  } catch {
    /* surfaced via pushError + sync log */
  }
}

/**
 * Прогнать правила с автоприменением по операциям, которых раньше не было, и
 * записать результат в слой правок — ровно так же, как это делает кнопка.
 *
 * Новыми считаем те, чьих идентификаторов не было в прошлом наборе. Если
 * прошлого набора не было вовсе (первая синхронизация, полный переимпорт),
 * автоприменение не срабатывает: «новых» там вся история, а молча переписать
 * её и отправить в Дзен-мани — не то, чего ждут от галочки.
 */
async function autoApplyToNew(
  raw: Transaction[],
  previousIds: Set<string>
): Promise<void> {
  if (previousIds.size === 0) return;
  const fresh = raw.filter((t) => !previousIds.has(t.id));
  if (fresh.length === 0) return;
  const rules = await db.loadJSON<StoredRule[]>("categoryRules");
  if (!rules || rules.length === 0) return;

  // Справочники Дзен-мани — из кэша: без них правило может записать категорию,
  // которой в облаке нет, и правка навсегда зависнет неотправленной.
  const cache = await loadZenCache();
  const categoryOk = cache?.tags ? makeCategoryChecker(cache.tags) : null;
  const payeeOk = cache?.merchants
    ? (() => {
        const set = new Set(
          cache.merchants.map((m) => (m.title ?? "").trim().toLowerCase())
        );
        return (title: string) => set.has(title.trim().toLowerCase());
      })()
    : null;

  const patches = autoApplyPatches(
    fresh,
    rules,
    await loadEditsFromStore(),
    await loadDeletedSet(),
    categoryOk,
    payeeOk
  );
  if (Object.keys(patches).length === 0) return;
  await useEditsStore.getState().setEditEach(patches);
}

async function loadEditsFromStore(): Promise<
  Record<string, import("./useEditsStore").TransactionEdit>
> {
  // Prefer the in-memory copy (set by hydrate); fall back to disk for the
  // very first call before any store hydration ran.
  const mem = useEditsStore.getState().edits;
  if (Object.keys(mem).length > 0 || useEditsStore.getState().loaded) return mem;
  const disk = await db.loadJSON<
    Record<string, import("./useEditsStore").TransactionEdit>
  >("transactionEdits");
  return disk || {};
}

/** Read the user's manual payee aliases straight from IDB, so this
 *  module doesn't depend on the React component lifecycle. */
async function loadManualAliasesFromStore(): Promise<PayeeAlias[]> {
  const data = await db.loadJSON<PayeeAlias[]>("payeeAliases");
  return Array.isArray(data) ? data : [];
}

/**
 * Apply payee-grouping pipeline:
 *   1. Restore every tx's `payee` to `payeeOriginal` (clean slate).
 *   2. If auto-grouping is enabled, run the fuzzy alias detector
 *      and map variants to their canonical representative.
 *   3. Apply the user's manual aliases on top — these always win,
 *      so the user can pin down anything fuzzy missed (or override
 *      it when it grouped too eagerly).
 */
function applyPayeeGrouping(
  txs: Transaction[],
  enabled: boolean,
  manualAliases: PayeeAlias[] = []
): Transaction[] {
  // Step 1 — restore originals.
  let out = txs.map((t) =>
    t.payeeOriginal ? { ...t, payee: t.payeeOriginal } : t
  );

  // Step 2 — fuzzy auto-grouping (only when toggle is on).
  if (enabled) {
    const allPayees = out.map((t) => t.payee).filter(Boolean);
    const aliases = buildPayeeAliasMap(allPayees);
    if (aliases.size > 0) {
      out = out.map((t) => {
        const canonical = aliases.get(t.payee);
        return canonical ? { ...t, payee: canonical } : t;
      });
    }
  }

  // Step 3 — manual aliases (curated by the user), always applied.
  // Match by the current (post-auto) payee first — that's a "rename the
  // whole group" rule. Fall back to the ORIGINAL payee so a manual
  // override of a single auto-grouped name works too (the auto-grouping
  // table lets the user retarget one original without touching the rest
  // of its group). Post-auto match wins so existing group-level rules
  // keep their meaning.
  if (manualAliases.length > 0) {
    const manual = aliasesToMap(manualAliases);
    out = out.map((t) => {
      const next =
        manual.get(t.payee) ??
        (t.payeeOriginal ? manual.get(t.payeeOriginal) : undefined);
      return next ? { ...t, payee: next } : t;
    });
  }

  return out;
}

export const useDataStore = create<DataState>((set, get) => ({
  transactions: [],
  transactionsRaw: [],
  rates: DEFAULT_RATES,
  histDayRates: {},
  histWarming: null,
  histRatesUnavailable: 0,
  importMeta: null,
  payeeGroupingEnabled: false,
  loaded: false,

  hydrate: async () => {
    const [txs, savedRates, savedHist, meta, grouping, manualAliases] =
      await Promise.all([
        db.loadTransactions(),
        db.loadRates(),
        db.loadJSON<HistDayRates>(HIST_RATES_KEY),
        db.loadImportMeta(),
        db.loadJSON<boolean>("payeeGrouping"),
        loadManualAliasesFromStore(),
      ]);
    const rates = mergeRatesWithDefaults(savedRates);
    const hist = savedHist || {};
    // Seed histDayRates BEFORE finalize() (which reads it from the store).
    set({ histDayRates: hist });
    let raw = recalcBase(txs, rates, hist);
    raw = applyPayeeGrouping(raw, grouping || false, manualAliases);
    raw = restoreRuleCategories(raw);
    const final = await finalize(raw, rates);
    set({
      transactions: final,
      transactionsRaw: raw,
      rates,
      importMeta: meta,
      payeeGroupingEnabled: grouping || false,
      loaded: true,
    });
    // Fill any gaps (new dates / first run) in the background, then reprice.
    void get().warmHistoricalRates();
  },

  warmHistoricalRates: async () => {
    const { rates, transactionsRaw, histDayRates, histWarming } = get();
    // CBR is RUB-centric — historical repricing is only exact with a RUB base.
    // Other bases keep the sync-time conversion (handled by baseWithHistory).
    if (rates.base !== "RUB") return;
    // Don't run two warms at once (e.g. hydrate + a fast re-sync).
    if (histWarming) return;
    // Every foreign-currency op date we don't already have a resolved entry for.
    const missing = new Set<string>();
    for (const t of transactionsRaw) {
      if (t.currency !== "RUB" && t.date && !(t.date in histDayRates)) {
        missing.add(t.date);
      }
    }
    if (missing.size === 0) return;

    // От свежих к старым — прогрев идёт по одному запросу в секунду (условия
    // сервиса курсов), и на большой истории это минуты. Сортируем ДО нарезки на
    // куски: сортировка внутри куска порядок между кусками не поменяет.
    const dates = Array.from(missing).sort((a, b) => b.localeCompare(a));
    const total = dates.length;
    set({ histWarming: { done: 0, total } });
    let unresolved = 0;
    try {
      // Fetch and PERSIST in chunks. Saving the resolved index after every
      // chunk (not just at the very end) means an interrupted warm — the user
      // reloads or navigates mid-download — keeps its progress: next load only
      // fetches the dates still missing, instead of starting over. Each date is
      // therefore fetched from CBR at most once, ever.
      const CHUNK = 24;
      let done = 0;
      for (let i = 0; i < dates.length; i += CHUNK) {
        const chunk = dates.slice(i, i + CHUNK);
        const fetched = await fetchHistoricalRubRates(chunk);
        // Даты, по которым не пришло ничего достоверного, остаются «пропущены»
        // и будут перезапрошены позже — но пользователю об этом надо сказать.
        unresolved += chunk.length - Object.keys(fetched).length;
        const merged = { ...get().histDayRates, ...fetched };
        await db.saveJSON(HIST_RATES_KEY, merged);
        set({ histDayRates: merged });
        done += chunk.length;
        set({ histWarming: { done, total } });
      }
      // Reprice once, from the unchanged raw set, with the complete index.
      const merged = get().histDayRates;
      const raw = recalcBase(get().transactionsRaw, rates, merged);
      const final = await finalize(raw, rates);
      set({ transactions: final, transactionsRaw: raw });
    } finally {
      set({ histWarming: null, histRatesUnavailable: unresolved });
    }
  },

  dismissHistRatesWarning: () => set({ histRatesUnavailable: 0 }),

  setTransactions: async (txs, meta) => {
    const { payeeGroupingEnabled } = get();
    const rates = ensureCurrenciesInRates(get().rates, txs);
    if (rates !== get().rates) await db.saveRates(rates);
    const manualAliases = await loadManualAliasesFromStore();
    // Синхронизация Дзен-мани приходит сюда ПОЛНЫМ набором, поэтому «новые»
    // определяем по прошлому составу, а не по размеру входящего.
    const previousIds = new Set(get().transactionsRaw.map((t) => t.id));
    let raw = recalcBase(txs, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    await db.saveImportMeta(meta);
    await autoApplyToNew(raw, previousIds);
    const final = await finalize(raw, rates);
    set({ transactions: final, transactionsRaw: raw, rates, importMeta: meta });
    void get().warmHistoricalRates();
  },

  mergeTransactions: async (incoming, meta) => {
    const { payeeGroupingEnabled, transactionsRaw: existing } = get();
    const rates = ensureCurrenciesInRates(get().rates, incoming);
    if (rates !== get().rates) await db.saveRates(rates);
    const manualAliases = await loadManualAliasesFromStore();
    const existingIds = new Set(existing.map((t) => t.id));
    const fresh = incoming.filter((t) => !existingIds.has(t.id));
    const combined = [...existing, ...fresh];
    let raw = recalcBase(combined, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    await autoApplyToNew(raw, existingIds);
    const mergedMeta: ImportMeta = {
      ...meta,
      parsed: existing.length + fresh.length,
      totalRows: meta.totalRows,
    };
    await db.saveImportMeta(mergedMeta);
    const final = await finalize(raw, rates);
    set({
      transactions: final,
      transactionsRaw: raw,
      rates,
      importMeta: mergedMeta,
    });
    void get().warmHistoricalRates();
    return { added: fresh.length, duplicates: incoming.length - fresh.length };
  },

  clearAll: async () => {
    await db.clearTransactions();
    await useDeletedStore.getState().clearAll();
    await useDeletedPayloadsStore.getState().clearAll();
    set({ transactions: [], transactionsRaw: [], importMeta: null });
  },

  setRate: async (currency, value) => {
    const rates: CurrencyRates = {
      ...get().rates,
      rates: { ...get().rates.rates, [currency]: value },
    };
    await db.saveRates(rates);
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(get().transactionsRaw, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, get().payeeGroupingEnabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ rates, transactions: final, transactionsRaw: raw });
  },

  setBase: async (newBase) => {
    const current = get().rates;
    if (newBase === current.base) return;
    const anchor = current.rates[newBase];
    if (!anchor || anchor <= 0) {
      throw new Error(
        `Установите положительный курс для ${newBase} перед сменой базовой валюты`
      );
    }
    // Rates were stored as "1 X = r[X] OLD_BASE".
    // After switching base to N, "1 X = r[X] / r[N] N".
    // Round to 6 decimals to keep the UI inputs readable.
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const nextRates: Record<string, number> = {};
    for (const [cur, val] of Object.entries(current.rates)) {
      nextRates[cur] = cur === newBase ? 1 : round(val / anchor);
    }
    const rates: CurrencyRates = { base: newBase, rates: nextRates };
    await db.saveRates(rates);
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(get().transactionsRaw, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, get().payeeGroupingEnabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ rates, transactions: final, transactionsRaw: raw });
  },

  setPayeeGrouping: async (enabled) => {
    await db.saveJSON("payeeGrouping", enabled);
    const { transactionsRaw: existing, rates } = get();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(existing, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, enabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ payeeGroupingEnabled: enabled, transactions: final, transactionsRaw: raw });
  },

  reapplyRules: async () => {
    const { transactionsRaw: existing, rates, payeeGroupingEnabled } = get();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(existing, rates, get().histDayRates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = restoreRuleCategories(raw);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ transactions: final, transactionsRaw: raw });
  },

  refresh: async () => {
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
  },

  deleteTransaction: async (id) => {
    // A not-yet-pushed draft is local-only: discard it outright. Marking it
    // "deleted" wouldn't help — `loadDraftRows` re-appends every draft
    // regardless of the deleted set, and there's no cloud row to hide, so the
    // draft would survive (and still get pushed). See issue #13.
    if (useDraftsStore.getState().drafts[id]) {
      await useDraftsStore.getState().remove(id);
    } else {
      await snapshotForCloudRestore([id]);
      await useDeletedStore.getState().remove(id);
      // Deleting wins over a pending edit: drop the edit so it doesn't
      // double-send (delete + upsert) or strand in «зависшие» (issue #19.4).
      await useEditsStore.getState().clearEdit(id);
    }
    // Recompute visible list from the unchanged raw set — the row is
    // still in `transactionsRaw` (and IDB) so a restore brings it back.
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
  },

  deleteTransactionMany: async (ids) => {
    if (ids.length === 0) return;
    // Split drafts (discarded outright) from synced rows (hidden + restorable).
    const draftMap = useDraftsStore.getState().drafts;
    const draftIds = ids.filter((id) => draftMap[id]);
    const syncedIds = ids.filter((id) => !draftMap[id]);
    for (const id of draftIds) await useDraftsStore.getState().remove(id);
    if (syncedIds.length > 0) {
      await snapshotForCloudRestore(syncedIds);
      await useDeletedStore.getState().removeMany(syncedIds);
      // Deleting wins over pending edits (issue #19.4).
      await useEditsStore.getState().clearMany(syncedIds);
    }
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
  },

  restoreTransaction: async (id) => {
    await useDeletedStore.getState().restore(id);
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
    void pushAfterRestore();
  },

  restoreTransactionMany: async (ids) => {
    if (ids.length === 0) return;
    await useDeletedStore.getState().restoreMany(ids);
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
    void pushAfterRestore();
  },

  purgeDeleted: async () => {
    // Permanently empty the local trash. Drops the recoverable copies:
    //   • removes the hidden rows from `transactionsRaw` + IDB,
    //   • clears the hidden-id set (so they leave the trash),
    //   • drops the cloud-restore snapshots (no more resurrection).
    // Intentionally NO cloud writes: rows already deleted in the cloud stay
    // deleted; a row that was only hidden locally (push off / not yet
    // pushed) may return on a FULL re-sync — the confirm dialog says so.
    const ids = useDeletedStore.getState().deletedIds;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { transactionsRaw: raw, rates } = get();
    const nextRaw = raw.filter((t) => !idSet.has(t.id));
    await db.saveTransactions(nextRaw);
    await useDeletedStore.getState().clearAll();
    await useDeletedPayloadsStore.getState().clearAll();
    const final = await finalize(nextRaw, rates);
    set({ transactions: final, transactionsRaw: nextRaw });
  },
}));
