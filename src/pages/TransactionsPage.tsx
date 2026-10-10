import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  Plus,
  Pencil,
  Trash2,
  Eye,
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
  PiggyBank,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useSearchParams } from "react-router-dom";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useZenmoneyStore, getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { confirm, useConfirmStore } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { Checkbox } from "../components/Checkbox";
import { OperationActions, OperationAmount, OperationCategory, OperationPayee, OperationComment } from "../components/operations/OperationCells";
import { TONE_CLASS } from "../components/table/tableKit";
import { SplitTransactionModal } from "../components/SplitTransactionModal";
import { MakeRecurringModal } from "../components/operations/MakeRecurringModal";
import { MergeSelectionAction } from "../components/operations/MergeSelectionAction";
import { PlannedBar, PlannedFeedList } from "../components/operations/PlannedFeedSection";
import { useSplitTransaction } from "../hooks/useSplitTransaction";
import { useColumnResize, type ResizeColumn } from "../hooks/useColumnResize";
import { BulkEditModal } from "../components/BulkEditModal";
import { confirmBulkDelete } from "../lib/confirmBulkDelete";
import { kindTotals, transferTotals } from "../lib/aggregations";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { Popover } from "../components/Popover";
import { PageHeader } from "../components/PageHeader";
import { StatCell, StatRow } from "../components/SectionCard";
import { formatMoney, formatNum, payeeSearchText } from "../lib/format";
import { kindLabel, operationTone } from "../lib/txKindStyle";
import type { Transaction, TxKind } from "../types";
import { SectionEmpty } from "../components/SectionEmpty";
import { SearchInput } from "../components/SearchInput";
import { SortMenu, type SortOption } from "../components/SortMenu";
import { SelectionBar } from "../components/SelectionBar";
import { DayHeader } from "../components/operations/DayHeader";
import {
  LazyListFooter,
  ListHeadCell,
  OperationListHead,
  OperationListRow,
  OperationListTray,
} from "../components/operations/OperationList";
import { queryMatcher } from "../lib/keyboardLayout";
import { TOUR_OP_EVENT } from "../lib/tour";

type SortMode = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

/** Sort options for the compact sort menu. `icon` is the button glyph
 *  (calendar vs coins), `dir` picks the arrow. */
const SORT_OPTIONS: SortOption<SortMode>[] = [
  { value: "date-desc", label: "Дата ↓", icon: Calendar, dir: "desc" },
  { value: "date-asc", label: "Дата ↑", icon: Calendar, dir: "asc" },
  { value: "amount-desc", label: "Сумма ↓", icon: Coins, dir: "desc" },
  { value: "amount-asc", label: "Сумма ↑", icon: Coins, dir: "asc" },
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
  { kind: "transfer", label: "Перевод", Icon: ArrowLeftRight, color: "text-muted" },
  { kind: "transfer", label: "Долг", Icon: HandCoins, color: "text-warn", debt: true },
];

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
// Leading 32px column = selection checkbox, следом 10px под точку «новая».
// Колонка есть у ВСЕХ строк, просто у просмотренных она пустая: так пометка
// ничего не сдвигает, а глазом читается вертикальной дорожкой — сразу видно,
// сколько нового и где оно кончается.
// Первая колонка — ровно под чекбокс (16 пикселей плюс по два по бокам). Была
// 32, и за ней стояла ещё одна, 10-пиксельная, под точку «новая операция» — со
// своими зазорами это давало 66 пикселей от края до категории при 16 пикселях
// видимого содержимого. Точка переехала на значок категории, полоса убрана.
//
// Колонки — списком, а сетку из них строит `useColumnResize`: при «Своей
// ширине столбцов» дорожки берут сохранённые ширины.
const OPS_COLUMNS: ResizeColumn[] = [
  { key: "select", size: "20px", resizable: false },
  { key: "date", label: "Дата", size: "84px" },
  { key: "category", label: "Категория", size: "minmax(0, 1.3fr)" },
  { key: "account", label: "Счёт", size: "minmax(0, 1fr)" },
  { key: "payee", label: "Контрагент", size: "minmax(0, 1.3fr)" },
  { key: "comment", label: "Комментарий", size: "minmax(0, 2.6fr)" },
  { key: "amount", label: "Сумма", size: "140px" },
  // Четыре кнопки по 28 px и три зазора по 2 — 118 px. В 112 они выступали
  // на 6 px в поле строки.
  { key: "actions", size: "118px", resizable: false },
];
const OPS_COLUMNS_NODATE = OPS_COLUMNS.filter((c) => c.key !== "date");

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
  const purgeDeleted = useDataStore((s) => s.purgeDeleted);
  const zenToken = useZenmoneyStore((s) => s.token);
  const [trashOpen, setTrashOpen] = useState(false);
  const trashRef = useRef<HTMLDivElement>(null);

  /** Удалить окончательно — тот же вопрос и то же действие, что на странице
   *  «Удалённые»: безвозвратное удаление обязано спрашивать одинаково, откуда
   *  бы его ни запустили. Только без Дзен-мани: там удалённое хранит сам
   *  Дзен-мани, и стирать у нас нечего. */
  async function emptyTrash() {
    const n = deletedCount;
    if (n === 0) return;
    const ok = await confirm({
      title: "Удалить окончательно?",
      message: `${formatNum(n)} ${pluralRu(n, ["операция будет", "операции будут", "операций будут"])} безвозвратно удалены из локального хранилища — вернуть их будет нельзя.`,
      confirmLabel: "Удалить окончательно",
      tone: "danger",
    });
    if (!ok) return;
    await purgeDeleted();
  }
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  // Месяц из ссылки (`/transactions?month=2026-08`) — по ней приходят с
  // главной, где весь экран про один месяц, и лента должна открыться за него,
  // а не за тот период, что остался с прошлого раза.
  //
  // Своего периода у ленты нет, она живёт на общем фильтре, — поэтому ссылка
  // именно ПЕРЕКЛЮЧАЕТ общий период, а не заводит второй, страничный. Ставим
  // один раз на приход по ссылке: дальше человек волен выбрать любой другой,
  // и повторно навязывать ему августовский мы не будем.
  const [searchParams] = useSearchParams();
  const monthParam = useMemo(() => {
    const q = searchParams.get("month");
    return q && /^\d{4}-\d{2}$/.test(q) ? q : null;
  }, [searchParams]);

  // По ссылке приходят с главной, а она считает ОТЧЁТНЫЙ месяц: открыть его
  // календарным значило бы показать не те операции, из которых сложилась сумма
  // в виджете.
  const setMonth = filters.setPeriodMonth;
  const appliedMonth = useRef<string | null>(null);
  useEffect(() => {
    if (!monthParam || appliedMonth.current === monthParam) return;
    appliedMonth.current = monthParam;
    setMonth(monthParam);
  }, [monthParam, setMonth]);

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
  const setEdit = useEditsStore((s) => s.setEdit);
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
  /** Открыть редактор. Открыли — значит операцию посмотрели: снимаем пометку
   *  «новая» сразу, как это делает приложение Дзен-мани. */
  const openEditor = (t: Transaction) => {
    setEditing(t);
    if (t.unseen) {
      void setEdit(t.id, { unseen: false }).then(() => reapplyRules());
    }
  };
  const [creating, setCreating] = useState<TxKind | null>(null);
  const [creatingDebt, setCreatingDebt] = useState(false);
  // Операция, с которой снимают копию (issue #78). Живёт отдельно от
  // `creating`: там выбирают вид с нуля, здесь форма открывается заполненной.
  const [copying, setCopying] = useState<Transaction | null>(null);
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  const [recurring, setRecurring] = useState<Transaction | null>(null);
  const { applySplit } = useSplitTransaction();
  // Окно объединения выделенных открыто — Escape принадлежит ему.
  const [mergeOpen, setMergeOpen] = useState(false);
  // Лента «только запланированные» — как вкладка «Будущие» в Дзен-мани.
  // Включается щелчком по строке «Запланировано» над лентой.
  const [plannedMode, setPlannedMode] = useState(false);
  // Только что вернулись из ленты планов — операции проявляются, а не
  // появляются рывком. При обычной загрузке страницы анимации нет.
  const [leftPlanned, setLeftPlanned] = useState(false);


  // ── «Добавить» dropdown: pick which kind of operation to create. ─────
  // Anchored to addMenuRef; opening/closing (outside-click, Esc, scroll) is
  // handled by <Popover>.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // ── Bulk selection + edit ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  // Escape снимает выделение. Ставим обработчик, только когда выделение есть и
  // сверху ничего не открыто: Escape всегда закрывает САМОЕ верхнее — окно,
  // диалог, меню, — и перехватывать его у них нельзя. Оба обработчика висят на
  // `window`, где `stopPropagation` соседей не глушит, поэтому разводим их не
  // порядком подписки, а условием.
  const confirmOpen = useConfirmStore((s) => s.isOpen);
  const anythingOnTop =
    Boolean(editing) ||
    Boolean(creating) ||
    Boolean(copying) ||
    bulkOpen ||
    mergeOpen ||
    trashOpen ||
    addMenuOpen ||
    sortOpen ||
    confirmOpen;
  useEffect(() => {
    if (selected.size === 0 || anythingOnTop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, anythingOnTop]);

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
    const q = pageSearch.trim();
    if (!q) return filtered;
    // Раскладка не важна — как в общем фильтре и списках.
    const match = queryMatcher(q);
    return filtered.filter((t) =>
      match(
        `${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${(t.extraCategories ?? []).join(" ")} ${t.account}`
      )
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
    // Массив пересобирается и при обычной правке операции: правка ложится
    // накладкой, список строится заново, идентичность ссылки теряется. Раньше
    // этого хватало, чтобы сбросить выделение и прокрутку, — выделил десять
    // строк, поправил одну, и выделение исчезло. Сравниваем СОСТАВ: тот же
    // набор строк в том же порядке — значит поменялось содержимое, а не
    // фильтр/поиск/сортировка, и трогать ничего не нужно.
    const sameRows =
      prevSorted.length === sorted.length &&
      prevSorted.every((t, i) => t.id === sorted[i].id);
    setPrevSorted(sorted);
    if (!sameRows) {
      setVisibleCount(PAGE_SIZE);
      // Выделение чистим не целиком, а от строк, которых в новом наборе уже
      // нет: под другим фильтром часть выделенного просто не видна.
      if (selected.size > 0) {
        const live = new Set(sorted.map((t) => t.id));
        const kept = new Set([...selected].filter((id) => live.has(id)));
        if (kept.size !== selected.size) setSelected(kept);
      }
    }
  }

  // Selection helpers computed over the full filtered+searched set (not
  // just the lazily-rendered slice), so "select all" covers everything
  // under the current filters.
  const allSelected = searched.length > 0 && selected.size === searched.length;
  const someSelected = selected.size > 0 && !allSelected;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(searched.map((t) => t.id)));
  }

  /** Сколько среди выделенных «новых» — кнопку показываем только если есть что
   *  отмечать, и пишем в ней число, чтобы было понятно, на что она подействует. */
  const selectedUnseen = useMemo(
    () => searched.filter((t) => selected.has(t.id) && t.unseen).length,
    [searched, selected]
  );

  /** Снять пометку «новая» с выделенных. Правка ложится в ту же накладку, что и
   *  обычные изменения операции, и уезжает в облако как `viewed: true`. */
  async function markSeenBulk() {
    const ids = searched.filter((t) => selected.has(t.id) && t.unseen).map((t) => t.id);
    if (ids.length === 0) return;
    await setEditMany(ids, { unseen: false });
    await reapplyRules();
  }

  // Sums (in base currency) of the currently-selected rows, split by kind — so
  // the bulk bar shows how much income / expense / transfer is in the selection.
  // Refunds subtract from expense, as everywhere else.
  const selectedTotals = useMemo(
    () => kindTotals(searched.filter((t) => selected.has(t.id))),
    [searched, selected]
  );

  const selectedTxs = useMemo(
    () => transactions.filter((t) => selected.has(t.id)),
    [transactions, selected]
  );

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  // Обучение открывает карточку первой операции ленты, чтобы показать значки
  // внизу, и само закрывает (`components/tour`). Без отметки «просмотрено»:
  // это была бы правка, которую человек не делал.
  const firstTx = useRef<Transaction | undefined>(undefined);
  useEffect(() => {
    firstTx.current = sorted[0];
  });
  useEffect(() => {
    const onTour = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail) {
        const t = firstTx.current;
        if (t) setEditing((cur) => cur ?? t);
      } else setEditing(null);
    };
    window.addEventListener(TOUR_OP_EVENT, onTour);
    return () => window.removeEventListener(TOUR_OP_EVENT, onTour);
  }, []);

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

  // Лента по дням — без колонки даты: дата стоит в шапке дня.
  const byDate = sortMode === "date-desc" || sortMode === "date-asc";
  const resize = useColumnResize("operations", byDate ? OPS_COLUMNS_NODATE : OPS_COLUMNS, {
    mode: "grid",
  });

  // Group by day only when sorted by date. Apply lazy slicing FIRST so groups
  // appear/grow incrementally as the user scrolls.
  const groupedByDay = useMemo(() => {
    if (!byDate) return null;
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
  }, [visible, byDate]);

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
      />
      <GlobalFilters />

      <StatRow>
        <StatCell
          label="Доходы"
          value={formatMoney(totals.inc, base)}
          tone="income"
          icon={<ArrowUp className="w-4 h-4" />}
        />
        <StatCell
          label="Расходы"
          value={formatMoney(totals.exp, base)}
          tone="expense"
          icon={<ArrowDown className="w-4 h-4" />}
        />
        <StatCell
          label="Прибыль"
          value={formatMoney(totals.net, base, { signed: true })}
          tone={totals.net >= 0 ? "income" : "expense"}
          icon={<Scale className="w-4 h-4" />}
        />
        <StatCell
          label="Переводы"
          value={formatMoney(totals.xfer, base)}
          icon={<ArrowLeftRight className="w-4 h-4" />}
          tooltip="Сумма переводов между своими счетами за период"
        />
        <StatCell
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
        <StatCell
          label="Операций"
          value={formatNum(totals.count)}
          icon={<List className="w-4 h-4" />}
          note={pageSearch ? `из ${filtered.length} в фильтре` : undefined}
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
              title={"Быстрый поиск по этой таблице\nИщет по получателю, комментарию, категории и счёту. Не сохраняется и на другие страницы не влияет."}
              className="flex-1 min-w-[220px]"
            />
            {apiConnected && (
              <div className="relative" ref={addMenuRef}>
                <button
                  data-tour="add-op"
                  onClick={() => setAddMenuOpen((o) => !o)}
                  className="btn-primary text-xs whitespace-nowrap"
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
            <SortMenu
              options={SORT_OPTIONS}
              value={sortMode}
              onChange={setSortMode}
              onOpenChange={setSortOpen}
            />
            <button onClick={exportCsv} className="btn-ghost text-xs whitespace-nowrap">
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            {/* «Удалённые» без Дзен-мани — меню, а не ссылка: чтобы стереть
                спрятанное, приходилось идти на отдельную страницу и возвращаться
                обратно. С Дзен-мани стирать у нас нечего — удалённые хранит он
                сам, и остаётся простая ссылка без счётчика: номера наших
                удалений копятся всю жизнь, и число на значке только росло бы. */}
            <div ref={trashRef} className="relative">
              {deletedCount > 0 && !zenToken ? (
                <button
                  type="button"
                  onClick={() => setTrashOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={trashOpen}
                  aria-label={`Удалённые операции: ${deletedCount}`}
                  title="Удалённые"
                  className="relative btn-ghost text-xs !px-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-expense text-on-tone text-[10px] leading-4 text-center tabular-nums">
                    {deletedCount}
                  </span>
                </button>
              ) : (
                <Link
                  to="/trash"
                  className="relative btn-ghost text-xs !px-2"
                  title="Удалённые"
                  aria-label="Удалённые операции"
                >
                  <Trash2 className="w-4 h-4" />
                </Link>
              )}
              <Popover
                open={trashOpen}
                anchorRef={trashRef}
                onClose={() => setTrashOpen(false)}
                align="right"
                className="card p-1.5 shadow-lg w-64"
              >
                <Link
                  to="/trash"
                  onClick={() => setTrashOpen(false)}
                  className="w-full text-left rounded-lg px-3 py-2 hover:bg-panel2 flex gap-3 items-start"
                >
                  <Eye className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                  <span>
                    <span className="block text-sm font-medium">Просмотреть</span>
                    <span className="block text-xs text-muted">
                      Список удалённых и возврат
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setTrashOpen(false);
                    void emptyTrash();
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 hover:bg-panel2 flex gap-3 items-start"
                >
                  <Trash2 className="w-4 h-4 mt-0.5 shrink-0 text-expense" />
                  <span>
                    <span className="block text-sm font-medium">Удалить окончательно</span>
                    <span className="block text-xs text-muted">
                      Удалить {formatNum(deletedCount)}{" "}
                      {pluralRu(deletedCount, ["операцию", "операции", "операций"])}{" "}
                      безвозвратно
                    </span>
                  </span>
                </button>
              </Popover>
            </div>
          </>
        }
      >
        {/* Строка «Запланировано» (или шапка ленты одних планов) — над
            заголовками колонок: она про всю ленту, а не про одну колонку. */}
        {apiConnected && (
          <PlannedBar
            open={plannedMode}
            onToggle={() => {
              setPlannedMode((v) => !v);
              setLeftPlanned(plannedMode);
            }}
            query={pageSearch}
          />
        )}
        {apiConnected && plannedMode ? (
          <div>
            <HeaderRow
              grouped={byDate}
              template={resize.template}
              handle={resize.handle}
              allSelected={false}
              someSelected={false}
              onToggleAll={() => {}}
              noSelect
            />
            <PlannedFeedList
              template={resize.template}
              grouped={byDate}
              query={pageSearch}
            />
          </div>
        ) : sorted.length === 0 ? (
          <SectionEmpty variant="inline">
            По текущим фильтрам ничего не найдено
          </SectionEmpty>
        ) : groupedByDay ? (
          <div className={leftPlanned ? "feed-back-in" : undefined}>
            <HeaderRow
              grouped
              template={resize.template}
              handle={resize.handle}
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
                template={resize.template}
                showTransfers={!filters.excludeTransfers}
                edits={edits}
                drafts={drafts}
                onEdit={openEditor}
                onCopy={apiConnected ? setCopying : undefined}
                onDelete={handleDelete}
                onSplit={apiConnected ? setSplitting : undefined}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        ) : (
          <div className={leftPlanned ? "feed-back-in" : undefined}>
            <HeaderRow
              grouped={false}
              template={resize.template}
              handle={resize.handle}
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleAll={toggleSelectAll}
            />
            {visible.map((t) => (
              <Row
                key={t.id}
                tx={t}
                template={resize.template}
                edited={!!edits[t.id]}
                draft={!!drafts[t.id]}
                onEdit={() => openEditor(t)}
                onCopy={apiConnected ? () => setCopying(t) : undefined}
                onDelete={() => handleDelete(t)}
                onSplit={apiConnected ? () => setSplitting(t) : undefined}
                selected={selected.has(t.id)}
                onToggleSelect={() => toggleSelect(t.id)}
              />
            ))}
          </div>
        )}

        {showingTail && (
          <LazyListFooter shown={visibleCount} total={sorted.length} sentinelRef={sentinelRef} />
        )}
      </OperationListTray>

      {recurring && <MakeRecurringModal tx={recurring} onClose={() => setRecurring(null)} />}

      {splitting && (
        <SplitTransactionModal
          tx={splitting}
          onClose={() => setSplitting(null)}
          onSplit={(parts, payee, account) =>
              applySplit(splitting, parts, payee, account)
            }
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
                  // Карточку правки закрываем: копия — отдельная операция, и
                  // держать обе формы открытыми значило бы предлагать править
                  // образец и копию разом.
                  setEditing(null);
                  setCopying(editing);
                }
              : undefined
          }
          // Разделение открывается ВМЕСТО карточки: держать обе формы
          // открытыми значило бы предлагать править операцию и делить её
          // одновременно.
          onSplit={
            apiConnected
              ? () => {
                  setEditing(null);
                  setSplitting(editing);
                }
              : undefined
          }
          onMakeRecurring={
            apiConnected
              ? () => {
                  setEditing(null);
                  setRecurring(editing);
                }
              : undefined
          }
          onNavigate={(dir) => {
            const i = sorted.findIndex((t) => t.id === editing.id);
            const next = sorted[i + dir];
            if (next) openEditor(next);
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

      {copying && (
        <EditTransactionModal
          key={`copy-${copying.id}`}
          template={copying}
          onClose={() => setCopying(null)}
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
          <MergeSelectionAction
            txs={selectedTxs}
            onMerged={() => setSelected(new Set())}
            onOpenChange={setMergeOpen}
          />
          {selectedUnseen > 0 && (
            <button
              onClick={markSeenBulk}
              className="btn-ghost text-sm"
              title="Отметить выбранные операции просмотренными"
            >
              <Eye className="w-4 h-4" />
              Просмотрено
              <span className="tabular-nums text-muted">({selectedUnseen})</span>
            </button>
          )}
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

/** Колоночные заголовки. Сетка та же, что и у строк. */
function HeaderRow({
  grouped,
  template,
  handle,
  allSelected,
  someSelected,
  onToggleAll,
  noSelect = false,
}: {
  /** Выбирать нечего (планы) — вместо флажка пустая ячейка. */
  noSelect?: boolean;
  grouped: boolean;
  template: string;
  /** Границы своей ширины столбцов. */
  handle: (key: string) => ReactNode;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}) {
  return (
    <OperationListHead template={template}>
      {noSelect ? (
        // Тот же флажок, только невидимый: пустая ячейка ниже флажка, и
        // строка заголовков при переключении на планы становилась ниже.
        <span className="invisible" aria-hidden>
          <Checkbox checked={false} onChange={() => {}} label="Выбор недоступен" />
        </span>
      ) : (
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={onToggleAll}
          title="Выбрать всё (под фильтрами)"
          label="Выбрать все операции"
        />
      )}
      {!grouped && (
        <ListHeadCell col="date" resize={handle("date")}>
          Дата
        </ListHeadCell>
      )}
      <ListHeadCell col="category" resize={handle("category")}>
        Категория
      </ListHeadCell>
      <ListHeadCell col="account" resize={handle("account")}>
        Счёт
      </ListHeadCell>
      <ListHeadCell col="payee" resize={handle("payee")}>
        Контрагент
      </ListHeadCell>
      <ListHeadCell col="comment" resize={handle("comment")}>
        Комментарий
      </ListHeadCell>
      <ListHeadCell col="amount" className="text-right">
        Сумма
      </ListHeadCell>
      <div className="text-center">Действия</div>
    </OperationListHead>
  );
}

function DayGroup({
  ymd,
  txs,
  base,
  template,
  showTransfers,
  edits,
  drafts,
  onEdit,
  onCopy,
  onDelete,
  onSplit,
  selected,
  onToggleSelect,
}: {
  ymd: string;
  txs: Transaction[];
  base: string;
  template: string;
  showTransfers: boolean;
  edits: Record<string, unknown>;
  drafts: Record<string, unknown>;
  onEdit: (t: Transaction) => void;
  /** Не задан — копировать некуда: без подключённого Дзен-мани новых операций
   *  не создать, и кнопка не рисуется. */
  onCopy?: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  /** Не задан — делить нечем: без подключённого Дзен-мани частей не создать. */
  onSplit?: (t: Transaction) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div>
      <DayHeader ymd={ymd} txs={txs} base={base} showTransfers={showTransfers} />
      {txs.map((t) => (
        <Row
          key={t.id}
          tx={t}
          template={template}
          edited={!!edits[t.id]}
          draft={!!drafts[t.id]}
          onEdit={() => onEdit(t)}
          onCopy={onCopy && (() => onCopy(t))}
          onDelete={() => onDelete(t)}
          onSplit={onSplit && (() => onSplit(t))}
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
  template,
  edited,
  draft = false,
  onEdit,
  onCopy,
  onDelete,
  onSplit,
  selected,
  onToggleSelect,
  hideDate = false,
}: {
  tx: Transaction;
  template: string;
  edited: boolean;
  draft?: boolean;
  onEdit: () => void;
  onCopy?: () => void;
  onDelete: () => void;
  /** Разделить операцию на части. Нет — делить нечего или незачем. */
  onSplit?: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  hideDate?: boolean;
}) {
  return (
    <OperationListRow
      template={template}
      selected={selected}
      onToggleSelect={onToggleSelect}
      onOpen={onEdit}
    >
      <Checkbox
        checked={selected}
        stopPropagation
        onChange={onToggleSelect}
        label="Выбрать операцию"
      />
      {!hideDate && (
        <div className="text-muted tabular-nums whitespace-nowrap">
          {tx.date.slice(8, 10)}.{tx.date.slice(5, 7)}.{tx.date.slice(0, 4)}
        </div>
      )}
      {/* Без `title`: подсказка повторяла бы название, которое тут же и написано. */}
      <OperationCategory tx={tx} edited={edited} draft={draft} />
      <div className="truncate text-muted" title={tx.account}>
        {tx.account}
      </div>
      <OperationPayee tx={tx} />
      <OperationComment text={tx.comment} />
      <div
        data-cell="amount"
        className={`text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
      >
        <OperationAmount tx={tx} />
      </div>
      <OperationActions onEdit={onEdit} onCopy={onCopy} onSplit={onSplit} onDelete={onDelete} />
    </OperationListRow>
  );
}
