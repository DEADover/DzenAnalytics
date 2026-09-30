/**
 * Разделение операции (issue #69) — так же, как его делает сам Дзен-мани.
 *
 * Разбивка — это не пометка, а превращение одной операции в несколько
 * настоящих: у операции в Дзен-мани ровно одна сумма, и хранить суммы по
 * статьям там негде. Все части, в том числе первая, создаются новыми
 * операциями — с тем же временем, счётом и получателем, с пометкой
 * `source: "split"` и без банковских номеров. Исходная удаляется и уходит в
 * «Удалённые», откуда её можно вернуть.
 *
 * Прежде исходная ужималась до первой части и оставалась жить со своими
 * банковскими номерами. Её сумма переставала совпадать с тем, что сообщил
 * банк, и Дзен-мани заводил покупку заново из уведомления банка: у
 * пользователя в приложении оказывались обе части и «старая» операция на
 * полную сумму (30.09.2026). Удалённая исходная хранит номер банка и полную
 * сумму — по ней Дзен-мани понимает, что покупка уже учтена; так устроено и
 * его собственное разделение (сверено по записям с `source: "split"`).
 *
 * Связь между частями Дзен-мани хранить негде, и она живёт в своём сторе. Id
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
import { useSplitGroupsStore, type SplitGroup } from "../store/useSplitGroupsStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useDataStore } from "../store/useDataStore";

export function useSplitTransaction() {
  const addMany = useDraftsStore((s) => s.addMany);
  const newMerchants = useCounterpartyEditsStore((s) => s.created);
  const addGroup = useSplitGroupsStore((s) => s.add);
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);
  // Пересборка ленты: новые части иначе не появятся на экране до следующей
  // синхронизации.
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

      const stamp = Math.floor(Date.now() / 1000);
      const created = Math.floor(new Date(tx.createdAt).getTime() / 1000);
      // Название получателя от банка — частям, как у разделения в Дзен-мани:
      // по нему видно, из какой покупки выросла часть.
      const originalPayee =
        cache.transactions.find((t) => t.id === tx.id)?.originalPayee ?? null;

      // Собираем ВСЕ части заранее: если хоть одна не собирается (статьи нет
      // в справочнике), не трогаем ничего. Половина разбивки хуже, чем её
      // отсутствие: сумма разъедется, а откатывать нечего.
      const built: ZenTransaction[] = [];
      for (const part of parts) {
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
            // Теги-категории исходной операции — каждой части (#69): чек из
            // отпуска, разложенный на еду и сувениры, остаётся отпуском целиком.
            extraCategories: tx.extraCategories,
            source: "split",
            originalPayee,
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

      // Сначала части, потом удаление исходной: автоотправка ждёт две секунды
      // тишины и увозит то и другое ОДНИМ запросом — в облаке не бывает
      // момента, когда есть и исходная, и части.
      await addMany(built);
      await deleteTransaction(tx.id);

      const group: SplitGroup = {
        id: newDraftId(),
        sourceId: tx.id,
        createdAt: new Date().toISOString(),
        date: tx.date,
        payee: payee || tx.brand || tx.payee || "",
        originalAmount: round2(Math.abs(tx.amount)),
        originalCategory: tx.category,
        originalSubcategory: tx.subcategory,
        parts: built.map((zen, i) => ({
          id: zen.id,
          category: parts[i].category,
          subcategory: parts[i].subcategory,
          amount: round2(parts[i].amount),
        })),
      };
      await addGroup(group);
      await refresh();
      return null;
    },
    [addMany, addGroup, deleteTransaction, newMerchants, refresh]
  );

  return { applySplit };
}
