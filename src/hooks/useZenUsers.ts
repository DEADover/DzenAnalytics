import { useEffect, useState } from "react";
import type { ZenUserOption } from "../lib/zenUsers";
import { useDataStore } from "../store/useDataStore";
import { getZenUsersFromCache } from "../store/useZenmoneyStore";

/**
 * Участники аккаунта Дзен-мани из кэша — с запомненным последним списком.
 *
 * Список читается из кэша асинхронно, и страница успевала отрисоваться без
 * него: столбец «Владелец» на «Счетах» появлялся мгновением позже, и «Тип»
 * перескакивал на его место, а имена владельцев — с номеров на логины.
 * Запомненный список есть сразу при каждом следующем открытии; первый раз
 * его заранее читает `preloadZenUsers` при запуске.
 */
let lastUsers: ZenUserOption[] = [];

export function preloadZenUsers(): void {
  void getZenUsersFromCache().then((list) => {
    if (list) lastUsers = list;
  });
}

export function useZenUsers(): ZenUserOption[] {
  const transactions = useDataStore((s) => s.transactions);
  const [users, setUsers] = useState<ZenUserOption[]>(lastUsers);
  useEffect(() => {
    let cancelled = false;
    getZenUsersFromCache().then((list) => {
      if (cancelled || !list) return;
      lastUsers = list;
      setUsers((prev) => (sameUsers(prev, list) ? prev : list));
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  return users;
}

function sameUsers(a: ZenUserOption[], b: ZenUserOption[]): boolean {
  return (
    a.length === b.length &&
    a.every((u, i) => u.id === b[i].id && u.login === b[i].login && u.parent === b[i].parent)
  );
}
