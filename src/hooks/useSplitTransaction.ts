/**
 * Применение и откат разбивки операции (issue #69).
 *
 * Разбивка — это не пометка, а превращение одной операции в несколько
 * настоящих: у операции в Дзен-мани ровно одна сумма, и хранить суммы по
 * статьям там негде. Поэтому исходная ужимается до первой части (обычной
 * правкой суммы и статьи), а остальные части создаются рядом черновиками —
 * теми же, какими создаётся операция руками, и уезжают тем же путём.
 *
 * Связь между ними Дзен-мани хранить негде, и она живёт в своём сторе. Id
 * частей мы генерируем сами, поэтому связь переживает синхронизацию: после
 * отправки в облаке оказываются ровно те же id.
 */

import { useCallback } from "react";
import type { Transaction } from "../types";
import { buildDraftTransaction, newDraftId } from "../lib/zenmoneyPush";
import type { ZenTransaction } from "../lib/zenmoney";
import { loadZenCache } from "../lib/zenmoneyCache";
import { round2, type SplitDraftPart } from "../lib/splitTransaction";
import { useDraftsStore } from "../store/useDraftsStore";
import { useEditsStore } from "../store/useEditsStore";
import { useSplitGroupsStore, type SplitGroup } from "../store/useSplitGroupsStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useDataStore } from "../store/useDataStore";

export function useSplitTransaction() {
  const setEdit = useEditsStore((s) => s.setEdit);
  const addMany = useDraftsStore((s) => s.addMany);
  const newMerchants = useCounterpartyEditsStore((s) => s.created);
  const addGroup = useSplitGroupsStore((s) => s.add);
  // Пересборка ленты: правка исходной и новые части иначе не появятся на
  // экране до следующей синхронизации.
  const refresh = useDataStore((s) => s.refresh);

  /** Разделить операцию. Текст ошибки или `null` при успехе. */
  const applySplit = useCallback(
    async (
      tx: Transaction,
      parts: SplitDraftPart[],
      /** Контрагент, общий для всех частей. Пусто — оставляем как был. */
      payee?: string,
      /** Счёт, общий для всех частей. Пусто — оставляем как был. */
      account?: string
    ): Promise<string | null> => {
      const cache = await loadZenCache();
      // Черновику нужны настоящие id счёта, статьи и контрагента — в режиме
      // CSV их взять негде, и разделить операцию нечем.
      if (!cache) return "Разделение работает только при подключённом Дзен-мани";

      const [first, ...rest] = parts;
      const stamp = Math.floor(Date.now() / 1000);
      const created = Math.floor(new Date(tx.createdAt).getTime() / 1000);

      // Собираем ВСЕ новые операции заранее: если хоть одна не собирается
      // (статьи нет в справочнике), не трогаем ничего. Половина разбивки
      // хуже, чем её отсутствие: сумма разъедется, а откатывать нечего.
      const built: ZenTransaction[] = [];
      for (const part of rest) {
        const result = buildDraftTransaction(
          {
            id: newDraftId(),
            kind: tx.kind,
            date: tx.date,
            amount: round2(part.amount),
            account: account || tx.account,
            createdSeconds: Number.isFinite(created) ? created : undefined,
            category: part.category,
            subcategory: part.subcategory,
            payee: payee || tx.brand || tx.payee || undefined,
            comment: part.comment?.trim() || tx.comment || undefined,
          },
          cache,
          stamp,
          newMerchants
        );
        // Проверяем именно `zen`, а не `skip`: пустая строка в `skip` тоже
        // строка, и по ней тип не сужается.
        if (!result.zen) return result.skip;
        built.push(result.zen);
      }

      // Первая часть — сама исходная операция: ужимаем её сумму и меняем
      // статью. Обычная правка, уезжает в облако тем же путём, что и ручная.
      const firstComment = first.comment?.trim();
      await setEdit(tx.id, {
        amount: round2(first.amount),
        category: first.category,
        subcategory: first.subcategory,
        categoryFull: first.subcategory
          ? `${first.category} / ${first.subcategory}`
          : first.category,
        // Контрагента и комментарий правим ТОЛЬКО когда их задали: пустое
        // поле значит «оставить как было», а не «стереть».
        ...(payee && payee !== (tx.brand || tx.payee) ? { payee } : {}),
        ...(firstComment ? { comment: firstComment } : {}),
        // Смена счёта у одноногой операции — это ещё и его нога: при доходе и
        // возврате деньги пришли НА счёт, при расходе ушли С него. Поправить
        // только `account` мало, ноги остались бы от старого счёта.
        ...(account && account !== tx.account
          ? tx.kind === "income" || tx.kind === "refund"
            ? { account, incomeAccount: account, outcomeAccount: "" }
            : { account, outcomeAccount: account, incomeAccount: "" }
          : {}),
      });
      await addMany(built);

      const group: SplitGroup = {
        id: newDraftId(),
        sourceId: tx.id,
        createdAt: new Date().toISOString(),
        date: tx.date,
        payee: payee || tx.brand || tx.payee || "",
        originalAmount: round2(Math.abs(tx.amount)),
        originalCategory: tx.category,
        originalSubcategory: tx.subcategory,
        parts: [
          {
            id: tx.id,
            category: first.category,
            subcategory: first.subcategory,
            amount: round2(first.amount),
          },
          ...built.map((zen, i) => ({
            id: zen.id,
            category: rest[i].category,
            subcategory: rest[i].subcategory,
            amount: round2(rest[i].amount),
          })),
        ],
      };
      await addGroup(group);
      await refresh();
      return null;
    },
    [setEdit, addMany, addGroup, newMerchants, refresh]
  );


  return { applySplit };
}
