import { confirm } from "../store/useConfirmStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { pluralOps } from "./plural";

/**
 * Shared confirm dialog for deleting many transactions at once from any
 * bulk-action bar (feed / drawer / search / duplicates). Wording adapts to
 * whether two-way sync (Push) is on. Resolves to true when confirmed.
 */
export function confirmBulkDelete(n: number): Promise<boolean> {
  const pushMode = useZenmoneyStore.getState().pushMode;
  return confirm({
    title: `Удалить ${n} ${pluralOps(n)}?`,
    message:
      pushMode !== "off"
        ? "Операции скроются из всех расчётов и списков. Так как отправка в Дзен-мани включена, при следующей отправке они будут удалены и в облаке. Вернуть можно на странице «Удалённые» — в т. ч. в облако."
        : "Операции скроются из всех расчётов и списков. Их можно вернуть на странице «Удалённые». В облаке Дзен-мани они не тронутся.",
    confirmLabel: "Удалить",
    tone: "danger",
  });
}
