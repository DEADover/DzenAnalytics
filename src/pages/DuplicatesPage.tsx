import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Calendar, Coins, Copy, CopyCheck, Layers, Pencil, ShieldOff, Trash2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { detectDuplicates, kindTotals, type DuplicateGroup } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { operationTone } from "../lib/txKindStyle";
import { pluralRu } from "../lib/plural";
import type { Transaction } from "../types";
import { TONE_CLASS } from "../components/table/tableKit";
import {
  OperationActions,
  OperationAmount,
  OperationCategory,
} from "../components/operations/OperationCells";
import {
  LazyListFooter,
  OperationListHead,
  OperationListRow,
  OperationListTray,
} from "../components/operations/OperationList";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { BulkEditModal } from "../components/BulkEditModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { DuplicateExclusionsModal } from "../components/DuplicateExclusionsModal";
import { StatCell, StatRow } from "../components/SectionCard";
import { Tooltip } from "../components/Tooltip";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { SectionEmpty } from "../components/SectionEmpty";
import { SectionControls } from "../components/SectionControls";
import { Slider } from "../components/Slider";
import { SelectionBar } from "../components/SelectionBar";
import { SortMenu, type SortOption } from "../components/SortMenu";
import { Checkbox } from "../components/Checkbox";
import { ScrollTopButton } from "../components/ScrollTopButton";
import { useLazyList } from "../hooks/useLazyList";

/**
 * «Дубликаты» — похожие операции, сложенные в группы, и чистка их пачкой.
 *
 * Раздел переехал на общий вид ленты (27.09.2026). Прежде каждая группа была
 * отдельной таблицей со своей шапкой колонок и двумя кнопками — «Не дубликаты»
 * и «Открыть в шторке»: на десяти группах выходило десять одинаковых шапок, а
 * операцию нельзя было открыть прямо из строки — только уйти в шторку и
 * открыть её там.
 *
 * Теперь это лента «Операций»: одна шапка колонок, группа — секцией с итогом,
 * как день в ленте, а строка открывается двойным кликом или карандашом. Главное
 * действие раздела — убрать копии — стало явным: «Выбрать копии» отмечает в
 * группе всё, кроме самой ранней операции, а удаляются они из панели выделения.
 */

type DuplicateSort = "date-desc" | "extra-desc" | "count-desc";

const SORT_OPTIONS: SortOption<DuplicateSort>[] = [
  { value: "date-desc", label: "Сначала новые", icon: Calendar, dir: "desc" },
  { value: "extra-desc", label: "Лишняя сумма", icon: Coins, dir: "desc" },
  { value: "count-desc", label: "Число копий", icon: Layers, dir: "desc" },
];

/** Групп за раз: у группы от двух строк, так что это сотня-другая строк. */
const PAGE_SIZE = 40;

/**
 * Колонки строки. Счёта и контрагента нет — они одни на всю группу (это и есть
 * примета копии) и стоят в её шапке; повторять их в каждой строке незачем.
 */
const TEMPLATE = ["20px", "84px", "minmax(0, 1.2fr)", "minmax(0, 2.4fr)", "140px", "112px"].join(" ");

/** Лишнее в группе — всё, кроме одной операции: её сумма и есть «лишняя». */
function extraOf(g: DuplicateGroup): number {
  return g.totalAmount - g.txs[0].amountBase;
}

/** Копии в группе — всё, кроме самой ранней: её оставляем. */
function copiesOf(g: DuplicateGroup): Transaction[] {
  return g.txs.slice(1);
}

export function DuplicatesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const edits = useEditsStore((s) => s.edits);

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
  const [sortMode, setSortMode] = useState<DuplicateSort>("date-desc");
  const groups = useMemo(
    () => detectDuplicates(transactions, windowDays, excludedSet),
    [transactions, windowDays, excludedSet]
  );
  // «Сначала новые» — порядок самого поиска: свежие группы первыми.
  const sorted = useMemo(() => {
    if (sortMode === "date-desc") return groups;
    const list = [...groups];
    if (sortMode === "extra-desc") list.sort((a, b) => extraOf(b) - extraOf(a));
    else list.sort((a, b) => b.txs.length - a.txs.length || extraOf(b) - extraOf(a));
    return list;
  }, [groups, sortMode]);
  const lazy = useLazyList(sorted, PAGE_SIZE);

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
  const [editing, setEditing] = useState<Transaction | null>(null);

  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Отметить копии группы; если все уже отмечены — снять. */
  const toggleCopies = (list: Transaction[]) =>
    setSelected((cur) => {
      const next = new Set(cur);
      const all = list.every((t) => next.has(t.id));
      for (const t of list) {
        if (all) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });

  const allCopies = useMemo(() => groups.flatMap(copiesOf), [groups]);
  const allOps = useMemo(() => groups.flatMap((g) => g.txs), [groups]);
  const allSelected = allOps.length > 0 && allOps.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;

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

  async function deleteOne(t: Transaction) {
    if (!(await confirmBulkDelete(1))) return;
    await deleteTransactionMany([t.id]);
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
    () => kindTotals(allOps.filter((t) => selected.has(t.id))),
    [allOps, selected]
  );

  if (transactions.length === 0) return <EmptyState />;

  const totalDuplicateAmount = groups.reduce((s, g) => s + extraOf(g), 0);

  return (
    <div className="space-y-6">
      <PageHeader icon={Copy} title="Дубликаты" />

      {/* Что считать копией — рядом контролов раздела: разница в датах меняет
          весь список групп ниже, а исключения — то, что из него убрано. */}
      <SectionControls>
        <Slider
          label="Разница в датах"
          value={windowDays}
          min={0}
          max={14}
          onChange={setWindowDays}
          format={(v) => (v === 0 ? "В один день" : `до ${v} ${pluralRu(v, ["дня", "дней", "дней"])}`)}
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
        <StatCell label="Групп" value={formatNum(groups.length)} tone={groups.length > 0 ? "warn" : "default"} />
        <StatCell
          label="Лишних копий"
          value={formatNum(allCopies.length)}
          note={`из ${formatNum(allOps.length)} ${pluralRu(allOps.length, ["операции", "операций", "операций"])} в группах`}
        />
        <StatCell
          label="Лишняя сумма"
          value={formatMoney(totalDuplicateAmount, base)}
          tone="expense"
          note="Если все копии — действительно дубли"
        />
      </StatRow>

      {groups.length === 0 ? (
        <SectionEmpty icon={AlertCircle} title="Дубликатов не найдено">
          {windowDays < 14
            ? "Увеличьте разницу в датах выше — банк мог провести копию позже"
            : "Даже с разницей в датах до 14 дней похожих операций нет"}
        </SectionEmpty>
      ) : (
        <OperationListTray
          toolbar={
            <>
              <SortMenu options={SORT_OPTIONS} value={sortMode} onChange={setSortMode} />
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => toggleCopies(allCopies)}
                className="btn-ghost text-xs shrink-0"
                title={"Отметить копии во всех группах\nВ каждой группе остаётся неотмеченной самая ранняя операция."}
              >
                <CopyCheck className="w-3.5 h-3.5" aria-hidden />
                Выбрать все копии ({formatNum(allCopies.length)})
              </button>
            </>
          }
        >
          <OperationListHead template={TEMPLATE}>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(allOps.map((t) => t.id)))}
              title="Выбрать все операции во всех группах"
              label="Выбрать все операции во всех группах"
            />
            <div>Дата</div>
            <div>Категория</div>
            <div>Комментарий</div>
            <div className="text-right">Сумма</div>
            <div className="text-center">Действия</div>
          </OperationListHead>
          {lazy.visible.map((g) => (
            <div key={`${g.signature}|${g.txs[0].id}`}>
              <GroupHeader
                group={g}
                base={base}
                copiesSelected={copiesOf(g).every((t) => selected.has(t.id))}
                onToggleCopies={() => toggleCopies(copiesOf(g))}
                onNotDuplicates={() => markNotDuplicates(g)}
              />
              {g.txs.map((t, i) => (
                <OperationListRow
                  key={t.id}
                  template={TEMPLATE}
                  selected={selected.has(t.id)}
                  onToggleSelect={() => toggleOne(t.id)}
                  onOpen={() => setEditing(t)}
                >
                  <Checkbox
                    checked={selected.has(t.id)}
                    stopPropagation
                    onChange={() => toggleOne(t.id)}
                    label="Выбрать операцию"
                  />
                  <div className="text-muted tabular-nums whitespace-nowrap">
                    {formatDate(t.date, "full")}
                  </div>
                  <OperationCategory tx={t} edited={!!edits[t.id]} />
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Какую из операций раздел считает исходной — видно
                        прямо в строке: «Выбрать копии» её не отмечает. */}
                    {i === 0 && (
                      <span
                        className="chip chip-sm shrink-0"
                        title="Самая ранняя операция группы — «Выбрать копии» её не отмечает"
                      >
                        Исходная
                      </span>
                    )}
                    <span className="text-muted truncate" title={t.comment || ""}>
                      {t.comment || ""}
                    </span>
                  </div>
                  <div
                    className={`text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(t)]}`}
                  >
                    <OperationAmount tx={t} />
                  </div>
                  <OperationActions onEdit={() => setEditing(t)} onDelete={() => void deleteOne(t)} />
                </OperationListRow>
              ))}
            </div>
          ))}
          {lazy.hasMore && (
            <LazyListFooter shown={lazy.shown} total={lazy.total} sentinelRef={lazy.attachSentinel} />
          )}
        </OperationListTray>
      )}

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          totals={selectedTotals}
          base={base}
          onClear={() => setSelected(new Set())}
        >
          <button onClick={() => setBulkOpen(true)} className="btn-ghost text-sm">
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

      {editing && (
        <EditTransactionModal key={editing.id} tx={editing} onClose={() => setEditing(null)} />
      )}

      {exclusionsModalOpen && (
        <DuplicateExclusionsModal onClose={() => setExclusionsModalOpen(false)} />
      )}

      <ScrollTopButton />
    </div>
  );
}

/**
 * Шапка группы — как шапка дня в ленте «Операций»: что это за операция, где и
 * когда, сколько лишнего, и два действия над группой целиком.
 */
function GroupHeader({
  group,
  base,
  copiesSelected,
  onToggleCopies,
  onNotDuplicates,
}: {
  group: DuplicateGroup;
  base: string;
  copiesSelected: boolean;
  onToggleCopies: () => void;
  onNotDuplicates: () => void;
}) {
  const first = group.txs[0];
  const last = group.txs[group.txs.length - 1];
  const n = group.txs.length;
  const when =
    first.date.slice(0, 10) === last.date.slice(0, 10)
      ? formatDate(first.date, "full")
      : `${formatDate(first.date, "full")} – ${formatDate(last.date, "full")}`;
  return (
    <div className="px-4 py-2 border-b border-t border-border bg-panel2/60 flex items-center gap-3 text-sm flex-wrap">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-semibold truncate">{first.payee || first.categoryFull}</span>
        <span className="text-[13px] text-muted truncate">
          {formatNum(n)} {pluralRu(n, ["операция", "операции", "операций"])} · {when}
          {first.account ? ` · ${first.account}` : ""}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-expense tabular-nums whitespace-nowrap" title="Сумма копий — всё, кроме одной операции">
          Лишнее {formatMoney(extraOf(group), base)}
        </span>
        <button
          type="button"
          onClick={onToggleCopies}
          className="btn-ghost text-xs"
          title="Отметить в группе всё, кроме самой ранней операции"
        >
          <CopyCheck className="w-3.5 h-3.5" aria-hidden />
          {copiesSelected ? "Снять отметку" : "Выбрать копии"}
        </button>
        <button
          type="button"
          onClick={onNotDuplicates}
          className="btn-ghost text-xs"
          title={"Это разные операции\nГруппа уйдёт из списка и больше не будет помечаться. Вернуть — в «Исключениях»."}
        >
          <ShieldOff className="w-3.5 h-3.5" aria-hidden />
          Не дубликаты
        </button>
      </div>
    </div>
  );
}
