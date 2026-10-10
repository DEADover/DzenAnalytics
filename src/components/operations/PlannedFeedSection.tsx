import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../../types";
import { pluralRu } from "../../lib/plural";
import { formatMoney } from "../../lib/format";
import { plannedAsTransaction, type PlannedOp } from "../../lib/plannedOps";
import { usePlannedFeed, type PlannedFeedCounts } from "../../hooks/usePlannedFeed";
import { useDisplayStore } from "../../store/useDisplayStore";
import { useDataStore } from "../../store/useDataStore";
import { usePlannedDeletionsStore } from "../../store/usePlannedDeletionsStore";
import { confirm } from "../../store/useConfirmStore";
import { operationTone } from "../../lib/txKindStyle";
import { TONE_CLASS } from "../table/tableKit";
import { EditTransactionModal } from "../EditTransactionModal";
import { MenuItem } from "../MenuItem";
import { Popover } from "../Popover";
import { OperationListRow } from "./OperationList";
import { DayHeader, NetPill } from "./DayHeader";
import { OperationAmount, OperationCategory, OperationComment, OperationPayee } from "./OperationCells";
import { PlanLinkModal } from "./PlanLinkModal";
import { PlanEditModal } from "./PlanEditModal";

/** «Через 6 дней» / «Просрочено на 2 дня» — как у Дзен-мани; сегодня — без пометки. */
function dayNote(ymd: string, today: string): string | null {
  const days = Math.round((Date.parse(ymd) - Date.parse(today)) / 86_400_000);
  if (days === 0) return null;
  if (days === 1) return "Завтра";
  if (days > 0) return `Через ${days} ${pluralRu(days, ["день", "дня", "дней"])}`;
  const late = -days;
  return `Просрочено на ${late} ${pluralRu(late, ["день", "дня", "дней"])}`;
}

/** Подпись плана для списка изменений и подтверждений. */
function planTitle(p: PlannedOp): string {
  return p.payee || p.comment || p.category || (p.kind === "transfer" ? "Перевод" : "План");
}

type Counts = PlannedFeedCounts;

/** «Просрочено 4 · до конца месяца 3 · до конца года 25 · всего 34». */
function CountsLine({ counts, base }: { counts: Counts; base: string }) {
  const part = (label: string, n: number, tone?: string) => (
    <span className={clsx("whitespace-nowrap", tone)}>
      {label} <span className="tabular-nums font-medium">{n}</span>
    </span>
  );
  return (
    // Одной строкой: перенос менял бы высоту строки «Запланировано».
    <span className="flex items-center gap-x-3 min-w-0 overflow-hidden whitespace-nowrap text-muted text-xs">
      {/* Просроченные — плашкой и первыми: это то, с чем надо что-то
          сделать, остальные числа — просто справка. */}
      {counts.overdue > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-expense/10 text-expense font-medium whitespace-nowrap">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Просрочено <span className="tabular-nums">{counts.overdue}</span>
          {counts.overdueNet !== 0 && (
            <span className="tabular-nums font-normal">
              · {formatMoney(counts.overdueNet, base, { signed: true })}
            </span>
          )}
        </span>
      )}
      {part("До конца месяца", counts.month)}
      {part("До конца года", counts.year)}
      {part("Всего", counts.total)}
    </span>
  );
}

/**
 * Строка «Запланировано» над заголовками колонок — одна на оба состояния
 * ленты, чтобы при переключении ничего не прыгало: та же высота, те же
 * отступы, тот же текст слева. Справа — шеврон: вниз — показать одни запланированные (как «Будущие» в
 * Дзен-мани), вверх — вернуться к операциям.
 */
export function PlannedBar({
  open,
  onToggle,
  query,
}: {
  open: boolean;
  onToggle: () => void;
  /** Быстрый поиск ленты — в открытом виде счётчики считают найденное. */
  query: string;
}) {
  const enabled = useDisplayStore((s) => s.feedPlanned);
  const { ops, counts } = usePlannedFeed(open ? query : "");
  const base = useDataStore((s) => s.rates.base);
  if (!open && (!enabled || ops.length === 0)) return null;
  return (
    <button
      type="button"
      data-tour="planned"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? "Вернуться ко всем операциям" : "Показать только запланированные операции"}
      className="w-full h-10 px-4 border-b border-border bg-panel2/60 flex items-center gap-3 text-sm text-left hover:bg-panel2 transition-colors"
    >
      <span className="font-semibold shrink-0">Запланировано</span>
      <CountsLine counts={counts} base={base} />
      <span className="ml-auto flex items-center gap-3 shrink-0">
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}

/**
 * Лента в режиме «только запланированные»: все планы Дзен-мани — просроченные
 * и будущие до последней даты, что есть (примерно год вперёд), по дням, от
 * ближайших. По «⋯» — те же действия, что в приложении.
 *
 * Строки — те же ячейки и та же сетка, что у ленты: план должен читаться
 * «операцией, которой ещё нет», а не отдельной таблицей. Прогнозы Дзен-мани
 * помечены: их можно закрыть фактом, но просроченными они не бывают — старая
 * догадка не то, с чем надо что-то делать (как на главной, #87).
 */
export function PlannedFeedList({
  template,
  grouped,
  query = "",
  ops: opsProp,
  emptyText,
}: {
  template: string;
  /** Лента разбита по дням — тогда и планы идут с заголовками дней, без колонки даты. */
  grouped: boolean;
  /** Быстрый поиск ленты — ищет и по планам. */
  query?: string;
  /**
   * Свой список планов вместо всех — у «Регулярных» он отобран периодом и
   * вкладкой «План / Прогноз». Не задан — все планы ленты (`usePlannedFeed`).
   */
  ops?: PlannedOp[];
  /** Что сказать, когда показывать нечего. */
  emptyText?: string;
}) {
  const feed = usePlannedFeed(query);
  const ops = opsProp ?? feed.ops;
  const today = feed.today;
  const base = useDataStore((s) => s.rates.base);
  const [menu, setMenu] = useState<{ op: PlannedOp; anchor: HTMLElement } | null>(null);
  const [fact, setFact] = useState<PlannedOp | null>(null);
  const [link, setLink] = useState<PlannedOp | null>(null);
  const [edit, setEdit] = useState<PlannedOp | null>(null);

  const overdueOps = useMemo(() => ops.filter((p) => p.date < today), [ops, today]);
  const sections = useMemo(() => {
    const upcoming = ops.filter((p) => p.date >= today);
    return [
      { key: "overdue", title: "Просрочено", ops: overdueOps },
      { key: "upcoming", title: "Предстоящие", ops: upcoming },
    ].filter((sec) => sec.ops.length > 0);
  }, [ops, overdueOps, today]);

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
        // Действия — только по «⋯»: щелчок по строке ничего не делает, чтобы
        // случайное касание не открывало меню.
        // Будущие — приглушены: их время ещё не пришло. Просроченные — в
        // полную силу, с красной полосой слева и лёгкой заливкой: с ними надо
        // что-то сделать — провести, связать или удалить.
        className={
          late
            ? "bg-expense/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-expense))]"
            : "[&_.op-muted]:opacity-60"
        }
      >
        <span data-cell="select" className="grid place-items-center" aria-hidden>
          <CalendarClock className={clsx("w-4 h-4", late ? "text-expense" : "text-muted")} />
        </span>
        {!grouped && (
          <div className={clsx("tabular-nums whitespace-nowrap", late ? "text-expense" : "text-muted")}>
            {formatShort(p.date)}
          </div>
        )}
        <div data-cell="category" className="op-muted min-w-0 flex items-center gap-2">
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
        <div data-cell="payee" className="op-muted min-w-0">
          <OperationPayee tx={tx} />
        </div>
        <div className="op-muted min-w-0">
          <OperationComment text={p.comment} />
        </div>
        <div
          data-cell="amount"
          className={`op-muted text-right tabular-nums font-medium whitespace-nowrap ${TONE_CLASS[operationTone(tx)]}`}
        >
          <OperationAmount tx={tx} />
        </div>
        <div data-cell="actions" className="flex items-center justify-center">
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
      {ops.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted text-center">
          {emptyText ??
            (query.trim() ? "Среди запланированных ничего не найдено" : "Запланированных операций нет")}
        </p>
      )}
      {/* Дни появляются по очереди сверху вниз — лента «раскрывается»
          из строки «Запланировано», а не подменяется рывком. */}
      <div className="planned-in">
        {sections.map((sec) => [
          // Разделы — только если есть просроченные: иначе заголовок
          // «Предстоящие» над единственным разделом был бы лишним.
          overdueOps.length > 0 && (
            <SectionHead
              key={`h-${sec.key}`}
              title={sec.title}
              ops={sec.ops}
              base={base}
              tone={sec.key === "overdue" ? "danger" : "muted"}
            />
          ),
          ...(grouped
            ? dayGroups(sec.ops).map(([ymd, list]) => (
                <div key={ymd}>
                  {/* Та же шапка дня, что у проведённых операций: дата, день
                      недели и суммы дня — плюс пометка, когда платёж. */}
                  <DayHeader
                    ymd={ymd}
                    txs={list.map(plannedAsTransaction)}
                    base={base}
                    showTransfers
                    note={
                      dayNote(ymd, today) && (
                        <span className={clsx("text-[13px]", ymd < today ? "text-expense" : "text-muted")}>
                          · {dayNote(ymd, today)}
                        </span>
                      )
                    }
                  />
                  {list.map(renderRow)}
                </div>
              ))
            : [<div key={`rows-${sec.key}`}>{sec.ops.map(renderRow)}</div>]),
        ])}
      </div>

      <Popover
        open={!!menu}
        anchorRef={anchorRef}
        onClose={() => setMenu(null)}
        align="right"
        className="card p-1 w-max text-[13px] [&_button]:py-1"
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

/** Планы по дням, в порядке дат. */
function dayGroups(ops: PlannedOp[]): [string, PlannedOp[]][] {
  const m = new Map<string, PlannedOp[]>();
  for (const p of ops) {
    const list = m.get(p.date) ?? [];
    list.push(p);
    m.set(p.date, list);
  }
  return [...m.entries()];
}

/**
 * Заголовок раздела ленты планов — «Просрочено» и «Предстоящие»: сколько
 * операций и их итог. Просроченный — красным, чтобы раздел, с которым надо
 * что-то делать, читался с первого взгляда.
 */
function SectionHead({
  title,
  ops,
  base,
  tone,
}: {
  title: string;
  ops: PlannedOp[];
  base: string;
  tone: "danger" | "muted";
}) {
  const net = ops.reduce(
    (s, p) => s + (p.kind === "income" ? p.amountBase : p.kind === "expense" ? -p.amountBase : 0),
    0
  );
  return (
    <div
      className={clsx(
        "px-4 h-9 flex items-center gap-2 border-b text-xs font-semibold uppercase tracking-wide",
        tone === "danger"
          ? "bg-expense/10 text-expense border-expense/20"
          : "bg-panel text-muted border-border"
      )}
    >
      {tone === "danger" && <AlertCircle className="w-3.5 h-3.5" aria-hidden />}
      {title}
      <span className="font-normal normal-case tracking-normal tabular-nums">
        · {ops.length} {pluralRu(ops.length, ["операция", "операции", "операций"])}
      </span>
      {net !== 0 && (
        <span className="ml-auto flex normal-case tracking-normal">
          <NetPill value={net} base={base} title={`Итог: ${title.toLowerCase()}`} />
        </span>
      )}
    </div>
  );
}

function formatShort(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}
