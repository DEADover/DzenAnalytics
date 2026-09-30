/**
 * Объединение нескольких операций в одну (доска Budgera, 6 голосов).
 *
 * Устроено как разделение наоборот (`useSplitTransaction`): итоговая
 * операция создаётся новой, исходные удаляются и уходят в «Удалённые».
 * Удалённые хранят свои суммы и банковские номера — по ним Дзен-мани узнаёт
 * покупки и не заводит их заново из выписки. Ужать одну из исходных до общей
 * суммы, а остальные удалить, было бы короче, но так её сумма перестала бы
 * совпадать с банком, и Дзен-мани завёл бы покупку заново — ровно то, на чём
 * споткнулось первое разделение (30.09.2026).
 *
 * Арифметика и проверки — в `lib/mergeTransactions`.
 */

import { useCallback } from "react";
import type { Transaction } from "../types";
import { buildDraftTransaction, newDraftId } from "../lib/zenmoneyPush";
import { loadZenCache } from "../lib/zenmoneyCache";
import { mergeProblem, mergedTotal } from "../lib/mergeTransactions";
import { useDraftsStore } from "../store/useDraftsStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useDataStore } from "../store/useDataStore";

/** Поля итоговой операции, которые выбрал человек. */
export interface MergeChoice {
  date: string;
  category: string;
  subcategory: string | null;
  payee: string;
  comment: string;
  extraCategories: string[];
}

export function useMergeTransactions() {
  const add = useDraftsStore((s) => s.add);
  const newMerchants = useCounterpartyEditsStore((s) => s.created);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const refresh = useDataStore((s) => s.refresh);

  /** Объединить операции. Текст ошибки или `null` при успехе. */
  const applyMerge = useCallback(
    async (txs: Transaction[], choice: MergeChoice): Promise<string | null> => {
      const problem = mergeProblem(txs);
      if (problem) return problem;
      const cache = await loadZenCache();
      if (!cache) return "Объединение работает только при подключённом Дзен-мани";

      // Долги не объединяем: у долга контрагент — это человек, и сумма
      // долгов разным людям в одной операции означала бы долг непонятно кому.
      const debtIds = new Set(cache.accounts.filter((a) => a.type === "debt").map((a) => a.id));
      const zenById = new Map(cache.transactions.map((t) => [t.id, t]));
      const isDebt = txs.some((t) => {
        const z = zenById.get(t.id);
        return !!z && (debtIds.has(z.outcomeAccount) || debtIds.has(z.incomeAccount));
      });
      if (isDebt) return "Долги объединять нельзя: у каждого долга свой человек";

      const total = mergedTotal(txs);
      const first = txs[0];
      // Время дня — у самой поздней операции выбранного дня: в ленте
      // итоговая встанет туда же, где стояла последняя из объединённых.
      const sameDay = txs.filter((t) => t.date === choice.date);
      const latest = (sameDay.length > 0 ? sameDay : txs)
        .map((t) => Math.floor(new Date(t.createdAt).getTime() / 1000))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);

      const result = buildDraftTransaction(
        {
          id: newDraftId(),
          kind: total.kind,
          date: choice.date,
          amount: total.amount,
          account: total.kind === "transfer" ? first.outcomeAccount : first.account,
          incomeAccount: total.kind === "transfer" ? first.incomeAccount : undefined,
          incomeAmount: total.incomeAmount,
          createdSeconds: latest || undefined,
          category: total.kind === "transfer" ? undefined : choice.category,
          subcategory: total.kind === "transfer" ? undefined : choice.subcategory,
          payee: choice.payee.trim() || undefined,
          comment: choice.comment.trim() || undefined,
          extraCategories: total.kind === "transfer" ? undefined : choice.extraCategories,
        },
        cache,
        Math.floor(Date.now() / 1000),
        newMerchants
      );
      if (!result.zen) return result.skip;

      // Сначала новая, потом удаление: автоотправка ждёт две секунды тишины
      // и увозит то и другое одним запросом.
      await add(result.zen);
      await deleteTransactionMany(txs.map((t) => t.id));
      await refresh();
      return null;
    },
    [add, deleteTransactionMany, newMerchants, refresh]
  );

  return { applyMerge };
}
