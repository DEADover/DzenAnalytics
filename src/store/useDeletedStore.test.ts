import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: проверяем, что и под какими ключами
// записано.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useDeletedStore } from "./useDeletedStore";

const store = () => useDeletedStore.getState();

beforeEach(async () => {
  disk.clear();
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  await store().clearAll();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDeletedStore: время удаления", () => {
  it("записывает время только новым номерам", async () => {
    await store().removeMany(["a"]);
    vi.setSystemTime(2_000);
    await store().removeMany(["a", "b"]);
    expect(store().deletedAt).toEqual({ a: 1_000, b: 2_000 });
    expect(disk.get("deletedTransactionsAt")).toEqual({ a: 1_000, b: 2_000 });
  });

  it("вернули и снова удалили — время новое", async () => {
    await store().removeMany(["a"]);
    await store().restoreMany(["a"]);
    vi.setSystemTime(5_000);
    await store().removeMany(["a"]);
    expect(store().deletedAt.a).toBe(5_000);
  });

  it("отмена возврата (keepTime) оставляет прежнее время", async () => {
    await store().removeMany(["a"]);
    await store().restoreMany(["a"]);
    vi.setSystemTime(5_000);
    await store().removeMany(["a", "fresh"], { keepTime: true });
    expect(store().deletedIds).toEqual(["a", "fresh"]);
    // У «fresh» времени не было — ставится текущее.
    expect(store().deletedAt).toEqual({ a: 1_000, fresh: 5_000 });
  });

  it("поднимает номера и время с диска, clearAll стирает оба ключа", async () => {
    disk.set("deletedTransactions", ["x"]);
    disk.set("deletedTransactionsAt", { x: 42 });
    await store().hydrate();
    expect(store().deletedSet.has("x")).toBe(true);
    expect(store().deletedAt).toEqual({ x: 42 });

    await store().clearAll();
    expect(disk.get("deletedTransactions")).toEqual([]);
    expect(disk.get("deletedTransactionsAt")).toEqual({});
  });

  it("старый бэкап без ключа времени поднимается с пустым временем", async () => {
    disk.set("deletedTransactions", ["x"]);
    await store().hydrate();
    expect(store().deletedAt).toEqual({});
  });
});
