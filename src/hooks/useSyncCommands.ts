import { useZenmoneyStore, type SyncResult } from "../store/useZenmoneyStore";
import { pluralRu } from "../lib/plural";
import { toast } from "../store/useToastStore";
import { confirm } from "../store/useConfirmStore";
import { formatNum } from "../lib/format";

/** Итог синхронизации одной фразой — для плашки внизу по центру. */
export function formatSyncResult(r: SyncResult): string {
  if (r.full) return `Полная синхронизация: ${formatNum(r.count)} ${pluralRu(r.count, ["операция", "операции", "операций"])}.`;
  if (r.delta.transactions === 0 && r.delta.deletions === 0) {
    // Число всех операций тут ничего не сообщает — оно то же, что и было.
    return "Без изменений.";
  }
  const parts: string[] = [];
  if (r.delta.transactions > 0) parts.push(`+${formatNum(r.delta.transactions)} ${pluralRu(r.delta.transactions, ["новая/изменённая", "новые/изменённые", "новых/изменённых"])}`);
  if (r.delta.deletions > 0) parts.push(`${formatNum(r.delta.deletions)} ${pluralRu(r.delta.deletions, ["удалена", "удалены", "удалено"])}`);
  return `${parts.join(", ")}. Всего ${formatNum(r.count)} ${pluralRu(r.count, ["операция", "операции", "операций"])}.`;
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
  const busy = status === "syncing" || status === "checking";

  async function runIncremental() {
    if (busy) return;
    try {
      toast(formatSyncResult(await sync()), { tone: "ok" });
    } catch {
      toast(useZenmoneyStore.getState().error || "Синхронизация не прошла. Попробуйте ещё раз", { tone: "err" });
    }
  }

  async function runFull() {
    if (busy) return;
    const ok = await confirm({
      title: "Полная синхронизация?",
      message:
        "Сбросит локальный кэш и заново скачает все данные. Используйте, если данные не сходятся или после массовых переименований категорий в Дзен-мани.",
      confirmLabel: "Синхронизировать всё",
      tone: "warning",
    });
    if (!ok) return;
    try {
      toast(formatSyncResult(await sync({ force: true })), { tone: "ok" });
    } catch {
      toast(useZenmoneyStore.getState().error || "Синхронизация не прошла. Попробуйте ещё раз", { tone: "err" });
    }
  }

  return { busy, runIncremental, runFull };
}
