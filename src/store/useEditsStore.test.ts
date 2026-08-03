import { describe, it, expect, beforeEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: здесь важно не что записано, а СКОЛЬКО
// раз — цена одной записи и есть предмет проверки.
const disk = vi.hoisted(() => new Map<string, unknown>());
const writes = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    writes.count++;
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useEditsStore } from "./useEditsStore";

beforeEach(async () => {
  disk.clear();
  writes.count = 0;
  await useEditsStore.getState().clearAll();
  writes.count = 0;
});

describe("useEditsStore: снятие правок пачкой", () => {
  it("одна запись на диск и одно уведомление подписчиков вместо N", async () => {
    // Так очередь чистится после успешной отправки. Циклом по одной это
    // означало N полных копий карты, N записей и N перерисовок всего, что
    // подписано на правки: счётчика в шапке, ленты операций, окна изменений.
    // На массовом переименовании хэштега правок бывают сотни.
    const ids = Array.from({ length: 50 }, (_, i) => `t${i}`);
    await useEditsStore.getState().setEditMany(ids, { comment: "тег" });
    writes.count = 0;

    let notifications = 0;
    const unsub = useEditsStore.subscribe(() => notifications++);
    await useEditsStore.getState().clearMany(ids);
    unsub();

    expect(writes.count).toBe(1);
    expect(notifications).toBe(1);
    expect(useEditsStore.getState().edits).toEqual({});
  });

  it("после снятия всей пачки карта пуста ровно с первого уведомления", async () => {
    // От этого зависит автоотправка: подписка в App.tsx перевзводит
    // двухсекундный таймер на каждом непустом состоянии. Пока чистили по
    // одной, карта пустела лишь на последней итерации — и уже взведённый
    // таймер потом стрелял лишним пушем с полным fetchDiff.
    const ids = ["a", "b", "c"];
    await useEditsStore.getState().setEditMany(ids, { comment: "x" });

    const sizes: number[] = [];
    const unsub = useEditsStore.subscribe((s) =>
      sizes.push(Object.keys(s.edits).length)
    );
    await useEditsStore.getState().clearMany(ids);
    unsub();

    expect(sizes).toEqual([0]);
  });

  it("снимает только названные правки, остальные остаются в очереди", async () => {
    await useEditsStore.getState().setEditMany(["a", "b", "c"], { comment: "x" });
    await useEditsStore.getState().clearMany(["a", "c"]);
    expect(Object.keys(useEditsStore.getState().edits)).toEqual(["b"]);
  });

  it("пустой список ничего не пишет", async () => {
    await useEditsStore.getState().setEdit("a", { comment: "x" });
    writes.count = 0;
    await useEditsStore.getState().clearMany([]);
    expect(writes.count).toBe(0);
    expect(Object.keys(useEditsStore.getState().edits)).toEqual(["a"]);
  });
});
