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

/**
 * 429 — «слишком часто». Ждём столько, сколько просит сервер (`Retry-After`),
 * а не сказал — полминуты: через полторы секунды тот же ответ гарантирован.
 * Просит дольше минуты — не ждём здесь вовсе: человек не должен смотреть на
 * «отправляется» минутами, повторит синхронизация по расписанию.
 */
export const RATE_LIMIT_DEFAULT_MS = 30_000;
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** Сколько ждать перед следующей попыткой; `null` — не повторять. */
export function retryDelayFor(e: unknown, planned: number): number | null {
  if (!isTransientZenError(e)) return null;
  if (e instanceof ZenApiError && e.status === 429) {
    const ask = e.retryAfterMs ?? RATE_LIMIT_DEFAULT_MS;
    return ask > RATE_LIMIT_MAX_WAIT_MS ? null : Math.max(planned, ask);
  }
  return planned;
}

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
      const wait = attempt < delays.length ? retryDelayFor(e, delays[attempt]) : null;
      if (wait === null) throw e;
      opts.onRetry?.(attempt + 1, e);
      await sleep(wait);
    }
  }
}
