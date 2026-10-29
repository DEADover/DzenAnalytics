import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCategoryMetaStore } from "./useCategoryMetaStore";
import * as db from "../lib/db";

const load = vi.spyOn(db, "loadJSON").mockImplementation(async () => ({ Продукты: { color: 1, icon: null, picture: null } }) as never);

describe("настройки категорий: перечитывание с диска", () => {
  beforeEach(() => {
    load.mockClear();
    useCategoryMetaStore.setState({ meta: {}, loaded: false });
  });

  it("сотня одновременных вызовов — одно чтение и одно обновление", async () => {
    // Так зовут точки категорий в длинном списке, пока настройки не загружены.
    let updates = 0;
    const off = useCategoryMetaStore.subscribe(() => updates++);
    await Promise.all(Array.from({ length: 100 }, () => useCategoryMetaStore.getState().hydrate()));
    off();
    expect(load).toHaveBeenCalledTimes(1);
    expect(updates).toBe(1);
    expect(useCategoryMetaStore.getState().loaded).toBe(true);
  });

  it("после завершения чтения следующий вызов читает заново", async () => {
    await useCategoryMetaStore.getState().hydrate();
    await useCategoryMetaStore.getState().hydrate();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
