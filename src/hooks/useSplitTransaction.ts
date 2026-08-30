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
import { useDeletedStore } from "../store/useDeletedStore";
import { useSplitGroupsStore, type SplitGroup } from "../store/useSplitGroupsStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useDataStore } from "../store/useDataStore";

export function useSplitTransaction() {
  const setEdit = useEditsStore((s) => s.setEdit);
  const clearEdit = useEditsStore((s) => s.clearEdit);
  const addMany = useDraftsStore((s) => s.addMany);
  const removeDraft = useDraftsStore((s) => s.remove);
  const drafts = useDraftsStore((s) => s.drafts);
  const removeMany = useDeletedStore((s) => s.removeMany);
  const newMerchants = useCounterpartyEditsStore((s) => s.created);
  const addGroup = useSplitGroupsStore((s) => s.add);
  const dropGroup = useSplitGroupsStore((s) => s.remove);
  // Пересборка ленты: правка исходной и новые части иначе не появятся на
  // экране до следующей синхронизации.
  const refresh = useDataStore((s) => s.refresh);

  /** Разделить операцию. Текст ошибки или `null` при успехе. */
  const applySplit = useCallback(
    async (tx: Transaction, parts: SplitDraftPart[]): Promise<string | null> => {
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
            account: tx.account,
            createdSeconds: Number.isFinite(created) ? created : undefined,
            category: part.category,
            subcategory: part.subcategory,
            payee: tx.brand || tx.payee || undefined,
            comment: tx.comment || undefined,
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
      await setEdit(tx.id, {
        amount: round2(first.amount),
        category: first.category,
        subcategory: first.subcategory,
        categoryFull: first.subcategory
          ? `${first.category} / ${first.subcategory}`
          : first.category,
      });
      await addMany(built);

      const group: SplitGroup = {
        sourceId: tx.id,
        createdAt: new Date().toISOString(),
        date: tx.date,
        payee: tx.brand || tx.payee || "",
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

  /**
   * Отменить разбивку: вернуть исходную операцию как была и убрать части.
   *
   * Часть, ещё не уехавшую в облако, просто выбрасываем из черновиков. Та,
   * что уже уехала, удаляется обычным удалением операции — то же, что человек
   * сделал бы руками, и так же уезжает в Дзен-мани.
   */
  const undoSplit = useCallback(
    async (group: SplitGroup): Promise<string | null> => {
      const partIds = group.parts.slice(1).map((p) => p.id);
      const asDrafts = partIds.filter((id) => drafts[id]);
      const pushed = partIds.filter((id) => !drafts[id]);
      for (const id of asDrafts) await removeDraft(id);
      if (pushed.length) await removeMany(pushed);
      // Правку исходной снимаем целиком: она вся была разбивкой, и сумма со
      // статьёй возвращаются к тому, что пришло из Дзен-мани.
      await clearEdit(group.sourceId);
      await dropGroup(group.sourceId);
      await refresh();
      return null;
    },
    [drafts, removeDraft, removeMany, clearEdit, dropGroup, refresh]
  );

  return { applySplit, undoSplit };
}
