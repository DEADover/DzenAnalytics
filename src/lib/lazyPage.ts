import { createElement, use, type ComponentType } from "react";

/**
 * Раздел, код которого приходит отдельным куском, когда понадобится, — а не
 * в общем файле при старте.
 *
 * Не `React.lazy`: тот приостанавливает отрисовку при первом показе, даже если
 * код уже загружен, а переход между разделами рисует новую страницу синхронно,
 * внутри плавной смены кадров (`lib/viewTransition`). Здесь загруженный раздел
 * рисуется сразу; пока не загружен — `use()` ждёт его под `Suspense`.
 *
 * Не загрузился (после выкладки новой версии старых кусков на сервере уже нет)
 * — страница перезагружается один раз и берёт свежую версию целиком.
 */
export interface LazyPage {
  (): ReturnType<typeof createElement>;
  /** Загрузить заранее — перед переходом или в свободную минуту. */
  preload: () => Promise<unknown>;
  /** Код уже здесь — показать можно без ожидания. */
  loaded: () => boolean;
}

const RELOAD_KEY = "dzenanalytics:chunkReload";

export function lazyPage(load: () => Promise<ComponentType>): LazyPage {
  let component: ComponentType | null = null;
  let pending: Promise<ComponentType> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (c) => {
        component = c;
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* хранилище недоступно — не страшно */
        }
        return c;
      },
      (err: unknown) => {
        pending = null;
        reloadOnce();
        throw err;
      }
    ));
  const Page = (() => createElement(component ?? use(preload()))) as LazyPage;
  Page.preload = preload;
  Page.loaded = () => component !== null;
  return Page;
}

function reloadOnce(): void {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return;
  }
  window.location.reload();
}
