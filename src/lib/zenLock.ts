/**
 * Синхронизация и отправка правок — строго по очереди.
 *
 * И та и другая читают кэш Дзен-мани, вливают в него ответ облака и
 * записывают обратно. Пойди они одновременно — последняя запись затрёт
 * чужую: синхронизация, начатая раньше отправки, вернула бы кэш «до правок»,
 * и только что отправленное пропало бы с экрана до следующего раза.
 *
 * Очередь держит порядок внутри вкладки, а замок браузера (`navigator.locks`)
 * — между вкладками одного аккаунта: две вкладки не пишут в один кэш разом.
 */
import { activeProfileId } from "./profiles";

let tail: Promise<unknown> = Promise.resolve();

/** Выполнить `fn`, когда закончится всё, что встало в очередь раньше. */
export function zenExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withTabLock(fn);
  const next = tail.then(run, run);
  // Сбой одного шага не должен останавливать очередь.
  tail = next.catch(() => undefined);
  return next;
}

function withTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return fn();
  let started = false;
  const guarded = () => {
    started = true;
    return fn();
  };
  try {
    return (locks.request(`dzenanalytics-zen:${activeProfileId()}`, guarded) as Promise<T>).catch(
      (e: unknown) => {
        // Замок недоступен (страница без своего адреса) — работаем без него.
        // Ошибку самой работы, конечно, отдаём как есть.
        if (started) throw e;
        return fn();
      }
    );
  } catch {
    return fn();
  }
}
