import { describe, it, expect, beforeEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: проверяем, что уезжает на диск и что
// оттуда читается.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useHeaderNavStore } from "./useHeaderNavStore";
import { DEFAULT_HEADER_NAV } from "../lib/headerNav";

describe("основное меню: вид «только значки»", () => {
  beforeEach(() => {
    disk.clear();
    useHeaderNavStore.setState({ items: [...DEFAULT_HEADER_NAV], iconsOnly: false, loaded: false });
  });

  it("по умолчанию — с названиями, в том числе у старых сохранений без этой настройки", async () => {
    disk.set("headerNav", ["/", "/transactions"]);
    await useHeaderNavStore.getState().hydrate();
    expect(useHeaderNavStore.getState().iconsOnly).toBe(false);
    expect(useHeaderNavStore.getState().items).toEqual(["/", "/transactions"]);
  });

  it("выбор сохраняется и читается обратно", async () => {
    useHeaderNavStore.getState().setIconsOnly(true);
    await Promise.resolve();
    expect(disk.get("headerNavIconsOnly")).toBe(true);
    useHeaderNavStore.setState({ iconsOnly: false });
    await useHeaderNavStore.getState().hydrate();
    expect(useHeaderNavStore.getState().iconsOnly).toBe(true);
  });

  it("«Стандартный вид» возвращает и разделы, и названия", async () => {
    useHeaderNavStore.getState().remove("/");
    useHeaderNavStore.getState().setIconsOnly(true);
    useHeaderNavStore.getState().reset();
    await Promise.resolve();
    expect(useHeaderNavStore.getState().items).toEqual([...DEFAULT_HEADER_NAV]);
    expect(useHeaderNavStore.getState().iconsOnly).toBe(false);
    expect(disk.get("headerNavIconsOnly")).toBe(false);
  });

  it("мусор в сохранении не включает значки", async () => {
    disk.set("headerNavIconsOnly", "yes");
    await useHeaderNavStore.getState().hydrate();
    expect(useHeaderNavStore.getState().iconsOnly).toBe(false);
  });
});
