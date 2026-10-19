import { useMemo } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { pluralRu } from "../../lib/plural";
import { formatMoney } from "../../lib/format";
import { plannedAsTransaction, type PlannedOp } from "../../lib/plannedOps";
import { usePlanRows } from "../../hooks/usePlanRows";
import { usePlannedFeed, type PlannedFeedCounts } from "../../hooks/usePlannedFeed";
import { useDisplayStore } from "../../store/useDisplayStore";
import { useDataStore } from "../../store/useDataStore";
import { DayHeader, NetPill } from "./DayHeader";

/** «Через 6 дней» / «Просрочено на 2 дня» — как у Дзен-мани; сегодня — без пометки. */
function dayNote(ymd: string, today: string): string | null {
  const days = Math.round((Date.parse(ymd) - Date.parse(today)) / 86_400_000);
  if (days === 0) return null;
  if (days === 1) return "Завтра";
  if (days > 0) return `Через ${days} ${pluralRu(days, ["день", "дня", "дней"])}`;
  const late = -days;
  return `Просрочено на ${late} ${pluralRu(late, ["день", "дня", "дней"])}`;
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
  // В режиме «В ленте» планы стоят среди операций — строка над лентой не нужна.
  const enabled = useDisplayStore((s) => s.feedPlanned && s.feedPlannedMode === "bar");
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
  const rows = usePlanRows(template);
  const renderRow = (p: PlannedOp) => rows.renderRow(p, grouped);

  const overdueOps = useMemo(() => ops.filter((p) => p.date < today), [ops, today]);
  const sections = useMemo(() => {
    const upcoming = ops.filter((p) => p.date >= today);
    return [
      { key: "overdue", title: "Просрочено", ops: overdueOps },
      { key: "upcoming", title: "Предстоящие", ops: upcoming },
    ].filter((sec) => sec.ops.length > 0);
  }, [ops, overdueOps, today]);

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

      {rows.overlay}
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

