/**
 * Cloud-snapshot infrastructure — Phase 0 of the two-way sync work.
 *
 * A "snapshot" is the raw, untransformed response of `POST /v8/diff/`
 * called with `serverTimestamp=0` (forced full sync). We store it byte-
 * for-byte the way Zenmoney returned it, so that:
 *
 *   • Worst-case recovery is trivial — push the same payload back via
 *     the same endpoint and Zenmoney accepts each entity as a normal
 *     sync update (last-write-wins by `changed` timestamp).
 *   • We never lose information by re-mapping into our local shape and
 *     back; the snapshot is auditable against what the cloud knows.
 *
 * Storage layout: each snapshot lives in its own IDB key
 * (`cloudSnapshot:<id>`) so we don't load 5 × 10MB blobs every time the
 * user opens Settings. A separate `cloudSnapshotIndex` key keeps a
 * lightweight summary list keyed by id, for cheap rendering.
 *
 * The store keeps the most recent N snapshots (default 5). Old ones
 * roll off automatically so IndexedDB doesn't bloat unboundedly.
 */

import * as db from "./db";
import type { ZenAccount, ZenDiffResponse, ZenTransaction } from "./zenmoney";
import { fetchDiff, pushDiff, type PushPayload } from "./zenmoney";
import { devLog } from "./devLog";

const INDEX_KEY = "cloudSnapshotIndex";
const SNAPSHOT_PREFIX = "cloudSnapshot:";
const MAX_KEPT = 5;

export interface CloudSnapshotSummary {
  /** Stable id — ISO timestamp of when the snapshot was taken. */
  id: string;
  /** Wall-clock ms timestamp the snapshot was taken (client-side). */
  createdAt: number;
  /** `serverTimestamp` from the diff response — what point in cloud time we captured. */
  serverTimestamp: number;
  /**
   * Zenmoney user id this snapshot belongs to. Lets the UI hide
   * snapshots from accounts other than the one currently connected
   * via token, so switching accounts doesn't surface foreign data.
   * Null for snapshots taken before this field existed (legacy) — UI
   * shows them under a generic "without account binding" treatment.
   */
  userId: number | null;
  /** Per-entity counts at snapshot time. */
  counts: {
    transactions: number;
    accounts: number;
    tags: number;
    merchants: number;
    instruments: number;
    companies: number;
    user: number;
  };
  /** Approximate JSON byte size of the raw snapshot (after stringify). */
  approxBytes: number;
}

/** Full snapshot payload — separated so listing the index is cheap. */
export interface CloudSnapshot extends CloudSnapshotSummary {
  raw: ZenDiffResponse;
}

function snapshotKey(id: string): string {
  return `${SNAPSHOT_PREFIX}${id}`;
}

export async function loadSnapshotIndex(): Promise<CloudSnapshotSummary[]> {
  const data = await db.loadJSON<CloudSnapshotSummary[]>(INDEX_KEY);
  if (!Array.isArray(data)) return [];
  // Newest first — list is consulted by UI for ordering already, but
  // we sort defensively to stay correct after corrupt manual edits.
  return [...data].sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadSnapshot(id: string): Promise<CloudSnapshot | null> {
  return db.loadJSON<CloudSnapshot>(snapshotKey(id));
}

/**
 * Forced full-sync against Zenmoney and persist the raw response as a
 * new snapshot. Rolls older snapshots off when the cap is exceeded.
 *
 * Throws if the API call fails. Caller decides UX (toast / inline error).
 */
export async function takeSnapshot(token: string): Promise<CloudSnapshot> {
  if (!token) throw new Error("Нет токена Дзен-мани — снимок невозможен");
  // `serverTimestamp=0` → full payload regardless of any previous sync.
  const raw = await fetchDiff(token, 0);

  const now = Date.now();
  const id = new Date(now).toISOString();
  const approxBytes = roughByteSize(raw);
  const summary: CloudSnapshotSummary = {
    id,
    createdAt: now,
    serverTimestamp: raw.serverTimestamp,
    userId: raw.user?.[0]?.id ?? null,
    counts: {
      // Count "live" transactions only — the same filter the forward
      // mapper (`zenmoneyMap.ts`) applies before they reach the app:
      //   • drop `deleted: true` tombstones
      //   • drop entries with both outcome=0 and income=0 (Zen
      //     keeps these as reminders / system markers, no real money
      //     movement)
      // This way the count on the snapshot card matches the number
      // the user sees in DzenAnalytics after a full sync of the
      // restored cloud. Restore itself still pushes the full set —
      // deleted and zero-amount entries included — and the restore
      // report breaks down the active/deleted mix.
      transactions:
        raw.transaction?.filter(
          (t) => !t.deleted && ((t.outcome || 0) > 0 || (t.income || 0) > 0)
        ).length ?? 0,
      accounts: raw.account?.length ?? 0,
      tags: raw.tag?.length ?? 0,
      merchants: raw.merchant?.length ?? 0,
      instruments: raw.instrument?.length ?? 0,
      companies: (raw.company as unknown[] | undefined)?.length ?? 0,
      user: raw.user?.length ?? 0,
    },
    approxBytes,
  };
  const full: CloudSnapshot = { ...summary, raw };

  await db.saveJSON(snapshotKey(id), full);

  // Update index — prepend new, drop tails past the cap.
  const prev = await loadSnapshotIndex();
  const next = [summary, ...prev.filter((s) => s.id !== id)].slice(0, MAX_KEPT);
  await db.saveJSON(INDEX_KEY, next);

  // Garbage-collect any snapshot blobs not referenced by the new index.
  const kept = new Set(next.map((s) => s.id));
  for (const old of prev) {
    if (!kept.has(old.id)) {
      await db.saveJSON(snapshotKey(old.id), null);
    }
  }

  return full;
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.saveJSON(snapshotKey(id), null);
  const idx = await loadSnapshotIndex();
  await db.saveJSON(
    INDEX_KEY,
    idx.filter((s) => s.id !== id)
  );
}

export async function clearAllSnapshots(): Promise<void> {
  const idx = await loadSnapshotIndex();
  for (const s of idx) {
    await db.saveJSON(snapshotKey(s.id), null);
  }
  await db.saveJSON(INDEX_KEY, []);
}

/**
 * Trigger a browser download of the snapshot as a JSON file. Format is
 * the literal `ZenDiffResponse` Zenmoney sent us, wrapped with our own
 * metadata header (so the user knows what to do with it).
 */
export async function downloadSnapshot(id: string): Promise<void> {
  const snap = await loadSnapshot(id);
  if (!snap) throw new Error("Снимок не найден в локальной базе");
  const payload = {
    _meta: {
      app: "DzenAnalytics",
      schema: "cloud-snapshot/v1",
      createdAt: snap.createdAt,
      createdAtISO: snap.id,
      serverTimestamp: snap.serverTimestamp,
      counts: snap.counts,
      note:
        "Это сырой ответ POST /v8/diff/ от Дзен-мани на момент снимка. " +
        "Хранится как safety-net на случай неудачной Push-операции из приложения.",
    },
    diff: snap.raw,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fname = `dzenanalytics-cloud-snapshot-${snap.id.replace(/[:.]/g, "-")}.json`;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Result of a restore operation — counts of each entity type that
 * Zenmoney accepted, plus the canonical server timestamp.
 */
export interface RestoreResult {
  /** Per-entity counts of what Zenmoney acknowledged. Each entity
   *  type is split into "active" (live data) and "tombstone" (the
   *  `deleted: true` / `archive: true` flagged ones) — we restore
   *  both so the target user gets a complete picture, but the UI
   *  shows the split so the user understands the mix. */
  accepted: {
    /**
     * `visible` — transactions that will appear in the app after a
     *   sync (non-deleted AND have a non-zero amount).
     * `hidden`  — pushed but invisible: `deleted: true` tombstones
     *   plus zero-amount entries (reminders / system markers). They
     *   live in Zen's cloud but the forward mapper filters them out
     *   of the user-facing list.
     */
    transactions: { visible: number; hidden: number };
    accounts: { active: number; archived: number };
    tags: { active: number; archived: number };
    merchants: number;
  };
  /** Counts of entities present in the snapshot but NOT pushed.
   *  `transactions` = dropped due to broken references (account /
   *  tag / merchant ids that couldn't be resolved on the target user).
   *  `debtAccount` = 1 when the snapshot's per-user "debt" system
   *  account got merged with the target user's existing one (always
   *  the case on cross-account restore where both have a debt
   *  account); 0 otherwise. */
  skipped: {
    transactions: number;
    debtAccount: number;
  };
  /** First few "why was this transaction dropped" reasons for the
   *  UI — capped to keep memory bounded; the full list is in the
   *  dev log. */
  droppedTxReasons: { id: string; reason: string }[];
  /** Server timestamp from the push response (anchor for next sync). */
  serverTimestamp: number;
  /** True when the snapshot we restored belonged to a different user
   *  than the currently-connected token. Surfaced as a warning in UI. */
  crossUser: boolean;
}

export interface RestoreContext {
  /** ID of the Zenmoney user the *current* token belongs to. */
  userId: number | null;
  /** Accounts that already exist on the current user. Used to detect
   *  "system" accounts (like the singular debt-tracking account Zen
   *  auto-creates) so we can merge instead of trying to create a
   *  duplicate. */
  currentAccounts: ZenAccount[];
}

/**
 * Progress signal emitted during a restore. UI consumes this to show
 * a status bar like "Восстановление: Счета 5 / 31".
 */
export interface RestoreProgress {
  phase: "accounts" | "tags" | "merchants" | "transactions" | "done";
  current: number;
  total: number;
}

/**
 * Push the contents of a stored snapshot back to Zenmoney.
 *
 * Strategy: send the snapshot's `transaction`, `account`, `tag` and
 * `merchant` arrays as a single `pushDiff` call. The server upserts
 * each entity by `id` with last-write-wins on `changed`, so this works
 * as a "restore" for everything the snapshot captured.
 *
 * Cross-account restore quirks Zenmoney enforces:
 *
 *   1) Every entity carries a `user` field tying it to its source
 *      account. The API rejects pushes where `user` doesn't match the
 *      token's account ("Wrong user of object"). We rewrite `user` on
 *      every outgoing entity to the current account's id, while
 *      preserving entity IDs and their internal cross-references.
 *
 *   2) Zenmoney auto-creates exactly one "debt" account per user (for
 *      tracking interpersonal IOUs). It refuses to create a second one
 *      ("It is not allowed to create several user debt accounts").
 *      Solution: drop the snapshot's debt account from the payload AND
 *      remap any transaction that referenced it to point at the
 *      current user's existing debt account id.
 *
 * Limitations:
 *   • Does NOT delete entities that exist in the cloud but not in the
 *     snapshot. A true rollback needs to compute a deletion list
 *     separately — out of scope here. This is upsert-only restore.
 *   • Doesn't push `instrument` (server-managed) or `user` (root
 *     account record) — only the four user-mutable entity types.
 */
export async function restoreSnapshotToCloud(
  id: string,
  token: string,
  ctx: RestoreContext,
  onProgress?: (p: RestoreProgress) => void
): Promise<RestoreResult> {
  const snap = await loadSnapshot(id);
  if (!snap) throw new Error("Снимок не найден в локальной базе");

  const raw = snap.raw;
  const snapshotUserId = raw.user?.[0]?.id ?? null;
  const crossUser =
    ctx.userId != null &&
    snapshotUserId != null &&
    ctx.userId !== snapshotUserId;

  // For cross-account restores, every outgoing entity must carry the
  // *current* account's user id — Zen rejects the request otherwise.
  // For same-account restores the snapshot already has the right user
  // id, so we just pass entities through.
  const rewriteUser = <T extends { user: number }>(items: T[]): T[] =>
    crossUser && ctx.userId != null
      ? items.map((it) => ({ ...it, user: ctx.userId as number }))
      : items;

  // Special-case the singular per-user debt account. Zenmoney creates
  // one automatically and refuses to accept a second. If both the
  // snapshot and the current user have such an account, we drop the
  // snapshot's from the outgoing accounts list and remap any tx that
  // referenced its id to the current user's debt-account id.
  const snapshotDebt =
    (raw.account || []).find((a) => a.type === "debt") || null;
  const currentDebt =
    ctx.currentAccounts.find((a) => a.type === "debt") || null;
  const debtIdRemap =
    snapshotDebt && currentDebt && snapshotDebt.id !== currentDebt.id
      ? { from: snapshotDebt.id, to: currentDebt.id }
      : null;

  const accountsOut = (raw.account || []).filter((a) =>
    debtIdRemap ? a.id !== debtIdRemap.from : true
  );

  // ── ID remapping for cross-user restores ──────────────────────────
  // Zenmoney binds entity UUIDs to their original creator user; a
  // cross-user upsert by an existing UUID returns HTTP 500. Solution:
  // mint fresh UUIDs for every user-entity we send, build mapping
  // tables, then rewrite every cross-entity reference (transaction →
  // account / tag / merchant, tag → parent tag) to use the new id.
  // Same-user restores keep their original UUIDs untouched.
  const accountIdMap = new Map<string, string>();
  const tagIdMap = new Map<string, string>();
  const merchantIdMap = new Map<string, string>();
  if (crossUser) {
    for (const a of accountsOut) accountIdMap.set(a.id, crypto.randomUUID());
    // Snapshot's debt account folded into current user's debt id —
    // tx references will resolve via this mapping table.
    if (debtIdRemap) accountIdMap.set(debtIdRemap.from, debtIdRemap.to);
    for (const t of raw.tag || []) tagIdMap.set(t.id, crypto.randomUUID());
    for (const m of raw.merchant || [])
      merchantIdMap.set(m.id, crypto.randomUUID());
  }

  const remapId = (oldId: string, map: Map<string, string>): string =>
    crossUser ? map.get(oldId) || oldId : oldId;

  // Transaction remapping + reference validation. For cross-user
  // restores, transactions can reference entities that we DON'T have
  // mappings for — typically deleted tags / merchants that the
  // history of a long-lived account references but that no longer
  // appear in `tag[]` / `merchant[]`. Pushing transactions with
  // foreign UUIDs in those slots leaves the target account in a
  // broken state ("Cannot read properties of undefined" errors in
  // Zen's own web app on those transactions).
  // Validation rules:
  //   • outcomeAccount / incomeAccount — REQUIRED. If we can't remap,
  //     drop the transaction (we add it to `brokenRefSkipped`).
  //   • tag[]  — filter to ids we can resolve; if filtered empty, set
  //     to null. Tags are display-only metadata, safe to drop.
  //   • merchant — null if we can't resolve. Same reasoning.
  const brokenRefSkipped: { id: string; reason: string }[] = [];
  const isMapped = (id: string, map: Map<string, string>) =>
    crossUser ? map.has(id) : true;

  const transactionsOut: ZenTransaction[] = [];
  // Restore is a "full backup → full restore" operation: even
  // `deleted: true` transactions go to Zen, so the target account
  // mirrors the source byte-for-byte (tombstones included). The UI
  // reports the active / deleted split so the user sees the mix.
  for (const t of raw.transaction || []) {
    if (!crossUser && !debtIdRemap) {
      transactionsOut.push(t);
      continue;
    }
    // Required account refs — accept the debt-id remap as valid even
    // when the snapshot's debt id isn't in accountIdMap for same-user.
    const outIsDebt = debtIdRemap && t.outcomeAccount === debtIdRemap.from;
    const inIsDebt = debtIdRemap && t.incomeAccount === debtIdRemap.from;
    const outOk =
      isMapped(t.outcomeAccount, accountIdMap) ||
      outIsDebt ||
      // Same-user case doesn't need the map at all.
      !crossUser;
    const inOk =
      isMapped(t.incomeAccount, accountIdMap) || inIsDebt || !crossUser;
    if (!outOk || !inOk) {
      brokenRefSkipped.push({
        id: t.id,
        reason: `${!outOk ? "outcomeAccount" : "incomeAccount"} ${
          !outOk ? t.outcomeAccount : t.incomeAccount
        } не нашёлся в карте счетов снимка`,
      });
      continue;
    }
    // Filter tag refs to mapped ones; drop unresolvable ones.
    const cleanedTag = (() => {
      if (!t.tag) return t.tag;
      if (!crossUser) return t.tag;
      const filtered = t.tag.filter((id) => tagIdMap.has(id));
      return filtered.length > 0 ? filtered.map((id) => remapId(id, tagIdMap)) : null;
    })();
    // Merchant — null if unresolvable.
    const cleanedMerchant = crossUser
      ? t.merchant && merchantIdMap.has(t.merchant)
        ? remapId(t.merchant, merchantIdMap)
        : null
      : t.merchant;
    transactionsOut.push({
      ...t,
      id: crossUser ? crypto.randomUUID() : t.id,
      outcomeAccount: crossUser
        ? outIsDebt
          ? debtIdRemap!.to
          : remapId(t.outcomeAccount, accountIdMap)
        : outIsDebt
          ? debtIdRemap!.to
          : t.outcomeAccount,
      incomeAccount: crossUser
        ? inIsDebt
          ? debtIdRemap!.to
          : remapId(t.incomeAccount, accountIdMap)
        : inIsDebt
          ? debtIdRemap!.to
          : t.incomeAccount,
      tag: cleanedTag,
      merchant: cleanedMerchant,
      outcomeBankID: crossUser ? null : t.outcomeBankID,
      incomeBankID: crossUser ? null : t.incomeBankID,
    });
  }
  if (brokenRefSkipped.length > 0) {
    devLog(
      "zen-restore",
      `dropped ${brokenRefSkipped.length} transactions with unresolvable account refs`,
      "warn"
    );
    for (const s of brokenRefSkipped.slice(0, 10)) {
      devLog("zen-restore", `  drop ${s.id}: ${s.reason}`, "warn");
    }
  }

  // Account list with fresh UUIDs (cross-user). Same-user keeps
  // original ids — the user-rewrite still happens via `rewriteUser`,
  // but here we ALSO rewrite ids.
  const accountsRemapped = accountsOut.map((a) => ({
    ...a,
    id: remapId(a.id, accountIdMap),
  }));
  // Tags: remap own id + parent reference (parents are other tags in
  // the same batch, so they're in the same mapping table).
  const tagsRemapped = (raw.tag || []).map((t) => ({
    ...t,
    id: remapId(t.id, tagIdMap),
    parent: t.parent ? remapId(t.parent, tagIdMap) : t.parent,
  }));
  // Merchants: only need own id remapped.
  const merchantsRemapped = (raw.merchant || []).map((m) => ({
    ...m,
    id: remapId(m.id, merchantIdMap),
  }));

  const finalTxs = rewriteUser(transactionsOut);
  const finalAccounts = rewriteUser(accountsRemapped);
  const finalTags = rewriteUser(tagsRemapped);
  const finalMerchants = rewriteUser(merchantsRemapped);

  // Zenmoney's `/v8/diff/` quietly fails with HTTP 500 "Server inner
  // error" when a request is too big. We've observed it tolerating
  // up to ~500KB by *size* but choking on requests that pack many
  // entities even within that budget — the 332 merchants + 583 txs
  // in a single ~488KB chunk we tried first all got rejected. So the
  // limit is partly about size and partly about item count.
  //
  // Strategy that survives real data:
  //   • Request #1: dictionary ONLY (accounts + tags + merchants),
  //     no transactions. Lets the server commit the catalog cleanly.
  //   • Requests #2…N: pure transaction batches, each capped at both
  //     250 KB and 100 items. Whichever limit hits first wins.
  //
  // The server upserts by id, so chunking is safe — outcome is
  // identical to a single mega-request that the server would have
  // rejected.
  const CHUNK_BYTES = 250_000;
  const CHUNK_MAX_ITEMS = 100;

  // Pre-stringify each transaction once to avoid re-serialising in
  // the size loop. The string itself isn't sent — we only need its
  // length for the budget; the actual JSON.stringify of the payload
  // happens inside `pushDiff`.
  const txWithSize = finalTxs.map((t) => ({ tx: t, size: JSON.stringify(t).length }));

  const accepted: RestoreResult["accepted"] = {
    transactions: { visible: 0, hidden: 0 },
    accounts: { active: 0, archived: 0 },
    tags: { active: 0, archived: 0 },
    merchants: 0,
  };
  let lastServerTs = 0;
  let chunkCount = 0;

  // ── Phase A: dictionary in sub-phases ────────────────────────────
  // We discovered the server rejects mixed dictionary pushes for
  // cross-account restores even when the body is tiny (~64KB). To
  // pinpoint which entity type trips it, we split phase A into
  // sequential sub-pushes per type. Each sub-phase logs separately,
  // so if it fails we know whether accounts, tags or merchants is
  // the offender. Item-level chunking is applied to merchants (the
  // only catalogue that can grow to thousands).
  const pushSubPhase = async (
    label: string,
    payload: PushPayload,
    onSuccess: (resp: ZenDiffResponse) => void
  ): Promise<void> => {
    const sectionSizes = {
      transaction: payload.transaction?.length ?? 0,
      account: payload.account?.length ?? 0,
      tag: payload.tag?.length ?? 0,
      merchant: payload.merchant?.length ?? 0,
    };
    const subMsg = `phase A.${label}: ${JSON.stringify(sectionSizes)}`;
    if (!import.meta.env.PROD) {
      console.info(`[Zen restore] ${subMsg}`);
    }
    devLog("zen-restore", subMsg);
    try {
      const resp = await pushDiff(token, lastServerTs || 0, payload);
      onSuccess(resp);
      lastServerTs = resp.serverTimestamp;
      chunkCount++;
    } catch (e) {
      const errMsg = `phase A.${label} FAILED: ${e instanceof Error ? e.message : String(e)}`;
      if (!import.meta.env.PROD) {
        console.error(`[Zen restore] ${errMsg}`);
      }
      devLog("zen-restore", errMsg, "error");
      throw e;
    }
  };

  // A.1 accounts — sent ONE AT A TIME so server errors localise to a
  // specific account. For cross-user restores we ALSO strip
  // bank-integration-specific fields that don't make sense on the
  // target user (their bank integrations are different / absent):
  //   • syncID — bank sync identifier (token from another account)
  //   • company — id of the bank/issuer entity (different namespace)
  //   • enableCorrection / balanceCorrectionType / enableSMS — flags
  //     tied to that bank integration
  //   • capitalization / percent / endDateOffset(Interval) /
  //     payoffStep(Interval) — credit-account terms set by bank
  // Same-user restores keep all fields untouched (the integration
  // still exists on the target user).
  for (let i = 0; i < finalAccounts.length; i++) {
    const acc = finalAccounts[i];
    // Build the outgoing account: a shallow copy with cross-user-only
    // sanitization. We cast to a loose Record so we can strip the
    // optional API-only fields that aren't part of our `ZenAccount`
    // interface.
    // `acc` already has its id remapped + `user` rewritten upstream
    // for cross-user (via `accountsRemapped` and `rewriteUser`). All
    // we need here is to null out the bank-integration refs that
    // don't make sense on the target user.
    const outAcc: Record<string, unknown> = { ...acc };
    if (crossUser) {
      outAcc.company = null;
      outAcc.syncID = null;
    }
    devLog(
      "zen-restore-acc",
      `#${i + 1}/${finalAccounts.length} id=${acc.id} type=${acc.type} ` +
        `title="${acc.title}" archive=${acc.archive} inBalance=${acc.inBalance} ` +
        `savings=${acc.savings} balance=${acc.balance} ` +
        `(crossUser=${crossUser}, fields=${Object.keys(outAcc).length})`
    );
    onProgress?.({
      phase: "accounts",
      current: i + 1,
      total: finalAccounts.length,
    });
    try {
      await pushSubPhase(
        `accounts[${i + 1}/${finalAccounts.length}:${acc.type}:${acc.title}]`,
        // Cast back through `unknown` — outAcc has the same shape as
        // ZenAccount or a subset of it, which the push payload accepts.
        { account: [outAcc as unknown as typeof acc] },
        () => {
          // Counting the OUTGOING payload, not response echo (with
          // serverTimestamp=0 Zen echoes the user's full state).
          // Split by `archive` flag so the result shows active vs
          // archived counts separately.
          if (acc.archive) accepted.accounts.archived += 1;
          else accepted.accounts.active += 1;
        }
      );
    } catch (e) {
      devLog(
        "zen-restore-acc",
        `failing account sanitized payload: ${JSON.stringify(outAcc)}`,
        "error"
      );
      throw e;
    }
  }

  // A.2 tags only.
  if (finalTags.length > 0) {
    onProgress?.({ phase: "tags", current: 0, total: finalTags.length });
    await pushSubPhase(
      "tags",
      { tag: finalTags },
      () => {
        // Tags don't have a `deleted` flag; `archive` means hidden
        // but not deleted. Split by it for the report.
        for (const t of finalTags) {
          if (t.archive) accepted.tags.archived += 1;
          else accepted.tags.active += 1;
        }
      }
    );
    onProgress?.({
      phase: "tags",
      current: finalTags.length,
      total: finalTags.length,
    });
  }

  // A.3 merchants only — chunked by count because dictionaries can
  // get large (332 merchants in our test snapshot already).
  const MERCHANT_CHUNK = 100;
  for (let i = 0; i < finalMerchants.length; i += MERCHANT_CHUNK) {
    const slice = finalMerchants.slice(i, i + MERCHANT_CHUNK);
    onProgress?.({
      phase: "merchants",
      current: i,
      total: finalMerchants.length,
    });
    await pushSubPhase(
      `merchants(${i}-${i + slice.length})`,
      { merchant: slice },
      () => {
        accepted.merchants += slice.length;
      }
    );
  }
  if (finalMerchants.length > 0) {
    onProgress?.({
      phase: "merchants",
      current: finalMerchants.length,
      total: finalMerchants.length,
    });
  }

  // ── Phase B: transaction chunks ───────────────────────────────────
  let txIdx = 0;
  while (txIdx < txWithSize.length) {
    const chunkTxs: ZenTransaction[] = [];
    let chunkSize = 0;
    while (txIdx < txWithSize.length) {
      const { tx, size } = txWithSize[txIdx];
      // Stop when adding this one would overflow EITHER limit. Always
      // accept at least one tx per chunk, even if it alone exceeds
      // budget — better to try and let the server reject than to
      // dead-loop.
      if (chunkTxs.length > 0) {
        if (chunkSize + size > CHUNK_BYTES) break;
        if (chunkTxs.length >= CHUNK_MAX_ITEMS) break;
      }
      chunkTxs.push(tx);
      chunkSize += size;
      txIdx++;
    }

    const payload: PushPayload = { transaction: chunkTxs };
    const chunkMsg =
      `phase B chunk ${chunkCount}: sending ${chunkTxs.length} tx(s) ` +
      `(~${Math.round(chunkSize / 1024)} KB)`;
    if (!import.meta.env.PROD) {
      console.info(`[Zen restore] ${chunkMsg}`);
    }
    devLog("zen-restore", chunkMsg);
    onProgress?.({
      phase: "transactions",
      current: txIdx - chunkTxs.length,
      total: txWithSize.length,
    });
    let response: ZenDiffResponse;
    try {
      response = await pushDiff(token, lastServerTs, payload);
    } catch (e) {
      const totalPushed =
        accepted.transactions.visible + accepted.transactions.hidden;
      const errMsg =
        `phase B chunk ${chunkCount} FAILED. ` +
        `Already pushed: ${totalPushed} tx (dict OK). ` +
        `Reason: ${e instanceof Error ? e.message : String(e)}`;
      if (!import.meta.env.PROD) {
        console.error(`[Zen restore] ${errMsg}`);
      }
      devLog("zen-restore", errMsg, "error");
      throw e;
    }

    // Split this chunk's tx count by "will be visible in app" vs
    // "pushed but hidden" (deleted tombstones OR zero-amount).
    // The split matches the forward mapper's filtering so the
    // restore report's `visible` count matches the post-sync local
    // view exactly.
    for (const t of chunkTxs) {
      const hasAmount = (t.outcome || 0) > 0 || (t.income || 0) > 0;
      if (!t.deleted && hasAmount) accepted.transactions.visible += 1;
      else accepted.transactions.hidden += 1;
    }
    lastServerTs = response.serverTimestamp;
    chunkCount++;
    onProgress?.({
      phase: "transactions",
      current: txIdx,
      total: txWithSize.length,
    });
  }

  onProgress?.({ phase: "done", current: 0, total: 0 });

  const summaryMsg =
    `sent ${accepted.transactions.visible}+${accepted.transactions.hidden} ` +
    `txs (visible+hidden) in ${chunkCount} request(s)`;
  if (!import.meta.env.PROD) {
    console.info(`[Zen restore] ${summaryMsg}`);
  }
  devLog("zen-restore", summaryMsg);

  return {
    accepted,
    skipped: {
      transactions: brokenRefSkipped.length,
      // The snapshot's debt account is dropped from the payload
      // whenever we have a `debtIdRemap` (which happens when both
      // source and target users have a debt account with different
      // ids — always true on cross-account restore).
      debtAccount: debtIdRemap ? 1 : 0,
    },
    droppedTxReasons: brokenRefSkipped.slice(0, 10),
    serverTimestamp: lastServerTs,
    crossUser,
  };
}

/**
 * Import a JSON file previously created by `downloadSnapshot` (or
 * structurally compatible) and persist it as a new locally-stored
 * snapshot.
 *
 * Accepts either:
 *   • The downloaded wrapped form `{ _meta, diff }`, or
 *   • A bare `ZenDiffResponse` (e.g. someone pasted raw API output).
 *
 * The imported snapshot is stamped with a fresh `id` (current time)
 * and pushed into the rolling 5-slot index just like a fresh capture.
 * Throws with a clear message if the file isn't a valid snapshot.
 */
export async function importSnapshotFromJson(
  fileContent: string
): Promise<CloudSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (e) {
    throw new Error(
      "Не удалось разобрать JSON: " +
        (e instanceof Error ? e.message : String(e)),
      { cause: e }
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Файл не содержит корректный JSON-объект");
  }

  // Two accepted shapes:
  //   1) Wrapped: { _meta, diff } — what `downloadSnapshot` writes.
  //   2) Bare: a raw `ZenDiffResponse` from any source.
  let raw: ZenDiffResponse | null = null;
  const obj = parsed as Record<string, unknown>;
  if (obj.diff && typeof obj.diff === "object") {
    raw = obj.diff as ZenDiffResponse;
  } else if (Array.isArray(obj.transaction) || Array.isArray(obj.account)) {
    raw = obj as unknown as ZenDiffResponse;
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "Не похоже на снимок DzenAnalytics. Ожидался JSON вида { _meta, diff } " +
        "или сырой ответ API Дзена."
    );
  }
  if (typeof raw.serverTimestamp !== "number") {
    throw new Error("В снимке нет поля serverTimestamp — файл повреждён.");
  }

  const now = Date.now();
  const id = new Date(now).toISOString();
  const approxBytes = roughByteSize(raw);
  const summary: CloudSnapshotSummary = {
    id,
    createdAt: now,
    serverTimestamp: raw.serverTimestamp,
    userId: raw.user?.[0]?.id ?? null,
    counts: {
      // Count "live" transactions only — the same filter the forward
      // mapper (`zenmoneyMap.ts`) applies before they reach the app:
      //   • drop `deleted: true` tombstones
      //   • drop entries with both outcome=0 and income=0 (Zen
      //     keeps these as reminders / system markers, no real money
      //     movement)
      // This way the count on the snapshot card matches the number
      // the user sees in DzenAnalytics after a full sync of the
      // restored cloud. Restore itself still pushes the full set —
      // deleted and zero-amount entries included — and the restore
      // report breaks down the active/deleted mix.
      transactions:
        raw.transaction?.filter(
          (t) => !t.deleted && ((t.outcome || 0) > 0 || (t.income || 0) > 0)
        ).length ?? 0,
      accounts: raw.account?.length ?? 0,
      tags: raw.tag?.length ?? 0,
      merchants: raw.merchant?.length ?? 0,
      instruments: raw.instrument?.length ?? 0,
      companies: (raw.company as unknown[] | undefined)?.length ?? 0,
      user: raw.user?.length ?? 0,
    },
    approxBytes,
  };
  // Imported snapshots are intentionally NOT bound to a specific
  // userId — they're a manual artefact the user uploaded and should
  // be visible regardless of which Zenmoney account is currently
  // connected. Cross-user detection at restore time still reads
  // `raw.user[0].id` (the original owner) from the snapshot body
  // itself, so safety checks aren't affected.
  summary.userId = null;
  const full: CloudSnapshot = { ...summary, raw };

  await db.saveJSON(snapshotKey(id), full);

  // Same rolling-cap logic as `takeSnapshot`.
  const prev = await loadSnapshotIndex();
  const next = [summary, ...prev.filter((s) => s.id !== id)].slice(0, MAX_KEPT);
  await db.saveJSON(INDEX_KEY, next);
  const kept = new Set(next.map((s) => s.id));
  for (const old of prev) {
    if (!kept.has(old.id)) {
      await db.saveJSON(snapshotKey(old.id), null);
    }
  }

  return full;
}

/** Best-effort byte size estimate. Avoids the cost of a full stringify
 *  for very large blobs — JSON.stringify is the canonical way but it
 *  duplicates the data in memory. UTF-8 string length × 2 is the rough
 *  worst case for non-ASCII; we sample-stringify to get a real number. */
function roughByteSize(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}

/** Окно «свежести» снимка для политики «раз в сутки». */
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Что честно написать в подтверждении отправки про копию облака.
 *
 * Раньше диалог обещал «перед отправкой сохраним копию» всегда — даже при
 * политике «никогда», когда копия не делается вовсе. Обещание, которое не
 * выполняется, хуже отсутствия обещания: на него рассчитывают.
 *
 * Возвращает готовое предложение с пробелом на конце либо пустую строку.
 */
export async function snapshotPromiseText(
  policy: "always" | "daily" | "never"
): Promise<string> {
  if (policy === "never") return "";
  if (policy === "always") {
    return "Перед отправкой сохраним копию облачного состояния. ";
  }
  const newest = (await loadSnapshotIndex())[0];
  const fresh = newest && Date.now() - newest.createdAt < DAILY_WINDOW_MS;
  if (!fresh) return "Перед отправкой сохраним копию облачного состояния. ";
  const when = new Date(newest.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Копия облака уже есть — от ${when}, новую сегодня делать не будем. `;
}
