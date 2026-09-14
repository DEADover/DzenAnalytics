import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Select } from "./Select";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  History,
  Trash2,
  HelpCircle,
} from "lucide-react";
import {
  useSyncLogStore,
  type SyncLogEntry,
  type SyncLogStatus,
} from "../store/useSyncLogStore";
import { confirm } from "../store/useConfirmStore";
import { InfoPopover } from "./InfoPopover";
import { ExpandChevron, HeadCell } from "./table/TableParts";
import { cellClass } from "./table/tableKit";
import { useDisplayStore } from "../store/useDisplayStore";
import { pluralRu } from "../lib/plural";
import { Callout } from "./Callout";
import { Badge } from "./Badge";
import { formatFixed } from "../lib/format";

/**
 * Sync log table.
 *
 * Columns:
 *   • Тип            — human-readable kind: "Синхронизация", "Полная
 *                       синхронизация", "Push в облако", …
 *   • Дата-время     — full localized timestamp.
 *   • Новых          — for pulls: delta.transactions (new/changed).
 *                       For pushes: accepted (sent successfully).
 *                       For snapshots / restores: "—".
 *   • Всего          — total transactions in local cache *after* the op.
 *                       Lets the user see "did the count grow?".
 *   • Длительность   — wall-clock duration in ms / s.
 *   • Статус         — "Успешно" / "Частично" / "Ошибка" with colour.
 *
 * Click a row to expand: shows error text (for errors) + skipped items
 * (for partial pushes). Status / type icons let the user scan the table
 * vertically without reading every label.
 *
 * Pagination: 10 / 20 / 50 / 100 per page (default 10). Buttons appear
 * only when there's more than one page.
 */

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

interface SyncLogProps {
  /** Render bare (no card, lighter heading) — for embedding inside the
   *  «Двусторонняя синхронизация с Дзен-мани» card instead of standing as its
   *  own section. */
  embedded?: boolean;
  /** Live status (queue size, last push…) shown on the heading line. Rendered
   *  in a fixed-height slot so the row doesn't jump as the text changes. */
  status?: ReactNode;
}

export function SyncLog({ embedded, status }: SyncLogProps = {}) {
  const entries = useSyncLogStore((s) => s.entries);
  const loaded = useSyncLogStore((s) => s.loaded);
  const hydrate = useSyncLogStore((s) => s.hydrate);
  const clear = useSyncLogStore((s) => s.clear);

  // Раскрыт ли журнал. Живёт в настройках оформления: вид должен пережить
  // перезагрузку, вернуться при следующем заходе и попасть в копию данных.
  const open = useDisplayStore((d) => d.syncLogOpen);
  const setOpen = useDisplayStore((d) => d.setSyncLogOpen);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  // Clamp page if entries shrink (e.g. after Clear) so we never end up
  // on an empty page.
  const safePage = Math.min(page, totalPages);
  if (safePage !== page) {
    // setState during render is fine here because it's idempotent —
    // React will short-circuit on the next pass.
    setTimeout(() => setPage(safePage), 0);
  }

  const visible = useMemo(
    () => entries.slice((safePage - 1) * pageSize, safePage * pageSize),
    [entries, safePage, pageSize]
  );

  // Reserve the chevron slot only when something on THIS page can actually
  // expand — otherwise every «Тип» cell carried an empty 20px indent that the
  // header didn't have, so the column read as misaligned.
  const anyExpandable = useMemo(
    () =>
      visible.some(
        (e) => !!e.error || (e.details?.skipped && e.details.skipped.length > 0)
      ),
    [visible]
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={embedded ? undefined : "card card-pad"}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Заголовок — кнопка: журнал свёрнут по умолчанию, это отладочная
            история, её открывают, когда что-то пошло не так. */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left"
        >
          <ChevronRight
            className={`w-4 h-4 shrink-0 text-muted transition-transform duration-500 ease-in-out ${
              open ? "rotate-90" : ""
            }`}
          />
          <History className={embedded ? "w-5 h-5 text-accent" : "w-5 h-5 text-accent2"} />
          <span className="font-medium">
            {embedded ? "Журнал синхронизаций" : "Лог синхронизаций"}
          </span>
          {/* Record count as a labelled chip — a bare «· 8» next to the title
              didn't say what it counted, and blended into the status text. */}
          {entries.length > 0 && (
            <span className="pill text-muted tabular-nums shrink-0">
              {formatN(entries.length)}{" "}
              {pluralRu(entries.length, ["запись", "записи", "записей"])}
            </span>
          )}
        </button>
        {/* Live status sits on the heading line. The slot keeps its height even
            while empty, so the row never jumps as the text changes. */}
        {status !== undefined && (
          <div className="text-xs text-muted flex-1 min-w-0 min-h-5 flex items-center">
            {status}
          </div>
        )}
        {/* Размер страницы и очистка относятся к самому списку: пока он
            свёрнут, чистить вслепую незачем. Но и выдёргивать их из потока
            нельзя: `hidden` возвращал их в раскладку ровно в тот кадр, когда
            поехала высота, и кнопки выскакивали рывком. Гасим прозрачностью —
            место остаётся за ними, шапка не перестраивается.

            На узком экране всё же убираем совсем: там шапка переносится, и
            невидимая строка кнопок держала бы у свёрнутого журнала лишние
            полсантиметра высоты — ровно та пустота, от которой избавляемся.
            `inert` убирает их из обхода клавиатурой, пока они не видны. */}
        <div
          inert={!open}
          className={`flex items-center gap-3 transition-opacity duration-500 ease-in-out ${
            open ? "opacity-100" : "opacity-0 pointer-events-none max-sm:hidden"
          }`}
        >
          <label className="text-xs text-muted flex items-center gap-2">
            Записей на странице:
            <Select
              size="sm"
              className="w-20"
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              ariaLabel="Записей на странице"
            />
          </label>
          {entries.length > 0 && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Очистить лог?",
                  message:
                    "История синхронизаций будет удалена. Действие необратимо.",
                  confirmLabel: "Очистить",
                  tone: "danger",
                });
                if (ok) await clear();
              }}
              className="btn-ghost text-xs text-muted"
              title="Удалить все записи"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистить
            </button>
          )}
        </div>
      </div>

      {/* Раскрытие через сетку `0fr → 1fr`: `max-height` наугад либо режет
          длинный список, либо тормозит на коротком, а `<details>` высоту не
          анимирует вовсе. Тот же приём, что у таблицы сравнения бэкапов. */}
      <div
        className={`grid transition-[grid-template-rows] duration-500 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* Отступ под заголовком — ВНУТРИ раскрывающейся части, а не `mb-3` у
            шапки: снаружи он оставался и в свёрнутом виде, и под строкой висела
            пустая полоса. Прозрачность идёт вместе с высотой — содержимое
            проявляется, а не проступает разом в щели. */}
        <div
          className={`overflow-hidden transition-opacity duration-500 ease-in-out ${
            open ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="pt-3">
      {entries.length === 0 ? (
        <p className="text-xs text-muted">
          История пуста. После первой синхронизации, push'а или снимка
          сюда упадут записи о результатах.
        </p>
      ) : (
        <>
          <div>
            <table className="w-full">
              <thead>
                <tr>
                  {/* «Тип» забирает остаток ширины, остальные колонки — по
                      содержимому: числа и статус остаются справа плотной группой. */}
                  <HeadCell type="text" label="Тип" className="w-full" />
                  <HeadCell type="date" label="Дата и время" className="w-px" />
                  <HeadCell
                    type="count"
                    className="w-px hidden md:table-cell"
                    label={
                      <span className="inline-flex items-center gap-1">
                        Новых операций
                        <InfoPopover label="Что считается">
                          <p>
                            Сколько записей пришло от сервера в этом синке. Для
                            синхронизации — новые и изменённые операции, для
                            полной — весь объём целиком, включая удалённые и
                            нулевые служебные записи. Для отправки — сколько правок
                            ушло в облако.
                          </p>
                        </InfoPopover>
                      </span>
                    }
                  />
                  <HeadCell
                    type="count"
                    className="w-px hidden md:table-cell"
                    label={
                      <span className="inline-flex items-center gap-1">
                        Всего операций
                        <InfoPopover label="Что считается">
                          <p>
                            Сколько операций видно в приложении после синка:
                            удалённые и нулевые служебные записи отфильтрованы.
                            Поэтому при полной синхронизации это число может быть
                            меньше «Новых операций».
                          </p>
                        </InfoPopover>
                      </span>
                    }
                  />
                  <HeadCell type="number" label="Длительность" className="w-px hidden md:table-cell" />
                  <HeadCell type="mark" label="Статус" className="w-px" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e, i) => (
                  <LogTableRow
                    key={e.id ?? `row-${i}`}
                    entry={e}
                    expanded={expanded.has(e.id)}
                    onToggle={() => toggle(e.id)}
                    reserveChevron={anyExpandable}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            // Стрелки и счётчик — одной группой по центру. Прежде счётчик стоял
            // у левого края, а кнопки у правого: на широкой карточке между ними
            // была тысяча пикселей, и связать «Страница 2 из 7» с кнопками,
            // которые её меняют, было нечем.
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-muted">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="btn-ghost btn-square disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Предыдущая"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="tabular-nums whitespace-nowrap">
                  Страница {safePage} из {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="btn-ghost btn-square disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Следующая"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogTableRow({
  entry,
  expanded,
  onToggle,
  reserveChevron,
}: {
  entry: SyncLogEntry;
  expanded: boolean;
  onToggle: () => void;
  /** True when some row on this page is expandable — keeps titles aligned. */
  reserveChevron: boolean;
}) {
  const hasDetails =
    !!entry.error ||
    (entry.details?.skipped && entry.details.skipped.length > 0);

  // "Новых": for pulls = delta.transactions (new/changed); for pushes =
  // accepted (sent to cloud). Snapshots/restores have no semantic value
  // here so we render an em-dash.
  const newCount =
    entry.kind === "pull"
      ? entry.details?.counts?.transactions
      : entry.kind === "push"
        ? entry.details?.counts?.accepted
        : undefined;
  const totalCount = entry.details?.counts?.total;

  return (
    <>
      <tr
        onClick={hasDetails ? onToggle : undefined}
        className={hasDetails ? "cursor-pointer hover:bg-panel2/50" : undefined}
      >
        {/* Шеврон раскрытия — внутри ячейки «Тип», перед названием, как в
            дереве любой таблицы. Итог записи — той же строкой, приглушённо. */}
        <td className={cellClass("text")}>
          <div className="flex items-center gap-1.5 min-w-0">
            {reserveChevron &&
              (hasDetails ? (
                <ExpandChevron open={expanded} />
              ) : (
                <span className="w-4 shrink-0" aria-hidden />
              ))}
            <span className="truncate" title={entry.summary ? `${entry.title} · ${capitalize(entry.summary)}` : entry.title}>
              {entry.title}
              {entry.summary && <span className="text-muted"> · {capitalize(entry.summary)}</span>}
            </span>
          </div>
        </td>
        <td className={cellClass("date")}>{new Date(entry.ts).toLocaleString("ru-RU")}</td>
        <td className={cellClass("count", { className: "hidden md:table-cell" })}>
          {newCount !== undefined ? formatN(newCount) : "—"}
        </td>
        <td className={cellClass("count", { className: "hidden md:table-cell" })}>
          {totalCount !== undefined ? formatN(totalCount) : "—"}
        </td>
        <td className={cellClass("number", { muted: true, className: "hidden md:table-cell" })}>
          {typeof entry.durationMs === "number" ? formatDuration(entry.durationMs) : "—"}
        </td>
        <td className={cellClass("mark")}>
          <StatusBadge status={entry.status} />
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-panel2/30">
          {/* Отступ — до начала названия над строкой: поле 12 + шеврон 16 + промежуток 6. */}
          <td colSpan={6} className="table-td pl-[34px] pr-3 py-3">
            <div className="text-xs space-y-2">
              {entry.error && (
                <Callout tone="expense">
                  <span className="whitespace-pre-wrap break-words font-mono text-[11px] text-expense">
                    {entry.error}
                  </span>
                </Callout>
              )}
              {entry.details?.skipped && entry.details.skipped.length > 0 && (
                <details>
                  <summary className="text-accent cursor-pointer hover:underline">
                    Пропущенные правки ({entry.details.skipped.length})
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1 -mx-1 px-1">
                    {entry.details.skipped.map((s) => (
                      <div
                        key={s.id}
                        className="py-1 border-b border-border/40 last:border-b-0 text-muted"
                      >
                        <div className="font-mono text-[10px] truncate">
                          {s.id}
                        </div>
                        <div>{s.reason}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}


function StatusBadge({ status }: { status: SyncLogStatus }) {
  const conf = {
    ok: {
      Icon: CheckCircle2,
      label: "Успешно",
      tone: "income" as const,
    },
    partial: {
      Icon: AlertCircle,
      label: "Частично",
      tone: "warn" as const,
    },
    error: {
      Icon: AlertTriangle,
      label: "Ошибка",
      tone: "expense" as const,
    },
  }[status];
  // Незнакомый статус — не повод ронять всю страницу настроек: запись могла
  // прийти из другой версии или пережить сбой записи. Показываем нейтральный
  // значок с самим значением, чтобы было видно, что именно не распозналось.
  const { Icon, label, tone } = conf ?? {
    Icon: HelpCircle,
    label: String(status || "—"),
    tone: "neutral" as const,
  };
  return (
    <Badge tone={tone} icon={Icon}>
      {label}
    </Badge>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function formatN(n: number): string {
  return n.toLocaleString("ru-RU");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  if (ms < 60_000) return `${formatFixed(ms / 1000)} с`;
  return `${Math.floor(ms / 60_000)} мин ${Math.floor((ms % 60_000) / 1000)} с`;
}
