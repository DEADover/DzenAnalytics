// Проверка собранной панели: открывается ли она вообще.
//
// Сквозные тесты идут на сервере разработки, где модули грузятся по одному.
// В сборке они склеены в файлы, и неудачный импорт может зациклить два файла
// друг на друга: панель падает на старте с «… is not a function», хотя все
// тесты зелёные (так вышел v1.29.0). Здесь открываем именно сборку из `dist/`
// и требуем: ни одной ошибки на странице и видимое меню.
//
// Запуск: `npm run build && npm run test:prod`.
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { preview } from "vite";

if (!existsSync("dist/index.html")) {
  console.error("Нет dist/ — сначала npm run build");
  process.exit(1);
}

const PORT = 4179;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "silent" });
const browser = await chromium.launch({ channel: "chrome" });
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  // Меню есть и без данных — значит, приложение запустилось и отрисовалось.
  const menu = await page
    .getByText("Операции", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (errors.length > 0 || !menu) {
    failed = true;
    console.error("Собранная панель не запускается.");
    for (const e of errors) console.error("  Ошибка на странице:", e);
    if (!menu) console.error("  Меню не появилось.");
  } else {
    console.log("Собранная панель запускается: ошибок на странице нет.");
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
