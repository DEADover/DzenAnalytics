import { useEffect, useMemo, useState } from "react";
import { Copy, AlertCircle, Pencil, Trash2, ShieldOff, XSquare } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { detectDuplicates, type DuplicateGroup } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { operationTone } from "../lib/txKindStyle";
import { pluralRu } from "../lib/plural";
import type { Transaction } from "../types";
import { DataTable } from "../components/DataTable";
import { OperationAmount } from "../components/operations/OperationCells";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { BulkEditModal } from "../components/BulkEditModal";
import { DuplicateExclusionsModal } from "../components/DuplicateExclusionsModal";
import { StatCell, StatRow } from "../components/SectionCard";
import { Tooltip } from "../components/Tooltip";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { SectionEmpty } from "../components/SectionEmpty";

export function DuplicatesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const showDrill = useDrillStore((s) => s.show);

  // «Не дубликаты» exceptions (by group signature), persisted + manageable.
  const exclusions = useDuplicateExclusionsStore((s) => s.rules);
  const exclusionsLoaded = useDuplicateExclusionsStore((s) => s.loaded);
  const hydrateExclusions = useDuplicateExclusionsStore((s) => s.hydrate);
  const addExclusion = useDuplicateExclusionsStore((s) => s.add);
  useEffect(() => {
    if (!exclusionsLoaded) hydrateExclusions();
  }, [exclusionsLoaded, hydrateExclusions]);
  const excludedSet = useMemo(() => new Set(Object.keys(exclusions)), [exclusions]);
  const exclusionsCount = Object.keys(exclusions).length;
  const [exclusionsModalOpen, setExclusionsModalOpen] = useState(false);

  const [windowDays, setWindowDays] = useState(0);
  const groups = useMemo(
    () => detectDuplicates(transactions, windowDays, excludedSet),
    [transactions, windowDays, excludedSet]
  );

  function markNotDuplicates(g: DuplicateGroup) {
    const first = g.txs[0];
    addExclusion({
      signature: g.signature,
      payee: first.payee,
      amount: first.amount,
      currency: first.currency,
      kind: first.kind,
      category: first.categoryFull,
      createdAt: new Date().toISOString(),
    });
  }

  // ── Bulk selection + edit (global across all duplicate groups) ──────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  async function applyBulk(patch: TransactionEdit) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await setEditMany(ids, patch);
    await reapplyRules();
    setSelected(new Set());
    setBulkOpen(false);
  }

  async function deleteBulk() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirmBulkDelete(ids.length);
    if (!ok) return;
    await deleteTransactionMany(ids);
    setSelected(new Set());
  }

  // Reset selection when the detected groups change (window / data).
  const [prevGroups, setPrevGroups] = useState(groups);
  if (groups !== prevGroups) {
    setPrevGroups(groups);
    if (selected.size > 0) setSelected(new Set());
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalDuplicateAmount = groups.reduce(
    (s, g) => s + g.totalAmount - g.txs[0].amountBase,
    0
  );
  const totalCount = groups.reduce((s, g) => s + g.txs.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Copy}
        iconTone="text-warn"
        title="Дубликаты"
        hint="Подозрительно похожие операции: одинаковая сумма, тот же получатель и тот же тип в пределах окна — часто бывают при двойном импорте"
        hintWrap
        right={
          <div className="flex items-center gap-4 flex-wrap">
            {exclusionsCount > 0 && (
              <Tooltip content="Управление исключениями «не дубликаты»">
                <button
                  onClick={() => setExclusionsModalOpen(true)}
                  className="btn-ghost text-xs"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  Исключения ({exclusionsCount})
                </button>
              </Tooltip>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Окно (дней)</span>
              <input
                type="range"
                min="0"
                max="14"
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="accent-accent"
              />
              <span className="text-xs tabular-nums w-6">{windowDays}</span>
            </div>
          </div>
        }
      />

      <StatRow>
        <StatCell label="Групп дубликатов" value={formatNum(groups.length)} tone="warn" />
        <StatCell label="Всего операций в группах" value={formatNum(totalCount)} />
        <StatCell
          label="Лишняя сумма"
          value={formatMoney(totalDuplicateAmount, base)}
          tone="expense"
          note="если все «лишние» копии — действительно дубли"
        />
      </StatRow>


      {groups.length === 0 ? (
        <SectionEmpty
          icon={AlertCircle}
          title="Дубликатов не найдено"
        >
          В окне ±{windowDays} дн нет подозрительно похожих операций
        </SectionEmpty>
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => {
            const first = g.txs[0];
            return (
              <DataTable<Transaction>
                key={i}
                icon={Copy}
                title={`${first.payee || first.categoryFull} · ${formatNum(g.txs.length)} ${pluralRu(g.txs.length, ["копия", "копии", "копий"])}`}
                actions={
                  <>
                    <Tooltip content="Это не дубликаты — больше не помечать эту группу">
                      <button onClick={() => markNotDuplicates(g)} className="btn-ghost text-xs">
                        <ShieldOff className="w-3.5 h-3.5" />
                        Не дубликаты
                      </button>
                    </Tooltip>
                    <button
                      onClick={() => showDrill(first.payee || first.categoryFull, g.txs, "Дубликаты")}
                      className="btn-ghost text-xs"
                    >
                      Открыть в шторке
                    </button>
                  </>
                }
                exportable={false}
                data={g.txs}
                rowKey={(t) => t.id}
                defaultSortKey="date"
                selection={{ selected, onChange: setSelected, label: "Выбрать все операции группы" }}
                fixed
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
                    width: "22%",
                    label: "Категория",
                    sortValue: (t) => t.categoryFull,
                    render: (t) => t.categoryFull,
                  },
                  {
                    key: "comment",
                    type: "text",
                    muted: true,
                    label: "Комментарий",
                    sortValue: (t) => t.comment || "",
                    render: (t) => t.comment,
                  },
                  {
                    key: "account",
                    type: "text",
                    muted: true,
                    width: "16%",
                    label: "Счёт",
                    sortValue: (t) => t.account,
                    render: (t) => t.account,
                  },
                  {
                    key: "amount",
                    type: "main",
                    tone: operationTone,
                    width: "9rem",
                    label: "Сумма",
                    sortValue: (t) => t.amountBase,
                    cellTitle: (t) =>
                      t.kind === "refund" ? "Возврат — уменьшает расход категории" : "",
                    render: (t) => <OperationAmount tx={t} />,
                  },
                ]}
              />
            );
          })}
        </div>
      )}

      {/* Floating bulk-action bar — appears when ≥1 row is selected. */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Массовые действия"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-panel shadow-xl max-w-[calc(100vw-1.5rem)]"
        >
          <span className="text-sm">
            Выбрано: <strong className="tabular-nums">{formatNum(selected.size)}</strong>
          </span>
          <button onClick={() => setBulkOpen(true)} className="btn-primary text-sm">
            <Pencil className="w-3.5 h-3.5" />
            Изменить
          </button>
          <button onClick={deleteBulk} className="btn-danger text-sm">
            <Trash2 className="w-3.5 h-3.5" />
            Удалить
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="btn-ghost text-sm text-muted"
          >
            <XSquare className="w-3.5 h-3.5" />
            Снять выделение
          </button>
        </div>
      )}

      {bulkOpen && (
        <BulkEditModal
          count={selected.size}
          allTransactions={transactions}
          onApply={applyBulk}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {exclusionsModalOpen && (
        <DuplicateExclusionsModal onClose={() => setExclusionsModalOpen(false)} />
      )}
    </div>
  );
}
