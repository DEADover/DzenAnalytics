/**
 * Подхватить то, что записала другая вкладка того же аккаунта.
 *
 * Вкладки объявляют свои записи (`lib/tabChannel`); здесь на объявление
 * отвечаем перечитыванием изменившегося: очереди правок, кэш Дзен-мани, лента.
 * Смысл — не красота, а сохранность: хранилище пишет свой ключ целиком из
 * памяти, и вкладка, не знающая о чужой правке, затёрла бы её первой же своей.
 *
 * Настройки вида (ширины, темы, фильтры) сюда не входят: у каждой вкладки они
 * могут быть свои, и терять там нечего.
 */
import { useAccountEditsStore } from "../store/useAccountEditsStore";
import { useBudgetEditsStore } from "../store/useBudgetEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useDataStore } from "../store/useDataStore";
import { useDeletedPayloadsStore } from "../store/useDeletedPayloadsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useEditsStore } from "../store/useEditsStore";
import { useNewCategoriesStore } from "../store/useNewCategoriesStore";
import { usePlanActionsStore } from "../store/usePlanActionsStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { invalidateLiveAccounts, useZenmoneyStore } from "../store/useZenmoneyStore";
import { devLog } from "./devLog";
import { EVERYTHING_KEY, onForeignWrite, TRANSACTIONS_KEY } from "./tabChannel";
import { invalidateZenCache } from "./zenCacheMemo";

type Hydratable = { getState: () => { hydrate: () => Promise<void> } };

/** Очереди того, что ждёт отправки, и ключи, под которыми они лежат. */
const QUEUES: readonly (readonly [Hydratable, readonly string[]])[] = [
  [useEditsStore, ["transactionEdits", "transactionEditOrigins"]],
  [useDraftsStore, ["pendingTransactions", "pendingTransactionsResend"]],
  [useDeletedStore, ["deletedTransactions", "deletedTransactionsAt"]],
  [useDeletedPayloadsStore, ["deletedPayloads"]],
  [useTagEditsStore, ["tagEdits"]],
  [useAccountEditsStore, ["accountEdits"]],
  [useNewCategoriesStore, ["newCategories"]],
  [useTagDeletionsStore, ["tagDeletions"]],
  [usePlannedDeletionsStore, ["plannedDeletions"]],
  [usePlanActionsStore, ["planActions"]],
  [useBudgetEditsStore, ["budgetEdits"]],
  [useCounterpartyEditsStore, ["counterpartyEdits"]],
];

/** Состояние подключения: метка синхронизации, режим отправки, расписание. */
const ZEN_KEY_PREFIX = "zenmoney";
const CACHE_KEY = "zenmoneyCache";

/** Что перечитать по списку записанных ключей. Чистая — под тест. */
export function planRefresh(keys: readonly string[]): {
  queues: number[];
  cache: boolean;
  categoryMeta: boolean;
  zen: boolean;
  /** `hydrate` — лента с диска; `refresh` — пересобрать из того, что в памяти. */
  data: "hydrate" | "refresh" | null;
} {
  const all = keys.includes(EVERYTHING_KEY);
  const has = (key: string) => all || keys.includes(key);
  const queues = QUEUES.flatMap(([, own], i) => (own.some(has) ? [i] : []));
  const cache = has(CACHE_KEY);
  const zen = all || keys.some((k) => k.startsWith(ZEN_KEY_PREFIX) && k !== CACHE_KEY);
  const data = cache || has(TRANSACTIONS_KEY) || has("rates") ? "hydrate" : queues.length > 0 ? "refresh" : null;
  return { queues, cache, categoryMeta: has("categoryMeta"), zen, data };
}

async function apply(keys: readonly string[]): Promise<void> {
  const plan = planRefresh(keys);
  for (const i of plan.queues) await QUEUES[i][0].getState().hydrate();
  if (plan.cache) {
    invalidateZenCache();
    invalidateLiveAccounts();
  }
  if (plan.categoryMeta) await useCategoryMetaStore.getState().hydrate();
  if (plan.zen) await useZenmoneyStore.getState().hydrate();
  if (plan.data === "hydrate") await useDataStore.getState().hydrate();
  else if (plan.data === "refresh") await useDataStore.getState().refresh();
}

/** Не чаще стольких перечитываний за окно — защита от «пинг-понга» вкладок. */
const MAX_RUNS = 12;
const WINDOW_MS = 10_000;

/** Включить. Возвращает функцию отключения. */
export function startCrossTabSync(): () => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let runs: number[] = [];

  const flush = () => {
    timer = null;
    const keys = [...pending];
    pending.clear();
    const now = Date.now();
    runs = runs.filter((t) => now - t < WINDOW_MS);
    if (runs.length >= MAX_RUNS) {
      devLog("cross-tab", "слишком часто — пропускаю перечитывание", "error");
      return;
    }
    runs.push(now);
    chain = chain.then(() => apply(keys)).catch((e: unknown) => {
      devLog("cross-tab", `не удалось перечитать: ${e instanceof Error ? e.message : String(e)}`, "error");
    });
  };

  return onForeignWrite((keys) => {
    for (const k of keys) pending.add(k);
    // Синхронизация пишет десяток ключей подряд — ждём, пока поток стихнет.
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  });
}
