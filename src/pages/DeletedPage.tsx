import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Calendar, Clock, Coins, Copy, List, Trash2, Undo2, X } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDeletedPayloadsStore } from "../store/useDeletedPayloadsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { confirm, useConfirmStore } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { applyEdits } from "../lib/applyEdits";
import { cacheToDiffResponse } from "../lib/zenmoneyCache";
import { getZenCache, peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import {
  collectDeletedOperations,
  dayOfMs,
  groupDeleted,
  sortDeleted,
  type DeletedEntry,
  type DeletedSort,
} from "../lib/deletedOperations";
import { kindTotals, lastTransactionDate } from "../lib/aggregations";
import { formatDate, formatMoney, formatNum, payeeSearchText } from "../lib/format";
import { formatDayHeader } from "../lib/dayLabel";
import { kindLabel, operationTone } from "../lib/txKindStyle";
import { TONE_CLASS, buildCsv, csvFileName, downloadCsv } from "../components/table/tableKit";
import { ExportButton } from "../components/table/TableParts";
import { OperationAmount, OperationCategory, OperationPayee } from "../components/operations/OperationCells";
import { DayHeader } from "../components/operations/DayHeader";
import {
  LazyListFooter,
  OperationListHead,
  OperationListRow,
  OperationListTray,
} from "../components/operations/OperationList";
import { PageHeader } from "../components/PageHeader";
import { GlobalFilters } from "../components/GlobalFilters";
import { SearchInput } from "../components/SearchInput";
import { SortMenu, type SortOption } from "../components/SortMenu";
import { SelectionBar } from "../components/SelectionBar";
import { ScrollTopButton } from "../components/ScrollTopButton";
import { StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { Callout } from "../components/Callout";
import { Badge } from "../components/Badge";
import { Checkbox } from "../components/Checkbox";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { useLazyList } from "../hooks/useLazyList";
import type { Transaction } from "../types";

const HINT = "Верните операцию, если её удалили по ошибке";

/** Порция ленты при подгрузке — как в «Операциях». */
const PAGE_SIZE = 100;

const SORT_OPTIONS: SortOption<DeletedSort>[] = [
  { value: "date-desc", label: "Дата ↓", icon: Calendar, dir: "desc" },
  { value: "date-asc", label: "Дата ↑", icon: Calendar, dir: "asc" },
  { value: "deleted-desc", label: "Удалена ↓", icon: Trash2, dir: "desc" },
  { value: "deleted-asc", label: "Удалена ↑", icon: Trash2, dir: "asc" },
  { value: "amount-desc", label: "Сумма ↓", icon: Coins, dir: "desc" },
  { value: "amount-asc", label: "Сумма ↑", icon: Coins, dir: "asc" },
];

/** Строка ленты: операция, когда её удалили и что с ней сейчас. */
type FeedRow = Pick<DeletedEntry, "id" | "deletedAt" | "status" | "hasTwin"> & { tx: Transaction };

/** `cloud` — удалённые в Дзен-мани; `local` — без подключения, спрятанные у нас. */
type Mode = "cloud" | "local";

interface Columns {
  /** Дата операции. В днях по дате операции она в шапке дня. */
  date: boolean;
  /** Когда удалена. В днях по удалению — в шапке дня. */
  deleted: boolean;
  /** Статус есть только у удалённых в Дзен-мани. */
  status: boolean;
}

/**
 * Сетка — та же, что у ленты «Операций», плюс «Статус» и «Удалена»; вместо
 * четырёх кнопок действий — одна.
 *
 * Статус стоит сразу за комментарием, а сумма — вплотную к действиям: так
 * решил пользователь (15.09.2026). Сумма у правого края читается рядом с
 * кнопкой возврата, к которой относится, а статус — продолжением описания
 * операции.
 */
function gridTemplate(cols: Columns): string {
  return [
    "20px",
    cols.date && "84px",
    "minmax(0, 1.3fr)",
    "minmax(0, 1fr)",
    "minmax(0, 1.3fr)",
    "minmax(0, 2.6fr)",
    cols.status && "120px",
    cols.deleted && "84px",
    "140px",
    "72px",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * «Удалённые» — операции, удалённые в Дзен-мани, и возврат их обратно.
 *
 * Прежде раздел назывался «Корзина» и показывал только наши удаления. Но
 * Дзен-мани сам хранит каждую удалённую операцию с пометкой `deleted: true` —
 * удалённую в его приложении, на сайте или у нас, — и раздел теперь про них
 * (`collectDeletedOperations`).
 *
 * Выглядит как лента «Операций»: общие фильтры, итоги, дни, подгрузка при
 * прокрутке, выделение. Своего периода у раздела нет — он живёт на общем
 * фильтре, как и лента.
 *
 * Без подключения к Дзен-мани облака нет, и раздел показывает то, что
 * спрятано у нас: иначе удалённое из CSV нечем было бы вернуть.
 */
export function DeletedPage() {
  const token = useZenmoneyStore((s) => s.token);
  const loaded = useZenmoneyStore((s) => s.loaded);
  if (!loaded) return null;
  return token ? <CloudDeleted /> : <LocalDeleted />;
}

// ── Удалённые в Дзен-мани ───────────────────────────────────────────────────

const accusativeOps = (n: number) => pluralRu(n, ["операцию", "операции", "операций"]);

function CloudDeleted() {
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  useEffect(() => {
    if (cache === undefined) void getZenCache();
  }, [cache]);
  const payloads = useDeletedPayloadsStore((s) => s.payloads);
  const deletedIds = useDeletedStore((s) => s.deletedIds);
  const deletedAt = useDeletedStore((s) => s.deletedAt);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const restoreDeleted = useDataStore((s) => s.restoreDeleted);
  const cancelRestore = useDataStore((s) => s.cancelRestore);

  // Разбор тем же `mapZenmoneyDiff`, что и живые операции: категория,
  // получатель, счёт и сумма в списке выглядят ровно как в ленте.
  const rows = useMemo<FeedRow[]>(() => {
    if (!cache) return [];
    const entries = collectDeletedOperations({ cache, payloads, deletedIds, deletedAt });
    if (entries.length === 0) return [];
    const mapped = mapZenmoneyDiff(
      cacheToDiffResponse({ ...cache, transactions: entries.map((e) => e.zen) })
    ).transactions;
    const byId = new Map(mapped.map((t) => [t.id, t]));
    return entries.flatMap((e) => {
      const tx = byId.get(e.id);
      // Пометка «новая» у удалённой ничего не значит: открывать её незачем.
      return tx
        ? [{ id: e.id, deletedAt: e.deletedAt, status: e.status, hasTwin: e.hasTwin, tx: { ...tx, unseen: false } }]
        : [];
    });
  }, [cache, payloads, deletedIds, deletedAt]);

  const restoresWaiting = rows.some((r) => r.status === "restore-pending");

  async function restore(list: FeedRow[]): Promise<boolean> {
    const ids = list.filter((r) => r.status !== "restore-pending").map((r) => r.id);
    if (ids.length === 0) return false;
    const dup = list.filter((r) => r.status === "deleted" && r.hasTwin).length;
    if (dup > 0) {
      const ok = await confirm({
        title: ids.length === 1 ? "Вернуть операцию?" : `Вернуть ${formatNum(ids.length)} ${accusativeOps(ids.length)}?`,
        message:
          ids.length === 1
            ? "В Дзен-мани уже есть такая же: та же дата, сумма, счёт и получатель. Возврат её задвоит."
            : `У ${formatNum(dup)} из них в Дзен-мани уже есть такие же — возврат их задвоит.`,
        confirmLabel: "Всё равно вернуть",
        tone: "warning",
      });
      if (!ok) return false;
    } else if (ids.length > 1) {
      const ok = await confirm({
        title: `Вернуть ${formatNum(ids.length)} ${accusativeOps(ids.length)}?`,
        message: "Удалённые в Дзен-мани появятся там снова — копиями со всеми полями.",
        confirmLabel: "Вернуть",
      });
      if (!ok) return false;
    }
    await restoreDeleted(ids);
    return true;
  }

  const header = (
    <PageHeader
      icon={Trash2}
      title="Удалённые"
      hint={HINT}
      info={
        <InfoPopover>
          <p>
            Дзен-мани не стирает удалённые операции: они остаются в облаке с
            пометкой «удалена». Здесь все такие операции —{" "}
            <InfoTerm>удалённые в приложении Дзен-мани, на сайте и у нас</InfoTerm>.
            В расчётах их нет.
          </p>
          <p>
            <InfoTerm>Фильтры</InfoTerm> — общие, как в ленте «Операции»: период
            считается по дате операции. Когда её удалили — в колонке «Удалена»;
            по ней же можно отсортировать.
          </p>
          <p>
            <InfoTerm>«Вернуть»</InfoTerm> создаёт в Дзен-мани копию со всеми
            полями — датой, суммой, счётом, категорией, получателем и
            комментарием. Снять пометку с самой операции Дзен-мани не даёт, поэтому
            возвращается копия.
          </p>
          <p>
            <InfoTerm>«Есть такая же»</InfoTerm> — в Дзен-мани уже есть живая
            операция с той же датой, суммой, счётом и получателем. Обычно это
            убранный дубль: возврат его задвоит.
          </p>
          <p>
            <InfoTerm>«Ждёт отправки»</InfoTerm> — удаление или возврат сделаны
            здесь и уйдут в Дзен-мани со следующей отправкой.
          </p>
        </InfoPopover>
      }
    />
  );

  if (cache === undefined) return <div className="space-y-6">{header}</div>;

  if (cache === null) {
    return (
      <div className="space-y-6">
        {header}
        <SectionEmpty icon={Trash2} title="Нет данных Дзен-мани">
          Синхронизируйтесь — и здесь появятся операции, удалённые в Дзен-мани.
        </SectionEmpty>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SectionEmpty icon={Trash2} title="Удалённых операций нет">
          В Дзен-мани нет операций с пометкой «удалена».
        </SectionEmpty>
      </div>
    );
  }

  return (
    <DeletedFeed
      mode="cloud"
      rows={rows}
      header={header}
      notice={
        pushMode === "off" &&
        restoresWaiting && (
          <Callout size="banner" tone="warn">
            Отправка в Дзен-мани выключена: возвращённые операции уйдут туда, когда
            вы включите двустороннюю синхронизацию в настройках.
          </Callout>
        )
      }
      onRestore={restore}
      onCancel={(list) => cancelRestore(list.map((r) => r.id))}
    />
  );
}

// ── Без Дзен-мани: спрятанные у нас ─────────────────────────────────────────

function LocalDeleted() {
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const rates = useDataStore((s) => s.rates);
  const restoreTransactionMany = useDataStore((s) => s.restoreTransactionMany);
  const purgeDeleted = useDataStore((s) => s.purgeDeleted);
  const edits = useEditsStore((s) => s.edits);
  const deletedSet = useDeletedStore((s) => s.deletedSet);
  const deletedAt = useDeletedStore((s) => s.deletedAt);

  const rows = useMemo<FeedRow[]>(() => {
    if (deletedSet.size === 0) return [];
    return applyEdits(transactionsRaw, edits, rates)
      .filter((t) => deletedSet.has(t.id))
      .map((t) => ({
        id: t.id,
        deletedAt: deletedAt[t.id] ?? null,
        status: "deleted" as const,
        hasTwin: false,
        tx: { ...t, unseen: false },
      }));
  }, [transactionsRaw, edits, rates, deletedSet, deletedAt]);

  async function handlePurge() {
    const n = rows.length;
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

  const header = (
    <PageHeader
      icon={Trash2}
      title="Удалённые"
      hint={HINT}
      right={
        rows.length > 0 && (
          <button onClick={handlePurge} className="btn-danger text-xs">
            <Trash2 className="w-3.5 h-3.5" />
            Удалить окончательно
          </button>
        )
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SectionEmpty icon={Trash2} title="Удалённых операций нет">
          Удалить операцию можно в ленте «Операции» или в её карточке.
        </SectionEmpty>
      </div>
    );
  }

  return (
    <DeletedFeed
      mode="local"
      rows={rows}
      header={header}
      onRestore={async (list) => {
        await restoreTransactionMany(list.map((r) => r.id));
        return true;
      }}
    />
  );
}

// ── Лента ───────────────────────────────────────────────────────────────────

function DeletedFeed({
  mode,
  rows,
  header,
  notice,
  onRestore,
  onCancel,
}: {
  mode: Mode;
  rows: FeedRow[];
  header: ReactNode;
  /** Предупреждение над итогами. */
  notice?: ReactNode;
  /** Вернуть строки. `false` — человек передумал в подтверждении. */
  onRestore: (rows: FeedRow[]) => Promise<boolean>;
  /** Передумать, пока возврат не отправлен. Только с Дзен-мани. */
  onCancel?: (rows: FeedRow[]) => Promise<void>;
}) {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const confirmOpen = useConfirmStore((s) => s.isOpen);
  const [pageSearch, setPageSearch] = useState("");
  const [sortMode, setSortMode] = useState<DeletedSort>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Скользящие периоды («30 дней», «12 мес») отсчитываются от последней
  // операции ВСЕЙ ленты: иначе здесь они значили бы другие дни, чем на
  // соседних страницах с тем же фильтром.
  const maxDate = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const filtered = useMemo(() => {
    const kept = new Set(
      applyFilters(
        rows.map((r) => r.tx),
        filters,
        monthStartDay,
        { maxDate: maxDate || undefined }
      ).map((t) => t.id)
    );
    return rows.filter((r) => kept.has(r.id));
  }, [rows, filters, monthStartDay, maxDate]);

  const searched = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(({ tx: t }) =>
      `${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${(t.extraCategories ?? []).join(" ")} ${t.account}`
        .toLowerCase()
        .includes(q)
    );
  }, [filtered, pageSearch]);

  const sorted = useMemo(() => sortDeleted(searched, sortMode), [searched, sortMode]);
  const lazy = useLazyList(sorted, PAGE_SIZE);
  const visible = useMemo(() => sorted.slice(0, lazy.shown), [sorted, lazy.shown]);
  const days = useMemo(() => groupDeleted(visible, sortMode), [visible, sortMode]);

  // Выделение считаем по тому, что сейчас в ленте: строки, скрытые фильтром
  // или уже вернувшиеся, в счёт и в действия не попадают.
  const selectedRows = useMemo(() => sorted.filter((r) => selected.has(r.id)), [sorted, selected]);
  const allSelected = sorted.length > 0 && selectedRows.length === sorted.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sorted.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  // Escape снимает выделение, если сверху ничего не открыто: иначе Escape
  // закрывает то, что сверху, — диалог или меню.
  const hasSelection = selectedRows.length > 0;
  useEffect(() => {
    if (!hasSelection || confirmOpen || sortOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection, confirmOpen, sortOpen]);

  const totals = useMemo(() => kindTotals(searched.map((r) => r.tx)), [searched]);
  const selectedTotals = useMemo(() => kindTotals(selectedRows.map((r) => r.tx)), [selectedRows]);
  const twins = searched.filter((r) => r.status === "deleted" && r.hasTwin).length;
  const pending = searched.filter((r) => r.status !== "deleted").length;
  const restorable = selectedRows.filter((r) => r.status !== "restore-pending");
  const cancellable = selectedRows.filter((r) => r.status === "restore-pending");

  const byDeletion = sortMode === "deleted-desc" || sortMode === "deleted-asc";
  const cols: Columns = {
    date: sortMode !== "date-desc" && sortMode !== "date-asc",
    deleted: !byDeletion,
    status: mode === "cloud",
  };
  const template = gridTemplate(cols);

  function exportCsv() {
    const cloud = mode === "cloud";
    const text = buildCsv(
      [
        "Дата",
        "Тип",
        "Категория",
        "Получатель",
        "Комментарий",
        "Счёт",
        "Сумма",
        "Валюта",
        "Удалена",
        ...(cloud ? ["Статус"] : []),
      ],
      sorted.map((r) => [
        r.tx.date,
        kindLabel(r.tx.kind),
        r.tx.categoryFull,
        r.tx.payee || "",
        r.tx.comment || "",
        r.tx.account,
        r.tx.amount,
        r.tx.currency,
        r.deletedAt ? dayOfMs(r.deletedAt) : "",
        ...(cloud ? [statusText(r)] : []),
      ])
    );
    downloadCsv(csvFileName("deleted"), text);
  }

  const renderRow = (r: FeedRow) => (
    <FeedRowView
      key={r.id}
      row={r}
      mode={mode}
      cols={cols}
      template={template}
      selected={selected.has(r.id)}
      onToggleSelect={() => toggleSelect(r.id)}
      onRestore={() => void onRestore([r])}
      onCancel={onCancel && (() => void onCancel([r]))}
    />
  );

  return (
    <div className="space-y-6">
      {header}
      <GlobalFilters />
      {notice}

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
        {mode === "cloud" && (
          <StatCell
            label="Есть такая же"
            value={formatNum(twins)}
            tone={twins > 0 ? "warn" : "default"}
            icon={<Copy className="w-4 h-4" />}
            tooltip="В Дзен-мани уже есть живая операция с той же датой, суммой, счётом и получателем — возврат задвоит"
          />
        )}
        {mode === "cloud" && (
          <StatCell
            label="Ждут отправки"
            value={formatNum(pending)}
            tone={pending > 0 ? "accent" : "default"}
            icon={<Clock className="w-4 h-4" />}
            tooltip="Возвраты и удаления, сделанные здесь и ещё не отправленные в Дзен-мани"
          />
        )}
        <StatCell
          label="Операций"
          value={formatNum(searched.length)}
          icon={<List className="w-4 h-4" />}
          note={searched.length < rows.length ? `из ${formatNum(rows.length)} удалённых` : undefined}
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
            <SortMenu
              options={SORT_OPTIONS}
              value={sortMode}
              onChange={setSortMode}
              onOpenChange={setSortOpen}
            />
            <ExportButton rows={sorted.length} onClick={exportCsv} />
          </>
        }
      >
        {sorted.length === 0 ? (
          <SectionEmpty variant="inline">
            По текущим фильтрам ничего не найдено.
            {filtered.length === 0 &&
              ` Всего удалённых — ${formatNum(rows.length)}: выберите другой период или сбросьте фильтры.`}
          </SectionEmpty>
        ) : (
          <div>
            <OperationListHead template={template}>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
                title="Выбрать всё (под фильтрами)"
                label="Выбрать все удалённые операции"
              />
              {cols.date && <div>Дата</div>}
              <div>Категория</div>
              <div>Счёт</div>
              <div>Контрагент</div>
              <div>Комментарий</div>
              {cols.status && <div className="text-center">Статус</div>}
              {cols.deleted && <div>Удалена</div>}
              <div className="text-right">Сумма</div>
              <div className="text-center">Действия</div>
            </OperationListHead>
            {days
              ? days.map((day) => (
                  <div key={day.key}>
                    <DayHeader
                      ymd={day.ymd}
                      title={byDeletion ? deletionDayTitle(day.ymd) : undefined}
                      txs={day.txs}
                      base={base}
                      showTransfers={!filters.excludeTransfers}
                    />
                    {day.rows.map(renderRow)}
                  </div>
                ))
              : visible.map(renderRow)}
          </div>
        )}

        {lazy.hasMore && (
          <LazyListFooter shown={lazy.shown} total={lazy.total} sentinelRef={lazy.attachSentinel} />
        )}
      </OperationListTray>

      {hasSelection && (
        <SelectionBar
          count={selectedRows.length}
          totals={selectedTotals}
          base={base}
          onClear={clearSelection}
        >
          {restorable.length > 0 && (
            <button
              onClick={async () => {
                if (await onRestore(restorable)) clearSelection();
              }}
              className="btn-primary text-sm"
            >
              <Undo2 className="w-4 h-4" />
              Вернуть
              {restorable.length < selectedRows.length && (
                <span className="tabular-nums opacity-80">({formatNum(restorable.length)})</span>
              )}
            </button>
          )}
          {onCancel && cancellable.length > 0 && (
            <button
              onClick={async () => {
                await onCancel(cancellable);
                clearSelection();
              }}
              className="btn-ghost text-sm"
            >
              <X className="w-4 h-4" />
              Отменить возврат
              {cancellable.length < selectedRows.length && (
                <span className="tabular-nums text-muted">({formatNum(cancellable.length)})</span>
              )}
            </button>
          )}
        </SelectionBar>
      )}

      <ScrollTopButton />
    </div>
  );
}

/** «Удалены вчера, 14 сентября» — шапка дня, когда лента разбита по дням удаления. */
function deletionDayTitle(ymd: string): string {
  if (!ymd) return "Когда удалены — неизвестно";
  const { label } = formatDayHeader(ymd);
  return `Удалены ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function FeedRowView({
  row,
  mode,
  cols,
  template,
  selected,
  onToggleSelect,
  onRestore,
  onCancel,
}: {
  row: FeedRow;
  mode: Mode;
  cols: Columns;
  template: string;
  selected: boolean;
  onToggleSelect: () => void;
  onRestore: () => void;
  onCancel?: () => void;
}) {
  const { tx } = row;
  return (
    <OperationListRow template={template} selected={selected} onToggleSelect={onToggleSelect}>
      <Checkbox checked={selected} stopPropagation onChange={onToggleSelect} label="Выбрать операцию" />
      {cols.date && (
        <div className="text-muted tabular-nums whitespace-nowrap">{formatDate(tx.date, "full")}</div>
      )}
      <OperationCategory tx={tx} edited={false} />
      <div className="truncate text-muted" title={tx.account}>
        {tx.account}
      </div>
      <OperationPayee tx={tx} />
      <div className="text-muted truncate" title={tx.comment || ""}>
        {tx.comment || ""}
      </div>
      {cols.status && (
        <div className="flex justify-center min-w-0">
          <StatusBadge row={row} />
        </div>
      )}
      {cols.deleted && (
        <div className="text-muted tabular-nums whitespace-nowrap">
          {row.deletedAt ? formatDate(dayOfMs(row.deletedAt), "full") : "—"}
        </div>
      )}
      <div
        className={`text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
      >
        <OperationAmount tx={tx} />
      </div>
      <div className="flex items-center justify-center">
        {row.status === "restore-pending" ? (
          onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn-icon"
              title="Отменить возврат — операция останется удалённой"
              aria-label="Отменить возврат"
            >
              <X className="w-4 h-4" />
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onRestore}
            className="btn-icon"
            title={
              row.status === "delete-pending"
                ? "Вернуть — удаление ещё не отправлено в Дзен-мани"
                : mode === "cloud"
                  ? "Вернуть — в Дзен-мани копией со всеми полями"
                  : "Вернуть"
            }
            aria-label="Вернуть операцию"
          >
            <Undo2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </OperationListRow>
  );
}

function statusText(r: Pick<FeedRow, "status" | "hasTwin">): string {
  if (r.status === "restore-pending") return "Вернётся";
  if (r.status === "delete-pending") return "Удаление ждёт отправки";
  return r.hasTwin ? "Есть такая же" : "Удалена";
}

/**
 * Статус есть у каждой строки: пустая ячейка у большинства операций читалась
 * как «статус неизвестен». Обычная удалённая — нейтральная «Удалена»; то, что
 * ещё уйдёт в Дзен-мани, — акцентом, как итог «Ждут отправки» над лентой.
 */
function StatusBadge({ row }: { row: FeedRow }) {
  if (row.status === "restore-pending") {
    return (
      <Badge tone="accent" title="Копия уйдёт в Дзен-мани со следующей отправкой">
        Вернётся
      </Badge>
    );
  }
  if (row.status === "delete-pending") {
    return (
      <Badge tone="accent" title="Удалена здесь, в Дзен-мани пока живая">
        Ждёт отправки
      </Badge>
    );
  }
  if (row.hasTwin) {
    return (
      <Badge tone="warn" title="В Дзен-мани есть живая операция с той же датой, суммой, счётом и получателем">
        Есть такая же
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" title="Удалена в Дзен-мани — можно вернуть копией">
      Удалена
    </Badge>
  );
}
