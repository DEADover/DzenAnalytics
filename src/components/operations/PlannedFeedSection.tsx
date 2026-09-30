import { useMemo, useState } from "react";
import {
  CalendarCheck,
  CalendarClock,
  ArrowLeft,
  ChevronRight,
  Link2,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../../types";
import { formatDate } from "../../lib/format";
import { pluralRu } from "../../lib/plural";
import { plannedAsTransaction, type PlannedOp } from "../../lib/plannedOps";
import { usePlannedFeed, type PlannedFeedCounts } from "../../hooks/usePlannedFeed";
import { useDisplayStore } from "../../store/useDisplayStore";
import { usePlannedDeletionsStore } from "../../store/usePlannedDeletionsStore";
import { confirm } from "../../store/useConfirmStore";
import { operationTone } from "../../lib/txKindStyle";
import { TONE_CLASS } from "../table/tableKit";
import { EditTransactionModal } from "../EditTransactionModal";
import { MenuItem } from "../MenuItem";
import { Popover } from "../Popover";
import { OperationListRow } from "./OperationList";
import { OperationAmount, OperationCategory, OperationComment, OperationPayee } from "./OperationCells";
import { PlanLinkModal } from "./PlanLinkModal";
import { PlanEditModal } from "./PlanEditModal";

/** «6 октября, через 6 дней» / «28 сентября, просрочено на 2 дня» — как у Дзен-мани. */
function dayTitle(ymd: string, today: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const label = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const days = Math.round((Date.parse(ymd) - Date.parse(today)) / 86_400_000);
  if (days === 0) return `${label}, сегодня`;
  if (days === 1) return `${label}, завтра`;
  if (days > 0) return `${label}, через ${days} ${pluralRu(days, ["день", "дня", "дней"])}`;
  const late = -days;
  return `${label}, просрочено на ${late} ${pluralRu(late, ["день", "дня", "дней"])}`;
}

/** Подпись плана для списка изменений и подтверждений. */
function planTitle(p: PlannedOp): string {
  return p.payee || p.comment || p.category || (p.kind === "transfer" ? "Перевод" : "План");
}

type Counts = PlannedFeedCounts;

/** «Просрочено 4 · до конца месяца 3 · до конца года 25 · всего 34». */
function CountsLine({ counts }: { counts: Counts }) {
  const part = (label: string, n: number, tone?: string) => (
    <span className={clsx("whitespace-nowrap", tone)}>
      {label} <span className="tabular-nums font-medium">{n}</span>
    </span>
  );
  return (
    <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-muted">
      {counts.overdue > 0 && part("Просрочено", counts.overdue, "text-expense")}
      {part("До конца месяца", counts.month)}
      {part("До конца года", counts.year)}
      {part("Всего", counts.total)}
    </span>
  );
}

/**
 * Строка «Запланировано» над лентой: сколько планов просрочено и сколько
 * осталось до конца месяца, года и всего. Щелчок переключает ленту в режим
 * «только запланированные» — как вкладка «Будущие» в приложении Дзен-мани.
 */
export function PlannedSummaryRow({ onOpen }: { onOpen: () => void }) {
  const enabled = useDisplayStore((s) => s.feedPlanned);
  const { ops, counts } = usePlannedFeed();
  if (!enabled || ops.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Показать только запланированные операции"
      className="w-full px-4 py-2 border-b border-border bg-panel2/60 flex items-center gap-3 text-sm text-left hover:bg-panel2"
    >
      <CalendarClock className="w-4 h-4 text-accent shrink-0" aria-hidden />
      <span className="font-semibold shrink-0">Запланировано</span>
      <CountsLine counts={counts} />
      <ChevronRight className="w-4 h-4 text-muted ml-auto shrink-0" aria-hidden />
    </button>
  );
}

/**
 * Лента в режиме «только запланированные»: все планы Дзен-мани — просроченные
 * и будущие до последней даты, что есть (примерно год вперёд), по дням, от
 * ближайших. По щелчку — те же действия, что в приложении.
 *
 * Строки — те же ячейки и та же сетка, что у ленты: план должен читаться
 * «операцией, которой ещё нет», а не отдельной таблицей. Прогнозы Дзен-мани
 * помечены: их можно закрыть фактом, но просроченными они не бывают — старая
 * догадка не то, с чем надо что-то делать (как на главной, #87).
 */
export function PlannedFeedList({
  template,
  grouped,
  query,
  onBack,
}: {
  template: string;
  /** Лента разбита по дням — тогда и планы идут с заголовками дней, без колонки даты. */
  grouped: boolean;
  /** Быстрый поиск ленты — ищет и по планам. */
  query: string;
  onBack: () => void;
}) {
  const { ops, today, counts } = usePlannedFeed(query);
  const [menu, setMenu] = useState<{ op: PlannedOp; anchor: HTMLElement } | null>(null);
  const [fact, setFact] = useState<PlannedOp | null>(null);
  const [link, setLink] = useState<PlannedOp | null>(null);
  const [edit, setEdit] = useState<PlannedOp | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, PlannedOp[]>();
    for (const p of ops) {
      const list = m.get(p.date) ?? [];
      list.push(p);
      m.set(p.date, list);
    }
    return [...m.entries()];
  }, [ops]);

  async function removeDate(p: PlannedOp) {
    const oneOff = p.repeating === false;
    const ok = await confirm({
      title: oneOff ? "Удалить план?" : `Удалить план на ${formatShort(p.date)}?`,
      message: oneOff
        ? "Это разовый план — он удалится целиком."
        : "Уберётся только эта дата, остальные повторения останутся.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    await usePlannedDeletionsStore
      .getState()
      .remove({ id: p.id, wholePlan: oneOff, date: p.date, title: planTitle(p) });
  }

  async function removeChain(p: PlannedOp) {
    const ok = await confirm({
      title: "Удалить всю цепочку?",
      message: "Удалится сам план со всеми будущими повторениями. Проведённые операции останутся.",
      confirmLabel: "Удалить цепочку",
      tone: "danger",
    });
    if (!ok) return;
    await usePlannedDeletionsStore
      .getState()
      .remove({ id: p.id, wholePlan: true, date: p.date, title: planTitle(p) });
  }

  const renderRow = (p: PlannedOp) => {
    const tx: Transaction = plannedAsTransaction(p);
    const late = p.date < today;
    return (
      <OperationListRow
        key={p.id}
        template={template}
        selected={menu?.op.id === p.id}
        // Щелчок по строке открывает то же меню, что и «⋯» — как касание в
        // приложении Дзен-мани. Выделять план незачем: массовых действий у
        // планов нет.
        onToggleSelect={() => {
          const btn = document.querySelector<HTMLElement>(`[data-plan-menu="${p.id}"]`);
          if (btn) setMenu({ op: p, anchor: btn });
        }}
        className="[&_.op-muted]:opacity-60"
      >
        <span className="grid place-items-center" aria-hidden>
          <CalendarClock className={clsx("w-4 h-4", late ? "text-expense" : "text-muted")} />
        </span>
        {!grouped && (
          <div className={clsx("tabular-nums whitespace-nowrap", late ? "text-expense" : "text-muted")}>
            {formatShort(p.date)}
          </div>
        )}
        <div className="op-muted min-w-0 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <OperationCategory tx={tx} edited={false} />
          </div>
          {p.forecast && (
            <span
              className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted"
              title="Прогноз Дзен-мани по регулярному платежу"
            >
              Прогноз
            </span>
          )}
        </div>
        <div className="op-muted truncate" title={p.toAccount ? `${p.account} → ${p.toAccount}` : p.account}>
          {p.toAccount ? `${p.account} → ${p.toAccount}` : p.account}
        </div>
        <div className="op-muted min-w-0">
          <OperationPayee tx={tx} />
        </div>
        <div className="op-muted min-w-0">
          <OperationComment text={p.comment} />
        </div>
        <div
          className={`op-muted text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
        >
          <OperationAmount tx={tx} />
        </div>
        <div className="flex items-center justify-center">
          <button
            type="button"
            className="btn-icon"
            data-plan-menu={p.id}
            aria-label="Действия с запланированной операцией"
            title="Сохранить как факт, связать, изменить или удалить"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ op: p, anchor: e.currentTarget });
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </OperationListRow>
    );
  };

  const anchorRef = { current: menu?.anchor ?? null };
  const m = menu?.op;

  return (
    <div className="border-b border-border">
      <div className="px-4 py-2 border-b border-border bg-panel2/60 flex items-center gap-3 text-sm flex-wrap">
        <button type="button" onClick={onBack} className="btn-ghost text-sm !px-2 -ml-2">
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Все операции
        </button>
        <CalendarClock className="w-4 h-4 text-accent shrink-0" aria-hidden />
        <span className="font-semibold">Запланированные</span>
        <CountsLine counts={counts} />
        {counts.last && (
          <span className="ml-auto text-muted whitespace-nowrap">по {formatDate(counts.last, "full")}</span>
        )}
      </div>
      {ops.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted text-center">
          {query.trim() ? "Среди запланированных ничего не найдено" : "Запланированных операций нет"}
        </p>
      )}
      {(grouped
          ? byDay.map(([ymd, list]) => (
              <div key={ymd}>
                <div
                  className={clsx(
                    "px-4 py-1.5 border-b border-border/60 text-[13px]",
                    ymd < today ? "text-expense" : "text-muted"
                  )}
                >
                  {dayTitle(ymd, today)}
                </div>
                {list.map(renderRow)}
              </div>
            ))
          : ops.map(renderRow))}

      <Popover
        open={!!menu}
        anchorRef={anchorRef}
        onClose={() => setMenu(null)}
        align="right"
        className="card p-1 w-72 text-sm"
      >
        {m && (
          <>
            <MenuItem
              icon={CalendarCheck}
              onClick={() => {
                setMenu(null);
                setFact(m);
              }}
            >
              Сохранить как факт
            </MenuItem>
            <MenuItem
              icon={Link2}
              onClick={() => {
                setMenu(null);
                setLink(m);
              }}
            >
              Связать план с фактом
            </MenuItem>
            <MenuItem
              icon={Pencil}
              onClick={() => {
                setMenu(null);
                setEdit(m);
              }}
            >
              Изменить
            </MenuItem>
            <div className="border-t border-border my-1" />
            <MenuItem
              icon={X}
              danger
              onClick={() => {
                setMenu(null);
                void removeDate(m);
              }}
            >
              {m.repeating === false ? "Удалить план" : `Удалить план на ${formatShort(m.date)}`}
            </MenuItem>
            {m.repeating !== false && (
              <MenuItem
                icon={X}
                danger
                onClick={() => {
                  setMenu(null);
                  void removeChain(m);
                }}
              >
                Удалить всю цепочку
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      {fact && (
        <EditTransactionModal
          key={`fact-${fact.id}`}
          template={plannedAsTransaction(fact)}
          planMarker={{ id: fact.id, date: fact.date, title: planTitle(fact) }}
          onClose={() => setFact(null)}
        />
      )}
      {link && <PlanLinkModal plan={link} title={planTitle(link)} onClose={() => setLink(null)} />}
      {edit && <PlanEditModal plan={edit} title={planTitle(edit)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function formatShort(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}
