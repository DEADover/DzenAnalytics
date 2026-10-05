import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, MemoryRouter } from "react-router-dom";
// Geist (Vercel) — self-hosted variable fonts, bundled so the standalone build
// stays offline-friendly. Sans for UI, Mono for tabular numbers.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { consumeOAuthCallback, exchangeCode } from "./lib/oauth";
import { isDemoActive } from "./hooks/useDemo";
import { DEMO_TOKEN } from "./lib/demo/demoServer";
import { seedDemoLocal } from "./lib/demo/demoSeed";
import { useZenmoneyStore } from "./store/useZenmoneyStore";
import { useDataStore } from "./store/useDataStore";
import { resumeSwitch } from "./lib/switchOverlay";

const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";
// Адреса разделов после «#» (HashRouter) — у однофайловой сборки ВСЕГДА, а не
// только при открытии с диска. Её кладут на любой хостинг одним файлом и
// встраивают во фрейм чужого сайта. С обычными адресами приложение переписывало
// адрес фрейма на `/transactions` и т. п.: такого файла на сервере нет, и
// любая перезагрузка — восстановление бэкапа, очистка данных, F5 — упиралась в
// 404. Хэш остаётся внутри того же файла.
// Это входной файл, а не компонент с горячей перезагрузкой, — правило
// fast-refresh к константе `Router` не относится.
//
// Документ без настоящего адреса — HTML, вставленный во фрейм через `srcdoc`
// (`about:srcdoc`) или `data:`, — не даёт собрать URL вовсе: react-router
// падал на первом же переходе. Там разделы переключаются в памяти, без адреса.
const hasRealUrl =
  typeof window === "undefined" ||
  ["http:", "https:", "file:", "blob:"].includes(window.location.protocol);
// eslint-disable-next-line react-refresh/only-export-components
const Router = !hasRealUrl
  ? MemoryRouter
  : isFileProtocol || __STANDALONE__
    ? HashRouter
    : BrowserRouter;

// `useTransitions={false}`: смена адреса рисуется сразу, а не в
// `startTransition`, как по умолчанию в React Router 7. Иначе плавная смена
// кадров (`withViewTransition`) снимала «новый» кадр раньше, чем React успевал
// нарисовать новую страницу: анимация шла от старой страницы к ней же, а потом
// страница подменялась ещё раз — рывком, будто открывалась дважды. Отложенная
// отрисовка нам ничего не даёт: ленивых разделов и `Suspense` в приложении нет.
// Продолжение перехода между аккаунтами — заглушка до первого кадра React.
resumeSwitch();

const callback = consumeOAuthCallback();
if (callback) document.getElementById("root")!.textContent = "Завершаем вход…";

async function mount() {
  let syncAfterLogin = false;
  // Первый заход в демо-данные: «подключаем» демо-аккаунт и ждём синхронизацию
  // до первой отрисовки — чтобы не мелькнул пустой экран «Нет данных».
  if (!callback && isDemoActive()) {
    await useZenmoneyStore.getState().hydrate();
    if (!useZenmoneyStore.getState().token) {
      document.getElementById("root")!.textContent = "Готовим демо-данные…";
      if (await useZenmoneyStore.getState().validateAndSaveToken(DEMO_TOKEN, "token")) {
        await useZenmoneyStore.getState().sync().catch(() => {});
        // Цели и правила живут в панели, а не в Дзен-мани — заводим их сами.
        await seedDemoLocal().catch(() => {});
      }
      document.getElementById("root")!.textContent = "";
    }
  }
  if (callback) {
    try {
      await useZenmoneyStore.getState().hydrate();
      if ("error" in callback) throw new Error("Invalid OAuth callback");
      const token = await exchangeCode(callback.code);
      syncAfterLogin = await useZenmoneyStore.getState().validateAndSaveToken(token, "oauth");
      // CSV стираем только теперь, с проверенным токеном на руках: согласие
      // на замену дано до ухода к провайдеру, но вход мог и не состояться.
      if (syncAfterLogin && callback.replaceCsv) await useDataStore.getState().clearAll();
    } catch (e) {
      // Человеку — общая фраза, а настоящую причину — в консоль: по ней и
      // разбираемся, когда вход «просто не работает».
      console.error("[DzenAnalytics] Вход через Дзен-мани не завершён:", e);
      useZenmoneyStore.setState({ status: "error", error: "Не удалось завершить вход. Попробуйте снова." });
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Router
        useTransitions={false}
        // Панель может жить не в корне сайта (например, на «/app/»).
        {...(Router === BrowserRouter ? { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" } : {})}
      >
        <App />
      </Router>
    </StrictMode>
  );
  if (syncAfterLogin) {
    void useZenmoneyStore.getState().sync().catch(() => {});
  }
}

void mount();

// После выкладки новой версии файлы прошлой с сервера пропадают: вкладка,
// открытая до выкладки, не догрузит модуль, который подгружается по
// требованию, и тихо сломается. Перезагружаемся на свежую версию — не чаще
// раза в минуту, чтобы при настоящей поломке не уйти в бесконечный цикл.
window.addEventListener("vite:preloadError", (event) => {
  const key = "da-preload-reload";
  try {
    const last = Number(sessionStorage.getItem(key)) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

// Service worker — только у обычной сборки на http(s). В однофайловой его
// файла нет: регистрация лишь сыпала 404 в консоль хоста.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  !isFileProtocol &&
  !__STANDALONE__
) {
  window.addEventListener("load", () => {
    // От базы панели, а не от текущего адреса: на вложенных разделах
    // («/app/budget/…») «./sw.js» вёл бы в никуда.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // ignore registration failures
    });
  });
}
