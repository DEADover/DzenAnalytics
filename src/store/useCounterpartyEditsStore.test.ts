import { describe, it, expect, beforeEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: проверяем и что записано, и сколько
// раз — пачка контрагентов обязана уходить одной записью.
const disk = vi.hoisted(() => new Map<string, unknown>());
const writes = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    writes.count++;
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useCounterpartyEditsStore } from "./useCounterpartyEditsStore";

const store = () => useCounterpartyEditsStore.getState();

beforeEach(async () => {
  disk.clear();
  writes.count = 0;
  useCounterpartyEditsStore.setState({
    renames: {},
    created: [],
    deleted: [],
    merges: {},
    loaded: true,
  });
});

describe("removeManyNew — откат заведённых импортом контрагентов", () => {
  it("КЛЮЧЕВОЕ: черновики удаляются, а в облако ничего не просится", () => {
    // Записи туда ещё не уезжали: ставить ZenDeletion — значит просить
    // Дзен-мани удалить то, чего у него нет.
    return (async () => {
      await store().addManyNew([
        { id: "cp-1", title: "Ларёк" },
        { id: "cp-2", title: "Тётя Маша" },
      ]);
      await store().removeManyNew(["cp-1", "cp-2"]);
      expect(store().created).toEqual([]);
      expect(store().deleted).toEqual([]);
    })();
  });

  it("чужие записи не задевает", async () => {
    await store().addManyNew([
      { id: "cp-1", title: "Ларёк" },
      { id: "cp-2", title: "Тётя Маша" },
    ]);
    await store().removeManyNew(["cp-1", "нет-такого"]);
    expect(store().created).toEqual([{ id: "cp-2", title: "Тётя Маша" }]);
  });

  it("переименование удалённого черновика уходит вместе с ним", async () => {
    await store().addManyNew([{ id: "cp-1", title: "Ларёк" }]);
    await store().rename("cp-1", "Ларёк у дома");
    await store().removeManyNew(["cp-1"]);
    expect(store().renames).toEqual({});
  });

  it("пачка — одна запись на диск, а не по одной на контрагента", async () => {
    await store().addManyNew([
      { id: "cp-1", title: "A" },
      { id: "cp-2", title: "B" },
      { id: "cp-3", title: "C" },
    ]);
    writes.count = 0;
    await store().removeManyNew(["cp-1", "cp-2", "cp-3"]);
    expect(writes.count).toBe(1);
  });

  it("нечего удалять — на диск не ходим вовсе", async () => {
    await store().removeManyNew(["cp-1"]);
    expect(writes.count).toBe(0);
  });
});
