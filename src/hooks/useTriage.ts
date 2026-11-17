/**
 * Что ждёт разбора — данные виджета «Разобрать» на главной.
 *
 * Считается по ВСЕМ операциям, а не по выбранному на главной месяцу и не по
 * общим фильтрам: новая операция без категории ждёт внимания независимо от
 * того, какой месяц сейчас открыт. Те же списки даёт лента с отметками «Только
 * новые» и «Только без категории» без остальных фильтров.
 */

import { useMemo } from "react";
import type { Transaction } from "../types";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { detectUncategorized } from "../lib/aggregations";

export interface Triage {
  /** Новые операции — ещё не просмотренные. */
  unseen: Transaction[];
  /** Расходы и доходы без категории. */
  uncategorized: Transaction[];
  /** Операции с правками, которые ещё не ушли в Дзен-мани. */
  unsent: Transaction[];
  /** Подключён ли Дзен-мани: без него отправлять некуда. */
  connected: boolean;
}

export function useTriage(): Triage {
  const transactions = useDataStore((s) => s.transactions);
  const edits = useEditsStore((s) => s.edits);
  const drafts = useDraftsStore((s) => s.drafts);
  const connected = useZenmoneyStore((s) => !!s.token);

  return useMemo(
    () => ({
      unseen: transactions.filter((t) => t.unseen),
      uncategorized: detectUncategorized(transactions),
      unsent: transactions.filter((t) => edits[t.id] !== undefined || drafts[t.id] !== undefined),
      connected,
    }),
    [transactions, edits, drafts, connected]
  );
}
