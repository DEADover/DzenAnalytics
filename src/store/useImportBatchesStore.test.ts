import { describe, it, expect, beforeEach, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useImportBatchesStore, fileFingerprint } from "./useImportBatchesStore";

const store = () => useImportBatchesStore.getState();

const batch = (id: string, draftIds: string[]) => ({
  id,
  fileName: `${id}.xlsx`,
  importedAt: "2026-08-18T10:00:00.000Z",
  draftIds,
});

beforeEach(() => {
  disk.clear();
  useImportBatchesStore.setState({ batches: [], loaded: true });
});

describe("markPushedByDrafts — партия после отправки не отменяется", () => {
  it("КЛЮЧЕВОЕ: уехавшая партия помечается, и кнопка отмены исчезает", async () => {
    // «Отменить импорт» после отправки лгало бы: черновиков нет, удалять
    // нечего, а операции уже в Дзен-мани.
    await store().add(batch("a", ["d1", "d2"]));
    await store().markPushedByDrafts(["d1", "d2"], "2026-08-18T11:00:00.000Z");
    expect(store().batches[0].pushedAt).toBe("2026-08-18T11:00:00.000Z");
    expect(store().batches.find((b) => !b.pushedAt)).toBeUndefined();
  });

  it("хватает одной уехавшей операции: отменять партию уже нельзя", async () => {
    await store().add(batch("a", ["d1", "d2"]));
    await store().markPushedByDrafts(["d2"], "2026-08-18T11:00:00.000Z");
    expect(store().batches[0].pushedAt).toBeTruthy();
  });

  it("чужие партии не задевает", async () => {
    await store().add(batch("a", ["d1"]));
    await store().add(batch("b", ["d2"]));
    await store().markPushedByDrafts(["d2"], "2026-08-18T11:00:00.000Z");
    const byId = Object.fromEntries(store().batches.map((b) => [b.id, b.pushedAt]));
    expect(byId.b).toBeTruthy();
    expect(byId.a).toBeUndefined();
  });

  it("повторная отметка ничего не переписывает", async () => {
    await store().add(batch("a", ["d1"]));
    await store().markPushedByDrafts(["d1"], "2026-08-18T11:00:00.000Z");
    await store().markPushedByDrafts(["d1"], "2026-08-18T12:00:00.000Z");
    expect(store().batches[0].pushedAt).toBe("2026-08-18T11:00:00.000Z");
  });
});

describe("fileFingerprint", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

  it("тот же файл — тот же отпечаток, другой — другой", () => {
    expect(fileFingerprint("a.xlsx", bytes("hello"))).toBe(
      fileFingerprint("a.xlsx", bytes("hello"))
    );
    expect(fileFingerprint("a.xlsx", bytes("hello"))).not.toBe(
      fileFingerprint("a.xlsx", bytes("hellp"))
    );
    expect(fileFingerprint("a.xlsx", bytes("hello"))).not.toBe(
      fileFingerprint("b.xlsx", bytes("hello"))
    );
  });
});
