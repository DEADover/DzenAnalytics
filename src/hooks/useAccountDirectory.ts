import { useEffect } from "react";
import { create } from "zustand";
import { useDataStore } from "../store/useDataStore";
import { useLiveAccounts } from "./useLiveAccounts";
import { buildAccountDirectory, type AccountDirectory } from "../lib/accountDirectory";

/**
 * Справочник счетов сервиса — один на приложение: живые счета Дзен-мани плюс
 * встреченные в операциях (CSV, удалённые). Собирается в корне
 * (`useAccountDirectorySync` в `App`) при смене счетов или операций; экраны и строки лент
 * только читают — иначе каждая строка пересобирала бы его по всем операциям.
 */
const useAccountDirStore = create<{ dir: AccountDirectory }>(() => ({
  dir: buildAccountDirectory(null, []),
}));

export function useAccountDirectory(): AccountDirectory {
  return useAccountDirStore((s) => s.dir);
}

/** Держит справочник в актуальном виде. Вызывается один раз — в `App`. */
export function useAccountDirectorySync(): void {
  const live = useLiveAccounts();
  const transactions = useDataStore((s) => s.transactions);
  useEffect(() => {
    useAccountDirStore.setState({ dir: buildAccountDirectory(live, transactions) });
  }, [live, transactions]);
}

/** Справочник вне компонентов — для действий (разделение, отправка). */
export function getAccountDirectory(): AccountDirectory {
  return useAccountDirStore.getState().dir;
}

/**
 * Название и номер счёта по ключу — то, что нужно сборке операции. Номера
 * нет у долгов (их счетов по валюте несколько) и у счетов из CSV — там счёт
 * ищется по названию.
 */
export function accountRef(
  dir: AccountDirectory,
  key: string
): { title: string; id: string | undefined } {
  const e = dir.byKey.get(key);
  return { title: e?.title ?? key, id: e && e.ids.length === 1 ? e.ids[0] : undefined };
}
