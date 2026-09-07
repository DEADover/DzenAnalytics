import { describe, it, expect } from "vitest";
import { foreignSnapshots } from "./cloudSnapshots";
import type { CloudSnapshotSummary } from "./cloudSnapshots";

const snap = (id: string, userId: number | null): CloudSnapshotSummary =>
  ({ id, userId }) as CloudSnapshotSummary;

describe("foreignSnapshots", () => {
  it("находит снимки чужого аккаунта", () => {
    const out = foreignSnapshots([snap("a", 1), snap("b", 2), snap("c", 2)], 2);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("снимки без привязки к аккаунту не трогает", () => {
    // Так выглядят копии, снятые до появления поля: они вполне могут быть
    // своими. Выбросить чужое — уборка, выбросить неизвестное — потеря
    // страховки.
    const out = foreignSnapshots([snap("legacy", null), snap("mine", 7)], 7);
    expect(out).toEqual([]);
  });

  it("все свои — выбрасывать нечего", () => {
    expect(foreignSnapshots([snap("a", 5), snap("b", 5)], 5)).toEqual([]);
  });

  it("все чужие — выбрасываются все", () => {
    expect(foreignSnapshots([snap("a", 1), snap("b", 1)], 9)).toHaveLength(2);
  });

  it("пустой список не роняет", () => {
    expect(foreignSnapshots([], 1)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Перенос планов

import { remapPlans, type PlanRemapMaps } from "./cloudSnapshots";
import type { ZenReminder, ZenReminderMarker } from "./zenmoney";

/** Карты «старый id → новый» из простого перечисления. */
const m = (pairs: [string, string][]) => new Map(pairs);

const maps = (over: Partial<PlanRemapMaps> = {}): PlanRemapMaps => ({
  accountIdMap: m([["acc", "ACC"]]),
  tagIdMap: m([["tag", "TAG"]]),
  merchantIdMap: m([["mer", "MER"]]),
  reminderIdMap: m([["rem", "REM"]]),
  markerIdMap: m([["mk", "MK"]]),
  debtIdRemap: null,
  freshIds: true,
  ...over,
});

const rem = (over: Partial<ZenReminder> = {}) =>
  ({
    id: "rem",
    user: 1,
    changed: 0,
    interval: "month",
    step: 1,
    startDate: "2026-09-15",
    incomeAccount: "acc",
    outcomeAccount: "acc",
    tag: ["tag"],
    merchant: "mer",
    ...over,
  }) as unknown as ZenReminder;

const mark = (over: Partial<ZenReminderMarker> = {}) =>
  ({
    id: "mk",
    user: 1,
    changed: 0,
    date: "2026-09-15",
    income: 0,
    incomeInstrument: 2,
    outcome: 100,
    outcomeInstrument: 2,
    incomeAccount: "acc",
    outcomeAccount: "acc",
    tag: ["tag"],
    merchant: "mer",
    reminder: "rem",
    state: "planned",
    ...over,
  }) as ZenReminderMarker;

describe("remapPlans", () => {
  it("перенумеровывает план и все его ссылки", () => {
    const out = remapPlans([rem()], [], maps());
    const r = out.reminders[0];
    expect(r.id).toBe("REM");
    expect(r.incomeAccount).toBe("ACC");
    expect(r.outcomeAccount).toBe("ACC");
    expect(r.tag).toEqual(["TAG"]);
    expect(r.merchant).toBe("MER");
  });

  it("маркер получает новый номер и ссылку на новый план", () => {
    const out = remapPlans([rem()], [mark()], maps());
    expect(out.markers[0].id).toBe("MK");
    expect(out.markers[0].reminder).toBe("REM");
  });

  it("операция получает новый номер маркера", () => {
    const out = remapPlans([rem()], [mark()], maps());
    expect(out.markerRef("mk")).toBe("MK");
  });

  it("без перенумерации ничего не трогает", () => {
    // Откат в свой аккаунт без новых номеров: ссылки уже верные.
    const out = remapPlans([rem()], [mark()], maps({ freshIds: false }));
    expect(out.reminders[0].id).toBe("rem");
    expect(out.markers[0].reminder).toBe("rem");
    expect(out.markerRef("mk")).toBe("mk");
  });
});

describe("remapPlans: неразрешимые ссылки", () => {
  it("план без разрешимого счёта не отправляется", () => {
    // Счёт обязателен: в чужом аккаунте такой план указывал бы в пустоту.
    const out = remapPlans([rem({ outcomeAccount: "нет-такого" })], [], maps());
    expect(out.reminders).toEqual([]);
  });

  it("неразрешимую категорию снимает, но план оставляет", () => {
    const out = remapPlans([rem({ tag: ["нет-такой"] })], [], maps());
    expect(out.reminders).toHaveLength(1);
    expect(out.reminders[0].tag).toBeNull();
  });

  it("неразрешимого контрагента снимает, но план оставляет", () => {
    const out = remapPlans([rem({ merchant: "нет-такого" })], [], maps());
    expect(out.reminders).toHaveLength(1);
    expect(out.reminders[0].merchant).toBeNull();
  });

  it("из нескольких категорий оставляет разрешимые", () => {
    const mp = maps({ tagIdMap: m([["tag", "TAG"], ["tag2", "TAG2"]]) });
    const out = remapPlans([rem({ tag: ["tag", "нет", "tag2"] })], [], mp);
    expect(out.reminders[0].tag).toEqual(["TAG", "TAG2"]);
  });

  it("маркер без своего плана не отправляется", () => {
    // Иначе плановая операция висит без плана, и убрать её из интерфейса
    // Дзен-мани уже нельзя.
    const out = remapPlans([], [mark()], maps());
    expect(out.markers).toEqual([]);
  });

  it("маркер отброшенного плана отбрасывается вместе с ним", () => {
    const out = remapPlans(
      [rem({ outcomeAccount: "нет-такого" })],
      [mark()],
      maps()
    );
    expect(out.reminders).toEqual([]);
    expect(out.markers).toEqual([]);
  });

  it("ссылка операции на недоехавший маркер становится пустой", () => {
    // Саму операцию при этом не теряем — это настоящие деньги, а маркер лишь
    // пометка «выполнено по плану».
    const out = remapPlans([], [mark()], maps());
    expect(out.markerRef("mk")).toBeNull();
  });

  it("долговой счёт переводится на существующий", () => {
    const mp = maps({
      accountIdMap: m([["acc", "ACC"]]),
      debtIdRemap: { from: "debt-old", to: "debt-new" },
    });
    const out = remapPlans([rem({ outcomeAccount: "debt-old" })], [], mp);
    expect(out.reminders[0].outcomeAccount).toBe("debt-new");
  });

  it("удалённые маркеры переносятся наравне с живыми", () => {
    // Снимок — полная копия, а история удалений это данные: ровно та же
    // причина, по которой мы шлём удалённые операции.
    const out = remapPlans([rem()], [mark({ state: "deleted" })], maps());
    expect(out.markers).toHaveLength(1);
    expect(out.markers[0].state).toBe("deleted");
  });

  it("пусто на входе — пусто на выходе", () => {
    const out = remapPlans([], [], maps());
    expect(out.reminders).toEqual([]);
    expect(out.markers).toEqual([]);
  });
});
