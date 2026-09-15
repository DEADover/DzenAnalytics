import { useEffect, useMemo, useState } from "react";
import {
  X,
  Download,
  Sparkles,
  Tag,
  User,
  ListChecks,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDrillStore } from "../store/useDrillStore";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { Tooltip } from "./Tooltip";
import { EditTransactionModal } from "./EditTransactionModal";
import { StatCell, StatRow } from "./SectionCard";
import { BulkEditModal } from "./BulkEditModal";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { formatMoney, formatDate, formatNum, displayPayee, payeeSearchText, transferCounterparty } from "../lib/format";
import { kindLabel, operationTone } from "../lib/txKindStyle";
import { DataTable, type Column, type SortState } from "./DataTable";
import { OperationActions, OperationAmount, OperationCategory, OperationPayee } from "./operations/OperationCells";
import { buildCsv, csvFileName, downloadCsv, sortRows } from "./table/tableKit";
import type { Transaction } from "../types";
import { SearchInput } from "./SearchInput";
import { SelectionBar } from "./SelectionBar";
import { kindTotals } from "../lib/aggregations";


export function TransactionsDrawer() {
  const { open, title, subtitle, transactions, close, show } = useDrillStore();
  const base = useDataStore((s) => s.rates.base);
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
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Копия операции (issue #78) — та же кнопка, что и в ленте: список операций
  // здесь тот же самый, только показан сбоку.
  const [copying, setCopying] = useState<Transaction | null>(null);
  const apiConnected = useZenmoneyStore((s) => !!s.token);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? liveTransactions.filter((t) =>
          `${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${(t.extraCategories ?? []).join(" ")} ${t.account}`
            .toLowerCase()
            .includes(q)
        )
      : liveTransactions;
  }, [liveTransactions, search]);

  const columns: Column<Transaction>[] = [
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
      width: "16rem",
      label: "Категория",
      sortValue: (t) => t.categoryFull,
      cellTitle: () => "",
      render: (t) => <OperationCategory tx={t} edited={!!edits[t.id]} draft={!!drafts[t.id]} />,
    },
    {
      key: "account",
      type: "text",
      muted: true,
      width: "11rem",
      label: "Счёт",
      sortValue: (t) => t.account,
      render: (t) => t.account,
    },
    {
      key: "payee",
      type: "text",
      width: "14rem",
      label: "Контрагент",
      sortValue: (t) => displayPayee(t) || transferCounterparty(t) || "",
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
      key: "amount",
      type: "main",
      tone: operationTone,
      width: "10rem",
      label: "Сумма",
      sortValue: (t) => t.amountBase,
      cellTitle: (t) => (t.kind === "refund" ? "Возврат — уменьшает расход категории" : ""),
      render: (t) => <OperationAmount tx={t} />,
    },
    {
      key: "actions",
      type: "actions",
      width: "8rem",
      label: "Действия",
      render: (t) => (
        <OperationActions
          onEdit={() => setEditing(t)}
          onCopy={apiConnected ? () => setCopying(t) : undefined}
          onDelete={() => handleDelete(t)}
        />
      ),
    },
  ];

  // Порядок строк — для выгрузки: CSV идёт в той же сортировке, что на экране.
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    return col?.sortValue ? sortRows(filtered, col.sortValue, sort.dir) : filtered;
    // Колонки пересобираются на каждый рендер, но порядок зависит только от ключа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of filtered) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
      // Refunds net out of the drawer's expense total — so when the
      // user drills into «category X» and sees both a purchase and
      // its refund, the footer says net spend, not double-counted.
      else if (t.kind === "refund") exp -= t.amountBase;
    }
    return { inc, exp, net: inc - exp };
  }, [filtered]);

  // Sums of the currently-selected rows, split by kind — shown in the bulk bar.
  const selectedTotals = useMemo(
    () => kindTotals(filtered.filter((t) => selected.has(t.id))),
    [filtered, selected]
  );

  function exportCsv() {
    const text = buildCsv(
      ["Дата", "Тип", "Категория", "Получатель", "Комментарий", "Счёт", "Сумма", "Валюта"],
      sorted.map((t) => [
        t.date,
        kindLabel(t.kind),
        t.categoryFull,
        t.payee || "",
        t.comment || "",
        t.account,
        t.amount,
        t.currency,
      ])
    );
    downloadCsv(csvFileName(title), text);
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
              className="btn-ghost text-xs"
            >
              <Tag className="w-3.5 h-3.5" />
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
                className="btn-ghost text-xs"
              >
                <User className="w-3.5 h-3.5" />
                По получателю «{transactions[0].payee}»
              </button>
            )}
          </div>
        )}

        {/* Тот же ряд итогов, что на страницах: три числа тут стояли голым
            текстом на плоской полосе — единственное место в продукте, где
            показатели выглядели так. */}
        <div className="px-5 md:px-6 py-3 border-b border-border">
          <StatRow>
            <StatCell label="Доходы" tone="income" value={formatMoney(totals.inc, base)} />
            <StatCell label="Расходы" tone="expense" value={formatMoney(totals.exp, base)} />
            <StatCell
              label="Чистый"
              tone={totals.net >= 0 ? "income" : "expense"}
              value={formatMoney(totals.net, base, { signed: true })}
            />
          </StatRow>
        </div>

        <div className="px-5 md:px-6 py-3 border-b border-border flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по получателю, комментарию, категории и счёту"
            className="flex-1"
          />
          <button onClick={exportCsv} className="btn-ghost text-xs whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <div className="text-xs text-muted whitespace-nowrap">
            {formatNum(filtered.length)} из {formatNum(transactions.length)}
          </div>
        </div>

        {/* Таблица лежит в поддоне — так же, как на «Операциях» и в «Отчёте».
            Здесь она была голой: заголовки и строки прямо на подложке окна, без
            канта, хотя это ровно такая же таблица операций. */}
        <div className="flex-1 min-h-0 px-5 md:px-6 pt-3 pb-5">
        <div className="card-tray h-full overflow-y-auto">
          <DataTable<Transaction>
            bare
            stickyHead
            fixed
            minWidth="64rem"
            data={filtered}
            columns={columns}
            rowKey={(t) => t.id}
            sort={sort}
            onSortChange={setSort}
            onRowDoubleClick={(t) => setEditing(t)}
            selection={{ selected, onChange: setSelected, label: "Выбрать все операции" }}
            exportable={false}
            emptyText={transactions.length === 0 ? "Нет операций" : "По запросу ничего не найдено"}
          />
        </div>
        </div>
        </aside>
    </div>

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          totals={selectedTotals}
          base={base}
          onClear={() => setSelected(new Set())}
          overDrawer
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

