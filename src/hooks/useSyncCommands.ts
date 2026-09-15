import { useZenmoneyStore, type SyncResult } from "../store/useZenmoneyStore";
import { useSyncFlashStore } from "../store/useSyncFlashStore";
import { confirm } from "../store/useConfirmStore";
import { formatNum } from "../lib/format";

/** Итог синхронизации одной фразой — для плашки под кнопками шапки. */
export function formatSyncResult(r: SyncResult): string {
  if (r.full) return `Полный синк: ${formatNum(r.count)} операций.`;
  if (r.delta.transactions === 0 && r.delta.deletions === 0) {
    return `Без изменений. Всего ${formatNum(r.count)} операций.`;
  }
  const parts: string[] = [];
  if (r.delta.transactions > 0) parts.push(`+${formatNum(r.delta.transactions)} новых/изменённых`);
  if (r.delta.deletions > 0) parts.push(`${formatNum(r.delta.deletions)} удалено`);
  return `${parts.join(", ")}. Всего ${formatNum(r.count)} операций.`;
}

/**
 * Синхронизация с Дзен-мани из шапки: обычная и полная.
 *
 * Одна на кнопки шапки и на пункт «Полная синхронизация» в меню телефона —
 * с тем же подтверждением и той же плашкой итога, откуда бы ни запустили.
 */
export function useSyncCommands() {
  const status = useZenmoneyStore((s) => s.status);
  const sync = useZenmoneyStore((s) => s.sync);
  const show = useSyncFlashStore((s) => s.show);
  const clear = useSyncFlashStore((s) => s.clear);
  const busy = status === "syncing" || status === "checking";

  async function runIncremental() {
    if (busy) return;
    clear();
    try {
      show({ tone: "ok", text: formatSyncResult(await sync()) });
    } catch {
      show({ tone: "err", text: useZenmoneyStore.getState().error || "Ошибка синхронизации" });
    }
  }

  async function runFull() {
    if (busy) return;
    const ok = await confirm({
      title: "Полная синхронизация?",
      message:
        "Сбросит локальный кэш и заново скачает все данные. Используйте, если данные не сходятся или после массовых переименований категорий в Дзен-мани.",
      confirmLabel: "Полный синк",
      tone: "warning",
    });
    if (!ok) return;
    clear();
    try {
      show({ tone: "ok", text: formatSyncResult(await sync({ force: true })) });
    } catch {
      show({ tone: "err", text: useZenmoneyStore.getState().error || "Ошибка синхронизации" });
    }
  }

  return { busy, runIncremental, runFull };
}
