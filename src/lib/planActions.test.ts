import { describe, it, expect } from "vitest";
import type { ZenReminder, ZenReminderMarker } from "./zenmoney";
import {
  applyPlanActions,
  buildPlanPush,
  linkCandidates,
  type PlanAction,
} from "./planActions";

const inst = (acc: string) => (acc === "usd" ? 2 : 1);

const marker = (over: Partial<ZenReminderMarker> = {}): ZenReminderMarker => ({
  id: "m1",
  user: 1,
  changed: 100,
  date: "2026-10-06",
  income: 0,
  incomeInstrument: 1,
  outcome: 700,
  outcomeInstrument: 1,
  incomeAccount: "tb",
  outcomeAccount: "tb",
  tag: ["subs"],
  reminder: "r1",
  state: "planned",
  payee: "Google",
  comment: "Google One 2Tb",
  merchant: null,
  ...over,
});

const reminder = (over: Partial<ZenReminder> = {}): ZenReminder => ({
  id: "r1",
  user: 1,
  changed: 100,
  interval: "month",
  step: 1,
  points: [0],
  startDate: "2026-01-06",
  endDate: null,
  income: 0,
  incomeInstrument: 1,
  incomeAccount: "tb",
  outcome: 700,
  outcomeInstrument: 1,
  outcomeAccount: "tb",
  tag: ["subs"],
  payee: "Google",
  comment: "Google One 2Tb",
  ...over,
});

const base = { date: "2026-10-06", title: "Google" };

describe("applyPlanActions", () => {
  it("факт и связь убирают дату из запланированных", () => {
    const actions: PlanAction[] = [{ ...base, kind: "link", markerId: "m1", txId: "t1" }];
    const o = applyPlanActions([marker(), marker({ id: "m2", date: "2026-11-06" })], [reminder()], actions, inst);
    expect(o.markers.map((m) => m.id)).toEqual(["m2"]);
    expect([...o.processed]).toEqual(["m1"]);
  });

  it("правка одной даты не трогает остальные и правило", () => {
    const o = applyPlanActions(
      [marker(), marker({ id: "m2", date: "2026-11-06" })],
      [reminder()],
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { amount: 800, date: "2026-10-08" } }],
      inst
    );
    expect(o.markers.find((m) => m.id === "m1")).toMatchObject({ outcome: 800, date: "2026-10-08" });
    expect(o.markers.find((m) => m.id === "m2")?.outcome).toBe(700);
    expect(o.reminders[0].outcome).toBe(700);
  });

  it("правка цепочки меняет правило и даты с этой и дальше, но не прошлые", () => {
    const o = applyPlanActions(
      [
        marker({ id: "m0", date: "2026-09-06" }),
        marker(),
        marker({ id: "m2", date: "2026-11-06" }),
      ],
      [reminder()],
      [{ ...base, kind: "edit", scope: "chain", markerId: "m1", patch: { amount: 900, comment: "2Tb+" } }],
      inst
    );
    const by = Object.fromEntries(o.markers.map((m) => [m.id, m.outcome]));
    expect(by).toEqual({ m0: 700, m1: 900, m2: 900 });
    expect(o.reminders[0]).toMatchObject({ outcome: 900, comment: "2Tb+" });
  });

  it("цепочка не меняет день, даже если он передан", () => {
    const o = applyPlanActions(
      [marker()],
      [reminder()],
      [{ ...base, kind: "edit", scope: "chain", markerId: "m1", patch: { date: "2026-10-09", amount: 1 } }],
      inst
    );
    expect(o.markers[0].date).toBe("2026-10-06");
  });

  it("перенос разового плана двигает и правило", () => {
    const o = applyPlanActions(
      [marker()],
      [reminder({ interval: null, step: null, points: null, startDate: "2026-10-06", endDate: "2026-10-06" })],
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { date: "2026-10-10" } }],
      inst
    );
    expect(o.reminders[0]).toMatchObject({ startDate: "2026-10-10", endDate: "2026-10-10" });
  });

  it("смена счёта у расхода переводит обе ноги и валюту", () => {
    const o = applyPlanActions(
      [marker()],
      [reminder()],
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { account: "usd" } }],
      inst
    );
    expect(o.markers[0]).toMatchObject({
      outcomeAccount: "usd",
      incomeAccount: "usd",
      outcomeInstrument: 2,
      incomeInstrument: 2,
    });
  });

  it("доход правит сумму зачисления", () => {
    const o = applyPlanActions(
      [marker({ outcome: 0, income: 145000 })],
      [reminder()],
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { amount: 150000 } }],
      inst
    );
    expect(o.markers[0]).toMatchObject({ income: 150000, outcome: 0 });
  });

  it("у перевода в одной валюте зачисление равно списанию", () => {
    const o = applyPlanActions(
      [marker({ income: 5000, outcome: 5000, incomeAccount: "save" })],
      [reminder()],
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { amount: 6000 } }],
      inst
    );
    expect(o.markers[0]).toMatchObject({ income: 6000, outcome: 6000 });
  });
});

describe("buildPlanPush", () => {
  const opts = (over: Partial<Parameters<typeof buildPlanPush>[3]> = {}) => ({
    liveTxIds: new Set<string>(),
    readyDraftIds: new Set<string>(),
    pendingDraftIds: new Set<string>(),
    instrumentOf: inst,
    ...over,
  });

  it("факт: дата закрывается, только если операция уезжает тем же запросом", () => {
    const a: PlanAction[] = [{ ...base, kind: "fact", markerId: "m1", txId: "d1" }];
    const ready = buildPlanPush(a, [marker()], [reminder()], opts({ readyDraftIds: new Set(["d1"]) }), 555);
    expect(ready.markers).toEqual([expect.objectContaining({ id: "m1", state: "processed", changed: 555 })]);
    expect(ready.doneIds).toEqual(["m1"]);

    const waiting = buildPlanPush(a, [marker()], [reminder()], opts({ pendingDraftIds: new Set(["d1"]) }), 555);
    expect(waiting.markers).toEqual([]);
    expect(waiting.doneIds).toEqual([]);

    const gone = buildPlanPush(a, [marker()], [reminder()], opts(), 555);
    expect(gone.markers).toEqual([]);
    expect(gone.doneIds).toEqual(["m1"]);
  });

  it("связь: ссылка у операции и закрытая дата", () => {
    const p = buildPlanPush(
      [{ ...base, kind: "link", markerId: "m1", txId: "t1" }],
      [marker()],
      [reminder()],
      opts({ liveTxIds: new Set(["t1"]) }),
      555
    );
    expect(p.links).toEqual([{ txId: "t1", markerId: "m1" }]);
    expect(p.markers[0].state).toBe("processed");
  });

  it("связь с черновиком ждёт, пока он не уедет", () => {
    const a: PlanAction[] = [{ ...base, kind: "link", markerId: "m1", txId: "d1" }];
    const waiting = buildPlanPush(a, [marker()], [reminder()], opts({ pendingDraftIds: new Set(["d1"]) }), 555);
    expect(waiting.doneIds).toEqual([]);
    expect(waiting.markers).toEqual([]);
    const ready = buildPlanPush(a, [marker()], [reminder()], opts({ readyDraftIds: new Set(["d1"]) }), 555);
    expect(ready.links).toEqual([{ txId: "d1", markerId: "m1" }]);
    expect(ready.markers[0].state).toBe("processed");
  });

  it("связь с операцией, которой уже нет, снимается без отправки", () => {
    const p = buildPlanPush(
      [{ ...base, kind: "link", markerId: "m1", txId: "t1" }],
      [marker()],
      [reminder()],
      opts(),
      555
    );
    expect(p.links).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(p.doneIds).toEqual(["m1"]);
  });

  it("правка цепочки уезжает правилом и изменившимися датами", () => {
    const p = buildPlanPush(
      [{ ...base, kind: "edit", scope: "chain", markerId: "m1", patch: { amount: 900 } }],
      [marker({ id: "m0", date: "2026-09-06" }), marker(), marker({ id: "m2", date: "2026-11-06" })],
      [reminder()],
      opts(),
      555
    );
    expect(p.markers.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(p.reminders).toEqual([expect.objectContaining({ id: "r1", outcome: 900, changed: 555 })]);
  });

  it("правка «на то же самое» ничего не шлёт, но снимается", () => {
    const p = buildPlanPush(
      [{ ...base, kind: "edit", scope: "date", markerId: "m1", patch: { amount: 700 } }],
      [marker()],
      [reminder()],
      opts(),
      555
    );
    expect(p.markers).toEqual([]);
    expect(p.doneIds).toEqual(["m1"]);
  });

  it("даты уже нет — действие снимается", () => {
    const p = buildPlanPush(
      [{ ...base, kind: "edit", scope: "date", markerId: "gone", patch: { amount: 1 } }],
      [marker()],
      [reminder()],
      opts(),
      555
    );
    expect(p.doneIds).toEqual(["gone"]);
    expect(p.markers).toEqual([]);
  });
});

describe("linkCandidates", () => {
  const tx = (over: Partial<Parameters<typeof linkCandidates>[1][number]>) => ({
    id: "t",
    date: "2026-10-05",
    kind: "expense",
    amount: 700,
    category: "Подписки",
    account: "Т-Банк",
    linked: false,
    ...over,
  });
  const plan = { date: "2026-10-06", kind: "expense", amount: 700, category: "Подписки", account: "Т-Банк" };

  it("похожие выше, связанные и другой вид — мимо", () => {
    const list = linkCandidates(
      plan,
      [
        tx({ id: "far", amount: 5000, category: "Еда" }),
        tx({ id: "best" }),
        tx({ id: "linked", linked: true }),
        tx({ id: "income", kind: "income" }),
        tx({ id: "close", amount: 690, date: "2026-10-01" }),
      ],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["best", "close", "far"]);
  });

  it("окно — месяц до плана и до сегодня", () => {
    const list = linkCandidates(
      plan,
      [tx({ id: "old", date: "2026-08-01" }), tx({ id: "future", date: "2026-10-20" }), tx({ id: "ok" })],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["ok"]);
  });

  it("доходный план подбирает и возвраты", () => {
    const list = linkCandidates(
      { ...plan, kind: "income" },
      [tx({ id: "r", kind: "refund" }), tx({ id: "e" })],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["r"]);
  });
});
