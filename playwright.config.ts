import { defineConfig } from "@playwright/test";

/**
 * Сквозные тесты интерфейса: настоящий браузер против дев-сервера на своём
 * порту (3131), чтобы не мешать рабочему на 3030. Дзен-мани и курсы ЦБ
 * подделаны в `e2e/harness.ts` — сеть тестам не нужна.
 *
 * Браузер — установленный Google Chrome (`channel: "chrome"`): своих сборок
 * Chromium Playwright не скачивает.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3131",
    channel: "chrome",
    headless: true,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 3131 --strictPort",
    url: "http://localhost:3131",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
