import { useMemo, useState } from "react";
import { Checkbox } from "../components/Checkbox";
import { Select } from "../components/Select";
import { Search, Calendar, Coins, Tag, X, Pencil, Trash2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { kindGlyphClass, kindSignGlyph, kindTone } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatCell, StatRow } from "../components/SectionCard";
import { BulkEditModal } from "../components/BulkEditModal";
import { DataTable } from "../components/DataTable";
import { DateField } from "../components/DateField";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { kindTotals } from "../lib/aggregations";
import type { Transaction } from "../types";
import { SearchInput } from "../components/SearchInput";
import { SelectionBar } from "../components/SelectionBar";


/** Значения отбора по типу. «Возвраты» — выбор поуже, чем «Расходы»: те
 *  показывают траты вместе с возвратами. */
type KindFilter = "all" | "expense" | "income" | "refund";

export function SearchPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const showDrill = useDrillStore((s) => s.show);

  const [query, setQuery] = useState("");
  const [exclude, setExclude] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  // ── Bulk selection + edit ──────────────────────────────────────────
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

  const matches = useMemo(() => {
    if (transactions.length === 0) return [];

    let regex: RegExp | null = null;
    let excludeRegex: RegExp | null = null;
    if (useRegex) {
      try {
        if (query) regex = new RegExp(query, "iu");
      } catch {
        regex = null;
      }
      try {
        if (exclude) excludeRegex = new RegExp(exclude, "iu");
      } catch {
        excludeRegex = null;
      }
    }

    const q = query.trim().toLowerCase();
    const ex = exclude.trim().toLowerCase();
    const minA = Number(minAmount) || 0;
    const maxA = maxAmount ? Number(maxAmount) : Infinity;

    return transactions.filter((t) => {
      if (kind !== "all") {
        // «Расходы» — вместе с возвратами, как везде в сервисе. Иначе итог
        // ниже противоречил бы сам себе: он вычитает возврат из расхода, но
        // при выбранном типе возврат до него не доезжал, и «покупка плюс её
        // возврат» показывала полную трату вместо нуля.
        const ok = t.kind === kind || (t.kind === "refund" && kind === "expense");
        if (!ok) return false;
      }
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (t.amount < minA || t.amount > maxA) return false;

      const haystack = `${t.payee} ${t.comment} ${t.categoryFull} ${t.account}`.toLowerCase();

      if (q) {
        if (regex) {
          if (!regex.test(haystack)) return false;
        } else {
          const terms = q.split(/\s+/).filter(Boolean);
          if (!terms.every((term) => haystack.includes(term))) return false;
        }
      }

      if (ex) {
        if (excludeRegex) {
          if (excludeRegex.test(haystack)) return false;
        } else {
          const terms = ex.split(/\s+/).filter(Boolean);
          if (terms.some((term) => haystack.includes(term))) return false;
        }
      }

      return true;
    });
  }, [transactions, query, exclude, useRegex, from, to, minAmount, maxAmount, kind]);

  // Выбор сбрасывается, когда меняется набор найденного: иначе массовая правка
  // задела бы операции, которых на экране уже нет. Смена порядка его не трогает.
  const [prevMatches, setPrevMatches] = useState(matches);
  if (matches !== prevMatches) {
    setPrevMatches(matches);
    if (selected.size > 0) setSelected(new Set());
  }

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of matches) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      // Refund nets out of the expense total in the search summary —
      // a result set with «one purchase + its refund» should show
      // zero expense, not double-count.
      else if (t.kind === "refund") exp -= t.amountBase;
    }
    return { inc, exp, net: inc - exp };
  }, [matches]);

  // Суммы выделенного по видам — для панели выделения, как в ленте «Операций».
  const selectedTotals = useMemo(
    () => kindTotals(matches.filter((t) => selected.has(t.id))),
    [matches, selected]
  );

  function openOne(t: Transaction) {
    showDrill(t.payee || t.categoryFull, [t], "Операция");
  }

  function openAll() {
    const title = query ? `«${query}»` : "Все совпадения";
    showDrill(title, matches, "Поиск");
  }

  function reset() {
    setQuery("");
    setExclude("");
    setUseRegex(false);
    setFrom("");
    setTo("");
    setMinAmount("");
    setMaxAmount("");
    setKind("all");
  }

  if (transactions.length === 0) return <EmptyState />;

  const hasFilters =
    query || exclude || from || to || minAmount || maxAmount || kind !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Search}
        title="Поиск"
        hint="По получателю, комментарию, категории и счёту"
      />

      <div className="card card-pad space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">Содержит</label>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={useRegex ? "Например, ^яндекс" : "Слова через пробел"}
              ariaLabel="Содержит"
              autoFocus
            />
          </div>
          <div>
            <label className="label block mb-1.5">Исключить</label>
            <div className="relative">
              <X className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-expense" />
              <input
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                placeholder="Слова, которых не должно быть"
                className="input text-sm pl-9"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="label block mb-1.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />C
            </label>
            <DateField
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input text-xs"
            />
          </div>
          <div>
            <label className="label block mb-1.5">По</label>
            <DateField
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input text-xs"
            />
          </div>
          <div>
            <label className="label block mb-1.5 flex items-center gap-1">
              <Coins className="w-3 h-3" />
              От
            </label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
              className="input text-xs"
            />
          </div>
          <div>
            <label className="label block mb-1.5">До</label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="∞"
              className="input text-xs"
            />
          </div>
          <div>
            <label className="label block mb-1.5">Тип</label>
            <Select
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all" as const, label: "Все" },
                { value: "expense" as const, label: "Расходы" },
                { value: "income" as const, label: "Доходы" },
                { value: "refund" as const, label: "Возвраты" },
              ]}
              ariaLabel="Тип операции"
            />
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <Checkbox
              checked={useRegex}
              onChange={(on) => setUseRegex(on)}
              label="Регулярное выражение"
            />
            Регулярное выражение, без учёта регистра
          </label>
          {hasFilters && (
            <button onClick={reset} className="text-xs text-muted hover:text-accent underline">
              Сбросить всё
            </button>
          )}
        </div>
      </div>

      <StatRow>
        <StatCell
          label="Найдено"
          value={
            <>
              {formatNum(matches.length)}
              <span className="text-muted text-sm font-normal ml-2">
                из {formatNum(transactions.length)}
              </span>
            </>
          }
        />
        <StatCell label="Доходы" value={formatMoney(totals.inc, base)} tone="income" />
        <StatCell label="Расходы" value={formatMoney(totals.exp, base)} tone="expense" />
        <StatCell
          label="Чистый"
          value={formatMoney(totals.net, base, { signed: true })}
          tone={totals.net >= 0 ? "income" : "expense"}
        />
      </StatRow>

      {matches.length > 0 && (
        <DataTable<Transaction>
          icon={Search}
          title={`Результаты (${formatNum(matches.length)})`}
          actions={
            <button type="button" onClick={openAll} className="btn-ghost text-xs">
              <Tag className="w-3.5 h-3.5" />
              Открыть всё в шторке
            </button>
          }
          data={matches}
          rowKey={(t) => t.id}
          defaultSortKey="date"
          onRowClick={openOne}
          selection={{
            selected,
            onChange: setSelected,
            label: "Выбрать все найденные операции",
          }}
          limit={200}
          exportName="search"
          fixed
          columns={[
            {
              key: "date",
              type: "date",
              width: "8.5rem",
              label: "Дата",
              sortValue: (t) => t.date,
              render: (t) => formatDate(t.date, "full"),
            },
            {
              key: "category",
              type: "text",
              width: "13rem",
              label: "Категория",
              sortValue: (t) => t.categoryFull,
              render: (t) => t.categoryFull,
            },
            {
              key: "payee",
              type: "text",
              width: "13rem",
              label: "Получатель",
              sortValue: (t) => t.payee || "",
              render: (t) => t.payee || "—",
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
              width: "10rem",
              label: "Счёт",
              sortValue: (t) => t.account,
              render: (t) => t.account,
            },
            {
              key: "amount",
              type: "main",
              tone: (t) => kindTone(t.kind),
              width: "10rem",
              label: "Сумма",
              sortValue: (t) => t.amountBase,
              cellTitle: (t) =>
                t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined,
              render: (t) => (
                <>
                  <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                  {formatMoney(t.amount, t.currency)}
                </>
              ),
            },
          ]}
        />
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
    </div>
  );
}
