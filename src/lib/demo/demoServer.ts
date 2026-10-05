import type { ZenDiffResponse } from "../zenmoney";
import { demoDiff } from "./demoAccount";

/**
 * «Дзен-мани» демо-аккаунта — прямо в браузере, без сети.
 *
 * Запросы с этим токеном до api.zenmoney.ru не доходят: их обслуживает
 * `respondDemo` (см. `zenRequest`). Поэтому синхронизация, планы, бюджеты,
 * правки и их «отправка» в демо работают по-настоящему, но всё остаётся в
 * браузере. Отвечает как настоящий сервер: первая синхронизация — аккаунт
 * целиком, следующие — пусто, отправленное — обратно как принятое.
 */
export const DEMO_TOKEN = "demo-dzenanalytics";

export const isDemoToken = (token: string | null | undefined) => token === DEMO_TOKEN;

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

type DiffBody = Partial<Omit<ZenDiffResponse, "serverTimestamp">> & {
  serverTimestamp: number;
  forceFetch?: string[];
};

let stamp = Math.floor(Date.now() / 1000);

/** «Сегодня» по местному времени: история демо доходит ровно до него. */
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const empty = (ts: number): ZenDiffResponse =>
  ({
    serverTimestamp: ts,
    instrument: [],
    account: [],
    tag: [],
    merchant: [],
    transaction: [],
    user: [],
  }) as unknown as ZenDiffResponse;

export function respondDemo(body: DiffBody): ZenDiffResponse {
  stamp = Math.max(stamp + 1, Math.floor(Date.now() / 1000));
  const sent = ENTITY_KEYS.some((k) => ((body[k] as unknown[] | undefined)?.length ?? 0) > 0);
  if (sent) {
    // Как настоящий сервер: принятые сущности возвращаются, удаления — нет.
    return {
      ...empty(stamp),
      account: body.account ?? [],
      tag: body.tag ?? [],
      merchant: body.merchant ?? [],
      transaction: body.transaction ?? [],
      budget: body.budget ?? [],
      reminder: body.reminder ?? [],
      reminderMarker: body.reminderMarker ?? [],
    } as ZenDiffResponse;
  }
  const full = () => demoDiff(stamp, todayIso());
  if (!body.serverTimestamp) return full();
  // Дозапрос отдельных справочников — целиком, как у настоящего сервера.
  const out = empty(stamp) as unknown as Record<string, unknown>;
  if (body.forceFetch?.length) {
    const f = full() as unknown as Record<string, unknown>;
    for (const k of body.forceFetch) if (k in f) out[k] = f[k];
  }
  return out as unknown as ZenDiffResponse;
}
