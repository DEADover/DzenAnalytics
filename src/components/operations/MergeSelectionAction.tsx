import { useMemo, useState } from "react";
import { Merge } from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../../types";
import { mergeProblem } from "../../lib/mergeTransactions";
import { useMergeTransactions } from "../../hooks/useMergeTransactions";
import { useZenmoneyStore } from "../../store/useZenmoneyStore";
import { MergeTransactionsModal } from "../MergeTransactionsModal";

/**
 * Кнопка «Объединить» в панели выделения — вместе со своим окном.
 *
 * Одна на ленту «Операций» и шторку операций. Рисуется, только когда выбрано
 * две операции и больше и подключён Дзен-мани (без него новую операцию не
 * создать). Если выбранное объединить нельзя, кнопка бледная, а подсказка
 * говорит почему: выключенной (`disabled`) её не делаем — у выключенной
 * кнопки подсказка не всплывает.
 */
export function MergeSelectionAction({
  txs,
  onMerged,
  onOpenChange,
}: {
  /** Выбранные операции. */
  txs: Transaction[];
  /** Объединили — выделение пора снять. */
  onMerged: () => void;
  /** Окно открылось/закрылось — странице это нужно для Escape. */
  onOpenChange?: (open: boolean) => void;
}) {
  const apiConnected = useZenmoneyStore((s) => !!s.token);
  const { applyMerge } = useMergeTransactions();
  const [open, setOpenState] = useState(false);
  const blocker = useMemo(() => mergeProblem(txs), [txs]);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  if (!apiConnected || txs.length < 2) return null;
  return (
    <>
      <button
        onClick={() => !blocker && setOpen(true)}
        aria-disabled={!!blocker}
        title={blocker ?? "Сложить выбранные в одну операцию"}
        className={clsx("btn-ghost text-sm", blocker && "opacity-50 cursor-not-allowed")}
      >
        <Merge className="w-4 h-4" />
        Объединить
      </button>
      {open && (
        <MergeTransactionsModal
          txs={txs}
          onClose={() => setOpen(false)}
          onMerge={async (choice) => {
            const failed = await applyMerge(txs, choice);
            if (!failed) {
              // Закрываем сами, до снятия выделения: без выделения кнопка
              // исчезает вместе с окном, и его `onClose` уже не придёт.
              setOpen(false);
              onMerged();
            }
            return failed;
          }}
        />
      )}
    </>
  );
}
