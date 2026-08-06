import { describe, it, expect, beforeEach, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import {
  useBudgetSettingsStore,
  DEFAULT_BUDGET_SETTINGS,
} from "./useBudgetSettingsStore";

const KEY = "budgetSettings";

beforeEach(() => {
  disk.clear();
  useBudgetSettingsStore.setState({ ...DEFAULT_BUDGET_SETTINGS, loaded: false });
});

describe("useBudgetSettingsStore", () => {
  it("на чистой базе берёт значения по умолчанию", async () => {
    await useBudgetSettingsStore.getState().hydrate();
    const s = useBudgetSettingsStore.getState();
    expect(s.accounts).toEqual([]);
    expect(s.perimeterTransfers).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it("настройка, добавленная позже, не приезжает пустой", async () => {
    // Сохранение из прошлой версии — без `forecastBasis` и `defaultView`.
    disk.set(KEY, { accounts: ["Карта"], perimeterTransfers: true });
    await useBudgetSettingsStore.getState().hydrate();
    const s = useBudgetSettingsStore.getState();
    expect(s.accounts).toEqual(["Карта"]);
    expect(s.perimeterTransfers).toBe(true);
    expect(s.defaultView).toBe(DEFAULT_BUDGET_SETTINGS.defaultView);
    expect(s.forecastBasis).toBe(DEFAULT_BUDGET_SETTINGS.forecastBasis);
  });

  it("правка пишется на диск без служебных полей", async () => {
    await useBudgetSettingsStore.getState().hydrate();
    await useBudgetSettingsStore.getState().update({ accounts: ["Карта"] });
    expect(disk.get(KEY)).toEqual({ ...DEFAULT_BUDGET_SETTINGS, accounts: ["Карта"] });
  });

  it("две правки подряд не затирают друг друга", async () => {
    await useBudgetSettingsStore.getState().hydrate();
    await useBudgetSettingsStore.getState().update({ accounts: ["Карта"] });
    await useBudgetSettingsStore.getState().update({ perimeterTransfers: true });
    expect(disk.get(KEY)).toMatchObject({ accounts: ["Карта"], perimeterTransfers: true });
  });
});
