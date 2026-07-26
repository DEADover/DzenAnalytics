import { describe, it, expect } from "vitest";
import {
  buildDeletions,
  buildDraftTransaction,
  buildPushItems,
  buildResurrections,
  buildTagPush,
  buildNewCategoriesPush,
  buildNewMerchantsPush,
  buildMerchantRenamePush,
  buildMerchantDeletions,
  buildMerchantMergePush,
  buildTagDeletionPush,
  detectConflicts,
  resurrectionId,
  validateDrafts,
  type DraftFields,
} from "./zenmoneyPush";
import { NO_CATEGORY } from "./zenmoneyMap";
import type { ZenCache } from "./zenmoneyCache";
import type { ZenAccount, ZenInstrument, ZenTag, ZenTransaction } from "./zenmoney";
import type { TransactionEdit } from "../store/useEditsStore";

/** Minimal ZenTransaction — buildDeletions only reads id/user/deleted. */
function zt(id: string, user: number, deleted = false): ZenTransaction {
  return { id, user, deleted } as ZenTransaction;
}

function cache(transactions: ZenTransaction[]): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [],
    accounts: [],
    tags: [],
    merchants: [],
    transactions,
    user: [],
  };
}

describe("buildDeletions", () => {
  it("emits a deletion for an id present (and live) in the cache", () => {
    const c = cache([zt("a", 42)]);
    const out = buildDeletions(["a"], c);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", object: "transaction", user: 42 });
    expect(typeof out[0].stamp).toBe("number");
  });

  it("skips ids that aren't in the cloud cache", () => {
    const c = cache([zt("a", 42)]);
    expect(buildDeletions(["missing"], c)).toEqual([]);
  });

  it("skips transactions already marked deleted (tombstones)", () => {
    const c = cache([zt("a", 42, true)]);
    expect(buildDeletions(["a"], c)).toEqual([]);
  });

  it("carries each transaction's own user id", () => {
    const c = cache([zt("a", 1), zt("b", 2)]);
    const out = buildDeletions(["a", "b"], c);
    expect(out.map((d) => d.user).sort()).toEqual([1, 2]);
  });

  it("returns an empty array for no deleted ids", () => {
    expect(buildDeletions([], cache([zt("a", 1)]))).toEqual([]);
  });
});

describe("buildResurrections", () => {
  const payloads = (txs: ZenTransaction[]) =>
    Object.fromEntries(txs.map((t) => [t.id, t]));
  const mint = () => "NEW";

  it("re-creates a restored, purged payload under a NEW id (deleted:false, fresh changed)", () => {
    const snap = zt("a", 7, true); // snapshot may carry deleted=true
    const out = buildResurrections(payloads([snap]), [], cache([]), 1234, mint);
    expect(out).toHaveLength(1);
    expect(out[0].oldId).toBe("a");
    expect(out[0].tx).toMatchObject({
      id: "NEW",
      user: 7,
      deleted: false,
      changed: 1234,
    });
  });

  it("skips ids still hidden locally (in deletedIds)", () => {
    const snap = zt("a", 7);
    expect(buildResurrections(payloads([snap]), ["a"], cache([]), 1, mint)).toEqual([]);
  });

  it("skips ids the cloud still has LIVE (deletion never pushed)", () => {
    const snap = zt("a", 7);
    expect(
      buildResurrections(payloads([snap]), [], cache([zt("a", 7)]), 1, mint)
    ).toEqual([]);
  });

  it("resurrects an id that's in cache only as a deleted tombstone", () => {
    const snap = zt("a", 7);
    // full sync returns the deleted row as deleted:true → must NOT count
    // as 'present' in the cloud
    const out = buildResurrections(
      payloads([snap]),
      [],
      cache([zt("a", 7, true)]),
      1,
      mint
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ oldId: "a", tx: { id: "NEW", deleted: false } });
  });

  it("returns an empty array when there are no snapshots", () => {
    expect(buildResurrections({}, [], cache([]), 1, mint)).toEqual([]);
  });

  it("mints a distinct new id per resurrection, preserving oldId", () => {
    const out = buildResurrections(
      payloads([zt("a", 1), zt("b", 1)]),
      [],
      cache([]),
      1,
      (oldId) => `new-${oldId}`
    );
    expect(out.map((r) => r.tx.id).sort()).toEqual(["new-a", "new-b"]);
    expect(out.map((r) => r.oldId).sort()).toEqual(["a", "b"]);
  });

  it("is idempotent: skips when the deterministic copy is already live", () => {
    // newId for "a" is "COPY"; it already exists live in the cloud → no dup
    const out = buildResurrections(
      payloads([zt("a", 1)]),
      [],
      cache([zt("COPY", 1)]),
      1,
      () => "COPY"
    );
    expect(out).toEqual([]);
  });

  it("default deterministic id: stable, uuid-shaped, differs from input", () => {
    const a = resurrectionId("4ae9985a-e80b-47ee-8a2b-1dcc6def84bf");
    const b = resurrectionId("4ae9985a-e80b-47ee-8a2b-1dcc6def84bf");
    expect(a).toBe(b); // deterministic
    expect(a).not.toBe("4ae9985a-e80b-47ee-8a2b-1dcc6def84bf");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(resurrectionId("other")).not.toBe(a); // different seed → different id
  });
});

// ── Kind-flip tests (Phase 2: expense ↔ income ↔ refund) ─────────────

const ACC = "acc-1";
/** A single-account, same-currency transaction in the shape Zenmoney
 *  returns. `outcome>0` → expense; `income>0` → income/refund. */
function fullTx(p: Partial<ZenTransaction>): ZenTransaction {
  return {
    id: "t1",
    user: 1,
    deleted: false,
    changed: 100,
    outcome: 0,
    income: 0,
    outcomeAccount: ACC,
    incomeAccount: ACC,
    outcomeInstrument: 2,
    incomeInstrument: 2,
    opOutcome: 0,
    opIncome: 0,
    outcomeBankID: null,
    incomeBankID: null,
    tag: null,
    ...p,
  } as ZenTransaction;
}

function flipCache(t: ZenTransaction): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [{ id: 2, shortTitle: "RUB" } as ZenInstrument],
    accounts: [{ id: ACC, title: "Карта" } as ZenAccount],
    tags: [],
    merchants: [],
    transactions: [t],
    user: [],
  };
}

function pushOne(t: ZenTransaction, edit: TransactionEdit) {
  return buildPushItems({ [t.id]: edit }, flipCache(t));
}

describe("buildPushItems — kind flips", () => {
  it("flips expense → income: amount moves to the income leg", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 500 }), { kind: "income" });
    expect(skipped).toHaveLength(0);
    expect(toPush).toHaveLength(1);
    expect(toPush[0].zen.income).toBe(500);
    expect(toPush[0].zen.outcome).toBe(0);
    expect(toPush[0].zen.incomeAccount).toBe(ACC);
  });

  it("flips income → expense: amount moves to the outcome leg", () => {
    const { toPush } = pushOne(fullTx({ income: 89 }), { kind: "expense" });
    expect(toPush[0].zen.outcome).toBe(89);
    expect(toPush[0].zen.income).toBe(0);
  });

  it("flips expense → refund onto the income leg", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 250 }), { kind: "refund" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.income).toBe(250);
    expect(toPush[0].zen.outcome).toBe(0);
  });

  it("does NOT touch legs when only the amount changes (no kind flip)", () => {
    const { toPush } = pushOne(fullTx({ outcome: 100 }), { amount: 150 });
    expect(toPush[0].zen.outcome).toBe(150);
    expect(toPush[0].zen.income).toBe(0);
  });

  it("refuses a flip to «transfer» with no second account (same account)", () => {
    // flipCache has a single account, so source === destination.
    const { toPush, skipped } = pushOne(fullTx({ outcome: 100 }), { kind: "transfer" });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/невозможен|тот же/i);
  });

  it("carries the op-amount when flipping an FX row (expense → income)", () => {
    // "spent $10 from a RUB card": outcome=900 RUB, opOutcome=10 USD (instr 3).
    const fx = fullTx({ outcome: 900, opOutcome: 10, opOutcomeInstrument: 3 });
    const { toPush, skipped } = pushOne(fx, { kind: "income" });
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.income).toBe(900);
    expect(z.incomeInstrument).toBe(2);
    expect(z.opIncome).toBe(10);
    expect(z.opIncomeInstrument).toBe(3);
    expect(z.outcome).toBe(0);
    expect(z.opOutcome).toBe(0);
    expect(z.opOutcomeInstrument).toBeNull();
  });

  it("carries the op-amount when flipping an FX row (income → expense)", () => {
    const fx = fullTx({ income: 900, opIncome: 10, opIncomeInstrument: 3 });
    const { toPush } = pushOne(fx, { kind: "expense" });
    const z = toPush[0].zen;
    expect(z.outcome).toBe(900);
    expect(z.opOutcome).toBe(10);
    expect(z.opOutcomeInstrument).toBe(3);
    expect(z.income).toBe(0);
    expect(z.opIncome).toBe(0);
  });

  it("does not falsely treat an ordinary expense (opOutcome: 0) as FX", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 100, opOutcome: 0 }), { kind: "income" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.income).toBe(100);
    expect(toPush[0].zen.opIncome).toBe(0);
  });
});

// Multi-account / multi-currency cache: Карта & Наличные are both RUB
// (instrument 2), Долларовый is USD (instrument 3).
function multiCache(t: ZenTransaction): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [
      { id: 2, shortTitle: "RUB" } as ZenInstrument,
      { id: 3, shortTitle: "USD" } as ZenInstrument,
    ],
    accounts: [
      { id: "acc-1", title: "Карта", instrument: 2 } as ZenAccount,
      { id: "acc-2", title: "Наличные", instrument: 2 } as ZenAccount,
      { id: "acc-3", title: "Долларовый", instrument: 3 } as ZenAccount,
    ],
    tags: [{ id: "tag-eda", title: "Еда" } as ZenTag],
    merchants: [],
    transactions: [t],
    user: [],
  };
}
const pushIn = (t: ZenTransaction, edit: TransactionEdit) =>
  buildPushItems({ [t.id]: edit }, multiCache(t));

/** A single-currency transfer (acc-1 → acc-2, both RUB / instrument 2). */
function transferTx(p: Partial<ZenTransaction> = {}): ZenTransaction {
  return {
    id: "t1",
    user: 1,
    deleted: false,
    changed: 100,
    outcome: 500,
    income: 500,
    outcomeAccount: "acc-1",
    incomeAccount: "acc-2",
    outcomeInstrument: 2,
    incomeInstrument: 2,
    opOutcome: 0,
    opIncome: 0,
    outcomeBankID: null,
    incomeBankID: null,
    tag: null,
    ...p,
  } as ZenTransaction;
}

describe("buildPushItems — account change", () => {
  it("moves both legs to the new same-currency account", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), { account: "Наличные" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.outcomeAccount).toBe("acc-2");
    expect(toPush[0].zen.incomeAccount).toBe("acc-2");
  });

  it("builds an FX row when moving to a different-currency account", () => {
    // RUB expense 500 → USD account, new sum 6 USD. Original 500 RUB becomes
    // the operational (op) side.
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      account: "Долларовый",
      amount: 6,
    });
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.outcome).toBe(6);
    expect(z.outcomeInstrument).toBe(3); // USD (new account)
    expect(z.outcomeAccount).toBe("acc-3");
    expect(z.opOutcome).toBe(500); // original sum
    expect(z.opOutcomeInstrument).toBe(2); // RUB (original)
  });

  it("skips a cross-currency move with no new-currency amount", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), { account: "Долларовый" });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/сумму в валюте нового счёта/i);
  });

  it("skips an unknown account", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), { account: "Депозит" });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/не найден/i);
  });

  it("time-of-day edit RECREATES (new id + created) instead of in-place — Zenmoney ignores a changed `created` on an existing row", () => {
    const iso = "2026-06-14T09:30:00.000Z";
    const { toPush, recreates, skipped } = pushIn(
      fullTx({ outcome: 500, created: 111 }),
      { createdAt: iso }
    );
    expect(skipped).toHaveLength(0);
    // NOT an in-place update…
    expect(toPush).toHaveLength(0);
    // …but a delete-old + create-new-id pair.
    expect(recreates).toHaveLength(1);
    expect(recreates[0].oldId).toBe("t1");
    expect(recreates[0].tx.id).not.toBe("t1");
    expect(recreates[0].tx.created).toBe(Math.floor(Date.parse(iso) / 1000));
    expect(recreates[0].tx.deleted).toBe(false);
    // Non-time fields still carried on the recreated tx.
    expect(recreates[0].tx.outcome).toBe(500);
  });

  it("a NON-time edit still updates in place (same id, no recreate)", () => {
    const { toPush, recreates, skipped } = pushIn(
      fullTx({ outcome: 500, created: 111, comment: null }),
      { comment: "новая заметка" }
    );
    expect(skipped).toHaveLength(0);
    expect(recreates).toHaveLength(0);
    expect(toPush).toHaveLength(1);
    expect(toPush[0].id).toBe("t1");
    expect(toPush[0].zen.comment).toBe("новая заметка");
    expect(toPush[0].zen.created).toBe(111); // unchanged
  });

  it("leaves created untouched when the edited createdAt is invalid", () => {
    const { toPush } = pushIn(fullTx({ outcome: 500, created: 111 }), {
      createdAt: "not-a-date",
    });
    expect(toPush[0].zen.created).toBe(111);
  });

  it("does not trigger when the account equals the original (no-op)", () => {
    // Original is on Карта (acc-1); editing account back to «Карта» is a no-op.
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), { account: "Карта" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.outcomeAccount).toBe("acc-1");
  });

  it("handles account change + kind flip together", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "income",
      account: "Наличные",
    });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.income).toBe(500);
    expect(toPush[0].zen.outcome).toBe(0);
    expect(toPush[0].zen.incomeAccount).toBe("acc-2");
    expect(toPush[0].zen.outcomeAccount).toBe("acc-2");
  });

  it("handles account change + currency change together (RUB→USD account)", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      currency: "USD",
      account: "Долларовый",
    });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.outcomeInstrument).toBe(3);
    expect(toPush[0].zen.outcomeAccount).toBe("acc-3");
    expect(toPush[0].zen.incomeAccount).toBe("acc-3");
  });
});

describe("buildPushItems — flip to transfer", () => {
  it("builds both legs for a single-currency transfer (expense → transfer)", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "transfer",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "Наличные",
    });
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.outcome).toBe(500);
    expect(z.income).toBe(500);
    expect(z.outcomeAccount).toBe("acc-1");
    expect(z.incomeAccount).toBe("acc-2");
    expect(z.outcomeInstrument).toBe(2);
    expect(z.incomeInstrument).toBe(2);
    expect(z.tag).toBeNull();
    expect(z.opOutcome).toBe(0);
    expect(z.opIncome).toBe(0);
  });

  it("takes the amount from the income leg (income → transfer)", () => {
    const { toPush } = pushIn(fullTx({ income: 300 }), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Наличные",
    });
    expect(toPush[0].zen.outcome).toBe(300);
    expect(toPush[0].zen.income).toBe(300);
  });

  it("applies a new transfer amount to both legs", () => {
    const { toPush } = pushIn(transferTx(), { amount: 777 });
    expect(toPush[0].zen.outcome).toBe(777);
    expect(toPush[0].zen.income).toBe(777);
  });

  it("builds a cross-currency transfer when the destination amount is given", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Долларовый",
      incomeAmount: 5,
      incomeCurrency: "USD",
    });
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.outcome).toBe(500);
    expect(z.outcomeInstrument).toBe(2); // RUB
    expect(z.income).toBe(5);
    expect(z.incomeInstrument).toBe(3); // USD
    expect(z.opOutcome).toBe(0);
    expect(z.opIncome).toBe(0);
  });

  it("skips a cross-currency transfer with no destination amount", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Долларовый",
    });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/сумму зачисления/i);
  });

  it("skips a transfer to the same account", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Карта",
    });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/невозможен|тот же/i);
  });

  it("skips when an account is not found", () => {
    const { toPush, skipped } = pushIn(fullTx({ outcome: 500 }), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Депозит",
    });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/не найден/i);
  });

  it("flips an FX (op-amount) row to a transfer, dropping the op pair", () => {
    // The old single-leg op-amounts are irrelevant once it's a transfer —
    // both legs live in their accounts' currencies. So it builds, op = 0.
    const { toPush, skipped } = pushIn(
      fullTx({ outcome: 900, opOutcome: 10, opOutcomeInstrument: 3 }),
      {
        kind: "transfer",
        account: "Карта",
        outcomeAccount: "Карта",
        incomeAccount: "Наличные",
      }
    );
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.outcome).toBe(900);
    expect(z.income).toBe(900);
    expect(z.opOutcome).toBe(0);
    expect(z.opIncome).toBe(0);
    expect(z.opOutcomeInstrument).toBeNull();
  });

  it("still refuses editing an EXISTING transfer that carries op-amounts", () => {
    // Op-amounts on a real transfer carry per-leg FX info we don't rebuild.
    const { toPush, skipped } = pushIn(
      transferTx({ opOutcome: 5, opOutcomeInstrument: 3 }),
      { amount: 600 }
    );
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/мультивалют|валют/i);
  });

  it("edits the accounts of an existing transfer (transfer → transfer)", () => {
    // Swap source/destination — both RUB, so it's allowed.
    const { toPush, skipped } = pushIn(transferTx(), {
      outcomeAccount: "Наличные",
      incomeAccount: "Карта",
    });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.outcomeAccount).toBe("acc-2");
    expect(toPush[0].zen.incomeAccount).toBe("acc-1");
  });
});

describe("buildPushItems — transfer collapse", () => {
  it("collapses transfer → expense onto the outcome leg", () => {
    const { toPush, skipped } = pushIn(transferTx(), { kind: "expense" });
    expect(skipped).toHaveLength(0);
    const z = toPush[0].zen;
    expect(z.outcome).toBe(500);
    expect(z.income).toBe(0);
    expect(z.outcomeAccount).toBe("acc-1");
    expect(z.incomeAccount).toBe("acc-1");
  });

  it("collapses transfer → income onto the income leg", () => {
    const { toPush } = pushIn(transferTx(), { kind: "income" });
    const z = toPush[0].zen;
    expect(z.income).toBe(500);
    expect(z.outcome).toBe(0);
    expect(z.outcomeAccount).toBe("acc-2");
    expect(z.incomeAccount).toBe("acc-2");
  });

  it("collapses to a chosen account (transfer → expense + account)", () => {
    const { toPush } = pushIn(transferTx(), { kind: "expense", account: "Наличные" });
    expect(toPush[0].zen.outcomeAccount).toBe("acc-2");
    expect(toPush[0].zen.incomeAccount).toBe("acc-2");
  });

  it("resolves a category when collapsing transfer → expense", () => {
    const { toPush, skipped } = pushIn(transferTx(), {
      kind: "expense",
      category: "Еда",
    });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.tag).toEqual(["tag-eda"]);
  });
});

describe("buildPushItems — clear category («Без категории»)", () => {
  const catCache = (t: ZenTransaction): ZenCache => ({
    serverTimestamp: 0,
    instruments: [{ id: 2, shortTitle: "RUB" } as ZenInstrument],
    accounts: [{ id: ACC, title: "Карта" } as ZenAccount],
    tags: [{ id: "t-food", title: "Еда", parent: null, archive: false } as ZenTag],
    merchants: [],
    transactions: [t],
    user: [],
  });

  it("maps a category edit to «Без категории» to a tag-less push, not a lookup", () => {
    const t = fullTx({ id: "x", outcome: 500, tag: ["t-food"] });
    const { toPush, skipped } = buildPushItems(
      { x: { category: NO_CATEGORY, subcategory: null } as TransactionEdit },
      catCache(t)
    );
    expect(skipped).toHaveLength(0);
    expect(toPush).toHaveLength(1);
    expect(toPush[0].zen.tag).toBeNull();
  });

  it("treats an empty-string category as «no tag» too", () => {
    const t = fullTx({ id: "x", outcome: 500, tag: ["t-food"] });
    const { toPush } = buildPushItems(
      { x: { category: "" } as TransactionEdit },
      catCache(t)
    );
    expect(toPush[0].zen.tag).toBeNull();
  });

  it("still resolves a real category and still skips a genuinely-missing one", () => {
    const t = fullTx({ id: "x", outcome: 500, tag: null });
    const ok = buildPushItems({ x: { category: "Еда" } as TransactionEdit }, catCache(t));
    expect(ok.toPush[0].zen.tag).toEqual(["t-food"]);
    const miss = buildPushItems({ x: { category: "Призрак" } as TransactionEdit }, catCache(t));
    expect(miss.toPush).toHaveLength(0);
    expect(miss.skipped[0].reason).toMatch(/не найдена/);
  });
});

describe("detectConflicts", () => {
  const c = cache([
    { id: "a", changed: 100 } as ZenTransaction,
    { id: "b", changed: 100 } as ZenTransaction,
  ]);

  it("flags an edited id whose cloud copy got newer", () => {
    const fresh = [{ id: "a", changed: 200 } as ZenTransaction];
    expect([...detectConflicts(["a"], c, fresh)]).toEqual(["a"]);
  });

  it("ignores an equal changed timestamp", () => {
    const fresh = [{ id: "a", changed: 100 } as ZenTransaction];
    expect(detectConflicts(["a"], c, fresh).size).toBe(0);
  });

  it("ignores ids absent from the fresh diff", () => {
    expect(detectConflicts(["a"], c, []).size).toBe(0);
  });

  it("only considers edited ids, not every changed cloud row", () => {
    const fresh = [{ id: "b", changed: 999 } as ZenTransaction];
    expect(detectConflicts(["a"], c, fresh).size).toBe(0);
  });
});

describe("buildTagPush", () => {
  const tags: ZenTag[] = [
    { id: "t1", title: "Аренда", required: null, color: 1 } as unknown as ZenTag,
    { id: "t2", title: "Кафе", required: false, color: 2 } as unknown as ZenTag,
  ];

  it("emits a changed tag with the new required + stamp, preserving other fields", () => {
    const { tags: out, skipped } = buildTagPush(
      { t1: { required: true } },
      tags,
      555
    );
    expect(skipped).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "t1",
      title: "Аренда", // untouched fields survive
      color: 1,
      required: true,
      changed: 555,
    });
  });

  it("drops a no-op edit (value already matches cache)", () => {
    const { tags: out } = buildTagPush({ t2: { required: false } }, tags, 1);
    expect(out).toEqual([]);
  });

  it("treats null and absent as equal (no-op)", () => {
    const { tags: out } = buildTagPush({ t1: { required: null } }, tags, 1);
    expect(out).toEqual([]);
  });

  it("reports an edit whose tag is missing from the cache as skipped", () => {
    const { tags: out, skipped } = buildTagPush(
      { ghost: { required: true } },
      tags,
      1
    );
    expect(out).toEqual([]);
    expect(skipped).toEqual([
      { id: "ghost", reason: expect.stringContaining("не найдена") },
    ]);
  });

  // ── Full editing: title / parent / type / icon / colour ──
  const richTags: ZenTag[] = [
    {
      id: "r1",
      title: "Еда",
      parent: null,
      showIncome: false,
      showOutcome: true,
      icon: "5001_food",
      color: 0x112233,
      required: null,
    } as unknown as ZenTag,
  ];

  it("renames a tag, preserving every other field", () => {
    const { tags: out } = buildTagPush({ r1: { title: "Питание" } }, richTags, 9);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "r1",
      title: "Питание",
      showOutcome: true,
      icon: "5001_food",
      color: 0x112233,
      changed: 9,
    });
  });

  it("changes type (showIncome/showOutcome) and colour together", () => {
    const { tags: out } = buildTagPush(
      { r1: { showIncome: true, showOutcome: false, color: 0xff0000 } },
      richTags,
      9
    );
    expect(out[0]).toMatchObject({ showIncome: true, showOutcome: false, color: 0xff0000 });
    expect(out[0].title).toBe("Еда"); // untouched
  });

  it("reparents a tag (root → sub) and sets an icon", () => {
    const { tags: out } = buildTagPush(
      { r1: { parent: "p9", icon: "3002_cars" } },
      richTags,
      9
    );
    expect(out[0]).toMatchObject({ parent: "p9", icon: "3002_cars" });
  });

  it("drops a net no-op even when several fields are present but unchanged", () => {
    const { tags: out } = buildTagPush(
      { r1: { title: "Еда", showOutcome: true, color: 0x112233 } },
      richTags,
      9
    );
    expect(out).toEqual([]);
  });

  it("pushes when at least one of several fields actually differs", () => {
    const { tags: out } = buildTagPush(
      { r1: { title: "Еда", color: 0x445566 } }, // title same, colour new
      richTags,
      9
    );
    expect(out).toHaveLength(1);
    expect(out[0].color).toBe(0x445566);
  });
});

describe("buildNewCategoriesPush", () => {
  it("emits a full new tag with the client id, user, stamp and budget flags", () => {
    const out = buildNewCategoriesPush(
      [
        {
          id: "new-1",
          title: "Подписки",
          parent: null,
          showIncome: false,
          showOutcome: true,
          icon: "5001_food",
          color: 0x223344,
          required: false,
        },
      ],
      777,
      42
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "new-1",
      user: 777,
      title: "Подписки",
      parent: null,
      archive: false,
      showOutcome: true,
      showIncome: false,
      budgetOutcome: true, // mirrors showOutcome
      budgetIncome: false, // mirrors showIncome
      icon: "5001_food",
      color: 0x223344,
      required: false,
      picture: null,
      changed: 42,
    });
  });

  it("carries the parent id for a new subcategory", () => {
    const out = buildNewCategoriesPush(
      [
        {
          id: "sub-1",
          title: "Кофе",
          parent: "root-food",
          showIncome: false,
          showOutcome: true,
          icon: null,
          color: null,
          required: null,
        },
      ],
      1,
      5
    );
    expect(out[0].parent).toBe("root-food");
  });

  it("skips an empty-titled draft", () => {
    const out = buildNewCategoriesPush(
      [{ id: "x", title: "   ", parent: null, showIncome: false, showOutcome: true, icon: null, color: null, required: null }],
      1,
      5
    );
    expect(out).toEqual([]);
  });
});

describe("контрагенты (merchants) push builders", () => {
  const cacheMerchants = [
    { id: "m1", user: 7, title: "Пятёрочка", changed: 100 },
    { id: "m2", user: 7, title: "Ozon", changed: 100 },
  ];

  it("creates a brand-new merchant with the client id, user and stamp", () => {
    const out = buildNewMerchantsPush([{ id: "new-1", title: "Пекарня №4" }], 7, 42);
    expect(out).toEqual([{ id: "new-1", user: 7, title: "Пекарня №4", changed: 42 }]);
  });

  it("trims titles and skips empty drafts", () => {
    const out = buildNewMerchantsPush(
      [
        { id: "a", title: "  Кофейня  " },
        { id: "b", title: "   " },
      ],
      7,
      1
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Кофейня");
  });

  it("renames a cached merchant, preserving user and bumping changed", () => {
    const { merchants, skipped } = buildMerchantRenamePush(
      { m1: "Пятёрочка у дома" },
      cacheMerchants,
      55
    );
    expect(skipped).toEqual([]);
    expect(merchants).toEqual([
      { id: "m1", user: 7, title: "Пятёрочка у дома", changed: 55 },
    ]);
  });

  it("drops a rename that matches the cached title (no-op) or is blank", () => {
    expect(
      buildMerchantRenamePush({ m1: "Пятёрочка", m2: "  " }, cacheMerchants, 1).merchants
    ).toEqual([]);
  });

  it("reports a rename whose merchant is missing from cache as skipped", () => {
    const { merchants, skipped } = buildMerchantRenamePush(
      { ghost: "Кто-то" },
      cacheMerchants,
      1
    );
    expect(merchants).toEqual([]);
    expect(skipped).toEqual([
      { id: "ghost", reason: expect.stringContaining("не найден") },
    ]);
  });

  it("builds merchant deletions with object \"merchant\"", () => {
    const out = buildMerchantDeletions(["m2"], cacheMerchants, 9);
    expect(out).toEqual([{ id: "m2", object: "merchant", user: 7, stamp: 9 }]);
  });

  it("skips deleting an id that isn't in the cache (already gone)", () => {
    expect(buildMerchantDeletions(["ghost"], cacheMerchants, 9)).toEqual([]);
  });
});

describe("buildMerchantMergePush", () => {
  /** Two merchants sharing a title — the duplicate case this exists for. */
  const merchants = [
    { id: "keep", user: 7, title: "Авито", changed: 100 },
    { id: "dup", user: 7, title: "Авито", changed: 100 },
    { id: "other", user: 7, title: "Ozon", changed: 100 },
  ];
  function mergeCache(transactions: ZenTransaction[]): ZenCache {
    return { ...cache(transactions), merchants };
  }
  function tx(id: string, merchant: string | null, deleted = false): ZenTransaction {
    return { id, user: 7, merchant, deleted, payee: "Авито" } as ZenTransaction;
  }

  it("re-points the duplicate's operations at the survivor and deletes it", () => {
    const c = mergeCache([tx("t1", "dup"), tx("t2", "keep"), tx("t3", "other")]);
    const out = buildMerchantMergePush([{ id: "dup", survivorId: "keep" }], c, 55);
    expect(out.skipped).toEqual([]);
    expect(out.transactions).toEqual([
      { id: "t1", user: 7, merchant: "keep", deleted: false, payee: "Авито", changed: 55 },
    ]);
    expect(out.deletions).toEqual([
      { id: "dup", object: "merchant", user: 7, stamp: 55 },
    ]);
  });

  it("still deletes a duplicate that has no operations", () => {
    const c = mergeCache([tx("t1", "keep")]);
    const out = buildMerchantMergePush([{ id: "dup", survivorId: "keep" }], c, 1);
    expect(out.transactions).toEqual([]);
    expect(out.deletions).toHaveLength(1);
  });

  it("leaves deleted operations alone", () => {
    const c = mergeCache([tx("t1", "dup", true)]);
    expect(
      buildMerchantMergePush([{ id: "dup", survivorId: "keep" }], c, 1).transactions
    ).toEqual([]);
  });

  it("refuses a merge whose survivor is itself being merged away", () => {
    const c = mergeCache([tx("t1", "dup")]);
    const out = buildMerchantMergePush(
      [
        { id: "dup", survivorId: "other" },
        { id: "other", survivorId: "keep" },
      ],
      c,
      1
    );
    expect(out.skipped).toEqual([
      { id: "dup", reason: expect.stringContaining("сам объединяется") },
    ]);
    // The valid half still goes through.
    expect(out.deletions.map((d) => d.id)).toEqual(["other"]);
  });

  it("reports an unknown survivor as skipped and pushes nothing for it", () => {
    const c = mergeCache([tx("t1", "dup")]);
    const out = buildMerchantMergePush([{ id: "dup", survivorId: "ghost" }], c, 1);
    expect(out.deletions).toEqual([]);
    expect(out.transactions).toEqual([]);
    expect(out.skipped).toEqual([
      { id: "dup", reason: expect.stringContaining("не найден") },
    ]);
  });

  it("ignores a duplicate that's already gone from the cache", () => {
    const c = mergeCache([]);
    const out = buildMerchantMergePush([{ id: "ghost", survivorId: "keep" }], c, 1);
    expect(out).toEqual({ transactions: [], deletions: [], skipped: [] });
  });
});

describe("buildTagDeletionPush", () => {
  const tags = [
    { id: "food", user: 7, title: "Еда", parent: null },
    { id: "cafe", user: 7, title: "Кафе", parent: "food" },
    { id: "misc", user: 7, title: "Другое", parent: null },
  ] as ZenTag[];
  function tagCache(transactions: ZenTransaction[]): ZenCache {
    return { ...cache(transactions), tags };
  }
  function tx(id: string, tag: string[] | null, deleted = false): ZenTransaction {
    return { id, user: 7, tag, deleted } as ZenTransaction;
  }

  it("swaps the deleted tag for its replacement and deletes the tag", () => {
    const c = tagCache([tx("t1", ["cafe"])]);
    const out = buildTagDeletionPush([{ id: "cafe", replacementId: "misc" }], c, 55);
    expect(out.skipped).toEqual([]);
    expect(out.transactions).toEqual([
      { id: "t1", user: 7, tag: ["misc"], deleted: false, changed: 55 },
    ]);
    expect(out.deletions).toEqual([
      { id: "cafe", object: "tag", user: 7, stamp: 55 },
    ]);
  });

  it("leaves the operation without a category when there is no replacement", () => {
    const c = tagCache([tx("t1", ["cafe"])]);
    const out = buildTagDeletionPush([{ id: "cafe", replacementId: null }], c, 1);
    expect(out.transactions[0].tag).toBeNull();
  });

  it("does not double the replacement when the operation already carries it", () => {
    const c = tagCache([tx("t1", ["cafe", "misc"])]);
    const out = buildTagDeletionPush([{ id: "cafe", replacementId: "misc" }], c, 1);
    expect(out.transactions[0].tag).toEqual(["misc"]);
  });

  it("keeps the operation's other categories untouched", () => {
    const c = tagCache([tx("t1", ["cafe", "food"])]);
    const out = buildTagDeletionPush([{ id: "cafe", replacementId: null }], c, 1);
    expect(out.transactions[0].tag).toEqual(["food"]);
  });

  it("refuses to strand subcategories when only the parent is deleted", () => {
    const c = tagCache([tx("t1", ["food"])]);
    const out = buildTagDeletionPush([{ id: "food", replacementId: "misc" }], c, 1);
    expect(out.deletions).toEqual([]);
    expect(out.transactions).toEqual([]);
    expect(out.skipped).toEqual([
      { id: "food", reason: expect.stringContaining("подкатегории") },
    ]);
  });

  it("allows deleting a parent together with its subcategories", () => {
    const c = tagCache([tx("t1", ["cafe"]), tx("t2", ["food"])]);
    const out = buildTagDeletionPush(
      [
        { id: "food", replacementId: "misc" },
        { id: "cafe", replacementId: "misc" },
      ],
      c,
      1
    );
    expect(out.skipped).toEqual([]);
    expect(out.deletions.map((d) => d.id).sort()).toEqual(["cafe", "food"]);
    expect(out.transactions.map((t) => t.tag)).toEqual([["misc"], ["misc"]]);
  });

  it("refuses a replacement that is itself being deleted", () => {
    const c = tagCache([tx("t1", ["cafe"])]);
    const out = buildTagDeletionPush(
      [
        { id: "cafe", replacementId: "misc" },
        { id: "misc", replacementId: null },
      ],
      c,
      1
    );
    expect(out.skipped).toEqual([
      { id: "cafe", reason: expect.stringContaining("сама удаляется") },
    ]);
    expect(out.deletions.map((d) => d.id)).toEqual(["misc"]);
  });

  it("leaves deleted operations and untagged ones alone", () => {
    const c = tagCache([tx("t1", ["cafe"], true), tx("t2", null), tx("t3", [])]);
    const out = buildTagDeletionPush([{ id: "cafe", replacementId: "misc" }], c, 1);
    expect(out.transactions).toEqual([]);
    expect(out.deletions).toHaveLength(1);
  });

  it("ignores a category that's already gone from the cache", () => {
    const c = tagCache([]);
    const out = buildTagDeletionPush([{ id: "ghost", replacementId: null }], c, 1);
    expect(out).toEqual({ transactions: [], deletions: [], skipped: [] });
  });
});

describe("buildDraftTransaction", () => {
  const RUB = 2;
  const USD = 1;
  // Richer cache with reference entities a draft resolves against.
  const draftCache = (): ZenCache => ({
    serverTimestamp: 0,
    instruments: [
      { id: RUB, shortTitle: "RUB", rate: 1 },
      { id: USD, shortTitle: "USD", rate: 90 },
    ] as unknown as ZenCache["instruments"],
    accounts: [
      { id: "acc-card", title: "Карта", instrument: RUB, archive: false },
      { id: "acc-usd", title: "USD-счёт", instrument: USD, archive: false },
    ] as unknown as ZenCache["accounts"],
    tags: [
      { id: "t-food", title: "Еда", parent: null, archive: false },
      { id: "t-salary", title: "Зарплата", parent: null, archive: false },
    ] as unknown as ZenCache["tags"],
    merchants: [{ id: "m-pyat", title: "Пятёрочка" }] as unknown as ZenCache["merchants"],
    transactions: [],
    user: [{ id: 99, currency: RUB }] as unknown as ZenCache["user"],
  });

  const base: DraftFields = {
    id: "new-1",
    kind: "expense",
    date: "2026-06-14",
    amount: 500,
    account: "Карта",
    category: "Еда",
  };

  // issue #19.3 — editing a not-yet-pushed draft rebuilds it IN PLACE (same id,
  // updated fields), so it stays ONE create, not a create + separate edit.
  it("rebuilding with the same id merges the edit into the draft", () => {
    const v1 = buildDraftTransaction({ ...base, category: "Еда", amount: 500 }, draftCache(), 1000);
    const v2 = buildDraftTransaction({ ...base, category: "Зарплата", kind: "income", amount: 800 }, draftCache(), 2000);
    expect(v1.zen?.id).toBe("new-1");
    expect(v2.zen?.id).toBe("new-1"); // same draft id → replace in place
    expect(v1.zen?.outcome).toBe(500);
    expect(v2.zen).toMatchObject({ income: 800, outcome: 0, tag: ["t-salary"] });
  });

  it("builds a single-leg expense (both legs on one account, amount on outcome)", () => {
    const r = buildDraftTransaction(base, draftCache(), 1000);
    expect(r.skip).toBeUndefined();
    expect(r.zen).toMatchObject({
      id: "new-1",
      user: 99,
      outcome: 500,
      income: 0,
      outcomeAccount: "acc-card",
      incomeAccount: "acc-card",
      outcomeInstrument: RUB,
      incomeInstrument: RUB,
      tag: ["t-food"],
      deleted: false,
      changed: 1000,
      created: 1000,
    });
  });

  it("uses createdSeconds for created (the «Время» field), changed stays at the build stamp", () => {
    const r = buildDraftTransaction({ ...base, createdSeconds: 777 }, draftCache(), 1000);
    expect(r.zen).toMatchObject({ created: 777, changed: 1000 });
  });

  it("falls back to the build stamp for created when no createdSeconds given", () => {
    const r = buildDraftTransaction(base, draftCache(), 1000);
    expect(r.zen).toMatchObject({ created: 1000, changed: 1000 });
  });

  it("builds a tag-less operation for «Без категории»", () => {
    const r = buildDraftTransaction({ ...base, category: NO_CATEGORY }, draftCache(), 1);
    expect(r.skip).toBeUndefined();
    expect(r.zen?.tag).toBeNull();
  });

  it("builds a single-leg income (amount on income leg)", () => {
    const r = buildDraftTransaction(
      { ...base, kind: "income", amount: 100000, category: "Зарплата" },
      draftCache(),
      1000
    );
    expect(r.zen).toMatchObject({ income: 100000, outcome: 0, tag: ["t-salary"] });
  });

  it("resolves a known brand to a merchant id (payee stays null)", () => {
    const r = buildDraftTransaction({ ...base, payee: "Пятёрочка" }, draftCache(), 1);
    expect(r.zen).toMatchObject({ merchant: "m-pyat", payee: null });
  });

  it("stores an unknown counterparty as free-text payee", () => {
    const r = buildDraftTransaction({ ...base, payee: "Ларёк у дома" }, draftCache(), 1);
    expect(r.zen).toMatchObject({ merchant: null, payee: "Ларёк у дома" });
  });

  it("builds a same-currency transfer (income mirrors outcome, no tag)", () => {
    const r = buildDraftTransaction(
      { id: "tr-1", kind: "transfer", date: "2026-06-14", amount: 1000, account: "Карта", incomeAccount: "Карта" },
      // two distinct RUB accounts
      {
        ...draftCache(),
        accounts: [
          { id: "acc-card", title: "Карта", instrument: RUB, archive: false },
          { id: "acc-cash", title: "Наличные", instrument: RUB, archive: false },
        ] as unknown as ZenCache["accounts"],
      },
      1
    );
    // adjust dst to the second RUB account
    const r2 = buildDraftTransaction(
      { id: "tr-1", kind: "transfer", date: "2026-06-14", amount: 1000, account: "Карта", incomeAccount: "Наличные" },
      {
        ...draftCache(),
        accounts: [
          { id: "acc-card", title: "Карта", instrument: RUB, archive: false },
          { id: "acc-cash", title: "Наличные", instrument: RUB, archive: false },
        ] as unknown as ZenCache["accounts"],
      },
      1
    );
    expect(r.skip).toBeDefined(); // same account → rejected
    expect(r2.zen).toMatchObject({
      outcome: 1000,
      income: 1000,
      outcomeAccount: "acc-card",
      incomeAccount: "acc-cash",
      tag: null,
    });
  });

  it("builds a cross-currency transfer when both leg amounts are given", () => {
    const r = buildDraftTransaction(
      { id: "fx-1", kind: "transfer", date: "2026-06-14", amount: 9000, account: "Карта", incomeAccount: "USD-счёт", incomeAmount: 100 },
      draftCache(),
      1
    );
    expect(r.zen).toMatchObject({
      outcome: 9000,
      outcomeInstrument: RUB,
      income: 100,
      incomeInstrument: USD,
      outcomeAccount: "acc-card",
      incomeAccount: "acc-usd",
    });
  });

  it("skips a cross-currency transfer with no destination amount", () => {
    const r = buildDraftTransaction(
      { id: "fx-2", kind: "transfer", date: "2026-06-14", amount: 9000, account: "Карта", incomeAccount: "USD-счёт" },
      draftCache(),
      1
    );
    expect(r.zen).toBeUndefined();
    expect(r.skip).toMatch(/сумму зачисления/);
  });

  it("rejects missing/unknown account, category, synthetic category, bad amount/date", () => {
    const c = draftCache();
    expect(buildDraftTransaction({ ...base, account: "Нет" }, c, 1).skip).toMatch(/не найден/);
    expect(buildDraftTransaction({ ...base, category: "" }, c, 1).skip).toMatch(/категори/);
    expect(buildDraftTransaction({ ...base, category: "Перевод" }, c, 1).skip).toMatch(/ярлык/);
    expect(buildDraftTransaction({ ...base, category: "Несуществующая" }, c, 1).skip).toMatch(/не найдена/);
    expect(buildDraftTransaction({ ...base, amount: 0 }, c, 1).skip).toMatch(/больше нуля/);
    expect(buildDraftTransaction({ ...base, date: "14.06.2026" }, c, 1).skip).toMatch(/дата/);
  });

  describe("validateDrafts (pre-push)", () => {
    const ok = (): ZenTransaction => {
      const r = buildDraftTransaction(base, draftCache(), 5);
      return r.zen!;
    };
    const byId = (txs: ZenTransaction[]) => Object.fromEntries(txs.map((t) => [t.id, t]));

    it("passes a valid draft and re-stamps `changed`", () => {
      const out = validateDrafts(byId([ok()]), draftCache(), 777);
      expect(out.skipped).toEqual([]);
      expect(out.ready).toHaveLength(1);
      expect(out.ready[0].changed).toBe(777);
      expect(out.ready[0].outcome).toBe(500);
    });

    it("skips a draft whose account is gone from the cache", () => {
      const d = ok();
      const out = validateDrafts(byId([d]), { ...draftCache(), accounts: [] }, 1);
      expect(out.ready).toEqual([]);
      expect(out.skipped[0].reason).toMatch(/счёт/);
    });

    it("skips a draft whose category tag is gone", () => {
      const d = ok();
      const out = validateDrafts(byId([d]), { ...draftCache(), tags: [] }, 1);
      expect(out.skipped[0].reason).toMatch(/категори/);
    });

    it("skips a draft whose id is already live in the cloud (stale)", () => {
      const d = ok();
      const c = draftCache();
      c.transactions = [{ id: d.id, deleted: false } as ZenTransaction];
      const out = validateDrafts(byId([d]), c, 1);
      expect(out.ready).toEqual([]);
      expect(out.skipped[0].reason).toMatch(/уже есть/);
    });
  });
});

// ── Debt / loan / credit operations ──────────────────────────────────────
// A debt op is a two-leg move where one leg is a debt-type account; Zenmoney
// requires a non-null `payee`. The generic transfer branch would null it, so
// the dedicated debt branch must patch in place and keep the counterparty.
function debtCache(t: ZenTransaction): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [{ id: 2, shortTitle: "RUB" } as ZenInstrument],
    accounts: [
      { id: "acc-card", title: "Карта", instrument: 2, type: "ccard" } as ZenAccount,
      { id: "acc-debt", title: "Долг", instrument: 2, type: "debt" } as ZenAccount,
      { id: "acc-card2", title: "Карта2", instrument: 2, type: "ccard" } as ZenAccount,
    ],
    tags: [],
    merchants: [],
    transactions: [t],
    user: [],
  };
}
function debtTx(p: Partial<ZenTransaction> = {}): ZenTransaction {
  return {
    id: "d1",
    user: 1,
    deleted: false,
    changed: 100,
    outcome: 1000,
    income: 1000,
    outcomeAccount: "acc-card",
    incomeAccount: "acc-debt",
    outcomeInstrument: 2,
    incomeInstrument: 2,
    opOutcome: 0,
    opIncome: 0,
    outcomeBankID: null,
    incomeBankID: null,
    tag: null,
    payee: "Иван",
    merchant: null,
    ...p,
  } as ZenTransaction;
}
const pushDebt = (t: ZenTransaction, edit: TransactionEdit) =>
  buildPushItems({ [t.id]: edit }, debtCache(t));

describe("buildPushItems — debt operations", () => {
  it("a time-of-day edit on a debt op recreates it (new id) and keeps the counterparty", () => {
    const t = debtTx({ created: 111 });
    const iso = "2026-06-14T09:30:00.000Z";
    const { toPush, recreates, skipped } = pushDebt(t, { createdAt: iso });
    expect(skipped).toHaveLength(0);
    expect(toPush).toHaveLength(0);
    expect(recreates).toHaveLength(1);
    expect(recreates[0].oldId).toBe("d1");
    expect(recreates[0].tx.id).not.toBe("d1");
    expect(recreates[0].tx.created).toBe(Math.floor(Date.parse(iso) / 1000));
    // Debt ops MUST keep a non-null payee — the recreated row carries it.
    expect(recreates[0].tx.payee).toBe("Иван");
    expect(recreates[0].tx.incomeAccount).toBe("acc-debt");
  });

  it("changing the counterparty keeps payee set (no «should have payee» error)", () => {
    const t = debtTx();
    // The editor maps «Получатель» to `brand`; the overlay also carries the
    // unchanged transfer legs.
    const out = pushDebt(t, {
      brand: "Пётр",
      account: "Карта",
      incomeAccount: "Долг",
    } as TransactionEdit);
    expect(out.toPush).toHaveLength(1);
    const zen = out.toPush[0].zen;
    expect(zen.payee).toBe("Пётр");
    // Debt structure preserved.
    expect(zen.outcomeAccount).toBe("acc-card");
    expect(zen.incomeAccount).toBe("acc-debt");
    expect(zen.outcome).toBe(1000);
    expect(zen.income).toBe(1000);
  });

  it("swapping one account leg keeps the payee", () => {
    const t = debtTx();
    const out = pushDebt(t, {
      outcomeAccount: "Карта2",
      incomeAccount: "Долг",
    } as TransactionEdit);
    expect(out.toPush).toHaveLength(1);
    const zen = out.toPush[0].zen;
    expect(zen.outcomeAccount).toBe("acc-card2");
    expect(zen.payee).toBe("Иван"); // preserved from original
  });

  it("refuses to clear the counterparty", () => {
    const t = debtTx({ payee: "" });
    const out = pushDebt(t, { brand: "" } as TransactionEdit);
    expect(out.toPush).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/плательщик/i);
  });

  it("refuses an amount change on a debt op", () => {
    const t = debtTx();
    const out = pushDebt(t, { amount: 2000 } as TransactionEdit);
    expect(out.toPush).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/сумм/i);
  });

  it("refuses a type flip on a debt op", () => {
    const t = debtTx();
    const out = pushDebt(t, { kind: "expense" } as TransactionEdit);
    expect(out.toPush).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/тип/i);
  });

  it("a no-op overlay (unchanged legs) still pushes with payee intact", () => {
    const t = debtTx();
    const out = pushDebt(t, { account: "Карта", incomeAccount: "Долг" } as TransactionEdit);
    expect(out.toPush).toHaveLength(1);
    expect(out.toPush[0].zen.payee).toBe("Иван");
  });

  // issue #19.7 / #19.1 — converting a REGULAR op into a debt one. The original
  // isn't a debt op, so the debt branch doesn't fire; the transfer branch must
  // still keep/require the payee because the TARGET leg is a debt account.
  const plainExpense = () =>
    debtTx({ id: "x", outcome: 1000, income: 0, outcomeAccount: "acc-card", incomeAccount: "acc-card", payee: null });

  it("converting a regular expense INTO a debt op keeps the counterparty", () => {
    const out = pushDebt(plainExpense(), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Долг",
      brand: "Иван",
    } as TransactionEdit);
    expect(out.skipped).toHaveLength(0);
    const zen = out.toPush[0].zen;
    expect(zen.payee).toBe("Иван");
    expect(zen.outcomeAccount).toBe("acc-card");
    expect(zen.incomeAccount).toBe("acc-debt");
  });

  it("converting to a debt op without a counterparty is refused", () => {
    const out = pushDebt(plainExpense(), {
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Долг",
    } as TransactionEdit);
    expect(out.toPush).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/плательщик/i);
  });
});

describe("buildDraftTransaction — debt", () => {
  const RUB = 2;
  const debtDraftCache = (): ZenCache => ({
    serverTimestamp: 0,
    instruments: [{ id: RUB, shortTitle: "RUB", rate: 1 }] as unknown as ZenCache["instruments"],
    accounts: [
      { id: "acc-card", title: "Карта", instrument: RUB, archive: false, type: "ccard" },
      { id: "acc-debt", title: "Долги", instrument: RUB, archive: false, type: "debt" },
    ] as unknown as ZenCache["accounts"],
    tags: [],
    merchants: [{ id: "m- renat", title: "Ренат Х." }] as unknown as ZenCache["merchants"],
    transactions: [],
    user: [{ id: 99, currency: RUB }] as unknown as ZenCache["user"],
  });

  it("«дал в долг»: real → Долги, payee set, no tag", () => {
    const r = buildDraftTransaction(
      {
        id: "nd",
        kind: "transfer",
        date: "2026-06-14",
        amount: 100000,
        account: "Карта",
        incomeAccount: "Долги",
        payee: "Ренат Х.",
      },
      debtDraftCache(),
      1000
    );
    expect(r.skip).toBeUndefined();
    expect(r.zen).toMatchObject({
      outcome: 100000,
      income: 100000,
      outcomeAccount: "acc-card",
      incomeAccount: "acc-debt",
      payee: "Ренат Х.",
      tag: null,
    });
  });

  it("«вернули»: Долги → real, payee still set", () => {
    const r = buildDraftTransaction(
      {
        id: "nd2",
        kind: "transfer",
        date: "2026-06-14",
        amount: 50000,
        account: "Долги",
        incomeAccount: "Карта",
        payee: "Ренат Х.",
      },
      debtDraftCache(),
      1000
    );
    expect(r.zen?.outcomeAccount).toBe("acc-debt");
    expect(r.zen?.incomeAccount).toBe("acc-card");
    expect(r.zen?.payee).toBe("Ренат Х.");
  });

  it("refuses a debt op without a counterparty", () => {
    const r = buildDraftTransaction(
      {
        id: "nd3",
        kind: "transfer",
        date: "2026-06-14",
        amount: 100,
        account: "Карта",
        incomeAccount: "Долги",
        payee: "",
      },
      debtDraftCache(),
      1000
    );
    expect(r.zen).toBeUndefined();
    expect(r.skip).toMatch(/контрагент/i);
  });
});
