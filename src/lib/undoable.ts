/**
 * Действия с операциями, которые можно отменить с плашки.
 *
 * Вместо окна «Вы уверены?» действие выполняется сразу, а внизу на несколько
 * секунд встаёт плашка «Операция удалена · Отменить». Окно-вопрос на каждое
 * удаление приучало жать «Да» не читая; плашка не останавливает работу и
 * спасает именно тогда, когда нажали по ошибке. Пока она висит, правки не
 * уходят в Дзен-мани (см. `lib/pushHold`), поэтому отмена честная: в облако
 * не попадает ни удаление, ни его возврат.
 */
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { toast } from "../store/useToastStore";
import { pluralOps, pluralRu } from "./plural";

/** «Операция удалена», «Удалены 3 операции», «Удалено 12 операций». */
export function deletedText(n: number): string {
  if (n === 1) return "Операция удалена";
  return `${pluralRu(n, ["Удалена", "Удалены", "Удалено"])} ${n} ${pluralOps(n)}`;
}

/**
 * Удалить операции и предложить отмену.
 *
 * Удаление и так обратимо — операция прячется, а не стирается, — но вместе с
 * ней снимаются её неотправленные правки, а черновик (ещё не отправленная
 * новая операция) убирается целиком. Отмена возвращает и то, и другое.
 */
export async function deleteWithUndo(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drafts = useDraftsStore.getState().drafts;
  const draftCopies = ids.filter((id) => drafts[id]).map((id) => drafts[id]);
  const synced = ids.filter((id) => !drafts[id]);
  // Уже спрятанные раньше отмена возвращать не должна — их удаляли не сейчас.
  const hiddenBefore = useDeletedStore.getState().deletedSet;
  const freshlyHidden = synced.filter((id) => !hiddenBefore.has(id));
  const edits = useEditsStore.getState().snapshot(synced);

  await useDataStore.getState().deleteTransactionMany(ids);

  toast(deletedText(ids.length), {
    undo: async () => {
      if (draftCopies.length) await useDraftsStore.getState().addMany(draftCopies);
      await useDeletedStore.getState().restoreMany(freshlyHidden);
      await useEditsStore.getState().restore(edits);
      await useDataStore.getState().refresh();
    },
  });
}

/**
 * Запомнить правки операций до изменения — вернёт функцию отмены.
 *
 * Снимок берётся ДО записи: отмена возвращает правку ровно такой, какой она
 * была, — с прежними неотправленными изменениями, а не пустой.
 */
export function editUndo(ids: readonly string[]): () => Promise<void> {
  const snap = useEditsStore.getState().snapshot(ids);
  return async () => {
    await useEditsStore.getState().restore(snap);
    await useDataStore.getState().reapplyRules();
  };
}
