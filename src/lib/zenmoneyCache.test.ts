import { describe, it, expect } from "vitest";
import { applyDiff, CACHE_SCHEMA_VERSION, type ZenCache } from "./zenmoneyCache";
import type {
  ZenAccount,
  ZenTransaction,
  ZenDiffResponse,
} from "./zenmoney";

const acc = (id: string) => ({ id, title: `Acc ${id}` }) as ZenAccount;
const txn = (id: string, out: string, inc: string) =>
  ({ id, outcomeAccount: out, incomeAccount: inc }) as ZenTransaction;

const cache = (over: Partial<ZenCache>): ZenCache => ({
  serverTimestamp: 1,
  instruments: [],
  accounts: [],
  tags: [],
  merchants: [],
  transactions: [],
  user: [],
  ...over,
});

const del = (id: string, object: string) => ({ id, object, user: 1, stamp: 2 });

describe("applyDiff — orphan transaction pruning", () => {
  it("drops a deleted account's transactions even with no per-tx deletion entry", () => {
    const prev = cache({
      accounts: [acc("A"), acc("B")],
      transactions: [txn("t1", "A", "A"), txn("t2", "B", "B")],
    });
    // Incremental diff deletes account B only — Zenmoney doesn't enumerate a
    // deletion for each of B's (old) transactions.
    const diff = {
      serverTimestamp: 2,
      deletion: [del("B", "account")],
    } as ZenDiffResponse;
    const next = applyDiff(prev, diff);
    expect(next.accounts.map((a) => a.id)).toEqual(["A"]);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]); // t2 pruned
  });

  it("prunes a transfer when one of its two accounts is gone", () => {
    const prev = cache({
      accounts: [acc("A"), acc("B")],
      transactions: [txn("tr", "A", "B")], // transfer A→B
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("B", "account")],
    } as ZenDiffResponse;
    expect(applyDiff(prev, diff).transactions).toHaveLength(0);
  });

  it("keeps transactions whose accounts all still exist", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A")],
    });
    const next = applyDiff(prev, { serverTimestamp: 1 } as ZenDiffResponse);
    expect(next.transactions).toHaveLength(1);
  });

  it("prunes orphans on the initial full sync too", () => {
    // prev=null branch: a transaction references an account missing from the diff.
    const diff = {
      serverTimestamp: 1,
      account: [acc("A")],
      transaction: [txn("t1", "A", "A"), txn("t2", "ghost", "ghost")],
    } as ZenDiffResponse;
    const next = applyDiff(null, diff);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("applyDiff — transaction deletions", () => {
  // The push flow folds the deletions IT sent into the merge (the Zenmoney
  // response doesn't echo our own deletions), so the just-deleted rows must
  // drop from the local cache immediately — otherwise they linger as
  // «Удалено» pending until the next full sync.
  it("drops a transaction carried in the diff's `deletion` array", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A"), txn("t2", "A", "A")],
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("t2", "transaction")],
    } as ZenDiffResponse;
    const next = applyDiff(prev, diff);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]);
  });

  it("keeps other rows and just drops the deleted ones", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A"), txn("t2", "A", "A"), txn("t3", "A", "A")],
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("t1", "transaction"), del("t3", "transaction")],
    } as ZenDiffResponse;
    expect(applyDiff(prev, diff).transactions.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("операции удалённого плана (#71)", () => {
  const marker = (id: string, reminder: string, date: string) => ({
    id, user: 1, changed: 1, date, income: 0, incomeInstrument: 2,
    outcome: 1000, outcomeInstrument: 2, tag: null, reminder,
    state: "planned" as const,
  });
  const base = (markers: ReturnType<typeof marker>[]) => ({
    serverTimestamp: 1, instruments: [], accounts: [], tags: [], merchants: [],
    transactions: [], user: [], budgets: [], companies: [],
    reminderMarkers: markers, cacheSchemaVersion: CACHE_SCHEMA_VERSION,
  });

  it("удаление плана уносит его будущие операции", () => {
    // Дзен-мани сообщает об удалении самого плана, а не каждой его операции.
    // Раньше операции оставались у нас навсегда и висели «просроченными».
    const next = applyDiff(base([marker("m1", "r1", "2026-07-01"), marker("m2", "r2", "2026-07-02")]), {
      serverTimestamp: 2,
      deletion: [{ id: "r1", object: "reminder", stamp: 2, user: 1 }],
    } as never);
    expect(next.reminderMarkers?.map((m) => m.id)).toEqual(["m2"]);
  });

  it("операции живого плана остаются на месте", () => {
    const next = applyDiff(base([marker("m1", "r1", "2026-07-01")]), {
      serverTimestamp: 2,
    } as never);
    expect(next.reminderMarkers).toHaveLength(1);
  });

  it("перезабор заменяет список целиком — так уходят уже осиротевшие", () => {
    // Ответ сервера — полная правда: чего в нём нет, того нет и в Дзен-мани.
    const next = applyDiff(
      base([marker("старый", "r0", "2025-01-01"), marker("m1", "r1", "2026-07-01")]),
      { serverTimestamp: 2, reminderMarker: [marker("m1", "r1", "2026-07-01")] } as never,
      { replaceMarkers: true }
    );
    expect(next.reminderMarkers?.map((m) => m.id)).toEqual(["m1"]);
  });

  it("без перезабора ответ сервера — добавка, а не замена", () => {
    const next = applyDiff(
      base([marker("m1", "r1", "2026-07-01")]),
      { serverTimestamp: 2, reminderMarker: [marker("m2", "r2", "2026-07-02")] } as never
    );
    expect(next.reminderMarkers?.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("сами планы тоже лежат в кэше — по ним видно, разовый план или нет", () => {
    // Без этого «удалить просроченную операцию» — игра вслепую: у разового надо
    // удалять план целиком, у повторяющегося — только одну дату.
    const plan = (id: string, interval: string | null) => ({
      id, user: 1, changed: 1, interval, step: interval ? 1 : null,
      startDate: "2022-04-14",
    });
    const next = applyDiff(base([marker("m1", "r1", "2026-07-01")]), {
      serverTimestamp: 2,
      reminder: [plan("r1", null), plan("r2", "month")],
    } as never);
    expect(next.reminders?.map((r) => r.interval)).toEqual([null, "month"]);
  });

  it("удалённый план уходит и из списка планов", () => {
    const next = applyDiff(
      {
        ...base([]),
        reminders: [
          { id: "r1", user: 1, changed: 1, interval: null, step: null, startDate: "2022-04-14" },
        ],
      },
      {
        serverTimestamp: 2,
        deletion: [{ id: "r1", object: "reminder", stamp: 2, user: 1 }],
      } as never
    );
    expect(next.reminders).toEqual([]);
  });
});
