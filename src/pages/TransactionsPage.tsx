import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Download,
  Plus,
  Pencil,
  Trash2,
  Scale,
  ListChecks,
  List,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  Undo2,
  HandCoins,
  Calendar,
  Coins,
  ChevronDown,
  PiggyBank,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useZenmoneyStore, getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { BulkEditModal } from "../components/BulkEditModal";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { transferTotals } from "../lib/aggregations";
import { CategoryDot } from "../components/CategoryDot";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { Popover } from "../components/Popover";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { formatMoney, formatNum, displayPayee, secondaryPayee, crossCurrencyReceived } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindLabel, kindSignGlyph } from "../lib/txKindStyle";
import { pluralOps } from "../lib/plural";
import type { Transaction, TxKind } from "../types";

type SortMode = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

/** Sort options for the compact sort menu. `field` picks the button glyph
 *  (calendar vs coins), `dir` picks the arrow. */
const SORT_OPTIONS: {
  value: SortMode;
  label: string;
  field: "date" | "amount";
  dir: "asc" | "desc";
}[] = [
  { value: "date-desc", label: "Дата ↓", field: "date", dir: "desc" },
  { value: "date-asc", label: "Дата ↑", field: "date", dir: "asc" },
  { value: "amount-desc", label: "Сумма ↓", field: "amount", dir: "desc" },
  { value: "amount-asc", label: "Сумма ↑", field: "amount", dir: "asc" },
];

/** The four operation kinds offered by the «Добавить» dropdown, in the order
 *  the menu shows them. Colours mirror `kindColorClass`. */
const ADD_OPTIONS: {
  kind: TxKind;
  label: string;
  Icon: typeof ArrowUp;
  color: string;
  /** Open the editor in «Долг» mode (a debt op rides on kind=transfer). */
  debt?: boolean;
}[] = [
  { kind: "expense", label: "Расход", Icon: ArrowDown, color: "text-expense" },
  { kind: "income", label: "Доход", Icon: ArrowUp, color: "text-income" },
  { kind: "refund", label: "Возврат", Icon: Undo2, color: "text-accent2" },
  { kind: "transfer", label: "Перевод", Icon: ArrowLeftRight, color: "text-slate-400" },
  { kind: "transfer", label: "Долг", Icon: HandCoins, color: "text-warn", debt: true },
];

/**
 * For transfer transactions `payee` is blank. The "Счёт" column already
 * shows the source, so we only need to surface the target account in
 * the "Получатель" slot.
 */
function transferCounterparty(t: Transaction): string | null {
  if (t.kind !== "transfer") return null;
  const from = t.outcomeAccount?.trim();
  const to = t.incomeAccount?.trim();
  if (!to) return null;
  if (from && to === from) return null;
  return to;
}

/**
 * Column templates are defined as CSS grid-template-columns and applied to
 * every row + the header so widths can never drift between days/rows.
 * Комментарий — самый широкий столбец (2.5fr), все остальные tracks
 * фиксированы либо имеют minmax(0, Xfr), что разрешает `truncate` усекать
 * содержимое многоточием вместо растяжения колонки.
 *
 * Track order:
 *   FULL: date · category · payee · comment · account · amount · edit
 *   NODATE: (используется внутри group-by-day) то же самое без date
 */
// Leading 32px column = selection checkbox.
const GRID_COLS_FULL =
  "32px 84px minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 2.6fr) 140px 88px";
const GRID_COLS_NODATE =
  "32px minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 2.6fr) 140px 88px";

const PAGE_SIZE = 100;

/**
 * "Операции" — сквозная лента всех операций, попадающих под глобальные
 * фильтры. По умолчанию отсортированы по дате (новые сверху) и
 * сгруппированы по дням ("Сегодня", "Вчера", полная дата).
 */
export function TransactionsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const deletedCount = useDeletedStore((s) => s.deletedIds.length);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  async function handleDelete(tx: Transaction) {
    const pushMode = useZenmoneyStore.getState().pushMode;
    const ok = await confirm({
      title: "Удалить операцию?",
      message:
        pushMode !== "off"
          ? "Операция скроется из всех расчётов и списков. Так как включён Push, при следующей отправке она будет удалена и в облаке Дзен-мани. Вернуть можно на странице «Удалённые» — в т.ч. в облако."
          : "Операция скроется из всех расчётов и списков. Вернуть можно на странице «Удалённые». В облаке Дзен-мани она не тронется.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) await deleteTransaction(tx.id);
  }

  const edits = useEditsStore((s) => s.edits);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const hydrateEdits = useEditsStore((s) => s.hydrate);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const setEditEach = useEditsStore((s) => s.setEditEach);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  useEffect(() => {
    if (!editsLoaded) hydrateEdits();
  }, [editsLoaded, hydrateEdits]);

  // Adding operations needs the live Zenmoney cache (account/tag ids), so
  // it's offered only in API mode. `drafts` are locally-created rows not yet
  // pushed — flagged in the list with a "не синхронизировано" badge.
  const apiConnected = useZenmoneyStore((s) => !!s.token);
  const drafts = useDraftsStore((s) => s.drafts);

  const [pageSearch, setPageSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [creating, setCreating] = useState<TxKind | null>(null);
  const [creatingDebt, setCreatingDebt] = useState(false);

  // ── «Добавить» dropdown: pick which kind of operation to create. ─────
  // Anchored to addMenuRef; opening/closing (outside-click, Esc, scroll) is
  // handled by <Popover>.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const sortAnchorRef = useRef<HTMLDivElement>(null);

  // ── Scroll-to-top FAB: shown once the user has scrolled the window
  //    well past the first screen of the (often long) list. ─────────────
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  async function applyBulk(patch: TransactionEdit, commentAppend?: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (commentAppend) {
      // «Дополнить»: append to each row's *current* comment individually, in a
      // single atomic store write (build all patches, then one setEditEach).
      const byId = new Map(transactions.map((t) => [t.id, t]));
      const patches: Record<string, TransactionEdit> = {};
      for (const id of ids) {
        const cur = (byId.get(id)?.comment || "").trim();
        const merged = cur ? `${cur} ${commentAppend}` : commentAppend;
        patches[id] = { ...patch, comment: merged };
      }
      await setEditEach(patches);
    } else {
      await setEditMany(ids, patch);
    }
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

  const filtered = useMemo(
    () => applyFilters(transactions, filters, monthStartDay),
    [transactions, filters, monthStartDay]
  );

  const searched = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((t) =>
      `${t.payee} ${t.comment} ${t.categoryFull} ${t.account}`.toLowerCase().includes(q)
    );
  }, [filtered, pageSearch]);

  const sorted = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      switch (sortMode) {
        case "date-desc":
          return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
        case "date-asc":
          return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        case "amount-desc":
          return b.amountBase - a.amountBase;
        case "amount-asc":
          return a.amountBase - b.amountBase;
      }
    });
    return arr;
  }, [searched, sortMode]);

  // Titles of accounts marked «накопительный» in Zenmoney — needed for the
  // «Накопления» total (issue #42). Empty in CSV mode (no live accounts).
  //
  // ARCHIVED ones count too. Dropping them looks tidier (a closed account is
  // often seeded by its OPENING BALANCE and later emptied by a transfer, which
  // reads as a withdrawal with no matching deposit) — but it silently breaks
  // the issue's rule that a savings→savings transfer must net to zero: in real
  // data most such pairs are «архивный ↔ активный», so one leg would fall out
  // of the set and the transfer would count at full value. The metric is about
  // TRANSFERS, so opening balances are simply out of scope for it.
  const [savingsAccounts, setSavingsAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setSavingsAccounts(new Set(live.filter((a) => a.savings).map((a) => a.title)));
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of searched) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      // Refunds reduce the displayed expense total in the feed
      // footer — they're not earnings.
      else if (t.kind === "refund") exp -= t.amountBase;
    }
    const { xfer, savings } = transferTotals(searched, savingsAccounts);
    return { inc, exp, xfer, savings, net: inc - exp, count: searched.length };
  }, [searched, savingsAccounts]);

  // Lazy reveal: render PAGE_SIZE rows initially; an IntersectionObserver at
  // the bottom of the list increases this by another PAGE_SIZE whenever the
  // sentinel scrolls into view. Drops to defaults whenever the underlying
  // sorted array changes (search/filter/sort) — done during render via the
  // "adjusting state based on prior props" pattern (avoids a setState-in-effect).
  const [prevSorted, setPrevSorted] = useState(sorted);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (sorted !== prevSorted) {
    setPrevSorted(sorted);
    setVisibleCount(PAGE_SIZE);
    // Drop selection when the underlying set changes — selected ids
    // may no longer be visible / relevant.
    if (selected.size > 0) setSelected(new Set());
  }

  // Selection helpers computed over the full filtered+searched set (not
  // just the lazily-rendered slice), so "select all" covers everything
  // under the current filters.
  const allSelected = searched.length > 0 && selected.size === searched.length;
  const someSelected = selected.size > 0 && !allSelected;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(searched.map((t) => t.id)));
  }

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (visibleCount >= sorted.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((n) => Math.min(n + PAGE_SIZE, sorted.length));
          }
        }
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, sorted.length]);

  // Group by day only when sorted by date. Apply lazy slicing FIRST so groups
  // appear/grow incrementally as the user scrolls.
  const groupedByDay = useMemo(() => {
    if (sortMode !== "date-desc" && sortMode !== "date-asc") return null;
    const groups = new Map<string, Transaction[]>();
    for (const t of visible) {
      const ymd = t.date.slice(0, 10);
      let bucket = groups.get(ymd);
      if (!bucket) {
        bucket = [];
        groups.set(ymd, bucket);
      }
      bucket.push(t);
    }
    return Array.from(groups.entries());
  }, [visible, sortMode]);

  function exportCsv() {
    const header = ["Дата", "Тип", "Категория", "Получатель", "Комментарий", "Счёт", "Сумма", "Валюта"];
    const lines = [
      header.join(";"),
      ...sorted.map((t) =>
        [
          t.date,
          kindLabel(t.kind),
          `"${t.categoryFull.replace(/"/g, '""')}"`,
          `"${(t.payee || "").replace(/"/g, '""')}"`,
          `"${(t.comment || "").replace(/"/g, '""')}"`,
          `"${t.account.replace(/"/g, '""')}"`,
          t.amount,
          t.currency,
        ].join(";")
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dzenanalytics_операции.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (transactions.length === 0) return <EmptyState />;

  const showingTail = visibleCount < sorted.length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Операции"
        hint="Сквозная лента операций. Двойной клик — редактирование строки."
      />
      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat
          dense
          label="Доходы"
          value={formatMoney(totals.inc, base)}
          tone="income"
          icon={<ArrowUp className="w-4 h-4" />}
        />
        <Stat
          dense
          label="Расходы"
          value={formatMoney(totals.exp, base)}
          tone="expense"
          icon={<ArrowDown className="w-4 h-4" />}
        />
        <Stat
          dense
          label="Прибыль"
          value={formatMoney(totals.net, base, { signed: true })}
          tone={totals.net >= 0 ? "income" : "expense"}
          icon={<Scale className="w-4 h-4" />}
        />
        <Stat
          dense
          label="Переводы"
          value={formatMoney(totals.xfer, base)}
          icon={<ArrowLeftRight className="w-4 h-4" />}
          tooltip="Сумма переводов между своими счетами за период"
        />
        <Stat
          dense
          label="Накопления"
          value={formatMoney(totals.savings, base, { signed: true })}
          tone={totals.savings > 0 ? "income" : totals.savings < 0 ? "expense" : "default"}
          icon={<PiggyBank className="w-4 h-4" />}
          tooltip={
            savingsAccounts.size === 0
              ? "Нет счетов с признаком «накопительный»"
              : `Переводы НА накопительные счета минус переводы С них. Перевод между двумя накопительными даёт ноль. Учтено счетов: ${savingsAccounts.size} (включая архивные). Начальные остатки счетов не учитываются — только переводы.`
          }
        />
        <Stat
          dense
          label="Операций"
          value={formatNum(totals.count)}
          icon={<List className="w-4 h-4" />}
          hint={pageSearch ? `из ${filtered.length} в фильтре` : undefined}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div
            className="relative flex-1 min-w-[220px]"
            title="Быстрый поиск только по этой таблице (получатель, комментарий, категория, счёт) — не сохраняется и не влияет на другие страницы"
          >
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="Быстрый поиск по таблице…"
              className="input pl-9 text-xs py-1.5 h-[30px]"
            />
          </div>
          {/* Compact sort — icon button (field glyph + direction) opening a
              small menu with the four named options. */}
          {apiConnected && (
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setAddMenuOpen((o) => !o)}
                className="btn-primary text-xs py-1.5 h-[30px] whitespace-nowrap"
                title="Добавить новую операцию"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
              >
                <Plus className="w-3.5 h-3.5" />
                Добавить
              </button>
              <Popover
                open={addMenuOpen}
                anchorRef={addMenuRef}
                onClose={() => setAddMenuOpen(false)}
                align="left"
                matchWidth
                className="rounded-lg border border-border bg-panel shadow-xl py-1"
              >
                {ADD_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.label}
                    role="menuitem"
                    onClick={() => {
                      setCreating(opt.kind);
                      setCreatingDebt(!!opt.debt);
                      setAddMenuOpen(false);
                    }}
                    className="animate-menu-item flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-left hover:bg-panel2"
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <opt.Icon className={`w-4 h-4 ${opt.color}`} />
                    {opt.label}
                  </button>
                ))}
              </Popover>
            </div>
          )}
          <div ref={sortAnchorRef} className="relative shrink-0">
            {(() => {
              const active = SORT_OPTIONS.find((o) => o.value === sortMode)!;
              const FieldIcon = active.field === "date" ? Calendar : Coins;
              const DirIcon = active.dir === "desc" ? ArrowDown : ArrowUp;
              return (
                <button
                  onClick={() => setSortOpen((o) => !o)}
                  className="btn-ghost text-xs py-1.5 h-[30px] !px-2"
                  title={`Сортировка: ${active.label}`}
                  aria-haspopup="menu"
                  aria-expanded={sortOpen}
                >
                  <FieldIcon className="w-3.5 h-3.5" />
                  <DirIcon className="w-3 h-3" />
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
              );
            })()}
            <Popover
              open={sortOpen}
              anchorRef={sortAnchorRef}
              onClose={() => setSortOpen(false)}
              align="left"
              className="w-28 card p-2"
            >
              {SORT_OPTIONS.map((o) => {
                const FieldIcon = o.field === "date" ? Calendar : Coins;
                return (
                  <button
                    key={o.value}
                    onClick={() => {
                      setSortMode(o.value);
                      setSortOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-panel2 ${
                      sortMode === o.value
                        ? "bg-panel2 text-accent2 font-medium"
                        : ""
                    }`}
                  >
                    <FieldIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                  </button>
                );
              })}
            </Popover>
          </div>
          <button onClick={exportCsv} className="btn-ghost text-xs py-1.5 h-[30px] whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <Link
            to="/trash"
            className="relative btn-ghost text-xs py-1.5 h-[30px] !px-2"
            title="Удалённые (корзина)"
            aria-label={
              deletedCount > 0
                ? `Удалённые операции: ${deletedCount}`
                : "Удалённые операции"
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deletedCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-expense text-white text-[10px] leading-4 text-center tabular-nums">
                {deletedCount}
              </span>
            )}
          </Link>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-muted text-sm py-16">
            По текущим фильтрам ничего не найдено
          </div>
        ) : groupedByDay ? (
          <div>
            <HeaderRow
              grouped
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleAll={toggleSelectAll}
            />
            {groupedByDay.map(([ymd, txs]) => (
              <DayGroup
                key={ymd}
                ymd={ymd}
                txs={txs}
                base={base}
                showTransfers={!filters.excludeTransfers}
                edits={edits}
                drafts={drafts}
                onEdit={setEditing}
                onDelete={handleDelete}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        ) : (
          <div>
            <HeaderRow
              grouped={false}
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleAll={toggleSelectAll}
            />
            {visible.map((t) => (
              <Row
                key={t.id}
                tx={t}
                edited={!!edits[t.id]}
                draft={!!drafts[t.id]}
                onEdit={() => setEditing(t)}
                onDelete={() => handleDelete(t)}
                selected={selected.has(t.id)}
                onToggleSelect={() => toggleSelect(t.id)}
              />
            ))}
          </div>
        )}

        {/* Lazy-load sentinel — shown only while more rows remain to load.
            The total count lives in the «Операций» widget above, so no
            trailing "Всего N" row is rendered once everything is loaded. */}
        {showingTail && (
          <div
            ref={sentinelRef}
            className="px-4 py-3 text-center text-xs text-muted border-t border-border"
          >
            Показано {visibleCount} из {sorted.length} — прокрутите дальше, чтобы загрузить ещё
          </div>
        )}
      </div>

      {editing && (
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
          onNavigate={(dir) => {
            const i = sorted.findIndex((t) => t.id === editing.id);
            const next = sorted[i + dir];
            if (next) setEditing(next);
          }}
        />
      )}

      {creating && (
        <EditTransactionModal
          initialKind={creating}
          initialDebt={creatingDebt}
          onClose={() => {
            setCreating(null);
            setCreatingDebt(false);
          }}
        />
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

      {/* Floating scroll-to-top button — appears once scrolled far down. */}
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full border border-border bg-panel shadow-xl flex items-center justify-center text-muted hover:text-accent transition-colors"
          title="Наверх"
          aria-label="Вернуться к началу списка"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

/** Колоночные заголовки. Сетка та же, что и у строк. */
function HeaderRow({
  grouped,
  allSelected,
  someSelected,
  onToggleAll,
}: {
  grouped: boolean;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}) {
  const template = grouped ? GRID_COLS_NODATE : GRID_COLS_FULL;
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 border-b border-border bg-panel text-[length:calc(var(--tbl-font)-0.125rem)] uppercase tracking-wider text-muted font-medium sticky top-0 z-20"
      style={{ gridTemplateColumns: template }}
    >
      <input
        type="checkbox"
        className="accent-accent w-4 h-4"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected;
        }}
        onChange={onToggleAll}
        title="Выбрать всё (под фильтрами)"
        aria-label="Выбрать все операции"
      />
      {!grouped && <div>Дата</div>}
      <div>Категория</div>
      <div>Счёт</div>
      <div>Контрагент</div>
      <div>Комментарий</div>
      <div className="text-right">Сумма</div>
      <div className="text-right">Операции</div>
    </div>
  );
}

function DayGroup({
  ymd,
  txs,
  base,
  showTransfers,
  edits,
  drafts,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
}: {
  ymd: string;
  txs: Transaction[];
  base: string;
  showTransfers: boolean;
  edits: Record<string, unknown>;
  drafts: Record<string, unknown>;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { label, weekday } = useMemo(() => formatDayHeader(ymd), [ymd]);
  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    let xfer = 0;
    for (const t of txs) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      // Refund subtracts from the day header's expense total.
      else if (t.kind === "refund") exp -= t.amountBase;
      else if (t.kind === "transfer") xfer += t.amountBase;
    }
    return { inc, exp, xfer, net: inc - exp };
  }, [txs]);

  return (
    <div>
      <div className="px-4 py-2 border-b border-t border-border bg-panel2/60 flex items-center gap-3 text-sm">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-semibold truncate">{label}</span>
          {weekday && <span className="text-[13px] text-muted capitalize">{weekday}</span>}
        </div>
        <div className="ml-auto flex items-center gap-3 sm:gap-4 text-sm tabular-nums">
          <span
            className="flex items-center gap-1 text-muted whitespace-nowrap"
            title={`${txs.length} ${pluralOps(txs.length)}`}
          >
            <List className="w-4 h-4" aria-hidden />
            {txs.length}
          </span>
          {showTransfers && totals.xfer > 0 && (
            <span
              className="flex items-center gap-1 text-slate-400 whitespace-nowrap"
              title="Переводы за день"
            >
              <ArrowLeftRight className="w-4 h-4" aria-hidden />
              {formatMoney(totals.xfer, base)}
            </span>
          )}
          {totals.inc > 0 && (
            <span
              className="flex items-center gap-1 text-income whitespace-nowrap"
              title="Поступления за день"
            >
              <ArrowUp className="w-4 h-4" aria-hidden />
              {formatMoney(totals.inc, base)}
            </span>
          )}
          {totals.exp > 0 && (
            <span
              className="flex items-center gap-1 text-expense whitespace-nowrap"
              title="Траты за день"
            >
              <ArrowDown className="w-4 h-4" aria-hidden />
              {formatMoney(totals.exp, base)}
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-md font-medium tabular-nums whitespace-nowrap ${totals.net >= 0 ? "bg-income/15 text-income" : "bg-expense/15 text-expense"}`}
            title="Итог за день"
          >
            {formatMoney(totals.net, base, { signed: true })}
          </span>
        </div>
      </div>
      {txs.map((t) => (
        <Row
          key={t.id}
          tx={t}
          edited={!!edits[t.id]}
          draft={!!drafts[t.id]}
          onEdit={() => onEdit(t)}
          onDelete={() => onDelete(t)}
          selected={selected.has(t.id)}
          onToggleSelect={() => onToggleSelect(t.id)}
          hideDate
        />
      ))}
    </div>
  );
}

function Row({
  tx,
  edited,
  draft = false,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
  hideDate = false,
}: {
  tx: Transaction;
  edited: boolean;
  draft?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  hideDate?: boolean;
}) {
  const template = hideDate ? GRID_COLS_NODATE : GRID_COLS_FULL;
  // Debt rides on kind=transfer, but gets its own accent (amber) instead of
  // the transfer grey — so the feed matches the editor's «Долг» colour.
  const amountColor =
    tx.category === "Долг" ? "text-warn" : kindColorClass(tx.kind);
  const amountSign = kindSignGlyph(tx.kind);
  const amountSignClass = kindGlyphClass(tx.kind);

  return (
    <div
      onDoubleClick={onEdit}
      className={`grid items-center gap-3 px-3 py-2 border-b border-border/40 cursor-pointer group text-[length:var(--tbl-font)] ${
        selected ? "bg-accent/5" : "hover:bg-panel2/40"
      }`}
      style={{ gridTemplateColumns: template }}
    >
      <input
        type="checkbox"
        className="accent-accent w-4 h-4"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
        aria-label="Выбрать операцию"
      />
      {!hideDate && (
        <div className="text-muted tabular-nums whitespace-nowrap">
          {tx.date.slice(8, 10)}.{tx.date.slice(5, 7)}.{tx.date.slice(0, 4)}
        </div>
      )}
      <div className="flex items-center gap-2 min-w-0" title={tx.categoryFull}>
        <span className="relative inline-flex shrink-0">
          {/* Sub-category operations show the SUB-tag's own icon (resolved by the
              «Parent / Sub» path), not the parent's. */}
          <CategoryDot
            category={tx.subcategory || tx.category}
            parent={tx.subcategory ? tx.category : undefined}
            size="w-7 h-7"
          />
          {draft && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-expense border-2 border-panel"
              aria-label="Новая операция — не синхронизирована"
            />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{tx.category}</span>
            {edited && !draft && (
              <Pencil
                className="w-3 h-3 text-accent2 shrink-0"
                aria-label="Отредактировано"
              />
            )}
          </div>
          {tx.subcategory && (
            <div className="text-[0.85em] text-muted truncate" title={tx.subcategory}>
              {tx.subcategory}
            </div>
          )}
        </div>
      </div>
      <div className="truncate text-muted" title={tx.account}>
        {tx.account}
      </div>
      {/* Show brand (Zenmoney's curated name) as the primary payee
          line. Raw bank-statement text (`tx.payee`) goes underneath
          in muted small if it differs — keeps the "WB-MOSCOW-12345"
          info visible without dominating. Tooltip shows both. */}
      <div className="min-w-0">
        {(() => {
          const primary = displayPayee(tx) || transferCounterparty(tx) || "";
          const secondary = secondaryPayee(tx);
          const tooltip = secondary ? `${primary} — ${secondary}` : primary;
          return (
            <>
              <div className="truncate text-muted" title={tooltip}>
                {primary || "—"}
              </div>
              {secondary && (
                <div className="truncate text-[0.85em] text-text" title={secondary}>
                  {secondary}
                </div>
              )}
            </>
          );
        })()}
      </div>
      <div className="text-muted truncate" title={tx.comment || ""}>
        {tx.comment || ""}
      </div>
      <div
        className={`text-right tabular-nums font-medium whitespace-nowrap ${amountColor}`}
      >
        {tx.category === "Долг" ? (
          <HandCoins className="inline-block w-3.5 h-3.5 align-[-2px] mr-0.5" aria-hidden />
        ) : tx.kind === "transfer" ? (
          <ArrowLeftRight className="inline-block w-3.5 h-3.5 align-[-2px] mr-0.5" aria-hidden />
        ) : (
          <span className={amountSignClass}>{amountSign}</span>
        )}
        {formatMoney(tx.amount, tx.currency)}
        {(() => {
          const received = crossCurrencyReceived(tx);
          return received ? (
            <div className="text-[0.85em] font-normal text-muted/80">
              ({received})
            </div>
          ) : null;
        })()}
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="p-1 text-muted/50 hover:text-text transition-colors"
          title="Редактировать"
          aria-label="Редактировать операцию"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 text-muted/50 hover:text-expense transition-colors"
          title="Удалить"
          aria-label="Удалить операцию"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatDayHeader(ymd: string): { label: string; weekday: string } {
  const d = new Date(ymd);
  if (Number.isNaN(d.getTime())) return { label: ymd, weekday: "" };

  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yYmd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const day = d.getDate();
  const month = MONTHS_GEN[d.getMonth()];
  const year = d.getFullYear();
  const weekday = WEEKDAYS[d.getDay()];
  const dateLabel = `${day} ${month}${year === today.getFullYear() ? "" : ` ${year}`}`;

  if (ymd === todayYmd) return { label: `Сегодня, ${dateLabel}`, weekday };
  if (ymd === yYmd) return { label: `Вчера, ${dateLabel}`, weekday };
  return { label: dateLabel, weekday };
}
