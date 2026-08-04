// Справочник контрагентов (Zenmoney merchants) — the dictionary behind
// «Получатель» on an operation. Search, create, rename, delete (single and
// bulk). Everything is staged in a local overlay and flushed to Дзен-мани
// through the normal Push flow, mirroring the categories editor.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLazyList } from "../hooks/useLazyList";
import { createPortal } from "react-dom";
import {
  Search,
  Pencil,
  Trash2,
  Plus,
  Undo2,
  X,
  Combine,
  UserPlus,
} from "lucide-react";
import clsx from "clsx";
import {
  getCounterpartiesFromCache,
  useZenmoneyStore,
  type Counterparty,
} from "../store/useZenmoneyStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { useCategoryRulesStore } from "../store/useCategoryRulesStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { confirm } from "../store/useConfirmStore";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { Combobox } from "./Combobox";
import { InfoPopover } from "./InfoPopover";
import { CountSortHeader, type SortMode } from "./CountSortHeader";
import {
  CounterpartyDeleteModal,
  type TransferTarget,
} from "./CounterpartyDeleteModal";

/** A row as rendered: cached merchant or unpushed draft, with overlay applied. */
interface Row {
  id: string;
  title: string;
  count: number;
  /** Ids of the operations referencing this counterparty (drill-down source). */
  txIds: string[];
  isNew: boolean;
  isRenamed: boolean;
  isDeleted: boolean;
  /** Queued to be folded into another counterparty — that one's id. */
  mergedInto?: string;
}

/** A set of counterparties sharing a title: one survivor + the copies folded
 *  into it. Дзен-мани happily keeps several merchant rows per name, so a real
 *  account accumulates hundreds of these. */
interface DupGroup {
  key: string;
  survivor: Row;
  dups: Row[];
  /** Operations across the whole group — what the merge will move. */
  total: number;
}

/** Same counterparty by name: trimmed, case- and ё-insensitive. */
function dupKey(title: string): string {
  return title.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Получатель, который есть в операциях, но не привязан к контрагенту: банк
 *  прислал его строкой, и в справочнике Дзен-мани записи под него нет. */
interface OrphanPayee {
  title: string;
  count: number;
  txIds: string[];
  /** Контрагент с таким названием в справочнике уже есть — заводить не надо,
   *  достаточно привязать операции. */
  inDictionary: boolean;
}

type ModalState =
  | { kind: "create" }
  | { kind: "rename"; row: Row }
  | { kind: "delete"; rows: Row[] }
  /** Привязка получателя под другим именем: «11043 MOP SBP» → «Магнит». */
  | { kind: "adopt"; payee: OrphanPayee }
  | null;

export function CounterpartyManager() {
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);

  const renames = useCounterpartyEditsStore((s) => s.renames);
  const created = useCounterpartyEditsStore((s) => s.created);
  const deleted = useCounterpartyEditsStore((s) => s.deleted);
  const merges = useCounterpartyEditsStore((s) => s.merges);
  const loaded = useCounterpartyEditsStore((s) => s.loaded);
  const hydrate = useCounterpartyEditsStore((s) => s.hydrate);

  const transactions = useDataStore((s) => s.transactions);
  const showDrill = useDrillStore((s) => s.show);

  const [cached, setCached] = useState<Counterparty[] | null | "loading">("loading");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("title");
  // «Дубли» view — the flat list is replaced by the duplicate groups.
  const [dupOnly, setDupOnly] = useState(false);
  // «Без контрагента» view — получатели из операций, которых нет в справочнике.
  const [orphanOnly, setOrphanOnly] = useState(false);
  const [orphanSel, setOrphanSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // (Re)load merchants from cache; re-runs after a sync so pushed rows refresh.
  useEffect(() => {
    let alive = true;
    getCounterpartiesFromCache().then((d) => {
      if (alive) setCached(d);
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  const deletedSet = useMemo(() => new Set(deleted), [deleted]);

  /** Every counterparty, unfiltered — the search must not narrow the set a
   *  transfer can pick from, nor what a bulk action reasons about. */
  const allRows = useMemo<Row[]>(() => {
    const base = Array.isArray(cached) ? cached : [];
    const fromCache: Row[] = base.map((m) => ({
      id: m.id,
      title: renames[m.id] ?? m.title,
      count: m.count,
      txIds: m.txIds,
      isNew: false,
      isRenamed: renames[m.id] !== undefined,
      isDeleted: deletedSet.has(m.id),
      mergedInto: merges[m.id],
    }));
    const fromDrafts: Row[] = created.map((c) => ({
      id: c.id,
      title: c.title,
      count: 0,
      txIds: [],
      isNew: true,
      isRenamed: false,
      isDeleted: false,
    }));
    // Count sorts keep a stable alphabetical tiebreak, so equal counts don't
    // shuffle between renders.
    const all = [...fromCache, ...fromDrafts].sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title, "ru");
      if (sort === "count-desc") return b.count - a.count || byTitle;
      if (sort === "count-asc") return a.count - b.count || byTitle;
      return byTitle;
    });
    return all;
  }, [cached, renames, created, deletedSet, merges, sort]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    return q ? allRows.filter((r) => r.title.toLowerCase().includes(q)) : allRows;
  }, [allRows, query]);

  // Duplicate groups, computed over the FULL list (a search must not change
  // what counts as a duplicate). Rows already queued for deletion or a merge
  // are out — their fate is decided. The survivor is the row holding the most
  // operations, so the merge moves as few of them as possible.
  const dupGroups = useMemo<DupGroup[]>(() => {
    const base = Array.isArray(cached) ? cached : [];
    const byKey = new Map<string, Row[]>();
    for (const m of base) {
      if (deletedSet.has(m.id) || merges[m.id] !== undefined) continue;
      const row: Row = {
        id: m.id,
        title: renames[m.id] ?? m.title,
        count: m.count,
        txIds: m.txIds,
        isNew: false,
        isRenamed: renames[m.id] !== undefined,
        isDeleted: false,
      };
      const k = dupKey(row.title);
      const arr = byKey.get(k);
      if (arr) arr.push(row);
      else byKey.set(k, [row]);
    }
    const out: DupGroup[] = [];
    for (const [key, arr] of byKey) {
      if (arr.length < 2) continue;
      const sorted = [...arr].sort(
        (a, b) => b.count - a.count || a.id.localeCompare(b.id)
      );
      out.push({
        key,
        survivor: sorted[0],
        dups: sorted.slice(1),
        total: arr.reduce((n, r) => n + r.count, 0),
      });
    }
    return out.sort(
      (a, b) => b.total - a.total || a.survivor.title.localeCompare(b.survivor.title, "ru")
    );
  }, [cached, renames, deletedSet, merges]);

  // Обратная сторона справочника: получатели, которые есть в операциях, но
  // контрагента под собой не имеют. В Дзен-мани у операции два поля — ссылка на
  // контрагента (`merchant`, у нас `brand`) и свободный текст от банка
  // (`payee`). Пока ссылки нет, получатель живёт строкой: его не переименовать
  // разом, не объединить с дублями и не найти в справочнике.
  const orphanPayees = useMemo<OrphanPayee[]>(() => {
    const live = new Set(
      allRows
        .filter((r) => !r.isDeleted && r.mergedInto === undefined)
        .map((r) => dupKey(r.title))
    );
    const byKey = new Map<string, OrphanPayee>();
    for (const t of transactions) {
      if (t.brand && t.brand.trim()) continue; // контрагент уже привязан
      const title = (t.payee || "").trim();
      if (!title) continue;
      const key = dupKey(title);
      const cur = byKey.get(key);
      if (cur) {
        cur.count += 1;
        cur.txIds.push(t.id);
      } else {
        byKey.set(key, {
          title,
          count: 1,
          txIds: [t.id],
          inDictionary: live.has(key),
        });
      }
    }
    return [...byKey.values()].sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title, "ru")
    );
  }, [transactions, allRows]);

  // Разобрали всех — возвращаемся к справочнику: кнопка отбора исчезает вместе
  // с последней строкой, и вид остался бы пустым без выхода.
  useEffect(() => {
    if (orphanPayees.length === 0) setOrphanOnly(false);
  }, [orphanPayees.length]);

  // Selection is scoped to what's visible; drop ids that vanished (filtered
  // out, pushed away) so the bulk bar never acts on stale rows.
  // Список показываем порциями по мере прокрутки страницы: контрагентов бывают
  // сотни, а собственная прокрутка внутри карточки означала бы две полосы
  // прокрутки сразу.
  const lazy = useLazyList(rows, 100);
  // Те же порции у вспомогательных видов: дублей и «без контрагента» тоже
  // бывают сотни.
  const lazyDups = useLazyList(dupGroups, 60);
  const lazyOrphans = useLazyList(orphanPayees, 100);

  const visibleIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds]
  );
  const allSelected = rows.length > 0 && selectedVisible.length === rows.length;
  // Operations behind the selection — deleting these counterparties clears the
  // получатель on exactly this many rows.
  const selectedOps = useMemo(() => {
    const ids = new Set(selectedVisible);
    return rows.reduce((n, r) => (ids.has(r.id) ? n + r.count : n), 0);
  }, [rows, selectedVisible]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Double-click a row to rename it — but not when the click landed on a
   *  control inside the row (checkbox, count, pencil, trash), and not on a row
   *  already queued for deletion. */
  function onRowDoubleClick(e: React.MouseEvent, row: Row) {
    if ((e.target as HTMLElement).closest("button, input, a, select")) return;
    if (row.isDeleted) return;
    setModal({ kind: "rename", row });
  }

  /** Open the operations of a counterparty in the shared drill drawer. Matches
   *  by transaction id (from the raw cache) — precise even when two merchants
   *  share a title. */
  function openOperations(row: Row) {
    if (row.count === 0) return;
    const ids = new Set(row.txIds);
    const txs = transactions.filter((t) => ids.has(t.id));
    if (txs.length === 0) return;
    showDrill(row.title, txs, "Контрагент");
  }

  /** Counterparties that can take over someone else's operations: everything
   *  live except the rows being deleted. Unpushed drafts are excluded — the
   *  merge builder resolves the target against the CACHE, and a draft isn't
   *  there yet, so the transfer would be silently skipped. */
  function transferTargets(doomed: Row[]): TransferTarget[] {
    const out = new Set(doomed.map((d) => d.id));
    return allRows
      .filter((r) => !out.has(r.id) && !r.isNew && !r.isDeleted && !r.mergedInto)
      .map((r) => ({ id: r.id, title: r.title, count: r.count }));
  }

  function removeOne(row: Row) {
    setModal({ kind: "delete", rows: [row] });
  }

  function removeSelected() {
    const ids = new Set(selectedVisible);
    const picked = rows.filter((r) => ids.has(r.id));
    if (picked.length === 0) return;
    setModal({ kind: "delete", rows: picked });
  }

  /** Fold one group's duplicates into its survivor. */
  async function mergeGroup(g: DupGroup) {
    await useCounterpartyEditsStore
      .getState()
      .mergeMany(g.dups.map((d) => ({ id: d.id, survivorId: g.survivor.id })));
  }

  /** Fold every duplicate group at once — the point of the whole view when an
   *  account has hundreds of them. */
  async function mergeAllGroups() {
    if (dupGroups.length === 0) return;
    const dupCount = dupGroups.reduce((n, g) => n + g.dups.length, 0);
    const moving = dupGroups.reduce(
      (n, g) => n + g.dups.reduce((m, d) => m + d.count, 0),
      0
    );
    const ok = await confirm({
      title: `Объединить ${formatNum(dupGroups.length)} ${pluralRu(dupGroups.length, ["группу", "группы", "групп"])} дублей?`,
      message: `Лишних записей: ${formatNum(dupCount)}. У ${formatNum(moving)} ${pluralRu(moving, ["операции", "операций", "операций"])} получатель переедет на оставшегося контрагента, дубли удалятся. Всё уйдёт в Дзен-мани при отправке в облако.`,
      confirmLabel: "Объединить",
    });
    if (!ok) return;
    await useCounterpartyEditsStore.getState().mergeMany(
      dupGroups.flatMap((g) =>
        g.dups.map((d) => ({ id: d.id, survivorId: g.survivor.id }))
      )
    );
  }

  /**
   * Завести контрагентов под выбранных получателей и привязать к ним операции.
   *
   * Две записи, а не одна: контрагент уходит в справочник, а операции получают
   * правку «Получатель» — тем же слоем, что и правка из редактора операции,
   * поэтому её видно в списке на отправку и можно откатить построчно. Если
   * контрагент с таким названием уже есть, заводим только связь.
   */
  async function adoptPayees(items: OrphanPayee[], renameTo?: string) {
    if (items.length === 0) return;
    // Имя, под которым получатель попадёт в справочник и в операции. Своё имя
    // задаётся только для одной строки — переименовать пачку одним словом
    // нечем.
    const targetOf = (o: OrphanPayee) => (renameTo ?? "").trim() || o.title;
    const liveKeys = new Set(
      allRows
        .filter((r) => !r.isDeleted && r.mergedInto === undefined)
        .map((r) => dupKey(r.title))
    );
    const ops = items.reduce((n, o) => n + o.count, 0);
    const toCreate = items.filter((o) => !liveKeys.has(dupKey(targetOf(o))));
    const ok = await confirm({
      title: renameTo?.trim()
        ? `Привязать как «${renameTo.trim()}»?`
        : `Привязать ${formatNum(items.length)} ${pluralRu(items.length, ["получателя", "получателей", "получателей"])}?`,
      message:
        (renameTo?.trim()
          ? `У операций получатель сменится с «${items[0].title}» на «${renameTo.trim()}». `
          : "") +
        (toCreate.length > 0
          ? `В справочнике появится ${formatNum(toCreate.length)} ${pluralRu(toCreate.length, ["новая запись", "новые записи", "новых записей"])}` +
            (toCreate.length < items.length ? ", остальные уже есть. " : ". ")
          : "Все записи в справочнике уже есть. ") +
        `Контрагент проставится у ${formatNum(ops)} ${pluralRu(ops, ["операции", "операций", "операций"])} — вместо текста от банка там будет ссылка на запись справочника. ` +
        "Всё уйдёт в Дзен-мани при отправке в облако; до неё правки можно откатить в списке изменений.",
      confirmLabel: "Привязать",
    });
    if (!ok) return;
    await useCounterpartyEditsStore.getState().addManyNew(
      toCreate.map((o) => ({ id: crypto.randomUUID(), title: targetOf(o) }))
    );
    const patches: Record<string, TransactionEdit> = {};
    for (const o of items) {
      const target = targetOf(o);
      for (const id of o.txIds) patches[id] = { brand: target };
    }
    await useEditsStore.getState().setEditEach(patches);
    // Правки надо наложить на набор, иначе разобранные получатели останутся в
    // списке до перезагрузки — как это делает и редактор операции.
    await useDataStore.getState().reapplyRules();
    setOrphanSel(new Set());
  }

  // CSV mode — no Zenmoney cache, nothing to edit / sync.
  if (cached === null) {
    return (
      <p className="text-sm text-muted">
        Справочник контрагентов доступен только в режиме Дзен-мани API — нужен
        живой список и синхронизация. Подключите Дзен-мани в настройках.
      </p>
    );
  }

  // Bare content — the card + heading come from OperationsSettings.
  return (
    <div className="space-y-3">
      {/* Toolbar: search + «?» info popover + pending/reset/push + Добавить. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-panel2 rounded-lg px-2 py-1 border border-border flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск контрагента…"
            className="bg-transparent text-sm flex-1 outline-none min-w-0"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-xs text-muted hover:text-text"
              aria-label="Очистить поиск"
            >
              ✕
            </button>
          )}
        </div>

        <InfoPopover label="Как это работает">
                <p>
                  <strong className="text-text">Контрагент</strong> — это запись
                  в справочнике: «Магнит», «Пятёрочка». Операция на неё
                  ссылается. А банк часто присылает получателя просто строкой —
                  «MAGNIT 7712 MOSCOW»; запись под такую строку Дзен-мани сам не
                  заводит, и операция остаётся без контрагента.
                </p>
                <p>
                  Разница простая. Запись переименовали один раз — новое имя
                  встало сразу во всех её операциях. Со строкой так не выйдет:
                  «SPAR 317» и «SPAR317» так и останутся двумя разными
                  получателями, и в отчётах будут двумя строками.
                </p>
                <p>
                  Здесь контрагента можно{" "}
                  <strong className="text-text">переименовать</strong> (карандаш
                  или двойной клик по строке),{" "}
                  <strong className="text-text">удалить</strong> и{" "}
                  <strong className="text-text">добавить</strong> нового. Всё
                  копится локально и уезжает в Дзен-мани при отправке в облако.
                </p>
                <p>
                  В столбце <strong className="text-text">«Операций»</strong>{" "}
                  видно, сколько операций на него ссылается. При удалении их
                  можно{" "}
                  <strong className="text-text">перенести на другого</strong> —
                  так же делается и замена контрагента. Если не переносить,
                  получатель у этих операций сотрётся, и после отправки в облако
                  обратно его не вернуть.
                </p>
                <p>
                  <strong className="text-text">«Без контрагента»</strong> — те
                  самые получатели-строки. Карандаш даёт задать имя: например,
                  свести «MAGNIT 7712 MOSCOW» к уже заведённому «Магниту». Значок
                  с плюсом заводит контрагента прямо под этим именем. В обоих
                  случаях получатель проставится во всех операциях строки, а если
                  запись с таким именем уже есть — операции просто привяжутся к
                  ней. Правку видно в списке изменений, откатить можно
                  построчно.
                </p>
                <p>
                  <strong className="text-text">«Дубли»</strong> — записи с
                  одинаковым именем: Дзен-мани заводит отдельную под каждое
                  написание получателя, и их набираются сотни.{" "}
                  <strong className="text-text">Объединение</strong> сводит их в
                  одну — операции переезжают на самую крупную, лишние удаляются.
                </p>
              </InfoPopover>

        {orphanPayees.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setOrphanOnly((v) => !v);
              setDupOnly(false);
            }}
            aria-pressed={orphanOnly}
            title="Получатели, которые есть в операциях, но записи в справочнике под собой не имеют"
            className={clsx(
              "text-sm flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0",
              orphanOnly
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-text hover:bg-panel2"
            )}
          >
            <UserPlus className="w-4 h-4" />
            Без контрагента
            <span className="tabular-nums">{formatNum(orphanPayees.length)}</span>
          </button>
        )}
        {dupGroups.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDupOnly((v) => !v);
              setOrphanOnly(false);
            }}
            aria-pressed={dupOnly}
            title="Контрагенты с одинаковым названием"
            className={clsx(
              "text-sm flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0",
              dupOnly
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-text hover:bg-panel2"
            )}
          >
            <Combine className="w-4 h-4" />
            Дубли
            <span className="tabular-nums">{formatNum(dupGroups.length)}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setModal({ kind: "create" })}
          className="btn-primary text-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* Floating bulk-action bar — same shape as Операции and the drawer:
          pinned bottom-centre, count on top, actions underneath. */}
      {selectedVisible.length > 0 && (
        <div
          role="region"
          aria-label="Массовые действия"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 rounded-xl border border-border bg-panel shadow-xl max-w-[calc(100vw-1.5rem)] overflow-hidden"
        >
          {/* Row 1: how many rows, and how many operations they hold — the
              latter is what actually gets its получатель cleared. */}
          <div className="flex items-center justify-center gap-x-4 gap-y-1 flex-wrap px-4 pt-2.5 pb-2 text-sm">
            <span>
              Выбрано:{" "}
              <strong className="tabular-nums">{formatNum(selectedVisible.length)}</strong>
            </span>
            {selectedOps > 0 && (
              <span className="tabular-nums text-muted border-l border-border pl-4">
                операций: {formatNum(selectedOps)}
              </span>
            )}
          </div>
          {/* Row 2: actions. */}
          <div className="flex items-center justify-center gap-2 flex-wrap px-4 pb-2.5 pt-2 border-t border-border">
            <button onClick={removeSelected} className="btn-danger text-sm">
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
        </div>
      )}

      {/* «Дубли»: Дзен-мани keeps a separate merchant row per payee spelling, so
          an account collects hundreds of same-named entries — usually one with
          all the operations and one empty. Each group folds into the row that
          holds the most operations. */}
      {dupOnly && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-panel">
            {/* One fact only: how many rows the merge removes. The group count
                is already on the «Дубли N» toolbar chip. */}
            <div className="text-sm min-w-0">
              Лишних записей:{" "}
              <strong className="tabular-nums">
                {formatNum(dupGroups.reduce((n, g) => n + g.dups.length, 0))}
              </strong>
            </div>
            <button onClick={mergeAllGroups} className="btn-primary text-sm shrink-0">
              <Combine className="w-4 h-4" />
              Объединить все
            </button>
          </div>
          <div
            style={{ fontSize: "var(--tbl-font)" }}
          >
            {/* Column header — the counts need a name, and the fixed widths
                below keep them (and the buttons) on one grid. */}
            <div className="sticky top-0 z-10 bg-panel border-b border-border flex items-center gap-3 px-3 py-2 text-[0.85em] text-muted uppercase tracking-wide">
              <span className="flex-1 min-w-0">Контрагент</span>
              <span className="w-20 shrink-0 text-right">Операций</span>
              <span className="w-36 shrink-0 text-right">Действия</span>
            </div>
            <div className="divide-y divide-border/60">
            {lazyDups.visible.map((g) => (
              <div key={g.key} className="px-3 py-2 flex items-start gap-3">
                {/* Survivor first, then the copies — each on its own line with
                    its own operations count, so it's obvious what moves where. */}
                <div className="min-w-0 flex-1 space-y-1">
                  {[g.survivor, ...g.dups].map((row, i) => {
                    const isSurvivor = i === 0;
                    return (
                      <div key={row.id} className="flex items-center gap-2 min-w-0">
                        <span
                          className={clsx(
                            "truncate",
                            !isSurvivor && "line-through text-muted"
                          )}
                        >
                          {row.title}
                        </span>
                        {isSurvivor && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                            останется
                          </span>
                        )}
                        <span className="flex-1 min-w-2" />
                        <span className="w-20 shrink-0 text-right">
                          {row.count ? (
                            <button
                              onClick={() => openOperations(row)}
                              title="Показать операции контрагента"
                              className="tabular-nums text-muted hover:text-accent hover:underline px-1 rounded"
                            >
                              {formatNum(row.count)}
                            </button>
                          ) : (
                            <span className="text-muted tabular-nums px-1">—</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <span className="w-36 shrink-0 flex justify-end">
                  <button
                    onClick={() => mergeGroup(g)}
                    title="Объединить в одного контрагента"
                    className="btn-ghost text-sm"
                  >
                    <Combine className="w-3.5 h-3.5" />
                    Объединить
                  </button>
                </span>
              </div>
            ))}
            </div>
          </div>
        </div>
      )}

      {orphanOnly && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-panel">
            {/* Объяснение прямо тут, а не только под «?»: вопрос «а что это
                вообще такое» возникает ровно на этом экране. */}
            <div className="text-sm min-w-0">
              <div>
                Операций без контрагента:{" "}
                <strong className="tabular-nums">
                  {formatNum(orphanPayees.reduce((n, o) => n + o.count, 0))}
                </strong>
              </div>
              <div className="text-xs text-muted">
                Получатель у них — текст от банка, а не запись справочника
              </div>
            </div>
            <button
              onClick={() =>
                adoptPayees(
                  orphanSel.size > 0
                    ? orphanPayees.filter((o) => orphanSel.has(dupKey(o.title)))
                    : orphanPayees
                )
              }
              className="btn-primary text-sm shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              {orphanSel.size > 0
                ? `Привязать выбранных (${formatNum(orphanSel.size)})`
                : "Привязать всех"}
            </button>
          </div>
          <div
            style={{ fontSize: "var(--tbl-font)" }}
          >
            <div className="sticky top-0 z-10 bg-panel border-b border-border flex items-center gap-3 px-3 py-2 text-[0.85em] text-muted uppercase tracking-wide">
              <span className="w-6 shrink-0 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={
                    orphanPayees.length > 0 && orphanSel.size === orphanPayees.length
                  }
                  onChange={() =>
                    setOrphanSel((s) =>
                      s.size === orphanPayees.length
                        ? new Set()
                        : new Set(orphanPayees.map((o) => dupKey(o.title)))
                    )
                  }
                  aria-label="Выделить все"
                  className="accent-[var(--accent)] cursor-pointer"
                />
              </span>
              <span className="flex-1 min-w-0">Получатель</span>
              <span className="w-20 shrink-0 text-right">Операций</span>
              <span className="w-20 shrink-0 text-center whitespace-nowrap">Действия</span>
            </div>
            <div className="divide-y divide-border/60">
              {lazyOrphans.visible.map((o) => {
                const key = dupKey(o.title);
                return (
                  <div key={key} className="px-3 py-2 flex items-center gap-3">
                    <span className="w-6 shrink-0 flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={orphanSel.has(key)}
                        onChange={() =>
                          setOrphanSel((s) => {
                            const next = new Set(s);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                        aria-label={`Выбрать «${o.title}»`}
                        className="accent-[var(--accent)] cursor-pointer"
                      />
                    </span>
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="truncate">{o.title}</span>
                      {/* Такой контрагент уже заведён — значит операции просто не
                          связаны с ним, и заводить второго не нужно. */}
                      {o.inDictionary && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-panel2 text-muted shrink-0">
                          есть в справочнике
                        </span>
                      )}
                    </span>
                    <span className="w-20 shrink-0 text-right">
                      <button
                        onClick={() => {
                          const ids = new Set(o.txIds);
                          showDrill(
                            o.title,
                            transactions.filter((t) => ids.has(t.id)),
                            "Получатель"
                          );
                        }}
                        title="Показать операции этого получателя"
                        className="tabular-nums text-muted hover:text-accent hover:underline px-1 rounded"
                      >
                        {formatNum(o.count)}
                      </button>
                    </span>
                    {/* Два действия, как и в основной таблице: под своим именем
                        и «как есть». Банковскую строку почти всегда хочется
                        переименовать, поэтому карандаш стоит первым. */}
                    <span className="w-20 shrink-0 flex items-center justify-center gap-0.5">
                      <button
                        onClick={() => setModal({ kind: "adopt", payee: o })}
                        title={`Привязать под другим именем — например, к уже заведённому контрагенту`}
                        aria-label={`Привязать «${o.title}» под другим именем`}
                        className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => adoptPayees([o])}
                        title={
                          o.inDictionary
                            ? `Проставить контрагента «${o.title}» в ${formatNum(o.count)} ${pluralRu(o.count, ["операции", "операциях", "операциях"])} — запись в справочнике уже есть`
                            : `Завести контрагента «${o.title}» и проставить его в ${formatNum(o.count)} ${pluralRu(o.count, ["операции", "операциях", "операциях"])}`
                        }
                        aria-label={`Привязать получателя «${o.title}» как есть`}
                        className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!dupOnly && !orphanOnly && (
      <div className="border border-border rounded-lg overflow-hidden">
        <div style={{ fontSize: "var(--tbl-font)" }}>
          <div className="sticky top-0 z-10 bg-panel border-b border-border flex items-center gap-3 px-3 py-2 text-[0.85em] text-muted uppercase tracking-wide">
            <span className="w-6 shrink-0 flex items-center justify-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Выделить все"
                className="accent-[var(--accent)] cursor-pointer"
              />
            </span>
            <span className="flex-1 min-w-0">Название</span>
            <span className="w-24 shrink-0 flex items-center justify-center">
              <CountSortHeader sort={sort} onChange={setSort} />
            </span>
            <span className="w-20 shrink-0 text-center whitespace-nowrap">Действия</span>
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">
              {cached.length === 0 && created.length === 0
                ? "Контрагенты не найдены."
                : "Ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {lazy.visible.map((row) => {
                // A merged row is on its way out too — same struck-through
                // treatment as a delete, but it says where the operations went.
                const gone = row.isDeleted || row.mergedInto !== undefined;
                return (
                <div
                  key={row.id}
                  onDoubleClick={(e) => onRowDoubleClick(e, row)}
                  title={gone ? undefined : "Двойной клик — редактирование"}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-1.5 hover:bg-panel2/40 select-none",
                    gone && "opacity-50"
                  )}
                >
                  <span className="w-6 shrink-0 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Выбрать ${row.title}`}
                      className="accent-[var(--accent)] cursor-pointer"
                    />
                  </span>
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    {row.isRenamed && !gone && (
                      <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                    )}
                    <span className={clsx("truncate", gone && "line-through")}>
                      {row.title}
                    </span>
                    {row.isNew && !gone && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                        новый
                      </span>
                    )}
                    {row.isDeleted && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-expense/10 text-expense shrink-0">
                        удалён
                      </span>
                    )}
                    {row.mergedInto && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                        объединён
                      </span>
                    )}
                  </span>
                  <span className="w-24 shrink-0 flex items-center justify-center">
                    {row.count ? (
                      <button
                        onClick={() => openOperations(row)}
                        title="Показать операции контрагента"
                        className="tabular-nums text-muted hover:text-accent hover:underline px-1 rounded"
                      >
                        {formatNum(row.count)}
                      </button>
                    ) : (
                      <span className="text-muted tabular-nums">—</span>
                    )}
                  </span>
                  {/* Both actions in ONE cell — keeps them together under the
                      «Действия» header instead of drifting a gap apart. */}
                  <span className="w-20 shrink-0 flex items-center justify-center gap-0.5">
                    <button
                      onClick={() => setModal({ kind: "rename", row })}
                      disabled={gone}
                      title="Переименовать"
                      aria-label="Переименовать контрагента"
                      className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {gone ? (
                      <button
                        onClick={() => useCounterpartyEditsStore.getState().restore(row.id)}
                        title={row.mergedInto ? "Отменить объединение" : "Отменить удаление"}
                        aria-label={
                          row.mergedInto ? "Отменить объединение" : "Отменить удаление"
                        }
                        className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => removeOne(row)}
                        title="Удалить"
                        aria-label="Удалить контрагента"
                        className="p-1.5 rounded-md text-muted hover:text-expense hover:bg-expense/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </span>
                </div>
                );
              })}
              {lazy.hasMore && (
                <div
                  ref={lazy.sentinelRef}
                  className="px-3 py-3 text-center text-xs text-muted"
                >
                  Показано {lazy.shown} из {lazy.total} — прокрутите дальше, чтобы
                  загрузить ещё
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {modal && modal.kind !== "delete" && (
        <CounterpartyModal
          row={modal.kind === "rename" ? modal.row : undefined}
          payee={modal.kind === "adopt" ? modal.payee : undefined}
          existing={rows.map((r) => ({ id: r.id, title: r.title }))}
          onAdopt={(title) =>
            modal.kind === "adopt" ? adoptPayees([modal.payee], title) : undefined
          }
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "delete" && (
        <CounterpartyDeleteModal
          targets={modal.rows.map((r) => ({
            id: r.id,
            title: r.title,
            count: r.count,
            isNew: r.isNew,
          }))}
          options={transferTargets(modal.rows)}
          onClose={() => {
            setModal(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/** Create / rename dialog — a single «Название» field, in the app's style.
 *  В режиме привязки (`payee`) то же поле отвечает на другой вопрос: под каким
 *  именем получатель попадёт в справочник и в операции. */
function CounterpartyModal({
  row,
  payee,
  existing,
  onAdopt,
  onClose,
}: {
  row?: Row;
  payee?: OrphanPayee;
  existing: { id: string; title: string }[];
  onAdopt?: (title: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(row?.title ?? payee?.title ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  const trimmed = title.trim();
  const duplicate = existing.some(
    (e) => e.id !== row?.id && e.title.toLowerCase() === trimmed.toLowerCase()
  );
  // При привязке совпадение с существующим — не ошибка, а второй сценарий:
  // операции уедут на уже заведённого контрагента, нового не появится.
  const canSave = payee
    ? trimmed.length > 0
    : trimmed.length > 0 && !duplicate && trimmed !== row?.title;

  async function save() {
    if (!canSave) return;
    if (payee) {
      await onAdopt?.(trimmed);
      onClose();
      return;
    }
    const store = useCounterpartyEditsStore.getState();
    if (row) {
      if (row.isNew) await store.renameNew(row.id, trimmed);
      else await store.rename(row.id, trimmed);
      // Правила ссылаются на контрагента ТЕКСТОМ, а не записью справочника.
      // Не перепиши мы их здесь — правило продолжило бы требовать старое имя,
      // которого в справочнике уже нет: правка не приживается, а «ждут записи»
      // не гаснет (issue #60).
      await useCategoryRulesStore.getState().renamePayee(row.title, trimmed);
    } else {
      await store.addNew({ id: crypto.randomUUID(), title: trimmed });
    }
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-modal-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border rounded-t-2xl">
          <div id="cp-modal-title" className="font-semibold">
            {payee
              ? "Привязать получателя"
              : row
                ? "Редактирование контрагента"
                : "Новый контрагент"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {payee && (
            <p className="text-xs text-muted mb-3">
              Сейчас у{" "}
              <strong className="text-text tabular-nums">
                {formatNum(payee.count)}
              </strong>{" "}
              {pluralRu(payee.count, ["операции", "операций", "операций"])}{" "}
              получатель — текст от банка «{payee.title}». Задайте имя, под которым
              их собрать: можно оставить как есть или выбрать уже заведённого
              контрагента.
            </p>
          )}
          <label htmlFor="cp-name" className="label block mb-1">
            Название
          </label>
          {/* В привязке — с подсказками из справочника: чаще всего банковскую
              строку нужно свести к уже существующему контрагенту. */}
          {payee ? (
            <Combobox
              value={title}
              options={existing.map((e) => e.title)}
              onChange={setTitle}
              placeholder="Например, Магнит у дома"
            />
          ) : (
            <input
              id="cp-name"
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Например, Магнит у дома"
              autoComplete="off"
              className="input w-full text-sm"
            />
          )}
          {duplicate && (
            <p className={clsx("text-xs mt-1", payee ? "text-muted" : "text-warn")}>
              {payee
                ? "Такой контрагент уже есть — операции привяжутся к нему, новая запись не появится."
                : "Контрагент с таким названием уже есть."}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="btn-primary text-sm"
          >
            {payee ? "Привязать" : row ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
