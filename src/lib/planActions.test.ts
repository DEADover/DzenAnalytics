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
        tx({ id: "best" }),
        tx({ id: "linked", linked: true }),
        tx({ id: "income", kind: "income" }),
        tx({ id: "close", amount: 690, date: "2026-10-01" }),
      ],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["best", "close"]);
  });

  it("непохожее не показывается: чужая категория, та же категория с далёкой суммой", () => {
    const list = linkCandidates(
      plan,
      [
        tx({ id: "paper", amount: 200, category: "Товары для дома", account: "Сбер" }),
        tx({ id: "year", amount: 4700 }),
        tx({ id: "usd", amount: 1, account: "FFin $" }),
        tx({ id: "ok", amount: 699 }),
      ],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["ok"]);
  });

  it("похоже по контрагенту с близкой суммой или по счёту с суммой ±5%", () => {
    const list = linkCandidates(
      { ...plan, payee: "Google" },
      [
        tx({ id: "payee", amount: 750, category: "Прочее", account: "Сбер", payee: "google" }),
        tx({ id: "acc", amount: 710, category: "Прочее" }),
        tx({ id: "no", amount: 780, category: "Прочее" }),
      ],
      "2026-10-07"
    );
    expect(list.map((t) => t.id).sort()).toEqual(["acc", "payee"]);
  });

  it("один контрагент не делает похожим: другие покупки того же магазина мимо", () => {
    // План — подписка Ozon Premium на 199 ₽; салфетки и продукты с Ozon — не она.
    const list = linkCandidates(
      { ...plan, amount: 199, payee: "Ozon", category: "Интернет-покупки / Подписки", account: "Ozon" },
      [
        tx({ id: "alice", amount: 199, category: "Интернет-покупки / Подписки", payee: "Yandex" }),
        tx({ id: "wipes", amount: 560, category: "Товары для дома", account: "Ozon", payee: "Ozon" }),
        tx({ id: "fresh", amount: 2650, category: "Еда дома", payee: "Ozon" }),
      ],
      "2026-10-07"
    );
    expect(list.map((t) => t.id)).toEqual(["alice"]);
  });

  it("с поиском признаки не нужны — всё окно", () => {
    const list = linkCandidates(
      plan,
      [tx({ id: "paper", amount: 200, category: "Товары для дома", account: "Сбер" })],
      "2026-10-07",
      40,
      true
    );
    expect(list.map((t) => t.id)).toEqual(["paper"]);
  });

  it("окно — две недели до плана и до сегодня", () => {
    const list = linkCandidates(
      plan,
      [
        tx({ id: "old", date: "2026-09-20" }),
        tx({ id: "future", date: "2026-10-20" }),
        tx({ id: "ok", date: "2026-09-25" }),
      ],
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

describe("новый план («Сделать регулярной»)", () => {
  const fresh = reminder({ id: "new", startDate: "2026-11-05" });
  const dates = [
    marker({ id: "n1", reminder: "new", date: "2026-11-05" }),
    marker({ id: "n2", reminder: "new", date: "2026-12-05" }),
  ];
  const create: PlanAction = { kind: "create", markerId: "new", date: "2026-11-05", title: "Google", reminder: fresh, markers: dates };
  const opts = (over: Partial<Parameters<typeof buildPlanPush>[3]> = {}) => ({
    liveTxIds: new Set<string>(),
    readyDraftIds: new Set<string>(),
    pendingDraftIds: new Set<string>(),
    instrumentOf: inst,
    ...over,
  });

  it("сразу виден в ленте вместе с датами", () => {
    const o = applyPlanActions([marker()], [reminder()], [create], inst);
    expect(o.reminders.map((r) => r.id)).toEqual(["r1", "new"]);
    expect(o.markers.map((m) => m.id)).toEqual(["m1", "n1", "n2"]);
  });

  it("уходит правилом и всеми датами, со свежей меткой", () => {
    const p = buildPlanPush([create], [marker()], [reminder()], opts(), 777);
    expect(p.reminders).toEqual([expect.objectContaining({ id: "new", changed: 777 })]);
    expect(p.markers.map((m) => [m.id, m.changed])).toEqual([
      ["n1", 777],
      ["n2", 777],
    ]);
    expect(p.doneIds).toEqual(["new"]);
  });

  it("правка его даты до отправки уезжает в той же дате", () => {
    const edit: PlanAction = { kind: "edit", scope: "date", markerId: "n2", date: "2026-12-05", title: "Google", patch: { amount: 900 } };
    const p = buildPlanPush([create, edit], [], [], opts(), 1);
    expect(p.markers.find((m) => m.id === "n2")).toMatchObject({ outcome: 900 });
    expect(p.markers).toHaveLength(2);
  });

  it("снятая в ленте дата не создаётся, снятая цепочка — весь план", () => {
    const oneDate = buildPlanPush([create], [], [], opts({ deletedMarkers: new Map([["n1", false]]) }), 1);
    expect(oneDate.markers.map((m) => m.id)).toEqual(["n2"]);
    expect(oneDate.reminders).toHaveLength(1);

    const chain = buildPlanPush([create], [], [], opts({ deletedMarkers: new Map([["n2", true]]) }), 1);
    expect(chain.markers).toEqual([]);
    expect(chain.reminders).toEqual([]);
    expect(chain.doneIds).toEqual(["new"]);
  });

  it("уже в облаке — второй раз не отправляется", () => {
    const p = buildPlanPush([create], dates, [fresh], opts(), 1);
    expect(p.reminders).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(p.doneIds).toEqual(["new"]);
  });
});

describe("смена расписания цепочки", () => {
  const opts = {
    liveTxIds: new Set<string>(),
    readyDraftIds: new Set<string>(),
    pendingDraftIds: new Set<string>(),
    instrumentOf: inst,
  };
  const markers = [
    marker({ id: "past", date: "2026-09-06", state: "processed" }),
    marker({ id: "m1", date: "2026-10-06" }),
    marker({ id: "m2", date: "2026-11-06" }),
    marker({ id: "other", reminder: "r2", date: "2026-11-06" }),
  ];
  const fresh = (id: string, date: string) => marker({ id, date, changed: 0 });
  const action: PlanAction = {
    ...base,
    kind: "edit",
    scope: "chain",
    markerId: "m2",
    patch: { amount: 800 },
    schedule: {
      rule: { interval: "month", step: 1, points: [0], startDate: "2026-10-20", endDate: null },
      markers: [fresh("n1", "2026-10-20"), fresh("n2", "2026-11-20")],
    },
  };

  it("незакрытые даты плана уходят все (и раньше той, с которой правили), закрытые и чужие — остаются", () => {
    const o = applyPlanActions(markers, [reminder(), reminder({ id: "r2" })], [action], inst);
    expect(o.markers.map((m) => m.id).sort()).toEqual(["n1", "n2", "other", "past"]);
    expect([...o.dropped].sort()).toEqual(["m1", "m2"]);
    // Правка сумм ложится и на новые даты, правило получает расписание.
    expect(o.markers.find((m) => m.id === "n1")?.outcome).toBe(800);
    expect(o.reminders.find((r) => r.id === "r1")).toMatchObject({ startDate: "2026-10-20", outcome: 800 });
  });

  it("отправка: правило, новые даты и удаление старых — одним запросом", () => {
    const p = buildPlanPush([action], markers, [reminder(), reminder({ id: "r2" })], opts, 777);
    expect(p.reminders).toEqual([expect.objectContaining({ id: "r1", startDate: "2026-10-20", changed: 777 })]);
    expect(p.markers.map((m) => m.id).sort()).toEqual(["n1", "n2"]);
    expect(p.markers.every((m) => m.changed === 777)).toBe(true);
    expect(p.deletions).toEqual([
      { id: "m1", object: "reminderMarker", user: 1, stamp: 777 },
      { id: "m2", object: "reminderMarker", user: 1, stamp: 777 },
    ]);
    expect(p.doneIds).toEqual(["m2"]);
  });

  it("смена только интервала — тоже правка правила", () => {
    const weekly: PlanAction = {
      ...action,
      patch: {},
      schedule: { rule: { interval: "day", step: 14, points: [0], startDate: "2026-01-06", endDate: null }, markers: [] },
    };
    const p = buildPlanPush([weekly], markers, [reminder()], opts, 777);
    expect(p.reminders).toEqual([expect.objectContaining({ interval: "day", step: 14 })]);
  });
});
