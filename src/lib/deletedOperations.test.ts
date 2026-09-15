import { describe, it, expect } from "vitest";
import { collectDeletedOperations, dayOfMs, groupDeleted, sortDeleted, twinKey } from "./deletedOperations";
import { tx as txFixture } from "../test/fixtures";
import { resurrectionId } from "./zenmoneyPush";
import type { ZenCache } from "./zenmoneyCache";
import type { ZenTransaction } from "./zenmoney";

function op(id: string, patch: Partial<ZenTransaction> = {}): ZenTransaction {
  return {
    id,
    user: 1,
    date: "2026-09-01",
    income: 0,
    outcome: 500,
    changed: 1_780_000_000,
    incomeInstrument: 2,
    outcomeInstrument: 2,
    created: 1_780_000_000,
    originalPayee: null,
    deleted: false,
    viewed: true,
    hold: null,
    qrCode: null,
    source: null,
    incomeAccount: "card",
    outcomeAccount: "card",
    tag: null,
    comment: null,
    payee: "Пятёрочка",
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
    ...patch,
  };
}

function cache(transactions: ZenTransaction[]): ZenCache {
  return { serverTimestamp: 0, instruments: [], accounts: [], tags: [], merchants: [], transactions, user: [] };
}

const run = (
  transactions: ZenTransaction[],
  extra: { payloads?: Record<string, ZenTransaction>; deletedIds?: string[]; deletedAt?: Record<string, number> } = {}
) =>
  collectDeletedOperations({
    cache: cache(transactions),
    payloads: extra.payloads ?? {},
    deletedIds: extra.deletedIds ?? [],
    deletedAt: extra.deletedAt ?? {},
  });

describe("collectDeletedOperations", () => {
  it("берёт удалённые в Дзен-мани строки, время удаления — из changed", () => {
    const out = run([op("live"), op("gone", { deleted: true, changed: 1_780_000_100, payee: "Лента" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "gone", status: "deleted", deletedAt: 1_780_000_100_000 });
    // Разбор пропускает `deleted: true` — в список строка уходит живой.
    expect(out[0].zen.deleted).toBe(false);
  });

  it("свежие удаления — первыми", () => {
    const out = run([
      op("old", { deleted: true, changed: 100 }),
      op("new", { deleted: true, changed: 300 }),
      op("mid", { deleted: true, changed: 200 }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("прячет операции, которые мы пересоздали или уже вернули копией", () => {
    const copyLive = op(resurrectionId("moved"));
    const copyDeleted = op(resurrectionId("twice"), { deleted: true, changed: 50 });
    const out = run([
      op("moved", { deleted: true }),
      copyLive,
      op("twice", { deleted: true }),
      copyDeleted,
    ]);
    // Остаётся только удалённая копия — оригинал вернуть уже нельзя, копию можно.
    expect(out.map((e) => e.id)).toEqual([copyDeleted.id]);
  });

  it("помечает удалённую, у которой есть живой двойник", () => {
    const out = run([
      op("kept", { payee: "Кофейня", outcome: 250 }),
      op("dup", { payee: "кофейня ", outcome: 250, deleted: true }),
      op("unique", { payee: "Аптека", deleted: true }),
    ]);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.dup.hasTwin).toBe(true);
    expect(byId.unique.hasTwin).toBe(false);
  });

  it("спрятанная у нас операция двойником не считается", () => {
    const out = run(
      [op("hiddenTwin", { payee: "Кофейня" }), op("dup", { payee: "Кофейня", deleted: true })],
      { deletedIds: ["hiddenTwin"] }
    );
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.dup.hasTwin).toBe(false);
  });

  it("удаление у нас, ещё не отправленное, — «ждёт отправки»", () => {
    const out = run([op("mine")], { deletedIds: ["mine"], deletedAt: { mine: 42 } });
    expect(out).toEqual([expect.objectContaining({ id: "mine", status: "delete-pending", deletedAt: 42 })]);
  });

  it("отправленное удаление, которое кэш уже выбросил, берётся из снимка", () => {
    const snap = op("pushed", { payee: "Такси" });
    const out = run([op("other")], { deletedIds: ["pushed"], payloads: { pushed: snap }, deletedAt: { pushed: 7 } });
    expect(out).toEqual([expect.objectContaining({ id: "pushed", status: "deleted", deletedAt: 7 })]);
    expect(out[0].zen.payee).toBe("Такси");
  });

  it("возвращённая, но ещё не отправленная — «вернётся»", () => {
    // Удалена в Дзен-мани, снимок сохранён, у нас не спрятана.
    const tomb = op("back", { deleted: true });
    expect(run([tomb], { payloads: { back: tomb } })[0].status).toBe("restore-pending");
    // Наше отправленное удаление, которое человек вернул: в кэше строки нет.
    const snap = op("undo");
    expect(run([], { payloads: { undo: snap } })[0].status).toBe("restore-pending");
  });

  it("снимок операции, которая снова живая в кэше, в список не попадает", () => {
    expect(run([op("alive")], { payloads: { alive: op("alive") } })).toEqual([]);
  });

  it("twinKey не зависит от регистра и пробелов получателя", () => {
    expect(twinKey(op("a", { payee: " Лента " }))).toBe(twinKey(op("b", { payee: "лента" })));
  });
});

describe("лента «Удалённых»: порядок и дни", () => {
  const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).getTime();
  const row = (id: string, date: string, deletedAt: number | null, amountBase = 100) => ({
    id,
    deletedAt,
    tx: txFixture({ id, date, amountBase, createdAt: `${date}T10:00:00` }),
  });
  const rows = [
    row("a", "2026-09-01", at(14, 9), 500),
    row("b", "2026-09-10", at(12), 50),
    row("c", "2026-09-10", null, 900),
    row("d", "2026-08-20", at(14, 18), 10),
  ];
  const order = (list: { id: string }[]) => list.map((r) => r.id);

  it("по дате операции — свежие первыми", () => {
    expect(order(sortDeleted(rows, "date-desc"))).toEqual(["b", "c", "a", "d"]);
    expect(order(sortDeleted(rows, "date-asc"))).toEqual(["d", "a", "b", "c"]);
  });

  it("по удалению — без времени удаления в конце при любом направлении", () => {
    expect(order(sortDeleted(rows, "deleted-desc"))).toEqual(["d", "a", "b", "c"]);
    expect(order(sortDeleted(rows, "deleted-asc"))).toEqual(["b", "a", "d", "c"]);
  });

  it("по сумме", () => {
    expect(order(sortDeleted(rows, "amount-desc"))).toEqual(["c", "a", "b", "d"]);
  });

  it("дни по дате операции", () => {
    const days = groupDeleted(sortDeleted(rows, "date-desc"), "date-desc")!;
    expect(days.map((d) => [d.ymd, order(d.rows)])).toEqual([
      ["2026-09-10", ["b", "c"]],
      ["2026-09-01", ["a"]],
      ["2026-08-20", ["d"]],
    ]);
    expect(days[0].txs.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("дни по удалению — местный день, неизвестные отдельным днём", () => {
    const days = groupDeleted(sortDeleted(rows, "deleted-desc"), "deleted-desc")!;
    expect(days.map((d) => [d.key, order(d.rows)])).toEqual([
      ["2026-09-14", ["d", "a"]],
      ["2026-09-12", ["b"]],
      ["unknown", ["c"]],
    ]);
    expect(dayOfMs(at(14, 23))).toBe("2026-09-14");
  });

  it("по сумме дней нет", () => {
    expect(groupDeleted(rows, "amount-asc")).toBeNull();
  });
});
