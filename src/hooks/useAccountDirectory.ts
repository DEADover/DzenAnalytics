import { useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import { useLiveAccounts } from "./useLiveAccounts";
import { buildAccountDirectory, type AccountDirectory } from "../lib/accountDirectory";

/**
 * Справочник счетов сервиса: живые счета Дзен-мани плюс встреченные в
 * операциях (CSV, удалённые). Ключи и подписи — отсюда, см.
 * `lib/accountDirectory`.
 */
export function useAccountDirectory(): AccountDirectory {
  const live = useLiveAccounts();
  const transactions = useDataStore((s) => s.transactions);
  return useMemo(() => buildAccountDirectory(live, transactions), [live, transactions]);
}
