/**
 * Reverse mapper: local `Transaction` edit → Zenmoney `ZenTransaction`.
 *
 * Phase 1 MVP scope. We push only the "safe" edit fields where the
 * inverse mapping is unambiguous:
 *
 *   • date            (direct YYYY-MM-DD)
 *   • payee           (string|null)
 *   • brand           (in dictionary → merchant id; not in dictionary →
 *                       fallback to free-text `payee` field)
 *   • comment         (string|null)
 *   • amount          (replaces the amount on the side that already has it)
 *   • currency        (replaces the instrument on the side that already has it)
 *   • category        (resolved to a single tag id by title)
 *   • subcategory     (resolved as a child tag where parent's title matches)
 *
 *   • kind change        — supported for the single-leg flips
 *                          Расход ↔ Доход ↔ Возврат: the money moves
 *                          between the income/outcome legs of the SAME
 *                          account (or, for income↔refund, stays put and
 *                          only the category flavour changes).
 *
 * Supported now: kind change expense↔income↔refund and to/from «Перевод»,
 * editing a transfer's accounts, account change for single-leg rows, AND
 * cross-currency cases — a kind flip on an FX row carries its op-amounts;
 * a transfer between accounts of different currencies takes a destination
 * amount; moving a row onto an account in another currency turns it into an
 * FX row (original sum becomes the op side).
 *
 * The only thing still NOT supported (skipped with a clear reason): moving
 * an ALREADY-FX row onto yet another different-currency account (a rare
 * triple-currency reshuffle that would need a fresh operational amount).
 *
 * Brand handling: Zenmoney has two counterparty fields on a transaction
 * — `merchant` (id-ref into the merchant dictionary, the curated brand
 * catalogue) and `payee` (free-text). When the user picks a name that
 * matches an existing merchant, we set `merchant`. When they type a
 * name that's NOT in the dictionary, we don't create a new merchant
 * entity (that has its own catalogue-side concerns); instead we store
 * the string into `payee` and clear `merchant`. Round-trip works:
 * after the next sync, the forward mapper sees `merchant: null` +
 * `payee: "MyCustomShop"` and surfaces it as the brand in the UI.
 *
 * Strategy: take the ORIGINAL `ZenTransaction` straight from cache and
 * apply only the fields the user actually touched. This preserves all
 * Zenmoney-specific fields we don't model locally (qrCode, latitude,
 * opIncome/opOutcome for FX, payeeRaw etc.) so a round-trip can't
 * accidentally blank them out.
 */

import { pushDiff, type PushPayload } from "./zenmoney";
import type {
  ZenAccount,
  ZenBudget,
  ZenDeletion,
  ZenDiffResponse,
  ZenMerchant,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import { NO_CATEGORY } from "./zenmoneyMap";
import type { TransactionEdit } from "../store/useEditsStore";
import type { TxKind } from "../types";

export interface PushItem {
  id: string;
  /** Reconstructed ZenTransaction ready to send. */
  zen: ZenTransaction;
}

export interface PushBuildResult {
  /** Ready-to-send in-place updates (same id). */
  toPush: PushItem[];
  /**
   * Time-of-day edits, pushed as delete-old + create-new-id instead of an
   * in-place update. Zenmoney IGNORES a changed `created` on an existing
   * transaction (verified live + mirrors what Zerro does), so the ONLY way to
   * move a transaction's time is to recreate it under a fresh id. Same
   * `{ oldId, tx }` shape as a resurrection — the caller creates `tx` and
   * deletes `oldId` in the SAME push. See `buildResurrections` for the twin
   * "Zenmoney won't update this in place → recreate" pattern.
   */
  recreates: Resurrection[];
  /** Edits we couldn't transform — paired with a human-readable reason. */
  skipped: { id: string; reason: string }[];
}

/** Synthetic categories minted in the forward mapper. They have no
 *  real Zenmoney tag, so pushing them is impossible. */
const SYNTHETIC_CATEGORIES = new Set(["Долг", "Перевод"]);

/** Zenmoney account types that mark an operation as a debt/loan/credit move.
 *  Mirrors the forward mapper (`zenmoneyMap.ts`) which labels these «Долг». */
const DEBT_ACCOUNT_TYPES = new Set(["loan", "credit", "debt"]);

/**
 * Replays the forward-mapper classification for a raw ZenTransaction so
 * we can tell what `kind` / `account` / `outcomeAccount` / `incomeAccount`
 * our local model originally derived from it. Used to decide whether an
 * overlay field is a *real* change or just an inherited copy from the
 * Edit-modal (which currently stashes every field into the patch).
 *
 * Mirrors `zenmoneyMap.ts` — including the refund heuristic: an
 * income-side movement tagged with an *expense* category
 * (`tag.showOutcome && !tag.showIncome`) is classified as `refund`.
 */
function classifyOriginal(
  zt: ZenTransaction,
  accountsById: Map<string, ZenAccount>,
  tagsById: Map<string, ZenTag>
): { kind: TxKind; account: string; outAcc: string; inAcc: string } {
  const outcome = zt.outcome || 0;
  const income = zt.income || 0;
  const outAcc = accountsById.get(zt.outcomeAccount)?.title || "";
  const inAcc = accountsById.get(zt.incomeAccount)?.title || "";
  const isTransfer =
    outcome > 0 && income > 0 && zt.outcomeAccount !== zt.incomeAccount;
  if (isTransfer) {
    return { kind: "transfer", account: outAcc, outAcc, inAcc };
  }
  if (outcome > 0) {
    return { kind: "expense", account: outAcc, outAcc, inAcc };
  }
  // Income-side. Check for the refund heuristic — same rule as the
  // forward mapper so this round-trips losslessly.
  let kind: TxKind = "income";
  const firstTag = zt.tag && zt.tag.length > 0 ? tagsById.get(zt.tag[0]) : null;
  if (firstTag && firstTag.showOutcome && !firstTag.showIncome) {
    kind = "refund";
  }
  return { kind, account: inAcc, outAcc, inAcc };
}

/** Convert an edited `createdAt` (ISO) into Zenmoney's `created` (unix
 *  seconds). Zenmoney has no time column — the operation's time-of-day rides
 *  on `created`, same as Zerro. */
function applyCreatedAt(zen: ZenTransaction, edit: TransactionEdit): void {
  if (edit.createdAt === undefined) return;
  const ms = Date.parse(edit.createdAt);
  if (Number.isFinite(ms)) zen.created = Math.floor(ms / 1000);
}

/** Apply the always-safe scalar edits (date, time, comment) onto a built patch. */
function applyDateComment(zen: ZenTransaction, edit: TransactionEdit): void {
  if (edit.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(edit.date)) {
    zen.date = edit.date;
  }
  applyCreatedAt(zen, edit);
  if (edit.comment !== undefined) {
    zen.comment = edit.comment || null;
  }
}

/**
 * Build a TRANSFER ZenTransaction (Branch A): money leaves `outcomeAccount`
 * and lands on `incomeAccount`. Single-currency only — both accounts must
 * share an instrument (the UI offers one amount field). Returns a skip
 * reason for FX rows, missing/same accounts, or a cross-currency pair.
 * The accounts come from the edit overlay (titles) and fall back to the
 * original's legs so editing only the amount/comment of an existing
 * transfer still works.
 */
function buildTransferTarget(
  original: ZenTransaction,
  edit: TransactionEdit,
  orig: { outAcc: string; inAcc: string },
  accountsByTitle: Map<string, ZenAccount>,
  origIsTransfer: boolean
): { zen?: ZenTransaction; skip?: string } {
  // Op-amounts (operation currency ≠ account currency) only matter when we're
  // EDITING an existing transfer — there they carry real per-leg FX info we
  // don't rebuild, so we still refuse. But when FLIPPING a regular operation
  // into a transfer, the op-amounts belong to the old single-leg record and
  // are irrelevant: both transfer legs live in their accounts' currencies
  // («Отправлено» / «Получено»), so we drop the op pair and build cleanly.
  if (
    origIsTransfer &&
    ((original.opIncome || 0) > 0 || (original.opOutcome || 0) > 0)
  ) {
    return {
      skip: "перевод с операцией в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const srcTitle = edit.outcomeAccount ?? orig.outAcc;
  const dstTitle = edit.incomeAccount ?? orig.inAcc;
  const src = accountsByTitle.get(srcTitle);
  const dst = accountsByTitle.get(dstTitle);
  if (!src) return { skip: `счёт-источник "${srcTitle}" не найден в Дзен-мани` };
  if (!dst) return { skip: `счёт-получатель "${dstTitle}" не найден в Дзен-мани` };
  if (src.id === dst.id) {
    return { skip: "перевод между одним и тем же счётом невозможен" };
  }
  // Amount on the source leg (in the source account's currency).
  const outcome = edit.amount ?? (original.outcome || original.income);
  // Amount on the destination leg. Same currency → both legs equal (the UI
  // shows one amount field). Different currencies → the two legs hold
  // different sums in their own currencies, so we NEED the destination
  // amount; we never invent an exchange rate.
  let income: number;
  if (src.instrument === dst.instrument) {
    income = outcome;
  } else {
    income = edit.incomeAmount ?? original.income;
    if (!income) {
      return {
        skip: "для перевода между счетами разной валюты укажите сумму зачисления — отредактируйте в приложении",
      };
    }
  }
  // A leg on a loan/credit/debt account makes this a «Долг» op — Zenmoney then
  // REQUIRES a non-null payee (the counterparty). This is the path for
  // converting a regular operation INTO a debt one (the original isn't a debt
  // op, so the dedicated debt branch upstream doesn't fire). Keep/require the
  // payee instead of nulling it (issue #19.7 / #19.1).
  const isDebtTransfer =
    DEBT_ACCOUNT_TYPES.has(src.type || "") || DEBT_ACCOUNT_TYPES.has(dst.type || "");
  let debtPayee: string | null = null;
  if (isDebtTransfer) {
    debtPayee = ((edit.brand ?? edit.payee ?? original.payee) || "").trim() || null;
    if (!debtPayee) {
      return { skip: "у долговой операции должен быть указан плательщик (контрагент)" };
    }
  }
  const zen: ZenTransaction = {
    ...original,
    outcome,
    income,
    outcomeAccount: src.id,
    incomeAccount: dst.id,
    outcomeInstrument: src.instrument,
    incomeInstrument: dst.instrument,
    opOutcome: 0,
    opIncome: 0,
    opOutcomeInstrument: null,
    opIncomeInstrument: null,
    // The source leg keeps any existing bank-reconciliation id; the
    // freshly-synthesised destination leg has none.
    outcomeBankID: original.outcome > 0 ? original.outcomeBankID : original.incomeBankID,
    incomeBankID: null,
    tag: null, // a transfer / debt op has no category tag in Zenmoney
    merchant: null,
    payee: debtPayee, // debt → counterparty; plain transfer → none
  };
  return { zen };
}

/**
 * Collapse a TRANSFER onto a single account (Branch B): transfer →
 * expense keeps the outcome leg; transfer → income/refund keeps the
 * income leg. The result account comes from the edit (else the kept
 * leg's account); same-currency only. Category is resolved from the
 * edit when present, otherwise the row goes untagged (a refund without
 * an expense tag round-trips as plain income — acceptable).
 */
function collapseTransfer(
  original: ZenTransaction,
  edit: TransactionEdit,
  orig: { outAcc: string; inAcc: string },
  targetKind: TxKind,
  accountsByTitle: Map<string, ZenAccount>,
  tagsByTitle: Map<string, ZenTag[]>,
  tagsById: Map<string, ZenTag>
): { zen?: ZenTransaction; skip?: string } {
  if ((original.opIncome || 0) > 0 || (original.opOutcome || 0) > 0) {
    return {
      skip: "перевод с операцией в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const keepLeg: "outcome" | "income" =
    targetKind === "expense" ? "outcome" : "income";
  const keepInstr =
    keepLeg === "outcome" ? original.outcomeInstrument : original.incomeInstrument;
  const wantTitle = edit.account ?? (keepLeg === "outcome" ? orig.outAcc : orig.inAcc);
  const acc = accountsByTitle.get(wantTitle);
  if (!acc) return { skip: `счёт "${wantTitle}" не найден в Дзен-мани` };
  if (acc.instrument !== keepInstr) {
    return {
      skip: "смена счёта на счёт в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const amount =
    edit.amount ?? (keepLeg === "outcome" ? original.outcome : original.income);
  const zen: ZenTransaction = { ...original };
  if (keepLeg === "outcome") {
    zen.outcome = amount;
    zen.income = 0;
    zen.outcomeBankID = original.outcomeBankID;
    zen.incomeBankID = null;
  } else {
    zen.income = amount;
    zen.outcome = 0;
    zen.incomeBankID = original.incomeBankID;
    zen.outcomeBankID = null;
  }
  // Single-leg invariant: both legs name the same account & instrument.
  zen.outcomeAccount = acc.id;
  zen.incomeAccount = acc.id;
  zen.outcomeInstrument = keepInstr;
  zen.incomeInstrument = keepInstr;
  zen.opOutcome = 0;
  zen.opIncome = 0;
  zen.opOutcomeInstrument = null;
  zen.opIncomeInstrument = null;
  if (
    edit.category &&
    edit.category !== NO_CATEGORY &&
    !SYNTHETIC_CATEGORIES.has(edit.category)
  ) {
    const resolved = resolveTagId(
      edit.category,
      edit.subcategory ?? null,
      tagsByTitle,
      tagsById
    );
    if (!resolved) {
      return { skip: `категория "${edit.category}" не найдена в тегах Дзен-мани` };
    }
    zen.tag = [resolved];
  } else {
    // No category / «Без категории» / synthetic → tag-less.
    zen.tag = null;
  }
  return { zen };
}

/**
 * Build Zenmoney `deletion` entries for locally-deleted transactions.
 *
 * Only ids that still exist in the cloud cache are emitted — once the
 * cloud no longer has the transaction (already deleted, or never
 * synced), there's nothing to delete and we silently skip it. Each
 * deletion carries the transaction's `user` (the cloud requires it)
 * and a fresh `stamp` (unix seconds).
 */
export function buildDeletions(
  deletedIds: Iterable<string>,
  cache: ZenCache
): ZenDeletion[] {
  const byId = new Map(cache.transactions.map((t) => [t.id, t]));
  const stamp = Math.floor(Date.now() / 1000);
  const out: ZenDeletion[] = [];
  for (const id of deletedIds) {
    const zt = byId.get(id);
    if (!zt) continue; // not in cloud cache — nothing to delete
    if (zt.deleted) continue; // already a tombstone
    out.push({ id, object: "transaction", user: zt.user, stamp });
  }
  return out;
}

export interface Resurrection {
  /** Original (now permanently tombstoned) id — used to drop the spent
   *  snapshot once the re-create succeeds. */
  oldId: string;
  /** A fresh transaction (NEW id) to create in the cloud. */
  tx: ZenTransaction;
}

/**
 * A DETERMINISTIC new id derived from the tombstoned old id. Using a
 * stable derived id (instead of a random one) makes resurrection
 * idempotent: re-pushing the same restored row hits the SAME new id, so
 * the server upserts it rather than creating a duplicate. This is the
 * safety net against ever spamming copies if the post-push snapshot prune
 * doesn't land. UUID-shaped (Zenmoney ids are UUIDs); FNV-1a fill — not
 * cryptographic, just stable + collision-free enough against real ids.
 */
export function resurrectionId(oldId: string): string {
  const bytes: number[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < 16; i++) {
    h ^= i + 0x9e;
    h = Math.imul(h, 0x01000193);
    for (let j = 0; j < oldId.length; j++) {
      h ^= oldId.charCodeAt(j);
      h = Math.imul(h, 0x01000193);
    }
    bytes.push((h >>> 0) & 0xff);
  }
  // Make it a valid RFC-4122 v4-shaped UUID — Zenmoney rejects ids that
  // aren't proper UUIDs. Set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-` +
    `${hex.slice(10, 16).join("")}`
  );
}

/**
 * Build "resurrection" re-creates for restored transactions.
 *
 * Zenmoney tombstones are sticky: re-pushing a deleted id (even with
 * `deleted:false`) is rejected — the server keeps it deleted (verified
 * against the API). So we revive a row by **creating a copy with a new
 * id**, preserving every field (payee, merchant, tags, amounts, date…).
 *
 * Derived purely from state, so it's safe to recompute each push:
 *   • id still hidden locally (in `deletedIds`) → skip (keep it deleted)
 *   • id LIVE in the cloud cache                → skip (deletion was never
 *     pushed — the original is still there)
 *   • otherwise (restored + gone/tombstoned)    → re-create under a new id
 *
 * NB: a full sync returns deleted rows as `deleted:true` tombstones, which
 * land in `cache.transactions`. A tombstone does NOT count as "present" —
 * we only treat a LIVE (deleted !== true) row as still in the cloud.
 *
 * After a successful push the caller MUST drop the snapshots for the
 * returned `oldId`s, otherwise the next push would create duplicates.
 */
export function buildResurrections(
  payloads: Record<string, ZenTransaction>,
  deletedIds: Iterable<string>,
  cache: ZenCache,
  stampSeconds: number,
  mintId: (oldId: string) => string = resurrectionId
): Resurrection[] {
  const deletedSet = new Set(deletedIds);
  const liveInCache = new Set(
    cache.transactions.filter((t) => !t.deleted).map((t) => String(t.id))
  );
  const out: Resurrection[] = [];
  for (const id of Object.keys(payloads)) {
    if (deletedSet.has(id)) continue;
    if (liveInCache.has(id)) continue; // original still live → nothing to do
    const newId = mintId(id);
    // Idempotency: if the deterministic copy is already live in the cloud,
    // the resurrection already landed — skip it (its snapshot gets pruned).
    if (liveInCache.has(newId)) continue;
    out.push({
      oldId: id,
      tx: {
        ...payloads[id],
        id: newId,
        deleted: false,
        changed: stampSeconds,
      },
    });
  }
  return out;
}

/**
 * Walk every pending edit and classify it as push-ready or skipped.
 * Pure function — no IO, no API calls; can be called from a preview UI.
 */
export function buildPushItems(
  edits: Record<string, TransactionEdit>,
  cache: ZenCache,
  stampSeconds: number = Math.floor(Date.now() / 1000),
  mintId: (oldId: string) => string = resurrectionId
): PushBuildResult {
  const transactionsById = new Map(cache.transactions.map((t) => [t.id, t]));
  const tagsByTitle = new Map<string, ZenTag[]>();
  for (const t of cache.tags) {
    if (t.archive) continue;
    const list = tagsByTitle.get(t.title) ?? [];
    list.push(t);
    tagsByTitle.set(t.title, list);
  }
  const tagsById = new Map(cache.tags.map((t) => [t.id, t]));
  const instrumentsBySymbol = new Map(
    cache.instruments.map((i) => [i.shortTitle, i])
  );
  const accountsById = new Map(cache.accounts.map((a) => [a.id, a]));
  // Reverse map for resolving an edited account NAME back to its id (account
  // changes push to cloud). Titles should be unique per user, but if two
  // collide prefer the non-archived one — that's the account the user means.
  const accountsByTitle = new Map<string, ZenAccount>();
  for (const a of cache.accounts) {
    const prev = accountsByTitle.get(a.title);
    if (!prev || (prev.archive && !a.archive)) accountsByTitle.set(a.title, a);
  }
  // Merchant dictionary indexed by title (case-insensitive trimmed key
  // for tolerance). `brand` edits get resolved to a merchant id through
  // this map. New brand titles (not in the dictionary) are refused —
  // creating a merchant entity is outside Phase 1 scope.
  const merchantsByTitle = new Map<string, string>();
  for (const m of cache.merchants) {
    const key = (m.title || "").trim().toLowerCase();
    if (!key) continue;
    // First-seen wins — Zenmoney shouldn't have duplicates, but be safe.
    if (!merchantsByTitle.has(key)) merchantsByTitle.set(key, m.id);
  }

  const toPush: PushItem[] = [];
  const recreates: Resurrection[] = [];
  const skipped: { id: string; reason: string }[] = [];

  // A built patch is either an in-place update (same id) or — when the user
  // changed the time-of-day (`created`) — a recreate (new id + delete old),
  // because Zenmoney silently drops a changed `created` on an existing row.
  // The comparison is against the cache `original.created`: every branch spreads
  // `...original` and only `applyCreatedAt` touches `zen.created`, so a diff here
  // means the user actually moved the time. All other edits (payee, category,
  // amount, legs…) ride along inside the recreated `tx` unchanged.
  const emit = (id: string, zen: ZenTransaction, original: ZenTransaction) => {
    if (zen.created !== original.created) {
      recreates.push({
        oldId: id,
        tx: { ...zen, id: mintId(id), changed: stampSeconds, deleted: false },
      });
    } else {
      toPush.push({ id, zen: { ...zen, changed: stampSeconds } });
    }
  };

  for (const [id, edit] of Object.entries(edits)) {
    const original = transactionsById.get(id);
    if (!original) {
      skipped.push({
        id,
        reason:
          "оригинал не найден в локальном кэше API (нужен ре-синк перед Push)",
      });
      continue;
    }
    if (original.deleted) {
      skipped.push({ id, reason: "транзакция помечена удалённой в облаке" });
      continue;
    }

    // Hard "no" for unsupported edit fields — but ONLY when the value
    // actually differs from what the forward mapper would have derived
    // from the original. The Edit-modal currently stashes every field
    // into the patch even when the user didn't touch it (so a payee-
    // only edit still carries `kind` / `account` / both legs unchanged).
    // Comparing against the original lets us treat those as no-ops.
    const orig = classifyOriginal(original, accountsById, tagsById);
    const targetKind: TxKind = (edit.kind as TxKind | undefined) ?? orig.kind;

    const origIsTransfer = orig.kind === "transfer";
    const targetIsTransfer = targetKind === "transfer";

    // ── Branch D (FIRST): debt / loan / credit operation ──────────────
    // An operation touching a loan/credit/debt account. Zenmoney models
    // these specially and REQUIRES a non-null `payee` (the counterparty).
    // The generic transfer branch rebuilds both legs and nulls
    // payee/merchant/tag → the server rejects it with «Debt transaction
    // should have "payee" field set». So we PATCH IN PLACE: keep the debt
    // structure (leg roles, amounts, tag, merchant) and only apply the
    // counterparty, account-id swaps, date and comment. Structural edits we
    // can't round-trip safely (type flip, amount, currency) are refused.
    const origIsDebt =
      DEBT_ACCOUNT_TYPES.has(accountsById.get(original.outcomeAccount)?.type || "") ||
      DEBT_ACCOUNT_TYPES.has(accountsById.get(original.incomeAccount)?.type || "");
    if (origIsDebt) {
      if (targetKind !== orig.kind) {
        skipped.push({
          id,
          reason:
            "смена типа у долговой операции пока не поддерживается — отредактируйте в приложении Дзена",
        });
        continue;
      }
      if (
        edit.amount !== undefined &&
        edit.amount !== (original.outcome || original.income)
      ) {
        skipped.push({
          id,
          reason:
            "смена суммы у долговой операции пока не поддерживается — отредактируйте в приложении Дзена",
        });
        continue;
      }
      const zen: ZenTransaction = { ...original };
      // Account-leg swaps (titles → ids). Keep the leg roles and refuse a
      // change of the account's currency (the debt leg structure stays).
      const swapLeg = (
        title: string | undefined,
        origTitle: string,
        leg: "outcome" | "income"
      ): string | null => {
        if (title === undefined || title === origTitle) return null;
        const a = accountsByTitle.get(title);
        if (!a) return `счёт "${title}" не найден в Дзен-мани`;
        const curInstr = leg === "outcome" ? original.outcomeInstrument : original.incomeInstrument;
        if (a.instrument !== curInstr) {
          return "смена счёта на счёт в другой валюте у долговой операции пока не поддерживается — отредактируйте в приложении Дзена";
        }
        if (leg === "outcome") {
          zen.outcomeAccount = a.id;
        } else {
          zen.incomeAccount = a.id;
        }
        return null;
      };
      const errOut = origIsTransfer ? swapLeg(edit.outcomeAccount, orig.outAcc, "outcome") : null;
      const errIn = origIsTransfer ? swapLeg(edit.incomeAccount, orig.inAcc, "income") : null;
      // Single-leg debt op (interest paid etc.): both legs share one account.
      const errSingle =
        !origIsTransfer && edit.account !== undefined && edit.account !== orig.account
          ? (() => {
              const a = accountsByTitle.get(edit.account!);
              if (!a) return `счёт "${edit.account}" не найден в Дзен-мани`;
              if (a.instrument !== original.outcomeInstrument)
                return "смена счёта на счёт в другой валюте у долговой операции пока не поддерживается — отредактируйте в приложении Дзена";
              zen.outcomeAccount = a.id;
              zen.incomeAccount = a.id;
              return null;
            })()
          : null;
      const accErr = errOut || errIn || errSingle;
      if (accErr) {
        skipped.push({ id, reason: accErr });
        continue;
      }
      applyDateComment(zen, edit);
      // Counterparty — the editor's «Получатель» maps to `brand`. A debt op
      // MUST keep a non-null payee, so prefer the explicit edit, else the
      // original's payee.
      let payeeStr = original.payee || "";
      if (edit.brand !== undefined) payeeStr = (edit.brand || "").trim();
      if (edit.payee !== undefined) payeeStr = (edit.payee || "").trim();
      if (!payeeStr) {
        skipped.push({
          id,
          reason: "у долговой операции должен быть указан плательщик (контрагент)",
        });
        continue;
      }
      zen.payee = payeeStr;
      const mId = merchantsByTitle.get(payeeStr.toLowerCase());
      zen.merchant = mId ?? original.merchant ?? null;
      emit(id, zen, original);
      continue;
    }

    // ── Branch A: target is a transfer ────────────────────────────────
    // Covers flip → transfer AND editing the accounts/amount of an
    // existing transfer (transfer → transfer). Both legs are rebuilt by
    // buildTransferTarget; single-currency only, FX is refused inside.
    if (targetIsTransfer) {
      const built = buildTransferTarget(
        original,
        edit,
        orig,
        accountsByTitle,
        origIsTransfer
      );
      if (built.skip) {
        skipped.push({ id, reason: built.skip });
        continue;
      }
      const zen = built.zen!;
      applyDateComment(zen, edit);
      emit(id, zen, original);
      continue;
    }

    // ── Branch B: transfer → single-leg (expense/income/refund) ───────
    // Collapse the two legs onto one account; FX refused inside.
    if (origIsTransfer) {
      const built = collapseTransfer(
        original,
        edit,
        orig,
        targetKind,
        accountsByTitle,
        tagsByTitle,
        tagsById
      );
      if (built.skip) {
        skipped.push({ id, reason: built.skip });
        continue;
      }
      const zen = built.zen!;
      applyDateComment(zen, edit);
      emit(id, zen, original);
      continue;
    }

    // ── Branch C: neither side is a transfer (expense ↔ income ↔ refund)
    // Single-leg, same-account flips: the money moves between the income
    // and outcome legs of the SAME account, or (income↔refund) stays put
    // and only the category flavour differs.
    const origLeg: "income" | "outcome" =
      orig.kind === "expense" ? "outcome" : "income";
    const targetLeg: "income" | "outcome" =
      targetKind === "expense" ? "outcome" : "income";

    // Refuse synthetic-category edits — Zen has no tag with that name.
    if (edit.category && SYNTHETIC_CATEGORIES.has(edit.category)) {
      skipped.push({
        id,
        reason: `категория "${edit.category}" — локальный ярлык, в Дзен-мани такого тега нет`,
      });
      continue;
    }

    // ── Build the patched ZenTransaction ──────────────────────────────
    const zen: ZenTransaction = { ...original };

    // Apply a kind flip by moving the money between legs of the SAME
    // account. The account ids stay as-is (both already point to the same
    // account); we move the amount, the instrument and the bank id onto the
    // target leg and zero the source leg. For an FX row we also carry the
    // operational pair (opOutcome/opOutcomeInstrument — the foreign-currency
    // side) so a "spent $10 from a RUB card" row keeps its $10 when flipped
    // to income. For a plain row the op fields are 0/null and move as no-ops.
    // income↔refund don't move legs (origLeg === targetLeg) — only the
    // category flavour differs, handled by the category edit below.
    if (targetKind !== orig.kind && origLeg !== targetLeg) {
      if (targetLeg === "income") {
        zen.income = original.outcome;
        zen.incomeInstrument = original.outcomeInstrument;
        zen.incomeBankID = original.outcomeBankID;
        zen.opIncome = original.opOutcome;
        zen.opIncomeInstrument = original.opOutcomeInstrument;
        zen.outcome = 0;
        zen.outcomeBankID = null;
        zen.opOutcome = 0;
        zen.opOutcomeInstrument = null;
      } else {
        zen.outcome = original.income;
        zen.outcomeInstrument = original.incomeInstrument;
        zen.outcomeBankID = original.incomeBankID;
        zen.opOutcome = original.opIncome;
        zen.opOutcomeInstrument = original.opIncomeInstrument;
        zen.income = 0;
        zen.incomeBankID = null;
        zen.opIncome = 0;
        zen.opIncomeInstrument = null;
      }
    }

    if (edit.date !== undefined) {
      // We only accept ISO YYYY-MM-DD here — the EditTransactionModal
      // already guards on this, but be defensive in case of stale data.
      if (/^\d{4}-\d{2}-\d{2}$/.test(edit.date)) {
        zen.date = edit.date;
      }
    }
    applyCreatedAt(zen, edit);
    if (edit.payee !== undefined) {
      zen.payee = edit.payee || null;
    }
    if (edit.comment !== undefined) {
      zen.comment = edit.comment || null;
    }

    // Brand handling. Two paths:
    //   1) The user picked a known brand (exists in the merchant
    //      dictionary) → set `merchant` to its id. Leave `payee`
    //      alone so the bank's original printout is preserved.
    //   2) The user typed a free-text name not in the dictionary
    //      → store it on the `payee` field (Zenmoney's free-text
    //      counterparty) and clear `merchant`. This avoids
    //      creating phantom merchant entities and matches what the
    //      mobile app does for unmatched bank lines.
    if (edit.brand !== undefined) {
      const wanted = (edit.brand || "").trim();
      if (!wanted) {
        // User cleared the field entirely → drop the merchant ref
        // and the free-text payee. (Leaving payee would surface
        // the bank's raw text again — usually not what "clear"
        // means.)
        zen.merchant = null;
        zen.payee = null;
      } else {
        const merchantId = merchantsByTitle.get(wanted.toLowerCase());
        if (merchantId) {
          zen.merchant = merchantId;
          // Known brand: keep zen.payee untouched (bank's original).
        } else {
          // Free-text fallback. This is intentional — see the
          // brand-handling block in the file-top JSDoc.
          zen.merchant = null;
          zen.payee = wanted;
        }
      }
    }

    // Amount + currency go on `targetLeg` — the leg that holds the money
    // after any kind flip (for unchanged rows targetLeg === the original
    // non-zero leg, so this matches the old behaviour). This runs AFTER
    // the leg-move above, so an edited amount overrides the moved value.
    if (edit.amount !== undefined) {
      if (targetLeg === "outcome") zen.outcome = edit.amount;
      else zen.income = edit.amount;
    }

    if (edit.currency !== undefined) {
      const instr = instrumentsBySymbol.get(edit.currency);
      if (instr) {
        if (targetLeg === "outcome") zen.outcomeInstrument = instr.id;
        else zen.incomeInstrument = instr.id;
      } else {
        skipped.push({
          id,
          reason: `валюта "${edit.currency}" не найдена в инструментах Дзен-мани`,
        });
        continue;
      }
    }

    if (edit.category !== undefined) {
      if (edit.category === NO_CATEGORY || edit.category === "") {
        // «Без категории» = no tag. Zenmoney has no uncategorized tag, so a
        // clear is simply `tag: null` — never a lookup (which would 404).
        zen.tag = null;
      } else {
        const resolved = resolveTagId(
          edit.category,
          edit.subcategory ?? null,
          tagsByTitle,
          tagsById
        );
        if (!resolved) {
          skipped.push({
            id,
            reason: `категория "${edit.category}"${edit.subcategory ? ` / "${edit.subcategory}"` : ""} не найдена в тегах Дзен-мани`,
          });
          continue;
        }
        zen.tag = [resolved];
      }
    } else if (edit.subcategory !== undefined && original.tag?.[0]) {
      // The user changed only the subcategory. Try to find a sibling tag
      // with the same parent. If we can't, skip — better than silently
      // dropping the subcategory change.
      const parentTagId = original.tag[0];
      const parentTag = tagsById.get(parentTagId);
      const parentTitle = parentTag?.parent
        ? tagsById.get(parentTag.parent)?.title || parentTag.title
        : parentTag?.title;
      const resolved = parentTitle
        ? resolveTagId(parentTitle, edit.subcategory, tagsByTitle, tagsById)
        : null;
      if (!resolved) {
        skipped.push({
          id,
          reason: `подкатегория "${edit.subcategory}" не найдена под текущим родителем`,
        });
        continue;
      }
      zen.tag = [resolved];
    }

    // Account change (non-transfer rows). Runs last so the effective leg
    // instrument already reflects any kind-flip and currency edit above —
    // that keeps account+kind and account+currency combos correct.
    if (edit.account !== undefined && edit.account !== orig.account) {
      const newAcc = accountsByTitle.get(edit.account);
      if (!newAcc) {
        skipped.push({ id, reason: `счёт "${edit.account}" не найден в Дзен-мани` });
        continue;
      }
      const effInstr =
        targetLeg === "outcome" ? zen.outcomeInstrument : zen.incomeInstrument;
      if (newAcc.instrument !== effInstr) {
        // Cross-currency move → the row becomes an FX operation: the sum on
        // the leg is now in the NEW account's currency (edit.amount), while
        // the ORIGINAL sum/currency becomes the operational (op) side. We
        // never invent a rate — the user must supply the new-currency amount.
        if ((original.opOutcome || 0) > 0 || (original.opIncome || 0) > 0) {
          skipped.push({
            id,
            reason:
              "перенос мультивалютной (FX) операции на счёт другой валюты пока не поддерживается — отредактируйте в приложении",
          });
          continue;
        }
        if (edit.amount === undefined) {
          skipped.push({
            id,
            reason:
              "перенос на счёт в другой валюте: укажите сумму в валюте нового счёта — отредактируйте в приложении",
          });
          continue;
        }
        const origAmt =
          targetLeg === "outcome" ? original.outcome : original.income;
        const origInstr =
          targetLeg === "outcome"
            ? original.outcomeInstrument
            : original.incomeInstrument;
        if (targetLeg === "outcome") {
          zen.outcomeInstrument = newAcc.instrument;
          zen.opOutcome = origAmt;
          zen.opOutcomeInstrument = origInstr;
          zen.opIncome = 0;
          zen.opIncomeInstrument = null;
        } else {
          zen.incomeInstrument = newAcc.instrument;
          zen.opIncome = origAmt;
          zen.opIncomeInstrument = origInstr;
          zen.opOutcome = 0;
          zen.opOutcomeInstrument = null;
        }
      }
      // Non-transfer invariant: both legs point at the same account.
      zen.outcomeAccount = newAcc.id;
      zen.incomeAccount = newAcc.id;
    }

    // Server uses `changed` for last-write-wins conflict resolution.
    // Setting it to "now" ensures our edit wins over anything older on
    // the server. (Conflicts where the cloud changed since our last sync
    // are caught pre-push by detectConflicts; see useZenmoneyStore.)
    // A time-of-day change routes to a recreate instead (see `emit`).
    emit(id, zen, original);
  }

  return { toPush, recreates, skipped };
}

/**
 * Detect edits that would clobber a newer cloud version. Compares the
 * `changed` timestamp we last synced (in `cache`) against a FRESH cloud
 * diff fetched just before pushing. An edited id whose cloud `changed`
 * advanced since our sync is a conflict — pushing it would overwrite a
 * change made elsewhere (e.g. the phone app). Pure: callers fetch the
 * diff and apply it afterwards.
 *
 * @param editedIds ids of transactions with a pending local edit
 * @param cache     the PRE-merge cache (its `changed` = value at last sync)
 * @param fresh     transactions from a fresh `fetchDiff` since last sync
 * @returns set of ids that changed in the cloud since we synced
 */
export function detectConflicts(
  editedIds: string[],
  cache: ZenCache,
  fresh: ZenTransaction[]
): Set<string> {
  const cached = new Map(cache.transactions.map((t) => [t.id, t.changed ?? 0]));
  const freshChanged = new Map(fresh.map((t) => [t.id, t.changed ?? 0]));
  const out = new Set<string>();
  for (const id of editedIds) {
    const f = freshChanged.get(id);
    if (f !== undefined && f > (cached.get(id) ?? 0)) out.add(id);
  }
  return out;
}

/**
 * Look up a tag id by category name (and optional subcategory).
 *
 *   • no subcategory       → exact title match (top-level or any depth)
 *   • with subcategory     → child whose own title === subcategory AND
 *                            whose parent's title === category
 *
 * Returns the tag id, or null if no match.
 */
function resolveTagId(
  category: string,
  subcategory: string | null,
  tagsByTitle: Map<string, ZenTag[]>,
  tagsById: Map<string, ZenTag>
): string | null {
  if (!subcategory) {
    // Prefer a top-level tag (no parent) when there's ambiguity, falling
    // back to any match. Zenmoney rarely has two tags with the same
    // title in different branches, but we want to be deterministic.
    const candidates = tagsByTitle.get(category) ?? [];
    if (candidates.length === 0) return null;
    const topLevel = candidates.find((t) => !t.parent);
    return (topLevel ?? candidates[0]).id;
  }
  // Subcategory present — look for a child whose parent has the right title.
  const subs = tagsByTitle.get(subcategory) ?? [];
  for (const sub of subs) {
    if (!sub.parent) continue;
    const parent = tagsById.get(sub.parent);
    if (parent?.title === category) return sub.id;
  }
  return null;
}

/** A fresh UUID for a locally-created transaction. Thin wrapper around
 *  `crypto.randomUUID()` so the create flow can inject a stable id in tests. */
export function newDraftId(): string {
  return crypto.randomUUID();
}

/** User-supplied fields for a brand-new transaction (create flow). Mirrors
 *  the EditTransactionModal state, but for a row that has no original. */
export interface DraftFields {
  /** Pre-generated UUID (see `newDraftId`); injected for testability. */
  id: string;
  kind: TxKind;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Main-leg amount, in the source account's own currency. */
  amount: number;
  /** Primary account title: source for expense/transfer, destination for
   *  income/refund. For a transfer, `incomeAccount` names the destination. */
  account: string;
  /** Transfer destination account title (transfer only). */
  incomeAccount?: string;
  /** Destination-leg amount for a cross-currency transfer (in the
   *  destination account's currency). Ignored when both legs share a
   *  currency (income mirrors `amount`). */
  incomeAmount?: number;
  /** Operation timestamp (unix seconds). When set, becomes the draft's
   *  `created` (the time-of-day); otherwise the build stamp (≈ now) is used.
   *  `changed` always stays at the build stamp so sync ordering is correct. */
  createdSeconds?: number;
  /** Category / subcategory for expense/income/refund (not transfer). */
  category?: string;
  subcategory?: string | null;
  /** Brand-or-free-text counterparty. Resolved to a merchant id when it
   *  matches the dictionary, else stored as a free-text payee. */
  payee?: string;
  comment?: string;
}

export type DraftBuildResult =
  | { zen: ZenTransaction; skip?: undefined }
  | { zen?: undefined; skip: string };

/**
 * Build a complete `ZenTransaction` for a brand-new (draft) operation from
 * the user's form fields, resolving accounts / instruments / tags / merchants
 * against the live cache. Pure — no IO. Returns `{ skip }` with a
 * human-readable reason when a required field can't be resolved.
 *
 * Single-leg (expense/income/refund): both legs point at the same account,
 * amount in that account's own currency. Transfer: two accounts; for a
 * cross-currency transfer the user supplies both leg amounts (we never
 * invent a rate). The forward mapper re-derives kind/«Перевод»/«Долг» from
 * the legs, so we don't set a tag on transfers.
 */
export function buildDraftTransaction(
  fields: DraftFields,
  cache: ZenCache,
  stampSeconds: number
): DraftBuildResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
    return { skip: "некорректная дата" };
  }
  if (!(fields.amount > 0)) {
    return { skip: "сумма должна быть больше нуля" };
  }

  const accountsByTitle = new Map<string, ZenAccount>();
  for (const a of cache.accounts) {
    const prev = accountsByTitle.get(a.title);
    if (!prev || (prev.archive && !a.archive)) accountsByTitle.set(a.title, a);
  }
  const tagsByTitle = new Map<string, ZenTag[]>();
  for (const t of cache.tags) {
    if (t.archive) continue;
    const list = tagsByTitle.get(t.title) ?? [];
    list.push(t);
    tagsByTitle.set(t.title, list);
  }
  const tagsById = new Map(cache.tags.map((t) => [t.id, t]));
  const merchantsByTitle = new Map<string, string>();
  for (const m of cache.merchants) {
    const key = (m.title || "").trim().toLowerCase();
    if (key && !merchantsByTitle.has(key)) merchantsByTitle.set(key, m.id);
  }

  const user = cache.user[0]?.id;
  if (user == null) return { skip: "нет данных пользователя в кэше" };

  // Base shell — every field present, Zenmoney-safe defaults.
  const zen: ZenTransaction = {
    id: fields.id,
    user,
    date: fields.date,
    income: 0,
    outcome: 0,
    changed: stampSeconds,
    incomeInstrument: 0,
    outcomeInstrument: 0,
    created: fields.createdSeconds ?? stampSeconds,
    originalPayee: null,
    deleted: false,
    viewed: true,
    hold: null,
    qrCode: null,
    source: null,
    incomeAccount: "",
    outcomeAccount: "",
    tag: null,
    comment: fields.comment ? fields.comment : null,
    payee: null,
    opIncome: null,
    opOutcome: null,
    opIncomeInstrument: null,
    opOutcomeInstrument: null,
    latitude: null,
    longitude: null,
    merchant: null,
    incomeBankID: null,
    outcomeBankID: null,
    reminderMarker: null,
  };

  if (fields.kind === "transfer") {
    const src = accountsByTitle.get(fields.account);
    const dst = fields.incomeAccount
      ? accountsByTitle.get(fields.incomeAccount)
      : undefined;
    if (!src) return { skip: `счёт "${fields.account}" не найден` };
    if (!dst) {
      return { skip: `счёт зачисления "${fields.incomeAccount ?? ""}" не найден` };
    }
    if (src.id === dst.id) return { skip: "счета перевода совпадают" };
    const sameCurrency = src.instrument === dst.instrument;
    const incomeAmount = sameCurrency ? fields.amount : fields.incomeAmount;
    if (!sameCurrency && !(incomeAmount! > 0)) {
      return { skip: "укажите сумму зачисления для перевода в другой валюте" };
    }
    zen.outcomeAccount = src.id;
    zen.outcomeInstrument = src.instrument;
    zen.outcome = fields.amount;
    zen.incomeAccount = dst.id;
    zen.incomeInstrument = dst.instrument;
    zen.income = incomeAmount!;
  } else {
    // Single-leg: expense leaves the account, income/refund lands in it.
    const acc = accountsByTitle.get(fields.account);
    if (!acc) return { skip: `счёт "${fields.account}" не найден` };
    zen.outcomeAccount = acc.id;
    zen.incomeAccount = acc.id;
    zen.outcomeInstrument = acc.instrument;
    zen.incomeInstrument = acc.instrument;
    if (fields.kind === "expense") {
      zen.outcome = fields.amount;
    } else {
      zen.income = fields.amount;
    }

    // Pick a category, or «Без категории» for a tag-less operation.
    const category = (fields.category || "").trim();
    if (!category) return { skip: "укажите категорию" };
    if (category !== NO_CATEGORY) {
      if (SYNTHETIC_CATEGORIES.has(category)) {
        return { skip: `категория "${category}" — локальный ярлык, тега в Дзен-мани нет` };
      }
      const tagId = resolveTagId(
        category,
        fields.subcategory?.trim() || null,
        tagsByTitle,
        tagsById
      );
      if (!tagId) {
        return {
          skip: `категория "${category}"${fields.subcategory ? ` / "${fields.subcategory}"` : ""} не найдена в тегах Дзен-мани`,
        };
      }
      zen.tag = [tagId];
    }
    // «Без категории» → leave zen.tag = null (an uncategorized operation).
  }

  // Counterparty. A DEBT op (one leg is a debt-type account) MUST keep a
  // non-null `payee` — Zenmoney rejects it otherwise — so we always write
  // payee (and link the merchant too when the name is known). For a normal
  // op the usual rule applies: known brand → merchant id, else free-text payee.
  const accById = new Map(cache.accounts.map((a) => [a.id, a]));
  const isDebtDraft =
    DEBT_ACCOUNT_TYPES.has(accById.get(zen.outcomeAccount)?.type || "") ||
    DEBT_ACCOUNT_TYPES.has(accById.get(zen.incomeAccount)?.type || "");
  const counterparty = (fields.payee || "").trim();
  if (isDebtDraft && !counterparty) {
    return { skip: "у долговой операции укажите контрагента (плательщика)" };
  }
  if (counterparty) {
    const merchantId = merchantsByTitle.get(counterparty.toLowerCase());
    if (isDebtDraft) {
      zen.payee = counterparty;
      if (merchantId) zen.merchant = merchantId;
    } else if (merchantId) {
      zen.merchant = merchantId;
    } else {
      zen.payee = counterparty;
    }
  }

  return { zen };
}

export interface DraftPushResult {
  /** Drafts whose references all resolve — ready to send. */
  ready: ZenTransaction[];
  /** Drafts we couldn't send, with a reason (stale cache, id clash). */
  skipped: { id: string; reason: string }[];
}

/**
 * Validate locally-created drafts against the current cache right before a
 * push. A draft is a full ZenTransaction, but the cache may have moved on
 * since it was built (an account/tag got archived elsewhere), so we re-check
 * that every referenced account / instrument / tag still exists and that the
 * fresh UUID isn't somehow already live. Re-stamps `changed` to now so the
 * create wins last-write-wins. Pure — no IO.
 */
export function validateDrafts(
  drafts: Record<string, ZenTransaction>,
  cache: ZenCache,
  stampSeconds: number
): DraftPushResult {
  const accountIds = new Set(cache.accounts.map((a) => a.id));
  const instrumentIds = new Set(cache.instruments.map((i) => i.id));
  const tagIds = new Set(cache.tags.map((t) => t.id));
  const liveTxIds = new Set(
    cache.transactions.filter((t) => !t.deleted).map((t) => String(t.id))
  );
  const ready: ZenTransaction[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const [id, zt] of Object.entries(drafts)) {
    if (liveTxIds.has(id)) {
      // Already echoed back from a prior push — the store cleanup just
      // hasn't run yet. Skip silently-ish (caller drops it from the store).
      skipped.push({ id, reason: "операция уже есть в облаке" });
      continue;
    }
    if (!accountIds.has(zt.outcomeAccount) || !accountIds.has(zt.incomeAccount)) {
      skipped.push({ id, reason: "счёт операции не найден в облаке (нужен ре-синк)" });
      continue;
    }
    if (
      !instrumentIds.has(zt.outcomeInstrument) ||
      !instrumentIds.has(zt.incomeInstrument)
    ) {
      skipped.push({ id, reason: "валюта операции не найдена в облаке" });
      continue;
    }
    if (zt.tag && zt.tag.some((t) => !tagIds.has(t))) {
      skipped.push({ id, reason: "категория операции не найдена в облаке" });
      continue;
    }
    ready.push({ ...zt, changed: stampSeconds });
  }
  return { ready, skipped };
}

/**
 * Send the prepared push batch. Returns the server's response so the
 * caller can merge the canonical `changed` timestamps back into cache.
 */
export async function sendPush(
  token: string,
  serverTimestamp: number,
  items: PushItem[],
  deletions: ZenDeletion[] = [],
  resurrections: ZenTransaction[] = [],
  tags: ZenTag[] = [],
  budgets: ZenBudget[] = [],
  merchants: ZenMerchant[] = []
): Promise<ZenDiffResponse> {
  const payload: PushPayload = {
    transaction: [...items.map((i) => i.zen), ...resurrections],
    ...(deletions.length > 0 ? { deletion: deletions } : {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(budgets.length > 0 ? { budget: budgets } : {}),
    ...(merchants.length > 0 ? { merchant: merchants } : {}),
  };
  // Debug aid: surface the full payload in DevTools so it's easy to
  // verify which fields actually landed in the request body. Disabled
  // automatically in production (Vite sets `import.meta.env.PROD`).
  if (!import.meta.env.PROD) {
    console.groupCollapsed(
      `[Zenmoney push] sending ${items.length} transaction(s)`
    );
    for (const item of items) {
      console.log(item.id, {
        payee: item.zen.payee,
        merchant: item.zen.merchant,
        comment: item.zen.comment,
        date: item.zen.date,
        outcome: item.zen.outcome,
        income: item.zen.income,
        tag: item.zen.tag,
        changed: item.zen.changed,
      });
    }
    console.groupEnd();
  }
  return pushDiff(token, serverTimestamp, payload);
}

/** A pending patch onto a tag — only the touched fields are present. Mirrors
 *  `TagEdit` in useTagEditsStore without importing the store into the pure lib. */
export interface TagEditPatch {
  title?: string;
  parent?: string | null;
  showIncome?: boolean;
  showOutcome?: boolean;
  icon?: string | null;
  color?: number | null;
  required?: boolean | null;
}

/**
 * Build the `ZenTag[]` payload for pending category-tag edits (title, parent,
 * type, icon, colour, «обязательная»). Same strategy as transactions: take the
 * ORIGINAL tag from cache and override ONLY the fields the patch carries, so we
 * never blank out fields we don't model locally (budget*, picture…).
 *
 * Edits that map to no cached tag (needs a re-sync) or are a net no-op (every
 * present field already matches the cache) are skipped — the former reported in
 * `skipped`, the latter silently dropped.
 */
export function buildTagPush(
  edits: Record<string, TagEditPatch>,
  cacheTags: ZenTag[],
  stampSeconds: number
): { tags: ZenTag[]; skipped: { id: string; reason: string }[] } {
  const byId = new Map(cacheTags.map((t) => [t.id, t]));
  const tags: ZenTag[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const [id, edit] of Object.entries(edits)) {
    const orig = byId.get(id);
    if (!orig) {
      skipped.push({ id, reason: "категория не найдена в кэше (нужна синхронизация)" });
      continue;
    }
    const next: ZenTag = { ...orig };
    let changed = false;
    // `null` is a meaningful value for required/color/parent, so compare with
    // ?? null to treat absent-vs-null as equal, and only mark changed on a real
    // difference. Fields absent from the patch are left at the cached value.
    if (edit.title !== undefined && edit.title !== orig.title) {
      next.title = edit.title;
      changed = true;
    }
    if (edit.parent !== undefined && (edit.parent ?? null) !== (orig.parent ?? null)) {
      next.parent = edit.parent;
      changed = true;
    }
    if (edit.showIncome !== undefined && edit.showIncome !== orig.showIncome) {
      next.showIncome = edit.showIncome;
      changed = true;
    }
    if (edit.showOutcome !== undefined && edit.showOutcome !== orig.showOutcome) {
      next.showOutcome = edit.showOutcome;
      changed = true;
    }
    if (edit.icon !== undefined && (edit.icon ?? null) !== (orig.icon ?? null)) {
      next.icon = edit.icon;
      changed = true;
    }
    if (edit.color !== undefined && (edit.color ?? null) !== (orig.color ?? null)) {
      next.color = edit.color;
      changed = true;
    }
    if (edit.required !== undefined && (edit.required ?? null) !== (orig.required ?? null)) {
      next.required = edit.required;
      changed = true;
    }
    if (!changed) continue; // net no-op
    next.changed = stampSeconds;
    tags.push(next);
  }
  return { tags, skipped };
}

/** A locally-created category to be pushed as a brand-new Zenmoney tag. */
export interface NewCategoryDraft {
  id: string;
  title: string;
  parent: string | null;
  showIncome: boolean;
  showOutcome: boolean;
  icon: string | null;
  color: number | null;
  required: boolean | null;
}

/**
 * Build the `ZenTag[]` payload for locally-created categories — full new tags
 * with the client-minted uuid. `user` is the account's numeric id (taken from
 * any cached tag). Empty-titled drafts are skipped defensively. `budgetIncome`/
 * `budgetOutcome` mirror the type so the new tag behaves like one made in Дзен.
 */
export function buildNewCategoriesPush(
  items: NewCategoryDraft[],
  user: number,
  stampSeconds: number
): ZenTag[] {
  const out: ZenTag[] = [];
  for (const c of items) {
    if (!c.title.trim()) continue;
    out.push({
      id: c.id,
      user,
      title: c.title.trim(),
      parent: c.parent,
      archive: false,
      showIncome: c.showIncome,
      showOutcome: c.showOutcome,
      budgetIncome: c.showIncome,
      budgetOutcome: c.showOutcome,
      required: c.required,
      icon: c.icon,
      picture: null,
      color: c.color,
      changed: stampSeconds,
    });
  }
  return out;
}

// ── Контрагенты (Zenmoney merchants) ─────────────────────────────────────────
// A merchant is a trivial 4-field dictionary entry {id, user, title, changed}.
// Creates mint a client-side uuid; renames take the cached row and override the
// title; deletions ride the generic `ZenDeletion` channel with object "merchant".

/** A locally-created counterparty to be pushed as a brand-new merchant. */
export interface NewCounterpartyDraft {
  id: string;
  title: string;
}

/**
 * Build the `ZenMerchant[]` payload for locally-created counterparties.
 * `user` is the account's numeric id (taken from any cached entity).
 * Empty-titled drafts are skipped defensively.
 */
export function buildNewMerchantsPush(
  items: NewCounterpartyDraft[],
  user: number,
  stampSeconds: number
): ZenMerchant[] {
  const out: ZenMerchant[] = [];
  for (const m of items) {
    if (!m.title.trim()) continue;
    out.push({ id: m.id, user, title: m.title.trim(), changed: stampSeconds });
  }
  return out;
}

/**
 * Build the `ZenMerchant[]` payload for renamed counterparties: take the
 * ORIGINAL cached merchant and override only its title, so we never blank out
 * fields we don't model. No-ops (title already matches) and unknown ids (need a
 * re-sync) are skipped — the latter reported in `skipped`.
 */
export function buildMerchantRenamePush(
  renames: Record<string, string>,
  cacheMerchants: ZenMerchant[],
  stampSeconds: number
): { merchants: ZenMerchant[]; skipped: { id: string; reason: string }[] } {
  const byId = new Map(cacheMerchants.map((m) => [m.id, m]));
  const merchants: ZenMerchant[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const [id, rawTitle] of Object.entries(renames)) {
    const orig = byId.get(id);
    if (!orig) {
      skipped.push({ id, reason: "контрагент не найден в кэше (нужна синхронизация)" });
      continue;
    }
    const title = rawTitle.trim();
    if (!title || title === orig.title) continue; // no-op
    merchants.push({ ...orig, title, changed: stampSeconds });
  }
  return { merchants, skipped };
}

/**
 * Build `ZenDeletion[]` for counterparties the user removed. Mirrors the
 * transaction deletion builder but stamps `object: "merchant"` — the cache
 * merge already drops deleted merchants from `cache.merchants`.
 *
 * Ids missing from the cache are skipped: nothing to delete server-side (the
 * row is already gone), so the local intent is satisfied.
 */
export function buildMerchantDeletions(
  ids: string[],
  cacheMerchants: ZenMerchant[],
  stampSeconds: number
): ZenDeletion[] {
  const byId = new Map(cacheMerchants.map((m) => [m.id, m]));
  const out: ZenDeletion[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) continue;
    out.push({ id, object: "merchant", user: m.user, stamp: stampSeconds });
  }
  return out;
}

/** Two counterparties that are really the same one: `id` is folded into
 *  `survivorId`, which keeps the operations. */
export interface MerchantMerge {
  id: string;
  survivorId: string;
}

/**
 * Build the payload that folds duplicate counterparties into one: every
 * operation pointing at `id` is re-pointed at `survivorId`, then `id` is
 * deleted.
 *
 * Re-pointing goes by merchant ID, not by title — duplicates share a title by
 * definition, so a title lookup could not tell the survivor from the copy.
 * Each operation is rebuilt from the ORIGINAL cached row with `merchant`
 * overridden, so nothing else on it moves.
 *
 * A merge whose survivor is itself being merged away is refused rather than
 * chased through the chain: one push, one hop, no surprises.
 */
export function buildMerchantMergePush(
  items: MerchantMerge[],
  cache: ZenCache,
  stampSeconds: number
): {
  transactions: ZenTransaction[];
  deletions: ZenDeletion[];
  skipped: { id: string; reason: string }[];
} {
  const byId = new Map(cache.merchants.map((m) => [m.id, m]));
  const transactions: ZenTransaction[] = [];
  const deletions: ZenDeletion[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const mergedAway = new Set(items.map((i) => i.id));
  /** dup id → survivor id, for the ones that passed validation. */
  const valid = new Map<string, string>();

  for (const { id, survivorId } of items) {
    const dup = byId.get(id);
    if (!dup) continue; // already gone server-side — intent satisfied
    if (id === survivorId) continue; // no-op
    if (!byId.get(survivorId)) {
      skipped.push({ id, reason: "контрагент-получатель не найден в кэше (нужна синхронизация)" });
      continue;
    }
    if (mergedAway.has(survivorId)) {
      skipped.push({ id, reason: "контрагент-получатель сам объединяется — сначала отправьте текущие правки" });
      continue;
    }
    valid.set(id, survivorId);
    deletions.push({ id, object: "merchant", user: dup.user, stamp: stampSeconds });
  }

  if (valid.size > 0) {
    for (const t of cache.transactions) {
      if (t.deleted || !t.merchant) continue;
      const survivor = valid.get(t.merchant);
      if (!survivor) continue;
      transactions.push({ ...t, merchant: survivor, changed: stampSeconds });
    }
  }

  return { transactions, deletions, skipped };
}

/** A category the user removed, and what happens to its operations. */
export interface TagDeletion {
  id: string;
  /** Category that inherits the operations, or null to leave them without one. */
  replacementId: string | null;
}

/**
 * Build the payload for deleting categories: operations tagged with a removed
 * category get re-tagged (or untagged), then the tags themselves are deleted.
 *
 * Zenmoney holds `tag` as an ARRAY, so a re-tag is a per-element substitution
 * with de-duplication — an operation already carrying the replacement must not
 * end up with it twice. An operation left with no tags gets `null`, which is
 * how Zenmoney spells «без категории».
 *
 * Refused (reported in `skipped`, nothing pushed for that id):
 *  • a category with subcategories that aren't being deleted in the same batch
 *    — deleting the parent alone would orphan them;
 *  • a replacement that is missing, or is itself being deleted.
 */
export function buildTagDeletionPush(
  items: TagDeletion[],
  cache: ZenCache,
  stampSeconds: number
): {
  transactions: ZenTransaction[];
  deletions: ZenDeletion[];
  skipped: { id: string; reason: string }[];
} {
  const byId = new Map(cache.tags.map((t) => [t.id, t]));
  const transactions: ZenTransaction[] = [];
  const deletions: ZenDeletion[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const doomed = new Set(items.map((i) => i.id));
  /** doomed tag id → replacement id (or null to just drop it). */
  const valid = new Map<string, string | null>();

  for (const { id, replacementId } of items) {
    const tag = byId.get(id);
    if (!tag) continue; // already gone server-side — intent satisfied

    const strandedChild = cache.tags.find(
      (t) => t.parent === id && !doomed.has(t.id)
    );
    if (strandedChild) {
      skipped.push({
        id,
        reason: `остались подкатегории («${strandedChild.title}») — удалите или перенесите их вместе с категорией`,
      });
      continue;
    }
    if (replacementId !== null) {
      if (!byId.get(replacementId)) {
        skipped.push({ id, reason: "категория-замена не найдена в кэше (нужна синхронизация)" });
        continue;
      }
      if (doomed.has(replacementId)) {
        skipped.push({ id, reason: "категория-замена сама удаляется — выберите другую" });
        continue;
      }
    }
    valid.set(id, replacementId);
    deletions.push({ id, object: "tag", user: tag.user, stamp: stampSeconds });
  }

  if (valid.size > 0) {
    for (const t of cache.transactions) {
      if (t.deleted || !t.tag || t.tag.length === 0) continue;
      if (!t.tag.some((id) => valid.has(id))) continue;
      const next: string[] = [];
      for (const id of t.tag) {
        if (!valid.has(id)) {
          if (!next.includes(id)) next.push(id);
          continue;
        }
        const replacement = valid.get(id)!;
        if (replacement && !next.includes(replacement)) next.push(replacement);
      }
      transactions.push({
        ...t,
        tag: next.length > 0 ? next : null,
        changed: stampSeconds,
      });
    }
  }

  return { transactions, deletions, skipped };
}

/** A pending budget/plan change, queued to push back to Zenmoney «Планы». */
export interface BudgetEdit {
  kind: "expense" | "income";
  category: string;
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
  /** How many pushes in a row skipped this edit (tag missing in cache / no
   *  userId). The queue auto-drops it once this hits the retry cap so a stale
   *  edit — its tag was deleted or renamed in Дзен, so it can never resolve —
   *  doesn't linger forever. A fresh (re-queued) edit carries no `skips`, so
   *  editing the cell again gives it a clean set of retries. */
  skips?: number;
}

/**
 * Pure core of the queue's skip-retry policy. For each id in `skippedIds` that
 * still exists, increment its `skips`; DROP the ones that reach `max`. Returns
 * the updated map, the dropped ids, and whether anything changed (so the caller
 * can skip a redundant persist). Ids not present are ignored.
 */
export function applyBudgetSkipBump(
  edits: Record<string, BudgetEdit>,
  skippedIds: string[],
  max: number
): { edits: Record<string, BudgetEdit>; dropped: string[]; changed: boolean } {
  const next = { ...edits };
  const dropped: string[] = [];
  let changed = false;
  for (const id of skippedIds) {
    const e = next[id];
    if (!e) continue;
    changed = true;
    const skips = (e.skips ?? 0) + 1;
    if (skips >= max) {
      delete next[id];
      dropped.push(id);
    } else {
      next[id] = { ...e, skips };
    }
  }
  return { edits: next, dropped, changed };
}

/** Stable id for a budget edit — (kind, category, subcategory, month). */
export function budgetEditId(e: {
  kind: string;
  category: string;
  subcategory: string | null;
  ym: string;
}): string {
  return [e.kind, e.category, e.subcategory ?? "", e.ym].join("\u0000");
}

/**
 * Build the `ZenBudget[]` payload for pending plan changes. A budget sits on
 * exactly one tag and has no surface id — it's keyed by (tag, date), so we
 * resolve (category, subcategory) → tag id and upsert that cell.
 *
 * To avoid clobbering, we start from the EXISTING cached budget for that
 * (tag, month) and override only the edited side (outcome for expense / income
 * for income).
 *
 * CRITICAL — we set the edited side's *Lock to `true`. Per the Zenmoney API:
 * with `incomeLock: false` the effective budget is `income` PLUS every planned
 * («напоминания») operation's income that month, so pushing our absolute plan
 * into an unlocked cell makes Zenmoney ADD the scheduled amount on top and the
 * budget balloons (this was the «суммы стали слишком большие» bug — a 305k plan
 * showed as 450k). Locking makes `income`/`outcome` the EXACT budget.
 *
 * Edits whose tag isn't in the cache (need a re-sync) are reported in
 * `skipped`; no-ops (cloud already equals the edit AS A LOCKED value) are
 * dropped silently.
 */
export function buildBudgetPush(
  edits: BudgetEdit[],
  cacheBudgets: ZenBudget[],
  cacheTags: ZenTag[],
  stampSeconds: number
): { budgets: ZenBudget[]; skipped: { id: string; reason: string }[] } {
  const budgets: ZenBudget[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const userId = cacheBudgets[0]?.user ?? cacheTags[0]?.user ?? null;
  const byId = new Map(cacheTags.map((t) => [t.id, t]));
  // Reverse name→tag lookups: top-level by title, sub by "parentTitle\0subTitle".
  const topByTitle = new Map<string, ZenTag>();
  const subByPath = new Map<string, ZenTag>();
  for (const t of cacheTags) {
    if (!t.parent) {
      topByTitle.set(t.title, t);
    } else {
      const p = byId.get(t.parent);
      if (p) subByPath.set([p.title, t.title].join("\u0000"), t);
    }
  }
  const existingByKey = new Map(
    cacheBudgets.map((b) => [[b.tag, b.date].join("\u0000"), b])
  );

  for (const e of edits) {
    const id = budgetEditId(e);
    const tag = e.subcategory
      ? subByPath.get([e.category, e.subcategory].join("\u0000"))
      : topByTitle.get(e.category);
    if (!tag) {
      skipped.push({ id, reason: "тег не найден в кэше (нужна синхронизация)" });
      continue;
    }
    if (userId == null) {
      skipped.push({ id, reason: "нет userId в кэше" });
      continue;
    }
    const date = `${e.ym}-01`;
    const existing = existingByKey.get([tag.id, date].join("\u0000"));
    // No-op: cloud already equals this edit AS A LOCKED (exact) budget. An
    // unlocked cell whose number matches is NOT the same effective plan — the
    // planned operations still get added — so it must be re-pushed as locked.
    if (existing) {
      const same =
        e.kind === "expense"
          ? existing.outcomeLock === true && existing.outcome === e.amount
          : existing.incomeLock === true && existing.income === e.amount;
      if (same) continue;
    }
    const base: ZenBudget = existing
      ? { ...existing }
      : {
          user: userId,
          changed: stampSeconds,
          date,
          tag: tag.id,
          income: 0,
          incomeLock: false,
          outcome: 0,
          outcomeLock: false,
          isIncomeForecast: false,
          isOutcomeForecast: false,
        };
    const next: ZenBudget = { ...base, user: userId, date, tag: tag.id, changed: stampSeconds };
    if (e.kind === "expense") {
      next.outcome = e.amount;
      next.outcomeLock = true; // exact budget — Zenmoney must NOT add planned ops
      next.isOutcomeForecast = false;
    } else {
      next.income = e.amount;
      next.incomeLock = true; // exact budget — Zenmoney must NOT add planned ops
      next.isIncomeForecast = false;
    }
    budgets.push(next);
  }
  return { budgets, skipped };
}
