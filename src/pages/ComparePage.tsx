import { useMemo, useState } from "react";
import { ChevronDown, GitCompare } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  buildHierarchy,
  computeKPI,
  scaleKPI,
  type KPI,
} from "../lib/aggregations";
import { affectsExpense } from "../lib/txKindStyle";
import {
  formatMoney,
  formatPct,
  formatDate,
  formatNum,
  currencySymbol,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { GlobalFilters } from "../components/GlobalFilters";
import { pluralRu } from "../lib/plural";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { MonthPicker } from "../components/MonthPicker";
import { Segmented } from "../components/Segmented";
import { Switch } from "../components/Switch";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import {
  alignWindows,
  comparableRanges,
  isRunningPeriod,
  parseIsoDate,
  periodKey,
  periodRange,
  previousWindows,
  shiftPeriod,
  spanDays,
  toIsoDate,
  yearRange,
  type DayRange,
} from "../lib/period";
import { DateField } from "../components/DateField";
import { CategoryDot } from "../components/CategoryDot";
import { KindSwitcher } from "../components/KindSwitcher";
import { DeviationPill } from "../components/DeviationPill";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import type { Transaction } from "../types";

/** Same logic as `periodKey` but accepts a Date instead of an ISO string. */
function periodKeyFromDate(d: Date, startDay: number): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return periodKey(`${yyyy}-${mm}-${dd}`, startDay);
}

/**
 * «Август 2026» — подпись отчётного месяца по его ключу.
 *
 * Заглавную ставим сами, а не CSS-классом `capitalize`: тот поднимает регистр у
 * КАЖДОГО слова и делал из «август 2026 г.» — «Август 2026 Г.». По той же
 * причине не берём «г.» из `toLocaleDateString` — в подписи периода оно лишнее.
 */
function monthTitle(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "long" });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

type Preset =
  | "months"
  | "years"
  | "avg"
  | "ytd_vs_prev_ytd"
  | "last_30_vs_prev_30"
  | "last_90_vs_prev_90"
  | "custom";

/** Сколько предыдущих месяцев усредняем в режиме «Среднее». */
type AvgMonths = 3 | 6 | 12;

interface Range {
  from: string;
  to: string;
  label: string;
}

/**
 * Что именно сравнивается: два периода и окна, из которых складывается второй.
 *
 * Для обычных пресетов окно у Б ровно одно — сам период. В режиме «Среднее» их
 * несколько: суммы по ним потом делятся на количество, давая «типичный месяц».
 */
interface Comparison {
  a: Range;
  b: Range;
  windowsB: DayRange[];
}

function rangeOf(
  preset: Preset,
  maxDate: string,
  monthStartDay: number = 1,
  /** Отчётные месяцы для пресета «Месяцы» — их выбирает пользователь. */
  months: { a: string; b: string } = { a: "", b: "" },
  /** Отчётные годы для пресета «Годы» — тоже выбирает пользователь. */
  years: { a: number; b: number } = { a: 0, b: 0 }
): { a: Range; b: Range } {
  // Разбор и сборка дат — обе локальные. Раньше здесь смешивались локальный
  // конструктор и `toISOString()`, и «с начала года» уезжало на сутки: в поясе
  // UTC+3 период А начинался 31 декабря прошлого года, а у периода Б
  // отрезался последний день. Проверено запуском в Europe/Moscow.
  const max = parseIsoDate(maxDate);
  const ymd = toIsoDate;

  if (preset === "months") {
    // Respect the user's reporting period: a «month» here is the billing
    // period, not the calendar one. Обрезка по последней операции и
    // выравнивание длин — снаружи, в `comparableRanges`.
    const aRange = periodRange(months.a, monthStartDay);
    const bRange = periodRange(months.b, monthStartDay);
    return {
      a: { ...aRange, label: monthTitle(months.a) },
      b: { ...bRange, label: monthTitle(months.b) },
    };
  }
  if (preset === "years") {
    // Год — тоже отчётный: при своём начале месяца он сдвинут вместе с ним.
    // Обрезка идущего года по последней операции и выравнивание длин — снаружи,
    // в `comparableRanges`, ровно как у «Месяцев».
    const aRange = yearRange(years.a, monthStartDay);
    const bRange = yearRange(years.b, monthStartDay);
    // Подпись — голый год, без слова «год»: она подставляется в фразы вида
    // «2026 против 2025», где «2026 год против 2025 год» звучало бы криво.
    return {
      a: { ...aRange, label: `${years.a}` },
      b: { ...bRange, label: `${years.b}` },
    };
  }
  if (preset === "ytd_vs_prev_ytd") {
    const aFrom = new Date(max.getFullYear(), 0, 1);
    const aTo = max;
    const bFrom = new Date(max.getFullYear() - 1, 0, 1);
    const bTo = new Date(max.getFullYear() - 1, max.getMonth(), max.getDate());
    return {
      a: { from: ymd(aFrom), to: ymd(aTo), label: `${max.getFullYear()} с начала года` },
      b: { from: ymd(bFrom), to: ymd(bTo), label: `${max.getFullYear() - 1} с начала года` },
    };
  }
  if (preset === "last_30_vs_prev_30") {
    const aFrom = new Date(max);
    aFrom.setDate(aFrom.getDate() - 29);
    const bTo = new Date(aFrom);
    bTo.setDate(bTo.getDate() - 1);
    const bFrom = new Date(bTo);
    bFrom.setDate(bFrom.getDate() - 29);
    return {
      a: { from: ymd(aFrom), to: ymd(max), label: "Последние 30 дней" },
      b: { from: ymd(bFrom), to: ymd(bTo), label: "Предыдущие 30 дней" },
    };
  }
  if (preset === "last_90_vs_prev_90") {
    const aFrom = new Date(max);
    aFrom.setDate(aFrom.getDate() - 89);
    const bTo = new Date(aFrom);
    bTo.setDate(bTo.getDate() - 1);
    const bFrom = new Date(bTo);
    bFrom.setDate(bFrom.getDate() - 89);
    return {
      a: { from: ymd(aFrom), to: ymd(max), label: "Последние 90 дней" },
      b: { from: ymd(bFrom), to: ymd(bTo), label: "Предыдущие 90 дней" },
    };
  }
  return {
    a: { from: ymd(max), to: ymd(max), label: "А" },
    b: { from: ymd(max), to: ymd(max), label: "Б" },
  };
}

function inRange(t: Transaction, r: Range): boolean {
  return t.date >= r.from && t.date <= r.to;
}

/**
 * Режимы сравнения. Подсказка у каждого — одной фразой, потому что из самого
 * слова «Среднее» или «30 дней» не следует, ЧТО с чем сравнивается.
 */
const MODE_OPTIONS: { value: Preset; label: string; title: string }[] = [
  { value: "months", label: "Месяцы", title: "Два любых отчётных месяца рядом" },
  { value: "years", label: "Годы", title: "Два любых года рядом — год к году" },
  {
    value: "avg",
    label: "Среднее",
    title: "Месяц против типичного — среднего за 3, 6 или 12 предыдущих",
  },
  {
    value: "last_30_vs_prev_30",
    label: "30 дней",
    title: "Последние 30 дней против предыдущих 30",
  },
  {
    value: "last_90_vs_prev_90",
    label: "90 дней",
    title: "Последние 90 дней против предыдущих 90",
  },
  {
    value: "ytd_vs_prev_ytd",
    label: "С начала года",
    title: "С 1 января по последнюю операцию — против того же куска прошлого года",
  },
  { value: "custom", label: "Свои даты", title: "Два любых отрезка дат" },
];

/** Строки таблицы метрик — одним списком, чтобы четыре почти одинаковых блока
 *  разметки не разъезжались по мелочам, как это уже случилось с кликами. */
const METRICS: {
  key: string;
  label: string;
  hint?: string;
  get: (k: KPI) => number;
  fmt: "money" | "signed" | "count";
  invert?: boolean;
}[] = [
  { key: "income", label: "Доходы", get: (k) => k.income, fmt: "money" },
  { key: "expense", label: "Расходы", get: (k) => k.expense, fmt: "money", invert: true },
  { key: "net", label: "Чистый поток", get: (k) => k.net, fmt: "signed" },
  {
    key: "avg",
    label: "Средний чек расхода",
    hint: "Расход, делённый на число операций. В «Среднем» на месяцы не делится — он и так средний, но на операцию",
    get: (k) => k.avgExpense,
    fmt: "money",
    invert: true,
  },
  { key: "count", label: "Операций", get: (k) => k.count, fmt: "count" },
];

/** Ячейка метрики: кликабельна, когда есть что показать. */
function MetricCell({
  value,
  fmt,
  base,
  onClick,
}: {
  value: number;
  fmt: "money" | "signed" | "count";
  base: string;
  onClick: () => void;
}) {
  const text =
    fmt === "count"
      ? formatNum(Math.round(value))
      : formatMoney(value, base, { signed: fmt === "signed" });
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-right px-3 py-2 tabular-nums whitespace-nowrap hover:text-accent"
    >
      {text}
    </button>
  );
}

/**
 * Строка сравнения по категории — тот же вид, что во вкладке Bars на
 * «Категориях»: иконка, название, полоса и колонки справа.
 *
 * Смысл полосы здесь другой, и это главное: сама полоса — период А, а засечка
 * на ней — период Б. Раньше на этом месте стояли два столбика recharts разной
 * длины, и чтобы понять «стало больше или меньше», глаз должен был сравнивать
 * их между собой в каждой строке. Засечка делает ответ мгновенным: полоса
 * дотянулась за неё — потратили больше обычного.
 */
function CompareBarRow({
  name,
  parent,
  a,
  b,
  count,
  share,
  max,
  color,
  base,
  devPct,
  labelB,
  kind,
  onOpen,
  expandable,
  expanded,
  onToggle,
}: {
  name: string;
  parent?: string;
  a: number;
  b: number;
  count: number;
  share: number;
  max: number;
  color: string;
  base: string;
  devPct: boolean;
  labelB: string;
  /** Расход или доход: у расхода «меньше» — хорошо, у дохода наоборот. */
  kind: "expense" | "income";
  onOpen: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const barPct = max > 0 ? Math.max(0, Math.min(100, (a / max) * 100)) : 0;
  const markPct = max > 0 ? Math.max(0, Math.min(100, (b / max) * 100)) : 0;
  return (
    <div
      className={`flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-panel2/50 cursor-pointer ${
        parent ? "pl-8" : ""
      }`}
      onClick={onOpen}
    >
      <CategoryDot category={name} parent={parent} size="w-7 h-7" />
      <div className="flex-1 min-w-0">
        <div className="truncate" title={parent ? `${parent} / ${name}` : name}>
          {name}
        </div>
        <div className="relative h-2 mt-1 mr-3">
          <div className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${barPct}%`, background: color }}
            />
          </div>
          {b > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-solid border-text/80"
              style={{ left: `${markPct}%`, height: "200%" }}
              title={`${labelB}: ${formatMoney(b, base)}`}
            />
          )}
        </div>
      </div>
      <span className="w-14 text-left tabular-nums shrink-0">
        {formatPct(share, 1)}
      </span>
      <span className="w-20 text-left tabular-nums shrink-0">{count}</span>
      <span className="w-28 text-left tabular-nums shrink-0">
        {formatMoney(a, base)}
      </span>
      <span className="w-28 text-left text-muted tabular-nums shrink-0">
        {b > 0 ? formatMoney(b, base) : "—"}
      </span>
      <span className="w-28 text-left shrink-0">
        <DeviationPill
          current={a}
          baseline={b}
          base={base}
          asPct={devPct}
          kind={kind}
          sameLabel="≈ поровну"
          upTitle="Больше, чем в периоде Б"
          downTitle="Меньше, чем в периоде Б"
        />
      </span>
      <span className="w-8 shrink-0 flex items-center justify-center">
        {expandable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            title={expanded ? "Свернуть" : "Развернуть"}
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            aria-expanded={expanded}
            className="-m-1 p-1 rounded-full text-muted transition-colors hover:text-accent hover:bg-panel2"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-300 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Шапка колонки периода: подпись, контрол выбора и настоящие даты под ним.
 *
 * Выбор стоит ровно над теми цифрами, к которым относится, — отдельной панели
 * настройки на странице больше нет. Там, где выбирать нечего («30 дней», «С
 * начала года»), в контроле стоит слово: нажимаемая на вид, но мёртвая кнопка
 * читается как поломка.
 *
 * Строка дат обязательна. Обрезка периода считается на странице четырьмя
 * разными способами, и ни один не был виден: человек не мог понять, почему в
 * одном режиме «01.08 → 03.08», а в другом «01.08 → 31.08».
 */
function PeriodHead({
  title,
  range,
  suffix,
  children,
}: {
  title: string;
  range: Range;
  /** Уточнение после длины — например «· 3 мес» у среднего. */
  suffix?: string;
  children: React.ReactNode;
}) {
  const days = range.from && range.to ? spanDays(range.from, range.to) : 0;
  const reversed = !!range.from && !!range.to && range.from > range.to;
  return (
    <th scope="col" className="table-th text-right align-bottom font-normal w-[20rem]">
      <div className="label mb-1.5">{title}</div>
      <div className="flex items-center justify-end gap-2 h-[30px]">{children}</div>
      <div className="text-xs text-muted mt-1.5 normal-case tracking-normal tabular-nums truncate">
        {days > 0 ? (
          <>
            {formatDate(range.from, "short")} → {formatDate(range.to, "short")}
            {" · "}
            {suffix ?? `${formatNum(days)} ${pluralRu(days, ["день", "дня", "дней"])}`}
          </>
        ) : reversed ? (
          // Заданный, но вывернутый отрезок — это НЕ «дат нет»: раньше обе
          // ситуации давали нулевую длину и одинаковую подпись, и человек не
          // понимал, почему при заполненных полях ничего не считается.
          <span className="text-warn">Начало позже конца</span>
        ) : (
          "Даты не заданы"
        )}
      </div>
    </th>
  );
}

export function ComparePage() {
  // Сравнение периодов — это доходы и расходы, поэтому обороты и взаимозачёты
  // из него исключаются так же, как из остальных сводных виджетов (#14).
  const transactions = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();

  const [preset, setPreset] = useState<Preset>("months");
  const [customA, setCustomA] = useState<Range>({ from: "", to: "", label: "Период А" });
  const [customB, setCustomB] = useState<Range>({ from: "", to: "", label: "Период Б" });
  // Отчётные месяцы пресета «Месяцы». `null` = «пользователь не выбирал», тогда
  // берём значения по умолчанию (последний месяц с данными и предыдущий) — они
  // зависят от самих данных, которых на момент useState ещё нет.
  const [monthA, setMonthA] = useState<string | null>(null);
  const [monthB, setMonthB] = useState<string | null>(null);
  // Годы пресета «Годы» — по тем же правилам, что и месяцы: `null` значит
  // «не выбирали», и тогда А — последний год с данными, а Б идёт следом за ним.
  const [yearA, setYearA] = useState<number | null>(null);
  const [yearB, setYearB] = useState<number | null>(null);
  // Сравнивать равные отрезки: неполный месяц против такого же куска другого.
  const [aligned, setAligned] = useState(true);
  // Сколько предыдущих месяцев усредняем в режиме «Среднее».
  const [avgMonths, setAvgMonths] = useState<AvgMonths>(3);
  // Отклонение в деньгах или в процентах — переключается кликом по заголовку.
  const [devPct, setDevPct] = useState(false);
  // Раскрытые категории в списке по категориям.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Разбор по категориям — про расходы или про доходы. Отдельно от остальной
  // страницы: карточки и таблица наверху показывают и то, и другое сразу.
  const [chartKind, setChartKind] = useState<"expense" | "income">("expense");

  const filtered = useMemo(
    () =>
      applyFilters(transactions, { ...filters, preset: "all", from: null, to: null }),
    [transactions, filters]
  );

  const maxDate = useMemo(
    () => filtered.reduce((m, t) => (t.date > m ? t.date : m), ""),
    [filtered]
  );
  const minDate = useMemo(
    () => filtered.reduce((m, t) => (!m || t.date < m ? t.date : m), ""),
    [filtered]
  );

  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  /**
   * Какие месяцы сейчас сравниваются. По умолчанию — последний месяц с данными
   * и предыдущий, то есть ровно то, что страница показывала раньше.
   *
   * Пока Б не выбран явно, он следует за А: сдвинул А на март — сравнивается с
   * февралём. Это то, чего ждёшь от «предыдущего месяца». Как только Б выбрали
   * руками, он закрепляется и больше за А не бегает.
   */
  const months = useMemo(() => {
    const fallback = periodKeyFromDate(
      maxDate ? new Date(maxDate) : new Date(),
      monthStartDay
    );
    const a = monthA ?? fallback;
    return { a, b: monthB ?? shiftPeriod(a, -1) };
  }, [monthA, monthB, maxDate, monthStartDay]);

  // Границы для выбора месяца — по тому, за что вообще есть операции.
  const minYM = minDate ? periodKey(minDate, monthStartDay) : months.a;
  const maxYM = maxDate ? periodKey(maxDate, monthStartDay) : months.a;

  /**
   * Какие годы сейчас сравниваются. По умолчанию — последний год с данными и
   * предыдущий; пока Б не выбран руками, он следует за А, как и у месяцев.
   *
   * Год берём из отчётного месяца, а не из даты: при своём начале месяца
   * январская операция может относиться ещё к прошлому отчётному году.
   */
  const years = useMemo(() => {
    const fallback = Number(maxYM.slice(0, 4)) || new Date().getFullYear();
    const a = yearA ?? fallback;
    return { a, b: yearB ?? a - 1 };
  }, [yearA, yearB, maxYM]);

  const ranges = useMemo<Comparison>(() => {
    const one = (r: Range): DayRange[] => (r.from && r.to ? [{ from: r.from, to: r.to }] : []);

    if (preset === "custom") {
      const a = { ...customA, label: customA.label || "Период А" };
      const b = { ...customB, label: customB.label || "Период Б" };
      return { a, b, windowsB: one(b) };
    }

    // ── «Среднее»: А — выбранный месяц, Б — типичный месяц из N предыдущих ──
    if (preset === "avg") {
      const full = periodRange(months.a, monthStartDay);
      // Идущий месяц обрезаем по последней операции — как и в режиме «Месяцы».
      const partial = !!maxDate && maxDate < full.to && maxDate >= full.from;
      const a: Range = {
        from: full.from,
        to: partial ? maxDate : full.to,
        label: monthTitle(months.a),
      };
      let windows = previousWindows(full, avgMonths, months.a, monthStartDay);
      // Неполный месяц сравниваем с такими же началами предыдущих: три дня
      // против целых месяцев не сказали бы ничего.
      if (aligned && partial) windows = alignWindows(windows, spanDays(a.from, a.to));
      const b: Range = {
        // Окна идут от свежего к старому, поэтому границы берём с разных концов.
        from: windows[windows.length - 1]?.from ?? "",
        to: windows[0]?.to ?? "",
        label: `Среднее за ${avgMonths} мес`,
      };
      return { a, b, windowsB: windows };
    }

    const raw = rangeOf(
      preset,
      maxDate || new Date().toISOString().slice(0, 10),
      monthStartDay,
      months,
      years
    );
    // Остальные пресеты строят одинаковые по длине окна сами, а «свои даты»
    // пользователь задал руками — там подрезать нечего.
    if (preset !== "months" && preset !== "years")
      return { ...raw, windowsB: one(raw.b) };
    const fit = comparableRanges(raw.a, raw.b, maxDate, aligned);
    const a = { ...fit.a, label: raw.a.label };
    const b = { ...fit.b, label: raw.b.label };
    return { a, b, windowsB: one(b) };
  }, [preset, customA, customB, maxDate, monthStartDay, months, years, aligned, avgMonths]);

  /** На сколько периодов делить суммы Б. В «Среднем» их несколько, иначе один. */
  const divisorB = preset === "avg" ? Math.max(1, ranges.windowsB.length) : 1;

  const txsA = useMemo(
    () => filtered.filter((t) => ranges.a.from && ranges.a.to && inRange(t, ranges.a)),
    [filtered, ranges]
  );
  const txsB = useMemo(
    () =>
      filtered.filter((t) =>
        ranges.windowsB.some((w) => t.date >= w.from && t.date <= w.to)
      ),
    [filtered, ranges]
  );

  const kpiA = useMemo(() => computeKPI(txsA), [txsA]);
  // В «Среднем» суммы Б собраны за несколько месяцев — приводим к одному.
  const kpiB = useMemo(
    () => scaleKPI(computeKPI(txsB), divisorB),
    [txsB, divisorB]
  );

  const showDrill = useDrillStore((s) => s.show);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  /** Подпись к списку операций периода Б. В «Среднем» там несколько месяцев —
   *  и об этом надо сказать прямо, иначе список выглядит противоречащим цифре. */
  const noteB =
    preset === "avg"
      ? `Все операции за ${divisorB} мес — в карточке показано среднее за месяц`
      : "Период Б";

  function openPeriod(label: "A" | "B") {
    const range = label === "A" ? ranges.a : ranges.b;
    const txs = label === "A" ? txsA : txsB;
    showDrill(range.label, txs, label === "A" ? "Период А" : noteB);
  }
  function openCategoryInPeriod(category: string, label: "A" | "B") {
    // Вид операций тот же, что показан в разборе: иначе клик по строке доходов
    // открывал бы расходы той же категории.
    const match = (t: Transaction) =>
      chartKind === "expense" ? affectsExpense(t.kind) : t.kind === "income";
    const txs = (label === "A" ? txsA : txsB).filter(
      (t) => match(t) && t.category === category
    );
    const range = label === "A" ? ranges.a : ranges.b;
    const what = chartKind === "expense" ? "Расходы" : "Доходы";
    showDrill(
      `${category} · ${range.label}`,
      txs,
      label === "A" ? `${what} в периоде А` : `${what} · ${noteB}`
    );
  }

  // Дерево «категория → подкатегории» отдельно для каждого периода, потом
  // сведённое по именам. Суммы Б делим на число усреднённых месяцев — иначе в
  // режиме «Среднее» засечка стояла бы втрое правее полосы.
  const rows = useMemo(() => {
    const ha = buildHierarchy(txsA, chartKind);
    const hb = buildHierarchy(txsB, chartKind);
    const aByName = new Map(ha.map((n) => [n.name, n]));
    const bByName = new Map(hb.map((n) => [n.name, n]));
    const names = new Set([...aByName.keys(), ...bByName.keys()]);
    return [...names]
      .map((name) => {
        const a = aByName.get(name);
        const b = bByName.get(name);
        const subNames = new Set([
          ...(a?.subs ?? []).map((x) => x.name),
          ...(b?.subs ?? []).map((x) => x.name),
        ]);
        return {
          name,
          a: a?.total ?? 0,
          b: (b?.total ?? 0) / divisorB,
          count: a?.count ?? 0,
          subs: [...subNames]
            .map((sn) => ({
              name: sn,
              a: a?.subs.find((x) => x.name === sn)?.total ?? 0,
              b: (b?.subs.find((x) => x.name === sn)?.total ?? 0) / divisorB,
              count: a?.subs.find((x) => x.name === sn)?.count ?? 0,
            }))
            .filter((x) => x.a > 0 || x.b > 0)
            .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)),
        };
      })
      .filter((r) => r.a > 0 || r.b > 0)
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  }, [txsA, txsB, divisorB, chartKind]);

  // Шкала — по самой длинной величине ИЗ ОБЕИХ, чтобы засечка периода Б никогда
  // не упиралась в край и её положение читалось честно.
  const rowsMax = rows.length
    ? Math.max(...rows.map((r) => Math.max(r.a, r.b)))
    : 1;
  const rowsTotalA = rows.reduce((sum, r) => sum + r.a, 0);

  // ── Содержимое слотов панели ────────────────────────────────────────────
  // Правило одно: есть выбор — стоит контрол, нет выбора — стоит слово.
  // Погашенная кнопка в этом месте читалась бы как поломка интерфейса.
  const monthPickerA = (
    <MonthPicker
      value={months.a}
      minYM={minYM}
      maxYM={maxYM}
      active
      onSelect={setMonthA}
      onStep={(dir) => setMonthA(shiftPeriod(months.a, dir))}
    />
  );
  const yearPicker = (value: number, set: (y: number) => void) => (
    <MonthPicker
      value={`${value}-01`}
      minYM={minYM}
      maxYM={maxYM}
      active
      mode="year"
      onSelect={(ym) => set(Number(ym.slice(0, 4)))}
      onSelectYear={set}
      onStep={(dir) => set(value + dir)}
    />
  );
  const dateFields = (
    r: Range,
    set: (next: Range) => void
  ) => (
    <>
      <DateField
        value={r.from}
        onChange={(e) => set({ ...r, from: e.target.value })}
        className="input text-xs py-1"
        wrapperClassName="flex-1 min-w-0"
      />
      <span className="text-muted text-xs shrink-0">—</span>
      <DateField
        value={r.to}
        onChange={(e) => set({ ...r, to: e.target.value })}
        className="input text-xs py-1"
        wrapperClassName="flex-1 min-w-0"
      />
    </>
  );

  const slotA =
    preset === "months" || preset === "avg" ? (
      monthPickerA
    ) : preset === "years" ? (
      yearPicker(years.a, setYearA)
    ) : preset === "custom" ? (
      dateFields(customA, setCustomA)
    ) : (
      <span className="text-sm truncate">{ranges.a.label}</span>
    );

  const slotB =
    preset === "months" ? (
      <MonthPicker
        value={months.b}
        minYM={minYM}
        maxYM={maxYM}
        active
        onSelect={setMonthB}
        onStep={(dir) => setMonthB(shiftPeriod(months.b, dir))}
      />
    ) : preset === "years" ? (
      yearPicker(years.b, setYearB)
    ) : preset === "avg" ? (
      <>
        <span className="text-sm shrink-0">Среднее за</span>
        <Segmented
          size="sm"
          value={avgMonths}
          onChange={setAvgMonths}
          label="Сколько предыдущих месяцев усреднять"
          options={[
            { value: 3 as AvgMonths, label: "3 мес" },
            { value: 6 as AvgMonths, label: "6 мес" },
            { value: 12 as AvgMonths, label: "12 мес" },
          ]}
        />
      </>
    ) : preset === "custom" ? (
      dateFields(customB, setCustomB)
    ) : (
      <span className="text-sm truncate">{ranges.b.label}</span>
    );

  const rangeSuffixB = preset === "avg" ? `${avgMonths} мес` : undefined;

  // ── Статус «равных отрезков» ────────────────────────────────────────────
  // Настройка применима только там, где периоды могут разойтись по длине.
  // Вместо погашенного переключателя — фраза, объясняющая, почему её тут нет.
  const alignApplicable =
    preset === "months" || preset === "avg" || preset === "years";
  const fullA = !alignApplicable
    ? null
    : preset === "years"
      ? yearRange(years.a, monthStartDay)
      : periodRange(months.a, monthStartDay);
  // В «Среднем» идущим может быть только А: период Б там собирается из прошлых
  // месяцев. А вот в «Месяцах» текущий месяц можно поставить в любой слот —
  // поэтому смотрим оба. Иначе панель заявляет «Оба периода целиком» ровно
  // тогда, когда идущий месяц выбран вторым.
  const fullB =
    preset === "months"
      ? periodRange(months.b, monthStartDay)
      : preset === "years"
        ? yearRange(years.b, monthStartDay)
        : null;
  // «Ещё идёт» — про календарь, а не про подрезку: см. `isRunningPeriod`.
  const runningTitle = (slot: "a" | "b") =>
    preset === "years"
      ? `${slot === "a" ? years.a : years.b} год`
      : monthTitle(slot === "a" ? months.a : months.b);
  const running = isRunningPeriod(fullA, maxDate)
    ? {
        slot: "А",
        other: "Б",
        title: runningTitle("a"),
        days: spanDays(ranges.a.from, ranges.a.to),
      }
    : isRunningPeriod(fullB, maxDate)
      ? {
          slot: "Б",
          other: "А",
          title: runningTitle("b"),
          days: spanDays(ranges.b.from, ranges.b.to),
        }
      : null;
  // Короткая строка и полная фраза к ней. Пояснение обязано укладываться в ОДНУ
  // строку: иначе панель в одних режимах на 16px выше, чем в других, и данные
  // снова начинают прыгать при переключении — ровно та беда, ради которой всё
  // это и затевалось.
  const [alignNote, alignNoteFull] = !alignApplicable
    ? preset === "custom"
      ? ["Ровно как задано", "Сравниваем ровно те отрезки, которые вы задали"]
      : preset === "ytd_vs_prev_ytd"
        ? ["Оба с 1 января", "Оба отрезка идут с 1 января по одно и то же число"]
        : ["Равны по построению", "Оба отрезка одной длины по самому устройству режима"]
    : !running
      ? ["Оба периода целиком", "Оба периода закончены — сравниваем их целиком"]
      : aligned
        ? [
            `По ${formatNum(running.days)} дн. с начала каждого`,
            `${running.title} ещё идёт, поэтому от обоих периодов взято по ${formatNum(running.days)} ${pluralRu(running.days, ["дню", "дня", "дней"])} с начала`,
          ]
        : [
            `${running.slot} ещё идёт, ${running.other} целиком`,
            `${running.title} ещё не закончился, а период ${running.other} взят целиком — суммы несопоставимы`,
          ];

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitCompare}
        title="Сравнение периодов"
        hint="Два периода рядом: ключевые метрики и расходы по категориям"
      />

      {/* Отборы режут цифры этой страницы и без панели — `applyFilters` ниже
          применяет счета, категории, валюты и поиск. До сих пор их тут просто
          не было видно: человек менял отбор на «Категориях», приходил сюда и
          получал другие суммы без единого намёка на причину. Даты скрываем —
          период у страницы свой. */}
      <GlobalFilters
        showDateRange={false}
        dateRangeHint="Период задаётся ниже — в блоке сравнения"
      />

      {/* ОДНА панель на все режимы.
          Раньше их было четыре: своя у «Месяцев», своя у «Среднего», сетка на
          две колонки у «Своих дат» и вовсе никакой у «30/90 дней» и «С начала
          года». Переключение пилюли роняло контент примерно на сотню пикселей.
          Здесь карточка всегда одна и та же: строка режима, три слота, строка
          дат под каждым. Где выбирать нечего — стоит слово, а не погашенный
          контрол: нажимаемая на вид, но мёртвая кнопка читается как поломка. */}
      <div className="card-tray card-pad space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="label shrink-0">Сравниваем</span>
          <Segmented
            size="sm"
            className="flex-wrap"
            value={preset}
            onChange={setPreset}
            label="Что с чем сравнивать"
            options={MODE_OPTIONS}
          />
          <span className="flex-1 min-w-0" />
          {/* Настройка относится к обоим периодам сразу, поэтому живёт в строке
              режима, а не в колонке одного из них. Здесь же и знак вопроса —
              рядом всё, что объясняет, КАК считается сравнение. */}
          <div className="flex items-center gap-2 min-w-0">
            {alignApplicable ? (
              <>
                <Switch
                  checked={aligned}
                  onChange={setAligned}
                  label="Сравнивать равные отрезки"
                />
                <span className="text-sm whitespace-nowrap">Равные отрезки</span>
              </>
            ) : (
              <span className="text-sm text-muted whitespace-nowrap">
                Равные отрезки не нужны
              </span>
            )}
            <span
              className="text-xs text-muted truncate max-w-[14rem]"
              title={alignNoteFull}
            >
              · {alignNote}
            </span>
          </div>
          <InfoPopover label="Как сравниваются периоды">
            <p>
              <InfoTerm>Период А</InfoTerm> — то, что смотрим,{" "}
              <InfoTerm>период Б</InfoTerm> — с чем сравниваем. Колонка{" "}
              <InfoTerm>«Изменение»</InfoTerm> всегда про то, насколько А
              отличается от Б. У расходов стрелка вниз зелёная: тратить меньше —
              хорошо.
            </p>
            <p>
              <InfoTerm>Месяцы</InfoTerm> — два любых отчётных месяца рядом.
              Пока второй не выбран руками, он идёт следом за первым.{" "}
              <InfoTerm>Среднее</InfoTerm> — месяц против типичного: суммы за 3,
              6 или 12 предыдущих месяцев, делённые на их количество.{" "}
              <InfoTerm>30 и 90 дней</InfoTerm> — последний отрезок против
              предыдущего такого же. <InfoTerm>С начала года</InfoTerm> — от 1
              января до последней операции против того же куска прошлого года.
            </p>
            <p>
              В режиме «Среднее» суммы и число операций приведены{" "}
              <InfoTerm>к одному месяцу</InfoTerm>. А вот «Средний чек расхода»
              на месяцы не делится — он и так средний, но на операцию.
            </p>
            <p>
              <InfoTerm>Равные отрезки</InfoTerm> — идущий месяц сравнивается не
              с целым прошлым, а с таким же его началом: 3 августа против 1–3
              июля. Так видно, потратили вы больше обычного или просто месяц ещё
              не кончился. Два законченных месяца всегда сравниваются целиком.
            </p>
            <p>
              «Июль» здесь — <InfoTerm>отчётный месяц</InfoTerm> из настроек: он
              может начинаться не с первого числа. Идущий период обрезан по
              последней операции — поэтому под слотом стоят настоящие даты, а не
              календарные границы.
            </p>
            <p>
              В сравнение <InfoTerm>не попадают</InfoTerm> переводы между своими
              счетами, долговые операции и всё, что исключено из аналитики
              разрезами. Возврат гасит трату своей категории, поэтому категория
              может уйти в минус — на графике такая стоит нулём, а в таблице
              показана как есть.
            </p>
          </InfoPopover>
        </div>

        {/* Слоты стоят РЯДОМ, а не по половине карточки каждый.
            Сетка из двух равных колонок растягивала слот на пол-экрана, и между
            узким пикером «Периода А» и подписью «Период Б» зияла пустота в
            несколько сотен пикселей — два связанных выбора выглядели как два
            несвязанных блока. Ширина слота фиксирована и посчитана по самому
            широкому содержимому («Свои даты» — два поля даты), поэтому при смене
            режима «Период Б» не ездит по горизонтали. Настройка прижата вправо. */}
        {/* ОДИН блок: выбор периода стоит в шапке той колонки, чьи цифры под
            ним. Раньше это были три отдельные карточки — панель настройки, две
            карточки периодов и таблица, — причём доходы, расходы и чистый поток
            печатались дважды: и в карточках, и в таблице. Одно и то же число в
            двух местах не помогает, а заставляет сверять. */}
        {/* Ширины колонок ЗАДАНЫ, а не подобраны по содержимому.
            Иначе широкий контрол в шапке («Среднее за 3 / 6 / 12») раздвигал
            колонку, и все цифры уезжали вбок при переключении режима — ровно
            тот прыжок, от которого избавлялись по вертикали. «Метрика» одна
            остаётся резиновой и забирает остаток ширины. */}
        <div className="overflow-x-auto -mx-1 px-1 border-t border-border pt-3">
          <table className="w-full text-sm table-fixed min-w-[60rem]">
            <thead>
              <tr>
                <th scope="col" className="table-th align-bottom">
                  Метрика
                </th>
                <PeriodHead title="Период А" range={ranges.a}>
                  {slotA}
                </PeriodHead>
                <PeriodHead title="Период Б" range={ranges.b} suffix={rangeSuffixB}>
                  {slotB}
                </PeriodHead>
                <th
                  scope="col"
                  className="table-th text-right align-bottom w-[9rem]"
                  title={`Насколько «${ranges.a.label}» отличается от «${ranges.b.label}»`}
                >
                  Изменение
                </th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key} className="hover:bg-panel2/40">
                  <td className="table-td whitespace-nowrap" title={m.hint}>
                    {m.label}
                  </td>
                  <td className="table-td text-right p-0">
                    <MetricCell
                      value={m.get(kpiA)}
                      fmt={m.fmt}
                      base={base}
                      onClick={() => openPeriod("A")}
                    />
                  </td>
                  <td className="table-td text-right p-0 text-muted">
                    <MetricCell
                      value={m.get(kpiB)}
                      fmt={m.fmt}
                      base={base}
                      onClick={() => openPeriod("B")}
                    />
                  </td>
                  <td className="table-td text-right">
                    <div className="flex justify-end">
                      <DeviationPill
                        current={m.get(kpiA)}
                        baseline={m.get(kpiB)}
                        base={base}
                        asPct
                        kind={m.invert ? "expense" : "income"}
                        sameLabel="≈ без изменений"
                        upTitle={`Больше, чем в «${ranges.b.label}»`}
                        downTitle={`Меньше, чем в «${ranges.b.label}»`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      <div className="card-tray card-pad">
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold">
            {chartKind === "expense" ? "Расходы" : "Доходы"} по категориям:{" "}
            {ranges.a.label} против {ranges.b.label}
          </div>
          {/* Переключатель тот же, что на «Категориях», — и стоит он только у
              этого блока: карточки и таблица выше показывают доходы и расходы
              одновременно, переключать там нечего. */}
          <KindSwitcher kind={chartKind} onChange={setChartKind} />
        </div>
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            {chartKind === "expense"
              ? "Нет расходов по категориям в выбранных периодах"
              : "Нет доходов по категориям в выбранных периодах"}{" "}
            — поменяйте периоды или отборы сверху.
          </div>
        ) : (
          /* Строки-полосы вместо двух столбиков recharts — тот же язык, что во
             вкладке Bars на «Категориях». Полоса это период А, засечка на ней —
             период Б: сравнение читается по одной строке, а не по паре столбиков
             разной длины. Размер шрифта подчиняется общей настройке таблиц. */
          <div className="pr-1" style={{ fontSize: "var(--tbl-font)" }}>
            <div className="bg-panel flex items-center gap-2 px-1.5 pb-1 mb-1 border-b border-border text-[0.85em] text-muted uppercase tracking-wide">
              <span className="flex-1 min-w-0">Категория</span>
              <span className="w-14 text-left shrink-0">%</span>
              <span className="w-20 text-left shrink-0">Операции</span>
              <span className="w-28 text-left shrink-0" title={ranges.a.label}>
                Период А
              </span>
              <span className="w-28 text-left shrink-0" title={ranges.b.label}>
                Период Б
              </span>
              <button
                onClick={() => setDevPct((v) => !v)}
                className="w-28 text-left shrink-0 uppercase tracking-wide text-muted hover:text-accent inline-flex items-center gap-1"
                title={`Насколько период А отличается от периода Б. Клик — переключить ${currencySymbol(base)} / %`}
              >
                Изменение
                <span className="normal-case rounded bg-panel2 px-1 text-[0.9em] leading-none text-text">
                  {devPct ? "%" : currencySymbol(base)}
                </span>
              </button>
              <span className="w-8 shrink-0 flex items-center justify-center">
                {rows.some((r) => r.subs.length > 0) && (
                  <button
                    onClick={() =>
                      setExpanded(
                        expanded.size > 0
                          ? new Set()
                          : new Set(rows.filter((r) => r.subs.length > 0).map((r) => r.name))
                      )
                    }
                    title={expanded.size > 0 ? "Свернуть все" : "Развернуть все"}
                    aria-label={expanded.size > 0 ? "Свернуть все" : "Развернуть все"}
                    className="-m-1 p-1 rounded-full text-muted transition-colors hover:text-accent hover:bg-panel2"
                  >
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-300 ${
                        expanded.size > 0 ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}
              </span>
            </div>
            <div className="space-y-0.5">
              {rows.map((row) => {
                const isOpen = expanded.has(row.name);
                return (
                  <div key={row.name}>
                    <CompareBarRow
                      name={row.name}
                      a={row.a}
                      b={row.b}
                      count={row.count}
                      share={rowsTotalA > 0 ? row.a / rowsTotalA : 0}
                      max={rowsMax}
                      color={colorForCategory(row.name, categoryMeta)}
                      base={base}
                      devPct={devPct}
                      labelB={ranges.b.label}
                      kind={chartKind}
                      onOpen={() => openCategoryInPeriod(row.name, "A")}
                      expandable={row.subs.length > 0}
                      expanded={isOpen}
                      onToggle={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.name)) next.delete(row.name);
                          else next.add(row.name);
                          return next;
                        })
                      }
                    />
                    {isOpen &&
                      row.subs.map((sub) => (
                        <CompareBarRow
                          key={sub.name}
                          name={sub.name}
                          parent={row.name}
                          a={sub.a}
                          b={sub.b}
                          count={sub.count}
                          share={rowsTotalA > 0 ? sub.a / rowsTotalA : 0}
                          max={rowsMax}
                          color={colorForCategory(row.name, categoryMeta)}
                          base={base}
                          devPct={devPct}
                          labelB={ranges.b.label}
                          kind={chartKind}
                          onOpen={() => openCategoryInPeriod(row.name, "A")}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
