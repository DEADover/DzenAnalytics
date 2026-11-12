/**
 * Ошибки, которые иначе потерялись бы молча.
 *
 * Обещание без `catch` (`void store.hydrate()`, фоновый прогрев курсов)
 * при сбое не говорило ничего: хранилище оставалось непрочитанным, а в отчёте
 * для разбора не было ни строчки. Теперь такие ошибки ловятся — общим
 * перехватчиком окна и обёрткой загрузки хранилищ — и последние из них
 * попадают в «Скопировать отчёт» (Настройки → Данные → Дзен-мани API).
 *
 * Только тип и текст ошибки и первые строки стека: без данных пользователя.
 */

export interface AppError {
  at: string;
  /** Откуда: перехватчик окна или имя хранилища. */
  source: string;
  name: string;
  message: string;
  stack: string | null;
}

const MAX = 10;
let list: AppError[] = [];

export function recordAppError(source: string, e: unknown, now: Date = new Date()): void {
  const err = e instanceof Error ? e : null;
  const entry: AppError = {
    at: now.toISOString(),
    source,
    name: err?.name || typeof e,
    message: (err?.message ?? String(e)).slice(0, 300),
    stack: err?.stack ? err.stack.split("\n").slice(0, 4).map((l) => l.trim()).join("\n") : null,
  };
  list = [entry, ...list].slice(0, MAX);
  console.error(`[${source}]`, e);
}

/** Последние ошибки, новые первыми. */
export function appErrors(): readonly AppError[] {
  return list;
}

/** Для тестов. */
export function clearAppErrors(): void {
  list = [];
}

/**
 * Прочитать хранилище с диска; не вышло — ещё раз через мгновение (база могла
 * быть занята другой вкладкой), потом записать ошибку. `true` — прочитано.
 */
export async function hydrateSafely(
  name: string,
  hydrate: () => Promise<unknown> | unknown,
  opts: { retryMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      await hydrate();
      return true;
    } catch (e) {
      if (attempt >= 1) {
        recordAppError(`загрузка «${name}»`, e);
        return false;
      }
      await sleep(opts.retryMs ?? 300);
    }
  }
}

/** Ловить необработанные ошибки окна и обещаний. Возвращает снятие. */
export function installGlobalErrorHandlers(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onRejection = (ev: PromiseRejectionEvent) => recordAppError("необработанное обещание", ev.reason);
  const onError = (ev: ErrorEvent) => {
    // Ошибки загрузки картинок и скриптов приходят без `error` — не наше.
    if (ev.error === undefined && !ev.message) return;
    recordAppError("ошибка страницы", ev.error ?? ev.message);
  };
  target.addEventListener("unhandledrejection", onRejection as EventListener);
  target.addEventListener("error", onError as EventListener);
  return () => {
    target.removeEventListener("unhandledrejection", onRejection as EventListener);
    target.removeEventListener("error", onError as EventListener);
  };
}

/** Строки для отчёта. */
export function formatAppErrors(errors: readonly AppError[]): string[] {
  if (errors.length === 0) return ["Ошибки приложения: нет"];
  const out = [`Ошибки приложения (последние ${errors.length}):`];
  for (const e of errors) {
    out.push(`  ${new Date(e.at).toLocaleString("ru-RU")} · ${e.source} · ${e.name}: ${e.message}`);
    if (e.stack) out.push(...e.stack.split("\n").map((l) => `    ${l}`));
  }
  return out;
}
