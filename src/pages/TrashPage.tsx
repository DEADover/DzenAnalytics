import { useEffect, useMemo, useState } from "react";
import { Trash2, RotateCcw, Undo2, Info } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDeletedPayloadsStore } from "../store/useDeletedPayloadsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { applyEdits } from "../lib/applyEdits";
import { loadZenCache, cacheToDiffResponse } from "../lib/zenmoneyCache";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import { formatDate, formatNum, displayPayee } from "../lib/format";
import { operationTone } from "../lib/txKindStyle";
import { DataTable } from "../components/DataTable";
import { OperationAmount, OperationCategory, OperationPayee } from "../components/operations/OperationCells";
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

      <DataTable<Transaction>
        icon={Trash2}
        title={`Удалённые операции (${formatNum(deletedTxs.length)})`}
        data={deletedTxs}
        rowKey={(t) => t.id}
        defaultSortKey="date"
        exportName="trash"
        fixed
        minWidth="60rem"
        columns={[
          {
            key: "date",
            type: "date",
            width: "7rem",
            label: "Дата",
            sortValue: (t) => t.date,
            render: (t) => formatDate(t.date, "full"),
          },
          {
            key: "category",
            type: "text",
            width: "15rem",
            label: "Категория",
            sortValue: (t) => t.categoryFull,
            cellTitle: () => "",
            render: (t) => <OperationCategory tx={t} edited={false} />,
          },
          {
            key: "payee",
            type: "text",
            width: "13rem",
            label: "Получатель",
            sortValue: (t) => displayPayee(t),
            cellTitle: () => "",
            render: (t) => <OperationPayee tx={t} />,
          },
          {
            key: "comment",
            type: "text",
            muted: true,
            label: "Комментарий",
            sortValue: (t) => t.comment || "",
            render: (t) => t.comment || "",
          },
          {
            key: "account",
            type: "text",
            muted: true,
            width: "10rem",
            label: "Счёт",
            sortValue: (t) => t.account,
            render: (t) => t.account,
          },
          {
            key: "amount",
            type: "main",
            tone: operationTone,
            width: "10rem",
            label: "Сумма",
            sortValue: (t) => t.amountBase,
            render: (t) => <OperationAmount tx={t} />,
          },
          {
            key: "restore",
            type: "actions",
            width: "9.5rem",
            label: "Действие",
            render: (t) => (
              <button
                onClick={() => restoreTransaction(t.id)}
                className="btn-ghost text-xs whitespace-nowrap -my-2"
                title="Восстановить операцию"
                aria-label="Восстановить операцию"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Восстановить
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
