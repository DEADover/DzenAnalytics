import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Вход через внешнего провайдера: согласие на замену CSV-данных должно
 * пережить уход к провайдеру и вернуться вместе с кодом — стираются данные
 * только после входа, а не до него.
 */

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let assigned = "";
const loc = {
  hostname: "zen.example.ru",
  pathname: "/",
  search: "",
  assign: (u: string) => {
    assigned = u;
  },
};

async function load() {
  vi.resetModules();
  vi.stubEnv("VITE_OAUTH_PROVIDER_URL", "https://auth.example.ru");
  vi.stubEnv("VITE_OAUTH_CALLBACK_PATH", "/oauth/return");
  vi.stubGlobal("__STANDALONE__", false);
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("location", loc);
  vi.stubGlobal("history", { replaceState: () => {} });
  return import("./oauth");
}

/** Вернуться от провайдера с тем `state`, что ушёл, и кодом. */
function returnFrom(state: string, code = "c1") {
  loc.pathname = "/oauth/return";
  loc.search = `?state=${encodeURIComponent(state)}&code=${code}`;
}

describe("oauth — согласие на замену CSV", () => {
  beforeEach(() => {
    assigned = "";
    loc.pathname = "/";
    loc.search = "";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("согласие возвращается вместе с кодом", async () => {
    const { startOAuth, consumeOAuthCallback } = await load();
    startOAuth({ replaceCsv: true });
    returnFrom(new URL(assigned).searchParams.get("state")!);
    expect(consumeOAuthCallback()).toEqual({ code: "c1", replaceCsv: true });
  });

  it("без CSV — заменять нечего", async () => {
    const { startOAuth, consumeOAuthCallback } = await load();
    startOAuth();
    returnFrom(new URL(assigned).searchParams.get("state")!);
    expect(consumeOAuthCallback()).toEqual({ code: "c1", replaceCsv: false });
  });

  it("чужой state — ошибка, и стирать нечего", async () => {
    const { startOAuth, consumeOAuthCallback } = await load();
    startOAuth({ replaceCsv: true });
    returnFrom("zen:подделка");
    expect(consumeOAuthCallback()).toEqual({ error: true });
  });
});
