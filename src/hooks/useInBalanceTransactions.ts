import { useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useLiveAccounts } from "./useLiveAccounts";
import { stripFromAnalytics } from "../lib/aggregations";
import type { Transaction } from "../types";

/**
 * Счета вне баланса, которые сейчас НЕ считаются: переключатель «Счета вне
 * баланса» (Настройки → Расчёты) выключен. `undefined` — исключать нечего:
 * переключатель включён, таких счетов нет или Дзен-мани не подключён (CSV).
 *
 * Одно правило на весь сервис: и балансы, и итоги, и периметр бюджета «все
 * счета» смотрят сюда. Раньше у разделов было два разных механизма —
 * переключатель и отбор «Без внебалансовых счетов» в фильтрах, — и трата с
 * накопительного счёта входила в «Категории», но не в кольцо на главной.
 * Архивный счёт вне баланса тоже исключается — как и из совокупного баланса
 * (`useBalanceValuation`): «вне баланса» — это флаг счёта, а не его состояние.
 */
export function useOffBalanceExcluded(): Set<string> | undefined {
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const liveAccounts = useLiveAccounts();
  return useMemo(() => {
    if (includeOffBalance || !liveAccounts) return undefined;
    const titles = liveAccounts.filter((a) => !a.inBalance).map((a) => a.title);
    return titles.length ? new Set(titles) : undefined;
  }, [includeOffBalance, liveAccounts]);
}

/**
 * Операции, которые идут в итоги и отчёты: все, кроме движений по счетам вне
 * баланса, пока они не считаются. Перевод выпадает, если любая его сторона —
 * такой счёт.
 *
 * Для разделов, которые считают суммы по общим фильтрам («Категории»,
 * «Cash-flow», «Топ» и др.). Сводная аналитика вдобавок вычитает разрез данных
 * — это `useAnalyticsTransactions`. Списки операций («Операции», «Поиск»)
 * показывают всё и берут операции как есть.
 *
 * Тот же массив, когда исключать нечего, — безопасно класть в зависимости.
 */
export function useInBalanceTransactions(): Transaction[] {
  const transactions = useDataStore((s) => s.transactions);
  const offBalance = useOffBalanceExcluded();
  return useMemo(
    () => stripFromAnalytics(transactions, { offBalanceTitles: offBalance }),
    [transactions, offBalance]
  );
}
