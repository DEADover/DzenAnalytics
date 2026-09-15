import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Trash2, Undo2, X } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDeletedPayloadsStore } from "../store/useDeletedPayloadsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { applyEdits } from "../lib/applyEdits";
import { cacheToDiffResponse } from "../lib/zenmoneyCache";
import { getZenCache, peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import { collectDeletedOperations, type DeletedEntry } from "../lib/deletedOperations";
import { formatDate, formatNum, displayPayee } from "../lib/format";
import { operationTone } from "../lib/txKindStyle";
import { DataTable, type Column } from "../components/DataTable";
import { scaledWidth } from "../components/table/tableKit";
import { OperationAmount, OperationCategory, OperationPayee } from "../components/operations/OperationCells";
import { PageHeader } from "../components/PageHeader";
import { SectionControls } from "../components/SectionControls";
import { Segmented } from "../components/Segmented";
import { SearchInput } from "../components/SearchInput";
import { StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { Callout } from "../components/Callout";
import { Badge } from "../components/Badge";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import type { Transaction } from "../types";

const HINT = "Верните операцию, если её удалили по ошибке";

// Колонки — как в ленте «Операции»: дата, категория, счёт, контрагент,
// комментарий, сумма, действия. Ширина у всех, кроме комментария: он берёт
// остаток. Таблица не уже суммы колонок и 7rem на комментарий — дальше
// прокрутка, а не комментарий в одну букву. Растёт вместе с размером текста,
// как и сами колонки.
const CLOUD_MIN_WIDTH = scaledWidth("82rem");
const LOCAL_MIN_WIDTH = scaledWidth("73.5rem");

/**
 * «Удалённые» — операции, удалённые в Дзен-мани, и возврат их обратно.
 *
 * Прежде раздел назывался «Корзина» и показывал только наши удаления. Но
 * Дзен-мани сам хранит каждую удалённую операцию с пометкой `deleted: true` —
 * удалённую в его приложении, на сайте или у нас, — и раздел теперь про них
 * (`collectDeletedOperations`).
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

type Period = "7d" | "30d" | "12m" | "all";
const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "12m", label: "12 мес" },
  { value: "all", label: "Всё" },
];
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "7d": 7, "30d": 30, "12m": 365 };
const PERIOD_NOTE: Record<Period, string> = {
  "7d": "За 7 дней",
  "30d": "За 30 дней",
  "12m": "За 12 месяцев",
  all: "За всё время",
};

type DeletedRow = DeletedEntry & { tx: Transaction };

/** День удаления в формате операции — чтобы показать его тем же `formatDate`. */
function dayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  const [period, setPeriod] = useState<Period>("30d");
  const [query, setQuery] = useState("");
  // «Сейчас» — на открытие страницы: границы периода не должны ползти при
  // каждой перерисовке, а страницу, открытую сутками, никто не держит.
  const [now] = useState(() => Date.now());

  // Разбор тем же `mapZenmoneyDiff`, что и живые операции: категория,
  // получатель, счёт и сумма в списке выглядят ровно как в ленте.
  const rows = useMemo<DeletedRow[]>(() => {
    if (!cache) return [];
    const entries = collectDeletedOperations({ cache, payloads, deletedIds, deletedAt });
    if (entries.length === 0) return [];
    const mapped = mapZenmoneyDiff(
      cacheToDiffResponse({ ...cache, transactions: entries.map((e) => e.zen) })
    ).transactions;
    const byId = new Map(mapped.map((t) => [t.id, t]));
    return entries.flatMap((e) => {
      const tx = byId.get(e.id);
      return tx ? [{ ...e, tx }] : [];
    });
  }, [cache, payloads, deletedIds, deletedAt]);

  const visible = useMemo(() => {
    const cutoff = period === "all" ? null : now - PERIOD_DAYS[period] * 86_400_000;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff !== null && (r.deletedAt === null || r.deletedAt < cutoff)) return false;
      if (!q) return true;
      return [displayPayee(r.tx), r.tx.comment, r.tx.categoryFull, r.tx.account].some(
        (v) => v && v.toLowerCase().includes(q)
      );
    });
  }, [rows, period, query, now]);

  const twins = visible.filter((r) => r.status === "deleted" && r.hasTwin).length;
  const pending = visible.filter((r) => r.status !== "deleted").length;
  const restorable = visible.filter((r) => r.status !== "restore-pending");
  const restoresWaiting = rows.some((r) => r.status === "restore-pending");

  async function restore(list: DeletedRow[]) {
    const ids = list.filter((r) => r.status !== "restore-pending").map((r) => r.id);
    if (ids.length === 0) return;
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
      if (!ok) return;
    } else if (ids.length > 1) {
      const ok = await confirm({
        title: `Вернуть ${formatNum(ids.length)} ${accusativeOps(ids.length)}?`,
        message: "Удалённые в Дзен-мани появятся там снова — копиями со всеми полями.",
        confirmLabel: "Вернуть",
      });
      if (!ok) return;
    }
    await restoreDeleted(ids);
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
            здесь и уйдут в Дзен-мани со следующей отправкой. Период считается по
            дате удаления.
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

  const columns: Column<DeletedRow>[] = [
    {
      key: "deletedAt",
      type: "date",
      width: "7.5rem",
      label: "Удалена",
      headerTitle: "Когда операцию удалили",
      sortValue: (r) => r.deletedAt ?? 0,
      exportValue: (r) => (r.deletedAt ? dayOf(r.deletedAt) : ""),
      render: (r) => (r.deletedAt ? formatDate(dayOf(r.deletedAt), "full") : "—"),
    },
    {
      key: "date",
      type: "date",
      width: "7rem",
      label: "Дата",
      sortValue: (r) => r.tx.date,
      render: (r) => formatDate(r.tx.date, "full"),
    },
    {
      key: "category",
      type: "text",
      width: "13rem",
      label: "Категория",
      sortValue: (r) => r.tx.categoryFull,
      cellTitle: () => "",
      render: (r) => <OperationCategory tx={r.tx} edited={false} />,
    },
    {
      key: "account",
      type: "text",
      muted: true,
      width: "9rem",
      label: "Счёт",
      sortValue: (r) => r.tx.account,
      render: (r) => r.tx.account,
    },
    {
      key: "payee",
      type: "text",
      width: "12rem",
      label: "Контрагент",
      sortValue: (r) => displayPayee(r.tx),
      cellTitle: () => "",
      render: (r) => <OperationPayee tx={r.tx} />,
    },
    {
      key: "comment",
      type: "text",
      muted: true,
      label: "Комментарий",
      sortValue: (r) => r.tx.comment || "",
      render: (r) => r.tx.comment || "",
    },
    {
      key: "amount",
      type: "main",
      tone: (r) => operationTone(r.tx),
      width: "9rem",
      label: "Сумма",
      sortValue: (r) => r.tx.amountBase,
      render: (r) => <OperationAmount tx={r.tx} />,
    },
    {
      key: "status",
      type: "mark",
      width: "8.5rem",
      label: "Статус",
      sortValue: (r) => (r.status === "deleted" ? (r.hasTwin ? 1 : 0) : 2),
      exportValue: (r) => statusText(r),
      render: (r) => <StatusBadge row={r} />,
    },
    {
      key: "action",
      type: "actions",
      width: "9rem",
      label: "Действия",
      render: (r) =>
        r.status === "restore-pending" ? (
          <button
            onClick={() => cancelRestore([r.id])}
            className="btn-ghost text-xs whitespace-nowrap -my-2"
            title="Не возвращать: операция останется удалённой"
          >
            <X className="w-3.5 h-3.5" />
            Отменить
          </button>
        ) : (
          <button
            onClick={() => restore([r])}
            className="btn-ghost text-xs whitespace-nowrap -my-2"
            title={
              r.status === "delete-pending"
                ? "Не удалять: удаление ещё не отправлено в Дзен-мани"
                : "Вернуть в Дзен-мани копией со всеми полями"
            }
          >
            <Undo2 className="w-3.5 h-3.5" />
            Вернуть
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      <SectionControls>
        <Segmented label="Период удаления" value={period} onChange={setPeriod} options={PERIODS} />
      </SectionControls>

      {pushMode === "off" && restoresWaiting && (
        <Callout size="banner" tone="warn">
          Отправка в Дзен-мани выключена: возвращённые операции уйдут туда, когда
          вы включите двустороннюю синхронизацию в настройках.
        </Callout>
      )}

      <StatRow>
        <StatCell label="Удалено" value={formatNum(visible.length)} note={PERIOD_NOTE[period]} />
        <StatCell
          label="Есть такая же"
          value={formatNum(twins)}
          tone={twins > 0 ? "warn" : "default"}
          note="Возврат задвоит операцию"
        />
        <StatCell
          label="Ждут отправки"
          value={formatNum(pending)}
          tone={pending > 0 ? "accent" : "default"}
          note="Возвраты и удаления отсюда"
        />
      </StatRow>

      <DataTable<DeletedRow>
        icon={Trash2}
        title="Удалённые операции"
        data={visible}
        rowKey={(r) => r.id}
        defaultSortKey="deletedAt"
        defaultSortDir="desc"
        limit={50}
        exportName="deleted"
        fixed
        minWidth={CLOUD_MIN_WIDTH}
        emptyText={query ? "Ничего не нашлось" : "За этот период ничего не удаляли"}
        actions={
          <>
            <SearchInput
              size="sm"
              value={query}
              onChange={setQuery}
              placeholder="Быстрый поиск по таблице…"
              title="Ищет по получателю, комментарию, категории и счёту"
              ariaLabel="Поиск по удалённым"
              className="w-64 max-sm:w-full"
            />
            {restorable.length > 1 && (
              <button onClick={() => restore(restorable)} className="btn-ghost text-xs whitespace-nowrap">
                <Undo2 className="w-3.5 h-3.5" />
                Вернуть все ({formatNum(restorable.length)})
              </button>
            )}
          </>
        }
        columns={columns}
      />
    </div>
  );
}

function statusText(r: DeletedRow): string {
  if (r.status === "restore-pending") return "Вернётся";
  if (r.status === "delete-pending") return "Удаление ждёт отправки";
  return r.hasTwin ? "Есть такая же" : "";
}

function StatusBadge({ row }: { row: DeletedRow }) {
  if (row.status === "restore-pending") {
    return (
      <Badge tone="accent" title="Копия уйдёт в Дзен-мани со следующей отправкой">
        Вернётся
      </Badge>
    );
  }
  if (row.status === "delete-pending") {
    return (
      <Badge tone="neutral" title="Удалена здесь, в Дзен-мани пока живая">
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
  return null;
}

// ── Без Дзен-мани: спрятанные у нас ─────────────────────────────────────────

function LocalDeleted() {
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const rates = useDataStore((s) => s.rates);
  const restoreTransaction = useDataStore((s) => s.restoreTransaction);
  const restoreTransactionMany = useDataStore((s) => s.restoreTransactionMany);
  const purgeDeleted = useDataStore((s) => s.purgeDeleted);
  const edits = useEditsStore((s) => s.edits);
  const deletedSet = useDeletedStore((s) => s.deletedSet);

  const rows = useMemo(() => {
    if (deletedSet.size === 0) return [];
    return applyEdits(transactionsRaw, edits, rates)
      .filter((t) => deletedSet.has(t.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactionsRaw, edits, rates, deletedSet]);

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

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Trash2} title="Удалённые" hint={HINT} />
        <SectionEmpty icon={Trash2} title="Удалённых операций нет">
          Удалить операцию можно в ленте «Операции» или в её карточке.
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="Удалённые"
        hint={HINT}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => restoreTransactionMany(rows.map((t) => t.id))}
              className="btn-ghost text-xs"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Вернуть все ({formatNum(rows.length)})
            </button>
            <button onClick={handlePurge} className="btn-danger text-xs">
              <Trash2 className="w-3.5 h-3.5" />
              Удалить окончательно
            </button>
          </div>
        }
      />

      <DataTable<Transaction>
        icon={Trash2}
        title="Удалённые операции"
        data={rows}
        rowKey={(t) => t.id}
        defaultSortKey="date"
        exportName="deleted"
        fixed
        minWidth={LOCAL_MIN_WIDTH}
        columns={[
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
            render: (t) => <OperationCategory tx={t} edited={false} />,
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
            sortValue: (t) => displayPayee(t),
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
            render: (t) => <OperationAmount tx={t} />,
          },
          {
            key: "restore",
            type: "actions",
            width: "8.5rem",
            label: "Действия",
            render: (t) => (
              <button
                onClick={() => restoreTransaction(t.id)}
                className="btn-ghost text-xs whitespace-nowrap -my-2"
                title="Вернуть операцию"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Вернуть
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
