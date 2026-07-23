import { useMemo, useState } from "react";
import { Search, Calendar, Coins, Tag, X, ArrowUpDown, Pencil, Trash2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindSignGlyph } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { BulkEditModal } from "../components/BulkEditModal";
import { DateField } from "../components/DateField";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import type { Transaction } from "../types";

type SortKey = "date" | "amount" | "category" | "payee";

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
  const [kind, setKind] = useState<"all" | "expense" | "income">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDesc, setSortDesc] = useState(true);

  // ── Bulk selection + edit ──────────────────────────────────────────
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
      if (kind !== "all" && t.kind !== kind) return false;
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

  const sorted = useMemo(() => {
    const arr = [...matches];
    arr.sort((a, b) => {
      let r = 0;
      if (sortKey === "date") r = a.date.localeCompare(b.date);
      else if (sortKey === "amount") r = a.amountBase - b.amountBase;
      else if (sortKey === "category") r = a.categoryFull.localeCompare(b.categoryFull, "ru");
      else if (sortKey === "payee") r = (a.payee || "").localeCompare(b.payee || "", "ru");
      return sortDesc ? -r : r;
    });
    return arr;
  }, [matches, sortKey, sortDesc]);

  // Select-all covers the whole result set (not just the 200 shown rows), so
  // a mass edit can hit every match. Reset when the result set changes.
  const allSelected = sorted.length > 0 && sorted.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(sorted.map((t) => t.id)));
  }
  const [prevSorted, setPrevSorted] = useState(sorted);
  if (sorted !== prevSorted) {
    setPrevSorted(sorted);
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

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(k === "date" || k === "amount");
    }
  }

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
        hint="Полнотекст по получателю, комментарию, категории и счёту. Несколько слов = AND."
        hintWrap
      />

      <div className="card card-pad space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">Содержит</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={useRegex ? "regex (например, ^яндекс)" : "слова через пробел"}
                className="input pl-9"
                autoFocus
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="label block mb-1.5">Исключить</label>
            <div className="relative">
              <X className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-expense" />
              <input
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                placeholder="слова, которых не должно быть"
                className="input pl-9"
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
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "all" | "expense" | "income")}
              className="input text-xs"
            >
              <option value="all">Все</option>
              <option value="expense">Расходы</option>
              <option value="income">Доходы</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
              className="accent-accent"
            />
            Regex (регистронезависимо)
          </label>
          {hasFilters && (
            <button onClick={reset} className="text-xs text-muted hover:text-accent underline">
              Сбросить всё
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
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
        <Stat label="Доходы" value={formatMoney(totals.inc, base)} tone="income" />
        <Stat label="Расходы" value={formatMoney(totals.exp, base)} tone="expense" />
        <Stat
          label="Чистый"
          value={formatMoney(totals.net, base, { signed: true })}
          tone={totals.net >= 0 ? "income" : "expense"}
        />
      </div>

      {matches.length > 0 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Результаты ({sorted.length})</div>
            <button onClick={openAll} className="btn-ghost text-xs">
              <Tag className="w-3 h-3" />
              Открыть всё в drawer
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th w-8">
                    <input
                      type="checkbox"
                      className="accent-accent w-4 h-4 align-middle"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleSelectAll}
                      title="Выбрать все результаты"
                      aria-label="Выбрать все найденные операции"
                    />
                  </th>
                  <SortHead label="Дата" k="date" cur={sortKey} desc={sortDesc} on={toggleSort} />
                  <SortHead label="Категория" k="category" cur={sortKey} desc={sortDesc} on={toggleSort} />
                  <SortHead label="Получатель" k="payee" cur={sortKey} desc={sortDesc} on={toggleSort} />
                  <th className="table-th">Комментарий</th>
                  <th className="table-th">Счёт</th>
                  <SortHead label="Сумма" k="amount" cur={sortKey} desc={sortDesc} on={toggleSort} right />
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((t) => {
                  const isSel = selected.has(t.id);
                  return (
                  <tr
                    key={t.id}
                    onClick={() => openOne(t)}
                    className={`cursor-pointer align-middle ${
                      isSel ? "bg-accent/5" : "hover:bg-panel2/50"
                    }`}
                  >
                    <td className="table-td w-8">
                      <input
                        type="checkbox"
                        className="accent-accent w-4 h-4 align-middle"
                        checked={isSel}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(t.id)}
                        aria-label="Выбрать операцию"
                      />
                    </td>
                    <td className="table-td whitespace-nowrap text-muted">
                      {formatDate(t.date, "full")}
                    </td>
                    <td className="table-td truncate max-w-[160px]">{t.categoryFull}</td>
                    <td className="table-td truncate max-w-[160px]">{t.payee || "—"}</td>
                    <td className="table-td max-w-[260px] text-muted">
                      <div className="line-clamp-2" title={t.comment}>
                        {t.comment}
                      </div>
                    </td>
                    <td className="table-td truncate max-w-[120px] text-muted">
                      {t.account}
                    </td>
                    <td
                      className={`table-td text-right tabular-nums font-medium whitespace-nowrap ${kindColorClass(t.kind)}`}
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
            {sorted.length > 200 && (
              <div className="text-xs text-muted text-center mt-3">
                Показано 200 из {sorted.length}. Уточните запрос.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating bulk-action bar — appears when ≥1 result is selected. */}
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
    </div>
  );
}

function SortHead({
  label,
  k,
  cur,
  desc,
  on,
  right,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  desc: boolean;
  on: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = cur === k;
  return (
    <th className={`table-th ${right ? "text-right" : ""}`}>
      <button
        onClick={() => on(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-text ${active ? "text-accent" : ""}`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "" : "opacity-30"}`} />
        {active && <span className="text-[10px]">{desc ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
