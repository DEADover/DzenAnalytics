import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSlicesStore, activeSlice, DEFAULT_SLICE_ID } from "./useSlicesStore";
import * as db from "../lib/db";

// Хранилище пишет в IDB — в тестах подменяем на память.
const store = new Map<string, unknown>();
vi.spyOn(db, "saveJSON").mockImplementation(async (k: string, v: unknown) => {
  store.set(k, v);
});
vi.spyOn(db, "loadJSON").mockImplementation(
  async (k: string) => store.get(k) as never
);

/** Сбросить только состояние стора — «как будто перезагрузили вкладку». */
function resetState() {
  useSlicesStore.setState({
    slices: [
      { id: DEFAULT_SLICE_ID, name: "Все данные", excludedCategories: [], excludedAccounts: [] },
    ],
    activeId: DEFAULT_SLICE_ID,
    loaded: false,
  });
}

function reset() {
  store.clear();
  resetState();
}

describe("разрезы данных (#14)", () => {
  beforeEach(reset);

  it("поднимает старый список исключённых категорий как первый разрез", async () => {
    store.set("analyticsExcludedCategories", ["Переводы", "Еда / Кафе"]);
    await useSlicesStore.getState().hydrate();
    const s = useSlicesStore.getState();
    expect(s.slices).toHaveLength(1);
    expect(activeSlice(s).excludedCategories).toEqual(["Переводы", "Еда / Кафе"]);
  });

  it("на чистой установке даёт один пустой разрез", async () => {
    await useSlicesStore.getState().hydrate();
    const s = useSlicesStore.getState();
    expect(s.slices).toHaveLength(1);
    expect(activeSlice(s).excludedCategories).toEqual([]);
  });

  it("новый разрез копирует исключения того, из которого создан", async () => {
    await useSlicesStore.getState().hydrate();
    await useSlicesStore.getState().toggleCategory("Переводы");
    const id = await useSlicesStore.getState().add("Личное", DEFAULT_SLICE_ID);
    const s = useSlicesStore.getState();
    expect(s.activeId).toBe(id); // созданный сразу становится активным
    expect(activeSlice(s).name).toBe("Личное");
    expect(activeSlice(s).excludedCategories).toEqual(["Переводы"]);
  });

  it("разрезы не делят исключения между собой", async () => {
    await useSlicesStore.getState().hydrate();
    const id = await useSlicesStore.getState().add("Бизнес");
    await useSlicesStore.getState().toggleCategory("Зарплата");
    await useSlicesStore.getState().setActive(DEFAULT_SLICE_ID);

    const s = useSlicesStore.getState();
    expect(activeSlice(s).excludedCategories).toEqual([]);
    expect(s.slices.find((x) => x.id === id)!.excludedCategories).toEqual(["Зарплата"]);
  });

  it("повторное нажатие возвращает категорию в аналитику", async () => {
    await useSlicesStore.getState().hydrate();
    await useSlicesStore.getState().toggleCategory("Переводы");
    await useSlicesStore.getState().toggleCategory("Переводы");
    expect(activeSlice(useSlicesStore.getState()).excludedCategories).toEqual([]);
  });

  it("единственный разрез удалить нельзя — иначе аналитике не на что опираться", async () => {
    await useSlicesStore.getState().hydrate();
    await useSlicesStore.getState().remove(DEFAULT_SLICE_ID);
    expect(useSlicesStore.getState().slices).toHaveLength(1);
  });

  it("удаление активного переключает на оставшийся", async () => {
    await useSlicesStore.getState().hydrate();
    const id = await useSlicesStore.getState().add("Личное");
    await useSlicesStore.getState().remove(id);
    const s = useSlicesStore.getState();
    expect(s.slices).toHaveLength(1);
    expect(s.activeId).toBe(DEFAULT_SLICE_ID);
  });

  it("после перезагрузки активным остаётся выбранный разрез", async () => {
    await useSlicesStore.getState().hydrate();
    const id = await useSlicesStore.getState().add("Личное");
    resetState(); // хранилище оставляем — это и есть перезагрузка вкладки
    await useSlicesStore.getState().hydrate();
    expect(useSlicesStore.getState().activeId).toBe(id);
  });

  it("исчезнувший активный разрез не ломает загрузку", async () => {
    store.set("dataSlices", {
      slices: [{ id: "a", name: "A", excludedCategories: [], excludedAccounts: [] }],
      activeId: "ghost",
    });
    await useSlicesStore.getState().hydrate();
    expect(useSlicesStore.getState().activeId).toBe("a");
  });
});
