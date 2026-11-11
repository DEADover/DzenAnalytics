/**
 * Повтор запроса к Дзен-мани при временном сбое.
 *
 * Нужен длинным цепочкам запросов — восстановлению снимка в облако, где их
 * десятки и сотни подряд: одна заминка сети обрывала всё, а отправленное до
 * неё оставалось в аккаунте, и начинать приходилось с очистки. Каждый запрос
 * цепочки несёт записи под своими id, так что повтор того же запроса
 * безопасен: сервер обновит уже принятое, а не заведёт второй раз.
 */
import { ZenApiError, ZenTimeoutError } from "./zenmoney";

/** Сбой, после которого есть смысл попробовать ещё раз: сеть, срок, 429, 5xx. */
export function isTransientZenError(e: unknown): boolean {
  if (e instanceof ZenTimeoutError) return true;
  if (e instanceof ZenApiError) return e.status === 429 || e.status >= 500;
  // `fetch` при обрыве связи бросает TypeError; отмена запроса — не сбой.
  return e instanceof TypeError;
}

/** Паузы между попытками, мс: всего попыток на одну больше. */
export const RETRY_DELAYS_MS = [1500, 5000] as const;

export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: {
    delays?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isTransientZenError(e)) throw e;
      opts.onRetry?.(attempt + 1, e);
      await sleep(delays[attempt]);
    }
  }
}
