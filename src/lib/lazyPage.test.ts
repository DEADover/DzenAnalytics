import { describe, it, expect, vi, beforeEach } from "vitest";
import { lazyPage } from "./lazyPage";

const store = new Map<string, string>();
const reload = vi.fn();
beforeEach(() => {
  store.clear();
  reload.mockReset();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { location: { reload } });
});

describe("lazyPage", () => {
  it("загружается один раз и помнит, что загружен", async () => {
    const Comp = () => null;
    const load = vi.fn(async () => Comp);
    const Page = lazyPage(load);
    expect(Page.loaded()).toBe(false);
    await Promise.all([Page.preload(), Page.preload()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(Page.loaded()).toBe(true);
  });

  it("сбой загрузки — перезагрузка страницы один раз, следующая попытка грузит заново", async () => {
    const load = vi.fn(async () => {
      throw new Error("chunk 404");
    });
    const Page = lazyPage(load);
    await expect(Page.preload()).rejects.toThrow("chunk 404");
    await expect(Page.preload()).rejects.toThrow("chunk 404");
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Page.loaded()).toBe(false);
  });

  it("удачная загрузка снимает пометку о перезагрузке", async () => {
    store.set("dzenanalytics:chunkReload", "1");
    const Page = lazyPage(async () => () => null);
    await Page.preload();
    expect(store.has("dzenanalytics:chunkReload")).toBe(false);
  });
});
