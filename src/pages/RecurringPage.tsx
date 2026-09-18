import { useEffect, useMemo, useState } from "react";
import {
  Repeat,
  Calendar,
  AlertCircle,
  TrendingUp,
  CalendarClock,
  Coins,
  Sparkles,
  ListChecks,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { detectRecurring, type RecurringCandidate } from "../lib/aggregations";
import { loadZenCache, type ZenCache } from "../lib/zenmoneyCache";
import { plannedOps, ownPlannedOps, type PlannedOp } from "../lib/plannedOps";

import { useMembersStore } from "../store/useMembersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { currentPeriod, periodRange } from "../lib/period";
import { formatMoney, formatDate, formatNum, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { CardHeader } from "../components/CardHeader";
import { Segmented } from "../components/Segmented";
import { Switch } from "../components/Switch";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { StatCell, StatRow } from "../components/SectionCard";
import { DataTable, type Column, type Tone } from "../components/DataTable";
import { DeviationPill } from "../components/DeviationPill";
import { confirm } from "../store/useConfirmStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { SectionEmpty } from "../components/SectionEmpty";
import { ProgressBar } from "../components/ProgressBar";
import { SectionControls } from "../components/SectionControls";

// One pill per coarse cadence bucket, plus an "all" pseudo-option.
// Order matches the user's likely usage frequency on this page:
// most subscriptions are monthly, weekly is the next bucket, and
// quarterly ones are the rare-but-meaningful tail.
type CadenceFilter = "all" | "weekly" | "monthly" | "quarterly";
const CADENCE_LABEL: Record<Exclude<CadenceFilter, "all">, string> = {
  weekly: "Еженедельные",
  monthly: "Ежемесячные",
  quarterly: "Реже раза в месяц",
};

// Page-level tabs: Zenmoney's own plans vs. our history-based detection (#3).
const PAGE_TABS = [
  { id: "zen", label: "Планы Дзен-мани", icon: CalendarClock },
  { id: "dzen", label: "Планы DzenAnalytics", icon: Sparkles },
] as const;
type PageTab = (typeof PAGE_TABS)[number]["id"];

// Date-window filter for the planned table.
type PlannedPeriod = "all" | "month" | "30d" | "3m" | "6m" | "1y";
const PLANNED_PERIODS: { id: PlannedPeriod; label: string }[] = [
  { id: "month", label: "Текущий месяц" },
  { id: "30d", label: "30 дней" },
  { id: "3m", label: "3 месяца" },
  { id: "6m", label: "6 месяцев" },
  { id: "1y", label: "1 год" },
  { id: "all", label: "Все" },
];

/** yyyy-mm-dd from LOCAL fields (no UTC shift). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Inclusive upper date bound for a period, or null for «Все». */
function plannedPeriodEnd(period: PlannedPeriod, monthStartDay: number = 1): string | null {
  const n = new Date();
  const y = n.getFullYear();
  const m = n.getMonth();
  const d = n.getDate();
  switch (period) {
    case "month":
      // Конец ОТЧЁТНОГО месяца, а не календарного: главная режет тот же список
      // по нему, и с первым днём месяца 28-го два экрана показывали разное
      // число ближайших платежей.
      return periodRange(currentPeriod(monthStartDay), monthStartDay).to;
    case "30d":
      return isoLocal(new Date(y, m, d + 30));
    case "3m":
      return isoLocal(new Date(y, m + 3, d));
    case "6m":
      return isoLocal(new Date(y, m + 6, d));
    case "1y":
      return isoLocal(new Date(y + 1, m, d));
    default:
      return null;
  }
}


/**
 * Сколько дней операция просрочена — целыми сутками, по местному календарю.
 *
 * Считаем по датам, а не по миллисекундам: план стоит на дату без времени, и
 * «вчера» должно быть вчера независимо от того, сколько сейчас на часах.
 */
function daysOverdue(iso: string, todayIso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date(`${todayIso}T00:00:00`);
  return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86_400_000));
}

/** Signed, coloured amount for a planned op (shared by table + overdue list). */
function plannedAmount(p: PlannedOp, base: string): string {
  const sign = p.kind === "income" ? "+" : p.kind === "expense" ? "−" : "";
  return `${sign}${formatMoney(p.amountBase, base)}`;
}

/** Сторона плановой суммы: перевод — без цвета. */
function plannedTone(p: PlannedOp): Tone {
  return p.kind === "income" ? "income" : p.kind === "expense" ? "expense" : "neutral";
}

/**
 * Уже этого таблицы запланированного и просроченного не сжимаются, а
 * прокручиваются вбок. Ширины колонок в rem, текстовые делят остаток: пока
 * колонки были в процентах, на экране около 1000 px подписи шапки обрезались
 * («ДАТ…», «ПОВТО…»). 32,75rem — сумма узких колонок, по 8rem — на три
 * текстовые. У просроченных сумма узких та же, поэтому колонки совпадают.
 */
const PLANNED_MIN_WIDTH = "57rem";

export function RecurringPage() {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const base = rates.base;
  const showDrill = useDrillStore((s) => s.show);

  // Planned / forecast operations straight from Zenmoney (issue #47). They ride
  // in the same cache as the transactions — no extra sync needed.
  const [zenCache, setZenCache] = useState<ZenCache | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadZenCache().then((c) => {
      if (!cancelled) setZenCache(c);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  // Только свои планы: на общем аккаунте по одному токену приезжают планы
  // всех подключённых людей, а мобильное приложение чужие не показывает (#92).
  const ownerId = useMembersStore((s) => s.ownerId);
  const allPlanned = useMemo(() => plannedOps(zenCache, rates), [zenCache, rates]);
  // Только по явному выбору участника — см. `useZenPlanned`.
  const planned = useMemo(() => ownPlannedOps(allPlanned, ownerId), [allPlanned, ownerId]);
  /** Сколько планов спрятано как чужие — нужно пустому экрану, чтобы не врать. */
  const hiddenPlanned = allPlanned.length - planned.length;
  const [pageTab, setPageTab] = useState<PageTab>("zen");
  const [plannedTab, setPlannedTab] = useState<"all" | "plan" | "forecast">("all");
  const [plannedPeriod, setPlannedPeriod] = useState<PlannedPeriod>("month");
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const todayIso = isoLocal(new Date());

  // Overdue = a plan the user scheduled that nobody carried out. Forecast rows
  // are excluded: a stale projection isn't something to act on, calling it
  // «просрочено» would be misinformation.
  const plannedOverdue = useMemo(
    () => planned.filter((p) => p.date < todayIso && !p.forecast),
    [planned, todayIso]
  );
  // Просроченные, снятые вручную и ещё не уехавшие в облако (issue #71).
  const queuedDeletions = usePlannedDeletionsStore((s) => s.deletions);
  /** Upcoming, ignoring tab & period — this decides whether the section shows at
   *  all, so an empty tab/period can never make the whole card disappear. */
  const plannedUpcoming = useMemo(
    () => planned.filter((p) => p.date >= todayIso),
    [planned, todayIso]
  );
  /** Upcoming within the selected date window (before the tab split), so the tab
   *  counts always match what the chosen period actually contains. */
  const plannedInPeriod = useMemo(() => {
    const end = plannedPeriodEnd(plannedPeriod, monthStartDay);
    return end ? plannedUpcoming.filter((p) => p.date <= end) : plannedUpcoming;
  }, [plannedUpcoming, plannedPeriod, monthStartDay]);
  const plannedCounts = useMemo(
    () => ({
      all: plannedInPeriod.length,
      plan: plannedInPeriod.filter((p) => !p.forecast).length,
      forecast: plannedInPeriod.filter((p) => p.forecast).length,
    }),
    [plannedInPeriod]
  );
  // A tab whose bucket is empty in the current period is disabled (Zenmoney
  // delivers few forecast markers, so «Прогноз» is often 0). If the selected tab
  // has nothing to show, fall back to «Все» so the table never looks broken.
  const effectiveTab = plannedCounts[plannedTab] > 0 ? plannedTab : "all";
  const plannedShown = useMemo(
    () =>
      plannedInPeriod.filter((p) =>
        effectiveTab === "all" ? true : effectiveTab === "plan" ? !p.forecast : p.forecast
      ),
    [plannedInPeriod, effectiveTab]
  );

  const plannedTitle = (p: PlannedOp) =>
    p.payee || p.comment || p.category || "—";

  /**
   * Убрать просроченную операцию — и у себя, и в Дзен-мани (issue #71).
   *
   * У РАЗОВОГО плана удаляем сам план: снести одну его операцию мало, останется
   * пустой шаблон, невидимый и здесь, и в Дзен-мани. Во всех остальных случаях —
   * только эту дату: у повторяющегося плана удаление целиком снесло бы серию
   * вперёд, а если план ещё не подтянут из облака (`repeating === null`), мы
   * просто не знаем, какой он, и осторожность важнее.
   */
  async function askDeletePlanned(p: PlannedOp) {
    const title = plannedTitle(p);
    const when = formatDate(p.date, "short");
    const wholePlan = p.repeating === false;
    const ok = await confirm({
      title: wholePlan ? "Удалить план в Дзен-мани?" : "Убрать просроченную операцию?",
      message: wholePlan
        ? `Разовый план «${title}» от ${when} будет удалён в Дзен-мани вместе с этой операцией.`
        : `Операция от ${when} исчезнет из плана «${title}». Сам план и его будущие операции останутся.`,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    await usePlannedDeletionsStore
      .getState()
      .remove({ id: p.id, wholePlan, date: p.date, title });
  }

  const allCandidates = useMemo(() => detectRecurring(transactions), [transactions]);
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all");
  const [onlyPriceUp, setOnlyPriceUp] = useState(false);
  // "Активные" = платёж идёт по графику (пропущено не больше ~2 циклов с учётом
  // периодичности). ON by default: a subscription cancelled a few months ago
  // isn't really "recurring" anymore, so we hide those unless the user
  // explicitly asks to see the full history. The staleness test is
  // cadence-aware (see `detectRecurring`), so a monthly plan unpaid for a
  // couple of months is hidden long before the old flat "older than a year".
  const [onlyActive, setOnlyActive] = useState(true);

  // Pool after the toggle filters (active / price-up) but BEFORE the cadence
  // pick. Used both for the result list AND for the per-cadence pill counts, so
  // a period pill's number always equals what «Найдено» shows for that cadence
  // under the current toggles (e.g. «Ежемесячные 17» → выбрал → Найдено 17).
  const filterPool = useMemo(
    () =>
      allCandidates.filter((c) => {
        if (onlyPriceUp && c.priceTrend.priceFlag !== "up") return false;
        if (onlyActive && c.stale) return false;
        return true;
      }),
    [allCandidates, onlyPriceUp, onlyActive]
  );

  const candidates = useMemo(
    () =>
      cadenceFilter === "all"
        ? filterPool
        : filterPool.filter((c) => c.cadence === cadenceFilter),
    [filterPool, cadenceFilter]
  );

  // Respects the «Только активные» toggle (but not the price-up filter itself,
  // which this card toggles): counts price-jumped subscriptions among active
  // ones when the toggle is on, so the number matches what clicking it reveals.
  const priceUpCount = allCandidates.filter(
    (c) => c.priceTrend.priceFlag === "up" && (!onlyActive || !c.stale)
  ).length;

  const totalMonthly = useMemo(
    () =>
      candidates.reduce((s, c) => {
        if (c.avgIntervalDays > 0) return s + (c.avgAmount * 30) / c.avgIntervalDays;
        return s;
      }, 0),
    [candidates]
  );

  const upcoming = useMemo(
    () =>
      candidates
        .filter((c) => c.nextExpected >= todayIso)
        .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected)),
    [candidates, todayIso]
  );

  // ── Column definitions ──────────────────────────────────────────────────
  const plannedColumns = useMemo<Column<PlannedOp>[]>(
    () => [
      {
        key: "date",
        type: "date",
        label: "Дата",
        width: "5.5rem",
        sortValue: (p) => p.date,
        render: (p) => formatDate(p.date, "short"),
      },
      {
        key: "type",
        type: "mark",
        label: "Тип",
        // Как «Задержка» у просроченных: колонки обеих таблиц стоят по одной линии.
        width: "7.25rem",
        sortValue: (p) => (p.forecast ? 1 : 0),
        exportValue: (p) => (p.forecast ? "Прогноз" : "План"),
        render: (p) => (
          <span
            className={`pill text-[11px] ${
              p.forecast ? "text-muted" : "text-accent border-accent/40"
            }`}
          >
            {p.forecast ? "Прогноз" : "План"}
          </span>
        ),
      },
      {
        key: "payee",
        type: "text",
        label: "Получатель",
        sortValue: (p) => p.payee || "",
        render: (p) => p.payee || "—",
      },
      {
        key: "category",
        type: "text",
        muted: true,
        label: "Категория",
        sortValue: (p) => p.category,
        render: (p) => p.category || "—",
      },
      {
        key: "comment",
        type: "text",
        muted: true,
        label: "Комментарий",
        sortValue: (p) => p.comment || "",
        render: (p) => p.comment || "—",
      },
      {
        key: "account",
        type: "text",
        muted: true,
        label: "Счёт",
        width: "10rem",
        sortValue: (p) => p.account,
        cellTitle: (p) => (p.kind === "transfer" ? `${p.account} → ${p.toAccount}` : p.account),
        render: (p) => (p.kind === "transfer" ? `${p.account} → ${p.toAccount}` : p.account),
      },
      {
        key: "amount",
        type: "main",
        tone: plannedTone,
        label: "Сумма",
        width: "10rem",
        sortValue: (p) => p.amountBase,
        exportValue: (p) => (p.kind === "expense" ? -p.amountBase : p.amountBase).toFixed(2),
        render: (p) => plannedAmount(p, base),
      },
    ],
    [base]
  );

  /**
   * Колонки просроченного — те же, что в таблице ниже, с двумя отличиями.
   *
   * Вместо «Типа» — «Задержка»: прогнозы сюда не попадают, и колонка со
   * сплошным «План» была бы пустой тратой места, а «сколько уже висит» — ровно
   * то, ради чего на просроченное смотрят. Ширина та же, так что колонки обеих
   * таблиц стоят по одной линии.
   *
   * И колонка действий в конце: снять операцию можно только отсюда. Место под
   * неё взято у суммы — иначе съехали бы все колонки разом.
   *
   * Без `useMemo`: строк здесь единицы, а зависимостей (кнопка удаления,
   * очередь снятий, сегодняшняя дата) столько, что список вышел бы длиннее
   * самих колонок.
   */
  const overdueColumns: Column<PlannedOp>[] = [
    ...plannedColumns.filter((c) => c.key === "date"),
    {
      key: "late",
      type: "mark",
      tone: "warn",
      label: "Задержка",
      width: "7.25rem",
      // Сортировать нечего: порядок по задержке — это порядок по дате наоборот.
      sortable: false,
      render: (p) => {
        const d = daysOverdue(p.date, todayIso);
        return `${formatNum(d)} ${pluralRu(d, ["день", "дня", "дней"])}`;
      },
    },
    ...plannedColumns.filter((c) =>
      ["payee", "category", "comment", "account"].includes(c.key)
    ),
    ...plannedColumns
      .filter((c) => c.key === "amount")
      .map((c) => ({ ...c, width: "7.5rem" })),
    {
      key: "act",
      type: "actions",
      label: "",
      width: "2.5rem",
      render: (p) =>
        queuedDeletions[p.id] !== undefined ? (
          <button
            type="button"
            className="btn-icon"
            aria-label="Вернуть операцию"
            title="Удаление ждёт отправки — вернуть"
            onClick={() => usePlannedDeletionsStore.getState().restore(p.id)}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-icon-danger"
            aria-label="Удалить операцию"
            title={
              p.repeating === false
                ? "Удалить разовый план в Дзен-мани"
                : "Убрать эту дату из плана в Дзен-мани"
            }
            onClick={() => askDeletePlanned(p)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ),
    },
  ];

  const recurringColumns = useMemo<Column<RecurringCandidate>[]>(
    () => [
      {
        // Светофор: зелёный — платежи идут по графику, красный — платежа нет
        // дольше двух ожидаемых циклов.
        key: "status",
        type: "mark",
        label: "Статус",
        width: "5.75rem",
        sortValue: (c) => (c.stale ? "неактивен" : "активен"),
        cellTitle: (c) =>
          c.stale
            ? `Неактивен: нет платежа ${c.daysSinceLast} дн. при периоде ~${c.avgIntervalDays} дн.`
            : "Активен: платежи идут по графику",
        render: (c) => (
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full align-middle ${
              c.stale ? "bg-expense" : "bg-income"
            }`}
          />
        ),
      },
      {
        key: "payee",
        type: "text",
        label: "Получатель",
        sortValue: (c) => c.payee,
        render: (c) => c.payee,
      },
      {
        key: "category",
        type: "text",
        muted: true,
        label: "Категория",
        sortValue: (c) => c.category,
        render: (c) => c.category,
      },
      {
        key: "avgAmount",
        type: "money",
        label: "Сумма ср.",
        width: "7.25rem",
        sortValue: (c) => c.avgAmount,
        render: (c) => formatMoney(c.avgAmount, c.currency),
      },
      {
        // Последний платёж против исторического среднего. У ровных подписок —
        // прочерк: колонка не рябит там, где ничего не меняется.
        key: "priceTrend",
        type: "change",
        label: "Изменение",
        width: "7.75rem",
        sortValue: (c) => c.priceTrend.changePct,
        render: (c) =>
          c.priceTrend.priceFlag === "flat" ? (
            <span className="text-muted">—</span>
          ) : (
            <DeviationPill
              current={1 + c.priceTrend.changePct}
              baseline={1}
              base={c.currency}
              asPct
              kind="expense"
              upTitle="Последний платёж дороже исторического среднего"
              downTitle="Последний платёж дешевле исторического среднего"
            />
          ),
      },
      {
        key: "avgInterval",
        type: "number",
        label: "Раз в",
        width: "5rem",
        sortValue: (c) => c.avgIntervalDays,
        render: (c) => `${formatNum(c.avgIntervalDays)} дн`,
      },
      {
        key: "occurrences",
        type: "count",
        label: "Повторов",
        width: "7.25rem",
        sortValue: (c) => c.occurrences,
        render: (c) => formatNum(c.occurrences),
      },
      {
        key: "consistency",
        type: "pct",
        label: "Стабильность",
        width: "9.5rem",
        sortValue: (c) => c.consistency,
        render: (c) => (
          <span className="flex items-center justify-end gap-2">
            <ProgressBar value={c.consistency} className="w-12 shrink-0" />
            <span className="w-10">{formatPct(c.consistency, 0)}</span>
          </span>
        ),
      },
      {
        key: "lastDate",
        type: "date",
        label: "Последний",
        width: "8rem",
        sortValue: (c) => c.lastDate,
        render: (c) => formatDate(c.lastDate, "short"),
      },
      {
        key: "nextExpected",
        type: "date",
        label: "Следующий",
        width: "8.25rem",
        sortValue: (c) => c.nextExpected,
        render: (c) => formatDate(c.nextExpected, "short"),
      },
      {
        key: "totalSpent",
        type: "main",
        tone: "expense",
        label: "Итого",
        width: "7.5rem",
        sortValue: (c) => c.totalSpent,
        render: (c) => formatMoney(c.totalSpent, c.currency),
      },
    ],
    []
  );

  if (transactions.length === 0) return <EmptyState />;

  function openCandidate(c: { txIds: string[]; payee: string }) {
    const txs = transactions.filter((t) => c.txIds.includes(t.id));
    showDrill(c.payee, txs, "Регулярные платежи");
  }

  const plannedTabs = [
    { id: "all", label: "Все" },
    { id: "plan", label: "План" },
    { id: "forecast", label: "Прогноз" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Регулярные платежи"
        icon={Repeat}
        info={
          <InfoPopover label="Что на этой странице">
            <p>
              <InfoTerm>«Планы Дзен-мани»</InfoTerm> — то, что стоит в самом
              Дзен-мани: и заведённое вами вручную (<InfoTerm>План</InfoTerm>),
              и достроенное Дзеном по регулярности (
              <InfoTerm>Прогноз</InfoTerm>).
            </p>
            <p>
              <InfoTerm>«Планы DzenAnalytics»</InfoTerm> — наша догадка:
              подписки и абонентские платежи, которые видны по вашей истории,
              даже если вы их нигде не отмечали. В Дзен-мани о них ничего не
              знают, и наружу отсюда ничего не уходит.
            </p>
            <p>
              Ищем так: берём расходы, группируем по получателю и валюте и
              оставляем те, где набралось хотя бы <InfoTerm>3 платежа</InfoTerm>{" "}
              в <InfoTerm>двух разных месяцах</InfoTerm>, а средний промежуток
              между ними — от <InfoTerm>5 до 95 дней</InfoTerm>. Разовая покупка
              и платежи раз в год так не находятся. Дальше смотрим, насколько
              ровные суммы и промежутки: если скачет и то и другое, платёж
              регулярным не считаем.
            </p>
            <p>
              <InfoTerm>«≈ в месяц»</InfoTerm> — все найденные платежи,
              приведённые к месяцу: недельный считается за четыре с небольшим,
              квартальный — за треть. <InfoTerm>«≈ в год»</InfoTerm> — это же
              число, умноженное на двенадцать, то есть оценка при неизменных
              подписках, а не факт за прошлый год.
            </p>
            <p>
              Кружок в колонке <InfoTerm>«Статус»</InfoTerm>: зелёный — платежи
              идут по графику, красный — пропущено больше двух ожидаемых подряд,
              и подписку, скорее всего, уже отменили. Такие спрятаны, пока
              включён переключатель <InfoTerm>«Только активные»</InfoTerm>.
            </p>
            <p>
              Верхние фильтры — счета, категории, валюта, период — на эту
              страницу не действуют: план ещё не операция, фильтровать его не по
              чему, а регулярность видна только по всей истории целиком.
            </p>
          </InfoPopover>
        }
      />

      {/* Page-level tabs: Zen plans vs our own detection (#3). */}
      <SectionControls>
        <Segmented
          tabs
          label="Разделы страницы"
          value={pageTab}
          onChange={setPageTab}
          options={PAGE_TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
        />
      </SectionControls>

      {/* ══ Планы из Дзен-мани (issue #47) ══════════════════════════════════ */}
      {pageTab === "zen" && (
        <>
          {plannedUpcoming.length === 0 && plannedOverdue.length === 0 ? (
            <SectionEmpty
              icon={CalendarClock}
              title="Нет запланированных операций из Дзен-мани"
            >
              {hiddenPlanned > 0 ? (
                <>
                  Все планы этого аккаунта стоят на личных счетах других
                  участников, поэтому здесь их нет — как и в приложении
                  Дзен-мани. Кого считать собой и показывать ли чужое,
                  задаётся в «Настройки → Данные → Участники аккаунта».
                </>
              ) : (
                <>
                  Планы и прогнозы появятся после синхронизации с Дзен-мани.
                  Автоопределённые регулярные платежи — во вкладке «Планы
                  DzenAnalytics».
                </>
              )}
            </SectionEmpty>
          ) : (
          <div className="card-tray card-pad space-y-4">
            <CardHeader
              icon={CalendarClock}
              title="Планируемые операции"
              right={
                <Segmented
                  size="sm"
                  label="Какие плановые операции показать"
                  value={effectiveTab}
                  onChange={setPlannedTab}
                  className="shrink-0"
                  options={plannedTabs.map((t) => ({
                    value: t.id,
                    label: t.label,
                    count: plannedCounts[t.id],
                    disabled: plannedCounts[t.id] === 0,
                    title:
                      plannedCounts[t.id] === 0
                        ? "Нет таких операций в выбранном периоде"
                        : undefined,
                  }))}
                />
              }
            />

            {/* Date-window filter for the plans table. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">Период</span>
              <Segmented
                tight
                label="Период плановых операций"
                value={plannedPeriod}
                onChange={setPlannedPeriod}
                options={PLANNED_PERIODS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </div>

            {/* Просроченное — та же таблица, что и ниже: разбирать его удобнее
                в привычных колонках, чем в собственной вёрстке со своими
                правилами. Стоит выше и не зависит ни от вкладки, ни от
                выбранного периода — это то, что просит действия. */}
            {plannedOverdue.length > 0 && (
              /* Боковых отступов у рамки нет намеренно: ячейки таблицы уже
                 набраны с отступом 12px, и ещё столько же у рамки сдвигали
                 колонки относительно таблицы ниже — две таблицы подряд читались
                 бы как сбитая сетка. Заголовку отступ возвращён вручную. */
              <div className="rounded-xl border border-warn/40 bg-warn/5 py-3">
                <div className="text-xs font-semibold text-warn flex items-center gap-1.5 mb-1 px-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Просрочено: {formatNum(plannedOverdue.length)}
                  <InfoPopover label="Что это за операции">
                    <p>
                      Дзен-мани поставил их на прошедшие даты, но никто не
                      провёл. Обычно это значит одно из двух: платёж прошёл, а
                      отметить забыли, — или его не было вовсе.
                    </p>
                    <p>
                      В первом случае проведите операцию{" "}
                      <InfoTerm>в Дзен-мани</InfoTerm>: здесь она только
                      показывается, провести её отсюда нельзя. Во втором —
                      удалите строку кнопкой справа: у повторяющегося плана
                      снимется одна эта дата, у разового удалится сам план.
                    </p>
                    <p>
                      Прогнозов тут нет — Дзен-мани достраивает их по
                      регулярности, и «просроченным» такое называть незачем.
                    </p>
                  </InfoPopover>
                </div>
                <DataTable<PlannedOp>
                  bare
                  data={plannedOverdue}
                  columns={overdueColumns}
                  minWidth={PLANNED_MIN_WIDTH}
                  rowKey={(p) => p.id}
                  defaultSortKey="date"
                  defaultSortDir="asc"
                  limit={10}
                  exportable={false}
                  // Снятое ждёт отправки в облако: строка ещё здесь, но уже
                  // вычеркнута — видно, что она на выходе, и её можно вернуть.
                  rowClassName={(p) =>
                    queuedDeletions[p.id] !== undefined
                      ? "line-through opacity-50"
                      : ""
                  }
                  fixed
                />
              </div>
            )}

            {plannedShown.length === 0 ? (
              <div className="text-sm text-muted py-2">
                {plannedInPeriod.length === 0 && plannedPeriod !== "all"
                  ? "В выбранном периоде операций нет — попробуйте расширить период."
                  : effectiveTab === "plan"
                    ? "Нет запланированных вручную операций."
                    : effectiveTab === "forecast"
                      ? "Нет прогнозных операций в этом периоде."
                      : "Ничего не запланировано на будущее."}
              </div>
            ) : (
              <DataTable<PlannedOp>
                bare
                data={plannedShown}
                columns={plannedColumns}
                minWidth={PLANNED_MIN_WIDTH}
                rowKey={(p) => p.id}
                defaultSortKey="date"
                defaultSortDir="asc"
                limit={40}
                exportable={false}
                fixed
              />
            )}
          </div>
          )}
        </>
      )}

      {/* ══ Планы DzenAnalytics — автодетект по истории (#4) ════════════════ */}
      {pageTab === "dzen" && (
        <>
          <StatRow>
        <StatCell
          label="Найдено"
          value={formatNum(candidates.length)}
          icon={<Repeat className="w-4 h-4" />}
          note="регулярных платежей"
        />
        <StatCell
          label="≈ в месяц"
          value={formatMoney(totalMonthly, base)}
          tone="warn"
          icon={<Coins className="w-4 h-4" />}
          note="оценка нагрузки"
        />
        <StatCell
          label="≈ в год"
          value={formatMoney(totalMonthly * 12, base)}
          tone="warn"
          icon={<Calendar className="w-4 h-4" />}
          note="экстраполяция"
        />
        {/* «Подорожали» фильтрует список ниже. Кликалась вся плитка — теперь
            действие отдельной ссылкой: в ряду итогов остальные числа не
            нажимаются, и по одному виду нельзя было понять, какое из них живое. */}
        <StatCell
          label="Подорожали"
          value={formatNum(priceUpCount)}
          tone={priceUpCount > 0 ? "warn" : "default"}
          icon={<TrendingUp className="w-4 h-4" />}
          note={priceUpCount > 0 ? undefined : "за всю историю"}
        >
          {priceUpCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyPriceUp((v) => !v)}
              aria-pressed={onlyPriceUp}
              className="text-xs mt-0.5 text-accent hover:underline"
            >
              {onlyPriceUp ? "Показать все" : "Показать только их"}
            </button>
          )}
        </StatCell>
      </StatRow>

      {/* Cadence filter — three mutually-exclusive pills + "Все", plus the
          active-only toggle. Hidden when nothing has been detected yet. */}
      {allCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="label">Периодичность</span>
          <Segmented
            size="sm"
            label="Периодичность платежей"
            value={cadenceFilter}
            onChange={setCadenceFilter}
            options={(["all", "monthly", "weekly", "quarterly"] as const).map((c) => ({
              value: c,
              label: c === "all" ? "Все" : CADENCE_LABEL[c],
              count:
                c === "all"
                  ? filterPool.length
                  : filterPool.filter((x) => x.cadence === c).length,
            }))}
          />
          {onlyPriceUp && (
            <button
              type="button"
              onClick={() => setOnlyPriceUp(false)}
              className="chip chip-on"
              aria-label="Снять фильтр «Только подорожавшие»"
            >
              Только подорожавшие
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {/* Active-only is a toggle, not a period — different style (switch)
              and pushed to the right edge so it doesn't read as a 5th pill. */}
          <label
            title={"Только активные\nНеактивные — те, по которым пропущено больше двух ожидаемых платежей подряд."}
            className={`ml-auto flex items-center gap-2 cursor-pointer transition-colors ${
              onlyActive ? "text-text" : "text-muted hover:text-text"
            }`}
          >
            <span>Только активные</span>
            <Switch checked={onlyActive} onChange={setOnlyActive} label="Только активные" />
          </label>
        </div>
      )}

      {candidates.length === 0 && (
        <SectionEmpty
          icon={AlertCircle}
          title="Регулярных платежей не найдено"
        >
          Нужно минимум 3 повтора одного получателя с интервалом ~раз в месяц.
        </SectionEmpty>
      )}

      {upcoming.length > 0 && (
        <div className="card-tray card-pad">
          <CardHeader icon={Calendar} title="Ближайшие ожидаемые" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcoming.slice(0, 6).map((c) => {
              const daysUntil = Math.round(
                (+new Date(c.nextExpected) - +new Date(todayIso)) / 86400000
              );
              return (
                <button
                  key={c.payee + c.currency}
                  onClick={() => openCandidate(c)}
                  className="text-left p-3 rounded-xl bg-panel2 border border-border hover:border-accent transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-medium text-sm truncate">{c.payee}</div>
                    <div className="text-xs pill shrink-0">
                      {daysUntil === 0 ? "сегодня" : `через ${daysUntil} дн.`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{formatDate(c.nextExpected, "short")}</span>
                    <span className="text-expense font-semibold tabular-nums">
                      ≈ {formatMoney(c.avgAmount, c.currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <DataTable<RecurringCandidate>
          icon={ListChecks}
          title="Все регулярные платежи"
          data={candidates}
          columns={recurringColumns}
          // 66,25rem узких колонок и по ~8rem получателю и категории.
          minWidth="82rem"
          rowKey={(c) => c.payee + c.currency}
          defaultSortKey="totalSpent"
          onRowClick={openCandidate}
          exportName="recurring_payments"
          fixed
        />
      )}
        </>
      )}
    </div>
  );
}
