import { useEffect, useMemo, useState } from "react";
import { Copy, AlertCircle, Pencil, Trash2, ShieldOff } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { detectDuplicates, kindTotals, type DuplicateGroup } from "../lib/aggregations";
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
import { SectionControls } from "../components/SectionControls";
import { Slider } from "../components/Slider";
import { SelectionBar } from "../components/SelectionBar";

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

  // Суммы выделенного по видам — для панели выделения, как в ленте «Операций».
  // Операция попадает ровно в одну группу, так что сложение без повторов.
  const selectedTotals = useMemo(
    () => kindTotals(groups.flatMap((g) => g.txs).filter((t) => selected.has(t.id))),
    [groups, selected]
  );

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
        hint="Удалите лишние копии или отметьте, что операции разные"
      />

      {/* Что считать копией — рядом контролов раздела: разница в датах меняет
          весь список групп ниже, а исключения — то, что из него убрано. В
          шапке бегунок стоял в правом углу, через экран от групп. */}
      <SectionControls>
        <Slider
          label="Разница в датах"
          value={windowDays}
          min={0}
          max={14}
          onChange={setWindowDays}
          format={(v) => `${v} дн`}
        />
        {exclusionsCount > 0 && (
          <Tooltip content="Группы, отмеченные «Не дубликаты»">
            <button onClick={() => setExclusionsModalOpen(true)} className="btn-ghost btn-lg">
              <ShieldOff className="w-4 h-4" />
              Исключения ({formatNum(exclusionsCount)})
            </button>
          </Tooltip>
        )}
      </SectionControls>

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
          {windowDays < 14
            ? "Увеличьте разницу в датах выше — банк мог провести копию позже"
            : "Даже с разницей в датах до 14 дн похожих операций нет"}
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

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          totals={selectedTotals}
          base={base}
          onClear={() => setSelected(new Set())}
        >
          <button onClick={() => setBulkOpen(true)} className="btn-primary text-sm">
            <Pencil className="w-4 h-4" />
            Изменить
          </button>
          <button onClick={deleteBulk} className="btn-danger text-sm">
            <Trash2 className="w-4 h-4" />
            Удалить
          </button>
        </SelectionBar>
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
