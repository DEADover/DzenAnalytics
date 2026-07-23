import { useEffect, useMemo, useState } from "react";
import { Copy, AlertCircle, Pencil, Trash2, ShieldOff } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { detectDuplicates, type DuplicateGroup } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindLabel, kindSignGlyph } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { BulkEditModal } from "../components/BulkEditModal";
import { DuplicateExclusionsModal } from "../components/DuplicateExclusionsModal";
import { Stat } from "../components/Stat";
import { Tooltip } from "../components/Tooltip";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";

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

  const [windowDays, setWindowDays] = useState(3);
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        hint="Подозрительно похожие операции: одинаковая сумма, тот же получатель и тот же тип в пределах окна. Часто бывают при двойном импорте."
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Групп дубликатов" value={groups.length} tone="warn" />
        <Stat label="Всего операций в группах" value={formatNum(totalCount)} />
        <Stat
          label="Лишняя сумма"
          value={formatMoney(totalDuplicateAmount, base)}
          tone="expense"
          hint="если все «лишние» копии — действительно дубли"
        />
      </div>


      {groups.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Дубликатов не найдено</div>
          <div className="text-sm text-muted">
            В окне ±{windowDays} дн нет подозрительно похожих операций
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => {
            const first = g.txs[0];
            const groupAll = g.txs.length > 0 && g.txs.every((t) => selected.has(t.id));
            const groupSome = g.txs.some((t) => selected.has(t.id)) && !groupAll;
            const toggleGroup = () =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (groupAll) g.txs.forEach((t) => next.delete(t.id));
                else g.txs.forEach((t) => next.add(t.id));
                return next;
              });
            return (
              <div key={i} className="card card-pad">
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {first.payee || first.categoryFull}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {kindLabel(first.kind).replace(/^./, (c) => c.toUpperCase())} ·{" "}
                      {first.categoryFull} ·{" "}
                      {formatMoney(first.amount, first.currency)} ·{" "}
                      {g.txs.length} копий
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Tooltip content="Это не дубликаты — больше не помечать эту группу">
                      <button
                        onClick={() => markNotDuplicates(g)}
                        className="btn-ghost text-xs"
                      >
                        <ShieldOff className="w-3.5 h-3.5" />
                        Не дубликаты
                      </button>
                    </Tooltip>
                    <button
                      onClick={() => showDrill(first.payee || first.categoryFull, g.txs, "Дубликаты")}
                      className="btn-ghost text-xs"
                    >
                      Открыть в Drawer
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm table-fixed">
                  {/* Shared column template — identical in every group so the
                      columns line up across all duplicate cards. */}
                  <colgroup>
                    <col style={{ width: "36px" }} />
                    <col style={{ width: "92px" }} />
                    <col style={{ width: "22%" }} />
                    <col />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "120px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="table-th w-8">
                        <input
                          type="checkbox"
                          className="accent-accent w-4 h-4 align-middle"
                          checked={groupAll}
                          ref={(el) => {
                            if (el) el.indeterminate = groupSome;
                          }}
                          onChange={toggleGroup}
                          title="Выбрать всю группу"
                          aria-label="Выбрать все операции группы"
                        />
                      </th>
                      <th className="table-th">Дата</th>
                      <th className="table-th">Категория</th>
                      <th className="table-th">Комментарий</th>
                      <th className="table-th">Счёт</th>
                      <th className="table-th text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.txs.map((t) => {
                      const isSel = selected.has(t.id);
                      return (
                      <tr
                        key={t.id}
                        className={isSel ? "bg-accent/5" : "hover:bg-panel2/40"}
                      >
                        <td className="table-td w-8">
                          <input
                            type="checkbox"
                            className="accent-accent w-4 h-4 align-middle"
                            checked={isSel}
                            onChange={() => toggleSelect(t.id)}
                            aria-label="Выбрать операцию"
                          />
                        </td>
                        <td className="table-td whitespace-nowrap text-muted">
                          {formatDate(t.date, "full")}
                        </td>
                        <td className="table-td truncate" title={t.categoryFull}>
                          {t.categoryFull}
                        </td>
                        <td
                          className="table-td truncate text-muted"
                          title={t.comment}
                        >
                          {t.comment}
                        </td>
                        <td className="table-td truncate text-muted" title={t.account}>
                          {t.account}
                        </td>
                        <td
                          className={`table-td text-right tabular-nums whitespace-nowrap ${kindColorClass(t.kind)}`}
                          title={t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined}
                        >
                          <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                          {formatMoney(t.amount, t.currency)}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
