// DzenAnalytics service worker
// Cache-first для статических ассетов, network-first для HTML.
// v2 — новый знак «DA»: иконки лежат по прежним адресам, и без смены версии
// кэш «сначала из кэша» ещё долго отдавал бы старые.
// v3 — пути от адреса воркера: панель может жить на «/app/», а не в корне.
const VERSION = "v3";
const STATIC_CACHE = `dzen-static-${VERSION}`;
const RUNTIME_CACHE = `dzen-runtime-${VERSION}`;

// Пути — от адреса самого воркера: панель может жить и не в корне сайта
// (например, на «/app/»).
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon-16.png",
  "./favicon-32.png",
  "./favicon-48.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Network-first для HTML — чтобы получить свежий код, если онлайн
  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          // no-cache — всегда сверка с сервером: без неё запрос шёл через кеш
          // браузера, и при сервере без Cache-Control у страницы вкладка могла
          // днями открываться старой версией панели.
          const fresh = await fetch(req, { cache: "no-cache" });
          // В запас кладём только нормальную страницу, не ошибку сервера.
          if (fresh.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match(new URL("./index.html", self.registration.scope).href);
          if (offline) return offline;
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Cache-first для остального (assets / static)
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok && fresh.type === "basic") {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return new Response("Offline asset", { status: 503 });
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
