import { useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  Download,
  Sparkles,
  Tag,
  User,
  Copy,
  ListChecks,
  Pencil,
  Trash2,
  XSquare,
} from "lucide-react";
import { useDrillStore } from "../store/useDrillStore";
import { useDataStore } from "../store/useDataStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { CategoryDot } from "./CategoryDot";
import { Tooltip } from "./Tooltip";
import { EditTransactionModal } from "./EditTransactionModal";
import { Stat } from "./Stat";
import { BulkEditModal } from "./BulkEditModal";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { formatMoney, formatDate, formatNum, displayPayee, secondaryPayee, crossCurrencyReceived, payeeSearchText } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindLabel, kindSignGlyph } from "../lib/txKindStyle";
import type { Transaction } from "../types";

type SortKey = "date" | "amount" | "category" | "payee";
type SortDir = "asc" | "desc";

/**
 * For transfer transactions Zenmoney leaves `payee` blank. The "Счёт"
 * column already shows the source account, so we only need to surface
 * the *target* account here as the counterparty.
 *
 * Returns null for non-transfers or when the target is missing / equal
 * to the source (a degenerate self-transfer).
 */
function transferCounterparty(t: Transaction): string | null {
  if (t.kind !== "transfer") return null;
  const from = t.outcomeAccount?.trim();
  const to = t.incomeAccount?.trim();
  if (!to) return null;
  if (from && to === from) return null;
  return to;
}


export function TransactionsDrawer() {
  const { open, title, subtitle, transactions, close, show } = useDrillStore();
  const base = useDataStore((s) => s.rates.base);
  const statementLine = useDisplayStore((s) => s.statementLine);
  const allTransactions = useDataStore((s) => s.transactions);
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const deleteTransactionMany = useDataStore((s) => s.deleteTransactionMany);
  const setEditMany = useEditsStore((s) => s.setEditMany);

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

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Копия операции (issue #78) — та же кнопка, что и в ленте: список операций
  // здесь тот же самый, только показан сбоку.
  const [copying, setCopying] = useState<Transaction | null>(null);
  const apiConnected = useZenmoneyStore((s) => !!s.token);

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

  const edits = useEditsStore((s) => s.edits);
  const drafts = useDraftsStore((s) => s.drafts);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const hydrateEdits = useEditsStore((s) => s.hydrate);
  useEffect(() => {
    if (!editsLoaded) hydrateEdits();
  }, [editsLoaded, hydrateEdits]);

  // Escape отрабатывает по одной ступени за нажатие: сперва снимает выделение,
  // и только следующим нажатием закрывает сам список. Закрывать всё разом
  // нельзя — человек выделил десяток строк, промахнулся мимо кнопки и одним
  // Escape потерял бы и выделение, и список.
  //
  // Пока сверху открыто окно правки или массовой правки, обработчик вообще не
  // ставим: Escape всегда принадлежит самому верхнему окну, а их обработчики
  // висят на том же `window`, где `stopPropagation` соседей не глушит.
  //
  // Живёт это отдельным эффектом от блокировки прокрутки ниже: у него свои
  // поводы перезапускаться (выделение меняется на каждый клик), а перезапускать
  // из-за них блокировку прокрутки незачем.
  const escOnTop = Boolean(editing) || Boolean(copying) || bulkOpen;
  useEffect(() => {
    if (!open || escOnTop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected.size > 0) {
        setSelected(new Set());
        return;
      }
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, escOnTop, selected, close]);

  useEffect(() => {
    if (!open) return;
    // The page scrolls on <html> (it has `overflow-y: scroll`), so locking
    // only <body> left the html scrollbar visible beside the drawer — it
    // moved the hidden page behind the overlay and looked broken. Lock the
    // real scroller and reserve its scrollbar width so the background doesn't
    // shift when the drawer opens/closes.
    const html = document.documentElement;
    const scrollbarW = window.innerWidth - html.clientWidth;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlPad: html.style.paddingRight,
      bodyOverflow: document.body.style.overflow,
    };
    html.style.overflow = "hidden";
    if (scrollbarW > 0) html.style.paddingRight = `${scrollbarW}px`;
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.paddingRight = prev.htmlPad;
      document.body.style.overflow = prev.bodyOverflow;
    };
  }, [open]);

  // Reset search every time the drawer re-opens — implemented via the
  // "adjust state on prior props" pattern (no setState-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSearch("");
      if (selected.size > 0) setSelected(new Set());
    }
  }

  // The "Похожие" shortcuts re-drill in place (new `transactions` snapshot
  // without closing the drawer). Drop a stale selection when that happens.
  const [prevTx, setPrevTx] = useState(transactions);
  if (transactions !== prevTx) {
    setPrevTx(transactions);
    if (selected.size > 0) setSelected(new Set());
  }

  // Drill store keeps a snapshot of transactions taken at the moment the drawer
  // was opened. After an inline edit the canonical `useDataStore.transactions`
  // is the source of truth, so we re-derive a fresh list by id-lookup.
  const liveTransactions = useMemo(() => {
    const byId = new Map(allTransactions.map((t) => [t.id, t]));
    return transactions.map((t) => byId.get(t.id) || t);
  }, [transactions, allTransactions]);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? liveTransactions.filter((t) =>
          `${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${t.account}`
            .toLowerCase()
            .includes(q)
        )
      : liveTransactions;
    const cmp = (a: Transaction, b: Transaction) => {
      let r = 0;
      if (sortKey === "date") r = a.date.localeCompare(b.date);
      else if (sortKey === "amount") r = a.amountBase - b.amountBase;
      else if (sortKey === "category") r = a.categoryFull.localeCompare(b.categoryFull, "ru");
      else if (sortKey === "payee") r = (a.payee || "").localeCompare(b.payee || "", "ru");
      return sortDir === "asc" ? r : -r;
    };
    return [...filtered].sort(cmp);
  }, [liveTransactions, search, sortKey, sortDir]);

  // Select-all reflects the currently visible (searched + sorted) set, so it
  // stays correct across sorting and search without clearing the selection.
  const allSelected = sorted.length > 0 && sorted.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(sorted.map((t) => t.id)));
  }

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of sorted) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      // Refunds net out of the drawer's expense total — so when the
      // user drills into «category X» and sees both a purchase and
      // its refund, the footer says net spend, not double-counted.
      else if (t.kind === "refund") exp -= t.amountBase;
    }
    return { inc, exp, net: inc - exp };
  }, [sorted]);

  // Sums of the currently-selected rows, split by kind — shown in the bulk bar.
  const selectedTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    let xfer = 0;
    for (const t of sorted) {
      if (!selected.has(t.id)) continue;
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      else if (t.kind === "refund") exp -= t.amountBase;
      else if (t.kind === "transfer") xfer += t.amountBase;
    }
    return { inc, exp, xfer };
  }, [sorted, selected]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" || key === "amount" ? "desc" : "asc");
    }
  }

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
    a.download = `dzenanalytics_${title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <>
    {/* Не полотно во весь экран, а большая карточка над затемнением.
        Разница не в красоте: это не страница, а взгляд вглубь — открыли с
        виджета, посмотрели операции за числом и вернулись. Полноэкранное
        полотно прятало, откуда пришли, и возвращение ощущалось переходом
        куда-то, а не закрытием. Затемнение сохраняет контекст, а карточка
        наконец говорит на том же языке, что и остальной продукт: скругление,
        кант, мягкая тень. */}
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade"
        onClick={close}
        aria-hidden
      />
      <aside className="relative w-[96vw] max-w-[1800px] h-[94vh] card overflow-hidden flex flex-col animate-fade">
      <div className="px-5 md:px-6 py-4 border-b border-border flex items-center justify-between gap-4 bg-panel">
        <div className="min-w-0 flex items-center gap-3">
          {/* Значок в плашке — как в заголовке страницы: один приём на весь
              продукт. */}
          <span className="shrink-0 w-9 h-9 rounded-xl bg-panel2 border border-border grid place-items-center">
            <ListChecks className="w-[18px] h-[18px] text-accent" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] uppercase tracking-[0.14em] text-muted font-medium">
              {subtitle || "Операции"}
            </div>
            <div className="text-[19px] font-semibold tracking-tight truncate" title={title}>
              {title}
            </div>
          </div>
        </div>
        <Tooltip content="Закрыть (Esc)">
          <button
            onClick={close}
            className="btn-ghost text-sm shrink-0"
            aria-label="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
            <span>Закрыть</span>
            <kbd className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-panel2 border border-border font-mono">
              Esc
            </kbd>
          </button>
        </Tooltip>
      </div>

        {transactions.length === 1 && (
          <div className="px-5 py-2 border-b border-border flex items-center gap-2 flex-wrap text-xs bg-accent/5">
            <span className="flex items-center gap-1 text-muted">
              <Sparkles className="w-3 h-3 text-accent" />
              Похожие:
            </span>
            <button
              onClick={() => {
                const t = transactions[0];
                const sim = allTransactions.filter(
                  (x) => x.kind === t.kind && x.categoryFull === t.categoryFull
                );
                show(`Категория: ${t.categoryFull}`, sim, "Похожие операции");
              }}
              className="btn-ghost !py-1 !px-2 text-xs"
            >
              <Tag className="w-3 h-3" />
              По категории «{transactions[0].categoryFull}»
            </button>
            {transactions[0].payee && (
              <button
                onClick={() => {
                  const t = transactions[0];
                  const sim = allTransactions.filter(
                    (x) => x.kind === t.kind && x.payee === t.payee
                  );
                  show(`Получатель: ${t.payee}`, sim, "Похожие операции");
                }}
                className="btn-ghost !py-1 !px-2 text-xs"
              >
                <User className="w-3 h-3" />
                По получателю «{transactions[0].payee}»
              </button>
            )}
          </div>
        )}

        {/* Те же плитки, что на страницах: три числа тут стояли голым текстом
            на плоской полосе — единственное место в продукте, где показатели
            выглядели так. */}
        <div className="px-5 md:px-6 py-3 border-b border-border grid grid-cols-3 gap-3">
          <Stat dense label="Доходы" tone="income" value={formatMoney(totals.inc, base)} />
          <Stat dense label="Расходы" tone="expense" value={formatMoney(totals.exp, base)} />
          <Stat
            dense
            label="Чистый"
            tone={totals.net >= 0 ? "income" : "expense"}
            value={formatMoney(totals.net, base, { signed: true })}
          />
        </div>

        <div className="px-5 md:px-6 py-3 border-b border-border flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по получателю/комментарию/категории/счёту"
              className="input pl-9 text-sm"
            />
          </div>
          <button onClick={exportCsv} className="btn-ghost text-xs whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <div className="text-xs text-muted whitespace-nowrap">
            {sorted.length} из {transactions.length}
          </div>
        </div>

        {/* Таблица лежит в поддоне — так же, как на «Операциях» и в «Отчёте».
            Здесь она была голой: заголовки и строки прямо на подложке окна, без
            канта, хотя это ровно такая же таблица операций. */}
        <div className="flex-1 min-h-0 px-5 md:px-6 pt-3 pb-5">
        <div className="card-tray h-full overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="text-center text-muted text-sm py-12">
              {transactions.length === 0
                ? "Нет операций"
                : "По запросу ничего не найдено"}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel z-10">
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
                      title="Выбрать всё (под текущим поиском)"
                      aria-label="Выбрать все операции"
                    />
                  </th>
                  <SortHead label="Дата" k="date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="Категория" k="category" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="table-th">Счёт</th>
                  <SortHead label="Контрагент" k="payee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="table-th">Комментарий</th>
                  <SortHead label="Сумма" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <th className="table-th text-center whitespace-nowrap">Действия</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const isEdited = !!edits[t.id];
                  const isDraft = !!drafts[t.id];
                  const isSel = selected.has(t.id);
                  return (
                  <tr
                    key={t.id}
                    onDoubleClick={() => setEditing(t)}
                    className={`align-middle group cursor-pointer ${
                      isSel ? "bg-accent/5" : "hover:bg-panel2/40"
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
                    <td className="table-td max-w-[180px]">
                      <div className="flex items-center gap-2 min-w-0" title={t.categoryFull}>
                        <span className="relative inline-flex shrink-0">
                          {/* Sub-category operations show the SUB-tag's own icon
                              (resolved by «Parent / Sub»), not the parent's. */}
                          <CategoryDot
                            category={t.subcategory || t.category}
                            parent={t.subcategory ? t.category : undefined}
                            size="w-7 h-7"
                          />
                          {isDraft && (
                            <span
                              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-expense border-2 border-panel"
                              aria-label="Новая операция — не синхронизирована"
                            />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{t.category}</span>
                            {isEdited && !isDraft && (
                              <Pencil
                                className="w-3 h-3 text-accent2 shrink-0"
                                aria-label="Отредактировано"
                              />
                            )}
                          </div>
                          {t.subcategory && (
                            <div className="text-[0.85em] text-muted truncate" title={t.subcategory}>
                              {t.subcategory}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="table-td max-w-[140px] truncate text-muted" title={t.account}>
                      {t.account}
                    </td>
                    {/* Brand (Zenmoney-curated) is the primary line;
                        raw payee text goes under it small-muted when
                        it differs. Tooltip shows the full pair. */}
                    <td className="table-td max-w-[180px]">
                      {(() => {
                        const primary = displayPayee(t) || transferCounterparty(t) || "";
                        const secondary = statementLine ? secondaryPayee(t, "statement") : null;
                        const tooltip = secondary ? `${primary} — ${secondary}` : primary;
                        return (
                          <div className="min-w-0">
                            <div className="truncate text-muted" title={tooltip}>
                              {primary || "—"}
                            </div>
                            {secondary && (
                              <div className="truncate text-[0.85em] text-text" title={secondary}>
                                {secondary}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="table-td max-w-[260px] text-muted">
                      <div className="truncate" title={t.comment}>
                        {t.comment || ""}
                      </div>
                    </td>
                    <td
                      className={`table-td text-right tabular-nums font-medium whitespace-nowrap ${kindColorClass(t.kind)}`}
                      title={t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined}
                    >
                      <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                      {formatMoney(t.amount, t.currency)}
                      {(() => {
                        const received = crossCurrencyReceived(t);
                        return received ? (
                          <div className="text-[0.85em] font-normal text-muted/80">
                            ({received})
                          </div>
                        ) : null;
                      })()}
                    </td>
                    <td className="table-td w-24 text-center whitespace-nowrap">
                      <button
                        onClick={() => setEditing(t)}
                        className="btn-icon"
                        title="Редактировать"
                        aria-label="Редактировать операцию"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {apiConnected && (
                        <button
                          onClick={() => setCopying(t)}
                          className="btn-icon"
                          title="Копировать — та же операция сегодняшним днём"
                          aria-label="Копировать операцию"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(t)}
                        className="btn-icon-danger"
                        title="Удалить"
                        aria-label="Удалить операцию"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
        </aside>
    </div>

      {/* Floating bulk-action bar — appears when ≥1 row is selected. Sits
          above the drawer (z-50) but below the edit modal (portaled, z-60). */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Массовые действия"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[55] rounded-xl border border-border bg-panel shadow-xl max-w-[calc(100vw-1.5rem)] overflow-hidden"
        >
          {/* Row 1: count + per-kind sums of the selection. */}
          <div className="flex items-center justify-center gap-x-4 gap-y-1 flex-wrap px-4 pt-2.5 pb-2 text-sm">
            <span>
              Выбрано: <strong className="tabular-nums">{formatNum(selected.size)}</strong>
            </span>
            {(selectedTotals.inc > 0 || selectedTotals.exp > 0 || selectedTotals.xfer > 0) && (
              <span className="flex items-center gap-3 tabular-nums border-l border-border pl-4">
                {selectedTotals.inc > 0 && (
                  <span className="flex items-center gap-1 text-income">
                    <ArrowUp className="w-3.5 h-3.5" />
                    {formatMoney(selectedTotals.inc, base)}
                  </span>
                )}
                {selectedTotals.exp > 0 && (
                  <span className="flex items-center gap-1 text-expense">
                    <ArrowDown className="w-3.5 h-3.5" />
                    {formatMoney(selectedTotals.exp, base)}
                  </span>
                )}
                {selectedTotals.xfer > 0 && (
                  <span className="flex items-center gap-1 text-muted">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    {formatMoney(selectedTotals.xfer, base)}
                  </span>
                )}
              </span>
            )}
          </div>
          {/* Row 2: actions. */}
          <div className="flex items-center justify-center gap-2 flex-wrap px-4 pb-2.5 pt-2 border-t border-border">
            <button onClick={() => setBulkOpen(true)} className="btn-primary text-sm">
              <Pencil className="w-4 h-4" />
              Изменить
            </button>
            <button onClick={deleteBulk} className="btn-danger text-sm">
              <Trash2 className="w-4 h-4" />
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
        </div>
      )}

      {bulkOpen && (
        <BulkEditModal
          count={selected.size}
          allTransactions={allTransactions}
          onApply={applyBulk}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {editing && (
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
          onCopy={
            apiConnected
              ? () => {
                  setEditing(null);
                  setCopying(editing);
                }
              : undefined
          }
          onNavigate={(dir) => {
            const i = sorted.findIndex((t) => t.id === editing.id);
            const next = sorted[i + dir];
            if (next) setEditing(next);
          }}
        />
      )}

      {copying && (
        <EditTransactionModal
          key={`copy-${copying.id}`}
          template={copying}
          onClose={() => setCopying(null)}
        />
      )}
    </>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`table-th ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-text transition-colors ${
          active ? "text-accent" : ""
        }`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "" : "opacity-30"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
