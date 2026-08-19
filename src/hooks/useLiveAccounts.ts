import { useEffect, useSyncExternalStore } from "react";
import {
  getLiveAccountsFromCache,
  peekLiveAccounts,
  subscribeLiveAccounts,
  type LiveAccount,
} from "../store/useZenmoneyStore";

/**
 * Счета из кэша Дзен-мани — общий на всё приложение источник.
 *
 * Раньше каждый хук читал кэш сам: своё состояние, свой `useEffect`, свой
 * первый кадр без счетов. При каждом входе на страницу она рисовалась дважды —
 * сначала по одним операциям, потом с остатками, — и это было заметно: на
 * главной пересчитывался баланс и перетасовывался список счетов, потому что
 * порядок «по величине остатка» до и после подмены разный.
 *
 * Здесь разбор берётся из общей памяти (`peekLiveAccounts`) прямо на первом
 * кадре, а чтение запускается только когда его ещё не было. Значит второй и
 * все последующие заходы на страницу отрисовываются сразу верно.
 *
 * `undefined` — кэш ещё не читали (первый кадр за загрузку приложения);
 * `null` — кэша нет, режим CSV. Обе величины ложные, так что старая проверка
 * `if (liveAccounts)` продолжает работать как была.
 */
export function useLiveAccounts(): LiveAccount[] | null | undefined {
  const accounts = useSyncExternalStore(
    subscribeLiveAccounts,
    peekLiveAccounts,
    peekLiveAccounts
  );

  useEffect(() => {
    if (accounts === undefined) void getLiveAccountsFromCache();
  }, [accounts]);

  return accounts;
}
