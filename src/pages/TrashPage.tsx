import { useEffect, useMemo, useState } from "react";
import { Trash2, RotateCcw, Undo2, Info } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDeletedPayloadsStore } from "../store/useDeletedPayloadsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { applyEdits } from "../lib/applyEdits";
import { loadZenCache, cacheToDiffResponse } from "../lib/zenmoneyCache";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import {
  formatMoney,
  formatDate,
  formatNum,
  displayPayee,
  secondaryPayee,
} from "../lib/format";
import { kindColorClass, kindGlyphClass, kindSignGlyph } from "../lib/txKindStyle";
import { CategoryDot } from "../components/CategoryDot";
import { PageHeader } from "../components/PageHeader";
import type { Transaction } from "../types";

/**
 * «Корзина» — locally-deleted (hidden) transactions and a way to bring
 * them back. Deleting is a soft, reversible operation; the underlying row
 * is recoverable, so we re-surface it here for one-click restore.
 *
 * Two data sources, merged:
 *   • `transactionsRaw` — rows still in the pipeline (CSV, or deleted but
 *     not yet pushed to the cloud).
 *   • Zenmoney snapshots — once a cloud deletion is pushed, the row is
 *     purged from cache/`transactionsRaw`; we then reconstruct it from the
 *     full payload captured at delete time (`useDeletedPayloadsStore`).
 */
export function TrashPage() {
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const rates = useDataStore((s) => s.rates);
  const statementLine = useDisplayStore((s) => s.statementLine);
  const restoreTransaction = useDataStore((s) => s.restoreTransaction);
  const restoreTransactionMany = useDataStore((s) => s.restoreTransactionMany);
  const purgeDeleted = useDataStore((s) => s.purgeDeleted);
  const edits = useEditsStore((s) => s.edits);
  const deletedSet = useDeletedStore((s) => s.deletedSet);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const payloads = useDeletedPayloadsStore((s) => s.payloads);
  const payloadsLoaded = useDeletedPayloadsStore((s) => s.loaded);
  const hydratePayloads = useDeletedPayloadsStore((s) => s.hydrate);
  useEffect(() => {
    if (!payloadsLoaded) hydratePayloads();
  }, [payloadsLoaded, hydratePayloads]);

  // Hidden rows still present in the pipeline (with edits applied).
  const fromRaw = useMemo(() => {
    if (deletedSet.size === 0) return [];
    const withEdits = applyEdits(transactionsRaw, edits, rates);
    return withEdits.filter((t) => deletedSet.has(t.id));
  }, [transactionsRaw, edits, rates, deletedSet]);

  // Hidden rows the cloud deletion purged from cache → rebuild from the
  // snapshot by mapping the saved ZenTransaction with the cache's
  // (still intact) account/tag/instrument dictionaries.
  const [fromSnapshots, setFromSnapshots] = useState<Transaction[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const presentIds = new Set(transactionsRaw.map((t) => t.id));
      const missing = [...deletedSet].filter(
        (id) => !presentIds.has(id) && payloads[id]
      );
      if (missing.length === 0) {
        if (!cancelled) setFromSnapshots([]);
        return;
      }
      const cache = await loadZenCache();
      if (!cache) {
        if (!cancelled) setFromSnapshots([]);
        return;
      }
      const synthetic = {
        ...cache,
        transactions: missing.map((id) => payloads[id]),
      };
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(synthetic));
      const withEdits = applyEdits(mapped.transactions, edits, rates);
      if (!cancelled) setFromSnapshots(withEdits);
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionsRaw, deletedSet, payloads, edits, rates]);

  // Merge both sources (dedup by id), newest first.
  const deletedTxs = useMemo(() => {
    const seen = new Set<string>();
    const all: Transaction[] = [];
    for (const t of [...fromRaw, ...fromSnapshots]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
    }
    return all.sort((a, b) => b.date.localeCompare(a.date));
  }, [fromRaw, fromSnapshots]);

  async function handlePurge() {
    const n = deletedTxs.length;
    if (n === 0) return;
    const ops = pluralRu(n, ["операция", "операции", "операций"]);
    const willBe = pluralRu(n, ["будет", "будут", "будут"]);
    const cloudNote =
      pushMode !== "off"
        ? " Уже удалённые в облаке Дзен-мани остаются удалёнными; операции, удаление которых ещё не отправлено в облако, могут вернуться при полной синхронизации."
        : "";
    const ok = await confirm({
      title: "Очистить корзину окончательно?",
      message:
        `${formatNum(n)} ${ops} ${willBe} безвозвратно удалены из локального хранилища и исчезнут из корзины — восстановить их будет нельзя.` +
        cloudNote,
      confirmLabel: "Очистить корзину",
      tone: "danger",
    });
    if (!ok) return;
    await purgeDeleted();
  }

  if (deletedTxs.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Trash2}
          title="Удалённые"
          hint="Удалённые операции скрыты из всех расчётов, но хранятся локально — здесь их можно вернуть"
        />
        <div className="card-tray card-pad text-center py-16">
          <Trash2 className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Корзина пуста</div>
          <div className="text-sm text-muted">
            Удалённых операций нет. Удалить операцию можно иконкой 🗑️ в ленте
            «Операции» или в карточке операции.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="Удалённые"
        hint="Удалённые операции скрыты из всех расчётов, но хранятся локально — здесь их можно вернуть"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => restoreTransactionMany(deletedTxs.map((t) => t.id))}
              className="btn-ghost text-sm"
            >
              <Undo2 className="w-4 h-4" />
              Восстановить все ({formatNum(deletedTxs.length)})
            </button>
            <button
              onClick={handlePurge}
              className="btn-danger text-sm"
              title="Окончательно удалить все операции из корзины"
            >
              <Trash2 className="w-4 h-4" />
              Очистить корзину
            </button>
          </div>
        }
      />

      {pushMode !== "off" && (
        <div className="card card-pad bg-accent/5 border-accent/40 flex items-start gap-2 text-sm">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <span className="text-muted">
            Включена двусторонняя синхронизация: восстановление вернёт операцию
            <strong> и в облако Дзен-мани</strong> — она будет создана заново при
            следующей отправке/синхронизации (со всеми полями: получатель, теги,
            суммы).
          </span>
        </div>
      )}

      <div className="card-tray card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Удалённые операции ({formatNum(deletedTxs.length)})
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr>
                <th className="table-th">Дата</th>
                <th className="table-th">Категория</th>
                <th className="table-th">Получатель</th>
                <th className="table-th">Комментарий</th>
                <th className="table-th">Счёт</th>
                <th className="table-th text-right">Сумма</th>
                <th className="table-th text-right">Действие</th>
              </tr>
            </thead>
            <tbody>
              {deletedTxs.map((t) => {
                const primary = displayPayee(t) || "";
                const secondary = statementLine ? secondaryPayee(t, "statement") : null;
                return (
                  <tr key={t.id} className="align-middle">
                    <td className="table-td whitespace-nowrap text-muted">
                      {formatDate(t.date, "full")}
                    </td>
                    <td className="table-td max-w-[180px]">
                      <div className="truncate flex items-center gap-2" title={t.categoryFull}>
                        <CategoryDot category={t.category} size="w-5 h-5" />
                        <span className="truncate">{t.category || "—"}</span>
                      </div>
                      {t.subcategory && (
                        <div className="text-[0.85em] text-muted truncate pl-7">
                          {t.subcategory}
                        </div>
                      )}
                    </td>
                    <td className="table-td max-w-[180px]">
                      <div className="truncate text-muted" title={primary}>
                        {primary || "—"}
                      </div>
                      {secondary && (
                        <div className="truncate text-[0.85em] text-text" title={secondary}>
                          {secondary}
                        </div>
                      )}
                    </td>
                    <td className="table-td max-w-[260px] text-muted">
                      <div className="line-clamp-2" title={t.comment}>
                        {t.comment || ""}
                      </div>
                    </td>
                    <td className="table-td max-w-[140px] truncate text-muted" title={t.account}>
                      {t.account}
                    </td>
                    <td
                      className={`table-td text-right tabular-nums font-medium whitespace-nowrap ${kindColorClass(t.kind)}`}
                    >
                      <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                      {formatMoney(t.amount, t.currency)}
                    </td>
                    <td className="table-td text-right">
                      <button
                        onClick={() => restoreTransaction(t.id)}
                        className="btn-ghost text-xs !py-1 whitespace-nowrap"
                        title="Восстановить операцию"
                        aria-label="Восстановить операцию"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Восстановить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
