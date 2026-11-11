import { describe, expect, it, vi } from "vitest";

// Хранилища тянут за собой IndexedDB — для расчёта плана они не нужны.
vi.mock("./db", () => ({ loadJSON: async () => null, saveJSON: async () => {} }));

import { planRefresh } from "./crossTab";

describe("что перечитать после записи в другой вкладке", () => {
  it("правка операции — очередь правок и пересборка ленты из памяти", () => {
    const plan = planRefresh(["transactionEdits", "transactionEditOrigins"]);
    expect(plan.queues).toHaveLength(1);
    expect(plan).toMatchObject({ cache: false, zen: false, categoryMeta: false, data: "refresh" });
  });

  it("синхронизация — кэш, состояние подключения, категории и лента с диска", () => {
    const plan = planRefresh(["zenmoneyCache", "#transactions", "categoryMeta", "zenmoneyServerTimestamp", "zenmoneyLastSyncAt"]);
    expect(plan).toMatchObject({ cache: true, zen: true, categoryMeta: true, data: "hydrate", queues: [] });
  });

  it("кэш сам по себе — не «состояние подключения»", () => {
    expect(planRefresh(["zenmoneyCache"]).zen).toBe(false);
  });

  it("настройки вида другой вкладки нас не касаются", () => {
    const plan = planRefresh(["displaySettings", "filterMemory", "dashboardLayout"]);
    expect(plan).toEqual({ queues: [], cache: false, categoryMeta: false, zen: false, data: null });
  });

  it("записано всё сразу (бэкап, очистка) — перечитываем всё", () => {
    const plan = planRefresh(["*"]);
    expect(plan.queues.length).toBeGreaterThan(10);
    expect(plan).toMatchObject({ cache: true, zen: true, categoryMeta: true, data: "hydrate" });
  });
});
