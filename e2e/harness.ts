/**
 * Обвязка сквозных тестов: поддельный Дзен-мани, остановленные часы и
 * доступ к сторам приложения.
 *
 * Тесты не ходят в сеть ВООБЩЕ: `/v8/diff/` отвечает выдуманным аккаунтом
 * (`fixtures/zenAccount.ts`), курсы ЦБ — постоянной таблицей, всё остальное
 * за пределами localhost обрывается. Настоящих токенов здесь нет и быть не
 * должно: подключение идёт под заведомо фальшивым.
 *
 * Отправки (push) сервер записывает в `zen.pushes` — по ним тест проверяет,
 * что именно ушло бы в облако.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { NOW, fullDiff } from "./fixtures/zenAccount";
import type { ZenDiffResponse } from "../src/lib/zenmoney";

/** Тело запроса к `/v8/diff/`: метка плюс то, что клиент отправляет. */
export type DiffBody = Partial<Omit<ZenDiffResponse, "serverTimestamp">> & {
  serverTimestamp: number;
  currentClientTimestamp: number;
  forceFetch?: string[];
};

const ENTITY_KEYS = [
  "transaction",
  "account",
  "tag",
  "merchant",
  "budget",
  "reminder",
  "reminderMarker",
  "deletion",
] as const;

export class FakeZen {
  private stamp = Math.floor(NOW.getTime() / 1000);
  /** Все запросы с данными — то, что приложение отправило в облако. */
  readonly pushes: DiffBody[] = [];
  /** Сколько раз приложение скачивало изменения. */
  pulls = 0;
  /** Подправить выдуманный аккаунт под тест — до подключения. */
  patchFull: ((diff: ZenDiffResponse) => ZenDiffResponse) | null = null;

  respond(body: DiffBody): ZenDiffResponse {
    this.stamp += 1;
    const sent = ENTITY_KEYS.some((k) => (body[k]?.length ?? 0) > 0);
    if (sent) {
      this.pushes.push(body);
      // Как настоящий сервер: возвращает принятые сущности, кроме удалений.
      return {
        serverTimestamp: this.stamp,
        instrument: [],
        account: body.account ?? [],
        tag: body.tag ?? [],
        merchant: body.merchant ?? [],
        transaction: body.transaction ?? [],
        user: [],
        budget: body.budget ?? [],
        reminder: body.reminder ?? [],
        reminderMarker: body.reminderMarker ?? [],
      };
    }
    this.pulls += 1;
    if (body.serverTimestamp === 0) {
      const diff = fullDiff(this.stamp);
      return this.patchFull ? this.patchFull(diff) : diff;
    }
    return {
      serverTimestamp: this.stamp,
      instrument: [],
      account: [],
      tag: [],
      merchant: [],
      transaction: [],
      user: [],
    };
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

/** Курс ЦБ на любой день — одна и та же таблица. */
const CBR_DAY = JSON.stringify({
  Date: `${NOW.toISOString().slice(0, 10)}T11:30:00+03:00`,
  Valute: {
    USD: { CharCode: "USD", Nominal: 1, Value: 90 },
    EUR: { CharCode: "EUR", Nominal: 1, Value: 98 },
  },
});

/** Заведомо фальшивый токен: поддельный сервер принимает любой. */
const FAKE_TOKEN = "e2e-fake-token";

export const test = base.extend<{ zen: FakeZen }>({
  // `auto`: подделка включается в КАЖДОМ тесте, даже если он её не просит, —
  // иначе запросы тихо уходили бы на настоящий api.zenmoney.ru.
  zen: [async ({ context }, use) => {
    const zen = new FakeZen();
    // Порядок важен: Playwright проверяет маршруты с последнего добавленного.
    await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
    await context.route("https://www.cbr-xml-daily.ru/**", (route) =>
      route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: CBR_DAY })
    );
    await context.route("https://api.zenmoney.ru/v8/diff/", async (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS });
      }
      const body = route.request().postDataJSON() as DiffBody;
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(zen.respond(body)),
      });
    });
    await use(zen);
  }, { auto: true }],
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    // Доступ к сторам — тем же экземплярам, что у приложения. Адрес модуля
    // прямой: в тестах нет горячей замены, и `?t=…` к нему не прилипает.
    // (Искать его в Resource Timing нельзя — часы Playwright подменяют
    // `performance`, и список ресурсов пуст.)
    await page.addInitScript(() => {
      (window as unknown as { __store: (name: string) => Promise<unknown> }).__store = (name) =>
        import(/* @vite-ignore */ `/src/store/${name}.ts`);
    });
    await use(page);
  },
});

export { expect };

/** Открыть приложение и подключить выдуманный аккаунт Дзен-мани. */
export async function connectZen(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.getByRole("banner").waitFor();
  await page.evaluate(async (token) => {
    type ZenStore = {
      useZenmoneyStore: {
        getState: () => {
          loaded: boolean;
          hydrate: () => Promise<void>;
          saveToken: (t: string) => Promise<void>;
          sync: (o: { force: boolean }) => Promise<unknown>;
        };
      };
    };
    const store = (window as unknown as { __store: (n: string) => Promise<ZenStore> }).__store;
    const { useZenmoneyStore } = await store("useZenmoneyStore");
    if (!useZenmoneyStore.getState().loaded) await useZenmoneyStore.getState().hydrate();
    await useZenmoneyStore.getState().saveToken(token);
    await useZenmoneyStore.getState().sync({ force: true });
  }, FAKE_TOKEN);
  // Синхронизация раскладывает данные по сторам асинхронно — ждём ленту.
  await page.waitForFunction(async () => {
    type DataStore = { useDataStore: { getState: () => { transactions: unknown[] } } };
    const store = (window as unknown as { __store: (n: string) => Promise<DataStore> }).__store;
    const { useDataStore } = await store("useDataStore");
    return useDataStore.getState().transactions.length > 0;
  });
}

/** Режим отправки: «Выключено», «Вручную», «Авто», «При синке». */
export async function setPushMode(page: Page, mode: "off" | "manual" | "auto" | "on-sync"): Promise<void> {
  await page.evaluate(async (m) => {
    type ZenStore = { useZenmoneyStore: { getState: () => { setPushMode: (m: string) => Promise<void> } } };
    const store = (window as unknown as { __store: (n: string) => Promise<ZenStore> }).__store;
    const { useZenmoneyStore } = await store("useZenmoneyStore");
    await useZenmoneyStore.getState().setPushMode(m);
  }, mode);
}

/** Ширина документа больше окна — страница прокручивается вбок. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
