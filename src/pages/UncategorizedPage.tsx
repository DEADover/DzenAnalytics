import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Coins,
  List,
  Pencil,
  Sparkles,
  Tag,
  User,
  Wand2,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useCategoryRulesStore } from "../store/useCategoryRulesStore";
import { confirm } from "../store/useConfirmStore";
import {
  detectUncategorized,
  kindTotals,
  lastTransactionDate,
  suggestCategoriesForUncategorized,
  type CategorySuggestion,
} from "../lib/aggregations";
import {
  CONFIDENT,
  groupUncategorizedByDay,
  sortUncategorized,
  suggestionKey,
  suggestionReason,
  suggestionStats,
  suggestionsById,
  type UncategorizedSort,
} from "../lib/uncategorized";
import { formatDate, formatMoney, formatNum, formatPct, payeeSearchText } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { operationTone } from "../lib/txKindStyle";
import { TONE_CLASS, buildCsv, csvFileName, downloadCsv } from "../components/table/tableKit";
import { ExportButton } from "../components/table/TableParts";
import { OperationAmount, OperationPayee } from "../components/operations/OperationCells";
import { DayHeader } from "../components/operations/DayHeader";
import {
  LazyListFooter,
  OperationListHead,
  OperationListRow,
  OperationListTray,
} from "../components/operations/OperationList";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { GlobalFilters } from "../components/GlobalFilters";
import { SearchInput } from "../components/SearchInput";
import { SortMenu, type SortOption } from "../components/SortMenu";
import { SelectionBar } from "../components/SelectionBar";
import { ScrollTopButton } from "../components/ScrollTopButton";
import { StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { Checkbox } from "../components/Checkbox";
import { BulkEditModal } from "../components/BulkEditModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { useLazyList } from "../hooks/useLazyList";
import type { Transaction } from "../types";

/**
 * «Без категории» — операции, которым категорию так и не поставили, и разметка
 * их пачкой.
 *
 * Раздел переехал на общий вид ленты (19.09.2026). Прежде он показывал ВСЮ
 * историю сразу, мимо общих фильтров, отдельной таблицей, а подсказки
 * категорий жили над ней своим списком: одни и те же операции были
 * нарисованы дважды, в двух разных видах, и до операции за нужный месяц
 * приходилось долистывать.
 *
 * Теперь это лента «Операций» на общих фильтрах, а подсказка стоит в строке
 * той операции, к которой относится: видно сразу, что предлагается и
 * насколько уверенно. Применение по-прежнему создаёт правило — по получателю,
 * а если его нет, по комментарию, — поэтому размечает и будущие операции.
 */

const PAGE_SIZE = 100;

const SORT_OPTIONS: SortOption<UncategorizedSort>[] = [
  { value: "date-desc", label: "Дата ↓", icon: Calendar, dir: "desc" },
  { value: "date-asc", label: "Дата ↑", icon: Calendar, dir: "asc" },
  { value: "amount-desc", label: "Сумма ↓", icon: Coins, dir: "desc" },
  { value: "amount-asc", label: "Сумма ↑", icon: Coins, dir: "asc" },
  { value: "payee-asc", label: "Контрагент", icon: User, dir: "asc" },
  { value: "confidence-desc", label: "Подсказка ↓", icon: Sparkles, dir: "desc" },
];

/** Колонки ленты. Категории среди них нет — её тут нет по определению. */
const TEMPLATE = ["20px", "84px", "minmax(0, 1fr)", "minmax(0, 1.3fr)", "minmax(0, 2fr)", "minmax(0, 1.4fr)", "140px", "72px"].join(" ");

export function UncategorizedPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const applyRulesNow = useDataStore((s) => s.applyRulesNow);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const addRule = useCategoryRulesStore((s) => s.add);
  const addManyRules = useCategoryRulesStore((s) => s.addMany);
  const rulesLoaded = useCategoryRulesStore((s) => s.loaded);
  const rulesHydrate = useCategoryRulesStore((s) => s.hydrate);
  useEffect(() => {
    if (!rulesLoaded) rulesHydrate();
  }, [rulesLoaded, rulesHydrate]);

  const [pageSearch, setPageSearch] = useState("");
  const [sortMode, setSortMode] = useState<UncategorizedSort>("date-desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  // Скользящие периоды («30 дней», «12 мес») считаются от последней операции
  // ВСЕЙ ленты, как на соседних страницах с тем же фильтром.
  const maxDate = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const scoped = useMemo(
    () => applyFilters(transactions, filters, monthStartDay, { maxDate: maxDate || undefined }),
    [transactions, filters, monthStartDay, maxDate]
  );

  /** Всё без категории — за всю историю и под фильтрами. */
  const allUncategorized = useMemo(() => detectUncategorized(transactions), [transactions]);
  const list = useMemo(() => detectUncategorized(scoped), [scoped]);

  // Подсказки строятся по ВСЕЙ истории (корпус тем богаче, чем больше
  // размеченных операций), а показываются для того, что сейчас в ленте.
  const suggestions = useMemo<CategorySuggestion[]>(
    () => suggestCategoriesForUncategorized(transactions, list, 7),
    [transactions, list]
  );
  const suggestionOf = useMemo(() => suggestionsById(suggestions), [suggestions]);
  const stats = useMemo(() => suggestionStats(suggestions, applied), [suggestions, applied]);

  const searched = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      `${payeeSearchText(t)} ${t.comment} ${t.account}`.toLowerCase().includes(q)
    );
  }, [list, pageSearch]);

  const sorted = useMemo(
    () => sortUncategorized(searched, sortMode, (t) => suggestionOf.get(t.id)?.confidence ?? 0),
    [searched, sortMode, suggestionOf]
  );
  const lazy = useLazyList(sorted, PAGE_SIZE);
  const visible = useMemo(() => sorted.slice(0, lazy.shown), [sorted, lazy.shown]);
  const days = useMemo(() => groupUncategorizedByDay(visible, sortMode), [visible, sortMode]);

  const totals = useMemo(() => kindTotals(list), [list]);
  const allFlows = useMemo(
    () => scoped.filter((t) => t.kind !== "transfer").reduce((s, t) => s + Math.abs(t.amountBase), 0),
    [scoped]
  );
  const sum = list.reduce((s, t) => s + Math.abs(t.amountBase), 0);
  const share = allFlows > 0 ? sum / allFlows : 0;

  const selectedTxs = useMemo(() => sorted.filter((t) => selected.has(t.id)), [sorted, selected]);
  const selectedTotals = useMemo(() => kindTotals(selectedTxs), [selectedTxs]);
  /** Из выделенного — то, что можно разметить подсказкой одним нажатием. */
  const selectedSuggestions = useMemo(
    () =>
      selectedTxs
        .map((t) => suggestionOf.get(t.id))
        .filter((s): s is CategorySuggestion => !!s && !applied.has(s.txId) && !!suggestionKey(s)),
    [selectedTxs, suggestionOf, applied]
  );

  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === sorted.length ? new Set() : new Set(sorted.map((t) => t.id))));
  }

  /** Выделить те, где подсказка достаточно уверенная: с них и начинают. */
  function selectConfident() {
    const ids = suggestions
      .filter((s) => s.confidence >= CONFIDENT && !applied.has(s.txId) && suggestionKey(s))
      .map((s) => s.txId)
      .filter((id) => sorted.some((t) => t.id === id));
    setSelected(new Set(ids));
  }

  async function applySuggestions(items: readonly CategorySuggestion[]) {
    if (items.length === 0 || busy) return;
    const rules = items.flatMap((s) => {
      const key = suggestionKey(s);
      return key ? [{ key, category: s.suggested, txId: s.txId }] : [];
    });
    if (rules.length === 0) return;

    const ok = await confirm({
      title: rules.length === 1 ? "Применить подсказку?" : `Применить ${rules.length} ${pluralRu(rules.length, ["подсказку", "подсказки", "подсказок"])}?`,
      message:
        "Для каждой создастся правило — по контрагенту, а если его нет, по комментарию. Правило разметит и похожие операции, в том числе будущие; отменить можно в разделе «Правила».",
      confirmLabel: "Применить",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const newRule = (r: (typeof rules)[number]) => ({
        enabled: true,
        field: r.key.field,
        op: "contains" as const,
        value: r.key.value,
        caseInsensitive: true,
        category: r.category,
      });
      const ids =
        rules.length === 1
          ? [await addRule(newRule(rules[0]))]
          : await addManyRules(rules.map(newRule));
      // Созданное правило само по себе историю не трогает — оно размечает
      // только то, что придёт потом. Здесь человек просит разметить именно эти
      // операции, поэтому применяем правила сразу, как кнопка «Проверить и
      // применить» в разделе «Правила».
      await applyRulesNow(ids);
      setApplied((prev) => new Set([...prev, ...rules.map((r) => r.txId)]));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  /** Массовая правка — то же окно, что в «Операциях»: категория, счёт, комментарий. */
  async function applyBulk(patch: TransactionEdit) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await setEditMany(ids, patch);
    await reapplyRules();
    setSelected(new Set());
    setBulkOpen(false);
  }

  function exportCsv() {
    const text = buildCsv(
      ["Дата", "Счёт", "Контрагент", "Комментарий", "Сумма", "Валюта", "Подсказка", "Уверенность"],
      sorted.map((t) => {
        const s = suggestionOf.get(t.id);
        return [
          t.date.slice(0, 10),
          t.account,
          t.payee || "",
          t.comment || "",
          t.amount,
          t.currency,
          s?.suggested ?? "",
          s ? formatPct(s.confidence, 0) : "",
        ];
      })
    );
    downloadCsv(csvFileName("uncategorized"), text);
  }

  if (transactions.length === 0) return <EmptyState />;

  const renderRow = (t: Transaction) => (
    <Row
      key={t.id}
      tx={t}
      suggestion={suggestionOf.get(t.id)}
      applied={applied.has(t.id)}
      busy={busy}
      selected={selected.has(t.id)}
      onToggleSelect={() => toggleSelect(t.id)}
      onOpen={() => setEditing(t)}
      onApply={(s) => void applySuggestions([s])}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader icon={Tag} title="Без категории" />
      <GlobalFilters />

      <StatRow>
        <StatCell
          label="Операций"
          value={formatNum(list.length)}
          icon={<List className="w-4 h-4" />}
          note={
            list.length < allUncategorized.length
              ? `из ${formatNum(allUncategorized.length)} за всё время`
              : undefined
          }
        />
        <StatCell
          label="Расходы"
          value={formatMoney(totals.exp, base)}
          tone="expense"
          icon={<ArrowDown className="w-4 h-4" />}
        />
        <StatCell
          label="Доходы"
          value={formatMoney(totals.inc, base)}
          tone="income"
          icon={<ArrowUp className="w-4 h-4" />}
        />
        <StatCell
          label="Доля от потоков"
          value={formatPct(share, 1)}
          tone={share > 0.1 ? "warn" : "default"}
          tooltip="Сколько из доходов и расходов за период осталось без категории. Переводы между своими счетами не в счёт"
        />
        <StatCell
          label="С подсказкой"
          value={formatNum(stats.applicable)}
          tone={stats.confident > 0 ? "accent" : "default"}
          icon={<Sparkles className="w-4 h-4" />}
          note={stats.confident > 0 ? `явных ${formatNum(stats.confident)}` : undefined}
        />
      </StatRow>

      <OperationListTray
        toolbar={
          <>
            <SearchInput
              size="sm"
              value={pageSearch}
              onChange={setPageSearch}
              placeholder="Быстрый поиск по таблице…"
              title={"Быстрый поиск по этой таблице\nИщет по контрагенту, комментарию и счёту. Не сохраняется и на другие страницы не влияет."}
              className="flex-1 min-w-[220px]"
            />
            {stats.confident > 0 && (
              <button
                type="button"
                onClick={selectConfident}
                className="btn-ghost text-xs shrink-0"
                title={`Отметить операции, у которых подсказка совпала на ${formatPct(CONFIDENT, 0)} и выше\nПрименить их можно разом, кнопкой в панели выделения: для каждой создастся правило, и такие же операции будут размечаться дальше сами.`}
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden />
                Явные совпадения ({formatNum(stats.confident)})
              </button>
            )}
            <SortMenu options={SORT_OPTIONS} value={sortMode} onChange={setSortMode} />
            <ExportButton rows={sorted.length} onClick={exportCsv} />
          </>
        }
      >
        {sorted.length === 0 ? (
          <SectionEmpty variant="inline">
            {allUncategorized.length === 0
              ? "Все операции размечены — категория есть у каждой."
              : `По текущим фильтрам ничего не найдено. Всего без категории — ${formatNum(
                  allUncategorized.length
                )}: выберите другой период или сбросьте фильтры.`}
          </SectionEmpty>
        ) : (
          <div>
            <OperationListHead template={TEMPLATE}>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
                title="Выбрать всё (под фильтрами)"
                label="Выбрать все операции без категории"
              />
              <div>Дата</div>
              <div>Счёт</div>
              <div>Контрагент</div>
              <div>Комментарий</div>
              <div>Подсказка</div>
              <div className="text-right">Сумма</div>
              <div className="text-center">Действия</div>
            </OperationListHead>
            {days
              ? days.map((day) => (
                  <div key={day.key}>
                    <DayHeader
                      ymd={day.ymd}
                      txs={day.txs}
                      base={base}
                      showTransfers={!filters.excludeTransfers}
                    />
                    {day.txs.map(renderRow)}
                  </div>
                ))
              : visible.map(renderRow)}
          </div>
        )}

        {lazy.hasMore && (
          <LazyListFooter shown={lazy.shown} total={lazy.total} sentinelRef={lazy.attachSentinel} />
        )}
      </OperationListTray>

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          totals={selectedTotals}
          base={base}
          onClear={() => setSelected(new Set())}
        >
          <button onClick={() => setBulkOpen(true)} className="btn-primary text-sm">
            <Pencil className="w-4 h-4" />
            Задать категорию
          </button>
          {selectedSuggestions.length > 0 && (
            <button
              onClick={() => void applySuggestions(selectedSuggestions)}
              disabled={busy}
              className="btn-ghost text-sm"
              title="Создаст правило по контрагенту (или комментарию) и разметит похожие операции"
            >
              <Wand2 className="w-4 h-4" />
              Применить подсказки
              <span className="tabular-nums text-muted">({selectedSuggestions.length})</span>
            </button>
          )}
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
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ScrollTopButton />
    </div>
  );
}

/** Строка ленты: операция и подсказка к ней. */
function Row({
  tx,
  suggestion,
  applied,
  busy,
  selected,
  onToggleSelect,
  onOpen,
  onApply,
}: {
  tx: Transaction;
  suggestion?: CategorySuggestion;
  applied: boolean;
  busy: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onApply: (s: CategorySuggestion) => void;
}) {
  const key = suggestion ? suggestionKey(suggestion) : null;
  return (
    <OperationListRow
      template={TEMPLATE}
      selected={selected}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
    >
      <Checkbox checked={selected} stopPropagation onChange={onToggleSelect} label="Выбрать операцию" />
      <div className="text-muted tabular-nums whitespace-nowrap">{formatDate(tx.date, "full")}</div>
      <div className="truncate text-muted" title={tx.account}>
        {tx.account}
      </div>
      <OperationPayee tx={tx} />
      <div className="text-muted truncate" title={tx.comment || ""}>
        {tx.comment || ""}
      </div>
      <SuggestionCell suggestion={suggestion} applied={applied} />
      <div
        className={`text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
      >
        <OperationAmount tx={tx} />
      </div>
      <div className="flex items-center justify-center gap-0.5">
        {suggestion && !applied && key && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onApply(suggestion);
            }}
            disabled={busy}
            className="btn-icon"
            title={`Применить подсказку «${suggestion.suggested}» — правилом по ${
              key.field === "payee" ? "контрагенту" : "комментарию"
            }`}
            aria-label="Применить подсказку"
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="btn-icon"
          title="Открыть операцию и задать категорию"
          aria-label="Открыть операцию"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>
    </OperationListRow>
  );
}

/**
 * Подсказка в строке: категория и насколько ей можно верить.
 *
 * Уверенность — цветом, а не только числом: глазу нужно отличить «почти точно»
 * от «наугад», не читая процентов в каждой строке.
 */
function SuggestionCell({
  suggestion,
  applied,
}: {
  suggestion?: CategorySuggestion;
  applied: boolean;
}) {
  if (applied) {
    return (
      <div className="flex items-center gap-1.5 text-income truncate">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Размечено</span>
      </div>
    );
  }
  if (!suggestion) return <div className="text-muted">—</div>;
  const tone =
    suggestion.confidence >= CONFIDENT
      ? "text-income"
      : suggestion.confidence >= 0.4
        ? "text-warn"
        : "text-muted";
  return (
    <div
      className="flex items-center gap-1.5 min-w-0"
      title={suggestionReason(suggestion)}
    >
      <Sparkles className="w-3.5 h-3.5 shrink-0 text-accent2" />
      <span className="truncate">{suggestion.suggested}</span>
      <span className={`tabular-nums shrink-0 ${tone}`}>{formatPct(suggestion.confidence, 0)}</span>
    </div>
  );
}
