import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Trash2,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Check,
  X,
  ArrowUp,
  HelpCircle,
  Wand2,
  Download,
  CalendarClock,
  Target,
  Scale,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { getZenForecastsFromCache } from "../store/useZenmoneyStore";
import { loadZenCache } from "../lib/zenmoneyCache";
import { plannedOps, type PlannedOp } from "../lib/plannedOps";
import { plannedPlans } from "../lib/plannedPlans";
import { zenPlanKey } from "../lib/zenBudgets";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useBudgetEditsStore } from "../store/useBudgetEditsStore";
import { budgetEditId } from "../lib/zenmoneyPush";
import { CategoryDot } from "../components/CategoryDot";
import { AccountLogo } from "../components/AccountLogo";
import { Popover } from "../components/Popover";
import { CategoryCascadePicker, type CategoryNode } from "../components/CategoryCascadePicker";
import { MonthCashflowChart } from "../components/MonthCashflowChart";
import { BudgetFillModal, type FillItem } from "../components/BudgetFillModal";
import { BudgetYearTable } from "../components/BudgetYearTable";
import { BudgetSettingsPopover } from "../components/BudgetSettingsPopover";
import { buildBudgetYear, categoryPathKey } from "../lib/budgetYear";
import { useLiveCategoryPaths } from "../hooks/useDictionaries";
import { nameKey } from "../lib/budgetLines";
import { buildBudgetDashboard } from "../lib/budgetDashboard";
import { BudgetDashboardPrint } from "../components/BudgetDashboardPrint";
import { BudgetDashboardView } from "../components/BudgetDashboardView";
import {
  budgetHits,
  insidePerimeter,
  transactionsForCell,
  TRANSFER_CATEGORY,
} from "../lib/budgetScope";
import { useBudgetSettingsStore, type BudgetView } from "../store/useBudgetSettingsStore";
import { Segmented } from "../components/Segmented";
import { Tooltip } from "../components/Tooltip";
import { TooltipFacts, type TooltipFact } from "../components/TooltipFacts";
import { groupByCategory } from "../lib/aggregations";
import {
  plannedFor,
  factFor,
  forecastFor,
  addMonths,
  budgetTone,
  compareBudgetRows,
  lockedFor,
  ownSubsIndex,
  ownSubsFor,
  type BudgetKind,
  type BudgetLine,
} from "../lib/budgets";
import { formatMoney } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { DateField } from "../components/DateField";
import {
  BudgetExportModal,
  budgetExportFileName,
  type BudgetExportFormat,
} from "../components/BudgetExportModal";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

interface Row {
  line: BudgetLine;
  /** Effective plan for the month: the manual plan, or a history forecast. */
  planned: number;
  fact: number;
  /** True when `planned` is a forecast (no manual plan this month). */
  forecast: boolean;
  /** План задан точной суммой (замок Дзен-мани). У категории это значит «вся
   *  категория целиком»: планы под-категорий уже внутри и не складываются. */
  locked?: boolean;
  /** План взят из назначенной операции Дзен-мани, своего плана у статьи нет. */
  scheduled?: boolean;
}

export function BudgetsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const rates = useDataStore((s) => s.rates);
  const showDrill = useDrillStore((s) => s.show);
  const lines = useBudgetsStore((s) => s.lines);
  const addLine = useBudgetsStore((s) => s.addLine);
  const setOverride = useBudgetsStore((s) => s.setOverride);
  const applyPlans = useBudgetsStore((s) => s.applyPlans);
  const hydrate = useBudgetsStore((s) => s.hydrate);
  const loaded = useBudgetsStore((s) => s.loaded);
  // Plan changes queue here and flush via the normal Push flow (Settings push
  // mode). `pendingBudget` lets a row show «ждёт отправки в Дзен».
  const queueBudget = useBudgetEditsStore((s) => s.queue);
  const budgetEdits = useBudgetEditsStore((s) => s.edits);

  // Настройки бюджета: периметр счетов, переводы, вид и прогноз по умолчанию.
  const settings = useBudgetSettingsStore();
  const settingsLoaded = settings.loaded;
  const hydrateSettings = settings.hydrate;

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);
  useEffect(() => {
    if (!settingsLoaded) hydrateSettings();
  }, [settingsLoaded, hydrateSettings]);

  const scope = useMemo(
    () => ({
      accounts: new Set(settings.accounts),
      perimeterTransfers: settings.perimeterTransfers,
    }),
    [settings.accounts, settings.perimeterTransfers]
  );
  // График движения денег считает сам по операциям — ему отдаём только то, что
  // внутри периметра.
  const scopedTx = useMemo(() => insidePerimeter(transactions, scope), [transactions, scope]);

  // Zenmoney's OWN auto-forecasts («из X»). In API mode we show these for
  // income tags without a manual plan — instead of a local median — so «≈»
  // planы match Дзен exactly. `zenLoaded` distinguishes «not yet read» from
  // «CSV mode / no cache» (where the median fallback still applies).
  const [zenForecasts, setZenForecasts] = useState<Map<string, number> | null>(null);
  const [zenLoaded, setZenLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    getZenForecastsFromCache().then((m) => {
      if (!alive) return;
      setZenForecasts(m);
      setZenLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [transactions]);

  // Запланированные операции Дзен-мани этого месяца, разложенные по дням: на
  // графике они видны ступенькой в свой день, а не размазаны до конца месяца
  // (issue #72). Прогнозы самого Дзена не берём — это не назначенная дата, а
  // достроенная регулярность, обещать её конкретным днём неправильно.
  const [zenPlanned, setZenPlanned] = useState<PlannedOp[]>([]);
  useEffect(() => {
    let alive = true;
    loadZenCache().then((c) => {
      if (alive) setZenPlanned(plannedOps(c, rates));
    });
    return () => {
      alive = false;
    };
  }, [transactions, rates]);

  const cur = currentMonth();
  const [ym, setYm] = useState(cur);
  const isCurrent = ym === cur;
  // Past/future months are "complete" for projection purposes (no linear
  // extrapolation); only the current month is partially elapsed.
  const monthProgress = isCurrent
    ? new Date().getDate() / daysInMonth(ym)
    : 1;

  const plannedByDay = useMemo(() => {
    const days = daysInMonth(ym);
    const income = new Array(days + 1).fill(0);
    const expense = new Array(days + 1).fill(0);
    // Периметр счетов действует и на планы: если бюджет сужен до карты, чужой
    // счёт не должен подрисовывать ступеньку на графике. Пустой периметр —
    // все счета, как и везде в разделе.
    const inScope = (account: string) =>
      scope.accounts.size === 0 || scope.accounts.has(account);
    for (const p of zenPlanned) {
      if (p.forecast || !p.date.startsWith(ym)) continue;
      if (!inScope(p.account)) continue;
      const d = Number(p.date.slice(8, 10));
      if (!(d >= 1 && d <= days)) continue;
      if (p.kind === "income") income[d] += p.amountBase;
      else if (p.kind === "expense") expense[d] += p.amountBase;
    }
    return { income, expense };
  }, [zenPlanned, ym, scope]);

  /**
   * План из НАЗНАЧЕННЫХ операций Дзен-мани.
   *
   * Дзен прибавляет запланированные операции к плану статьи, но только если
   * план у неё заведён. Статья без плана в бюджете не появлялась вовсе —
   * оплата назначена, сумма известна, а строки нет до самого списания. Этот
   * список закрывает ровно такие статьи: он показывается там, где своего плана
   * нет, никуда не сохраняется и в Дзен-мани не уходит.
   */
  const plannedAsPlan = useMemo(
    () => plannedPlans(zenPlanned, scope),
    [zenPlanned, scope]
  );

  /**
   * «Ещё в плане» по статьям выбранного месяца — назначенные операции, которые
   * ещё впереди.
   *
   * Дзен-мани делит остаток по статье надвое: что уже назначено на конкретные
   * даты и что ещё свободно. У нас была одна полоса «потрачено из плана», и по
   * ней нельзя было понять, свободны эти деньги или уже расписаны.
   */
  const aheadByTag = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const m = new Map<string, { sum: number; ops: PlannedOp[] }>();
    for (const p of plannedPlans(zenPlanned, scope, today)) {
      if (p.ym !== ym || p.ahead <= 0) continue;
      // Ключ тот же, что у `budgetKey` ниже; собираем его здесь, чтобы не
      // тянуть объявление функции выше по файлу.
      m.set([p.kind, p.category, p.subcategory ?? ""].join("\u0000"), {
        sum: p.ahead,
        ops: p.aheadOps,
      });
    }
    return m;
  }, [zenPlanned, scope, ym]);

  // ── Inline add: a draft row inside the «Расходы»/«Доходы» section ──
  const [draftKind, setDraftKind] = useState<BudgetKind | null>(null);
  const [fCat, setFCat] = useState("");
  const [fSub, setFSub] = useState(""); // "" = вся категория (родительский тег)
  const [fAmount, setFAmount] = useState("");
  const dKind: BudgetKind = draftKind ?? "expense";

  const catsByKind = useMemo(() => {
    const top = groupByCategory(transactions, "top");
    return {
      expense: top.filter((c) => c.expense > 0).map((c) => c.category),
      income: top.filter((c) => c.income > 0).map((c) => c.category),
    };
  }, [transactions]);
  const formCats = catsByKind[dKind];

  // Sub-categories present in the data, per parent category — populates the
  // «под-категория» selector so a budget can target one sub-tag.
  const subsByCat = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of transactions) {
      if (!t.subcategory) continue;
      if (!m.has(t.category)) m.set(t.category, new Set());
      m.get(t.category)!.add(t.subcategory);
    }
    return m;
  }, [transactions]);

  // (kind, category, sub) already budgeted THIS month — the «Добавить» dropdowns
  // offer only what isn't budgeted yet, and the save is blocked on a duplicate.
  /**
   * Ключ статьи на этой странице.
   *
   * Имена НОРМАЛИЗУЮТСЯ (см. `budgetLines`): хвостовой пробел или неразрывный
   * пробел в названии тега невидимы на экране, но раньше разводили одну статью
   * на две — строку плана и «назначенную операцию» с тем же названием, и обе
   * показывались рядом.
   */
  const budgetKey = (kind: string, cat: string, sub: string | null) =>
    nameKey(kind as BudgetKind, cat, sub);
  const budgetedThisMonth = useMemo(() => {
    const s = new Set<string>();
    for (const l of lines)
      if (plannedFor(l, ym) > 0) s.add(budgetKey(l.kind, l.category, l.subcategory ?? null));
    return s;
  }, [lines, ym]);
  const dupLine = budgetedThisMonth.has(budgetKey(dKind, fCat, fSub || null));
  // Picker tree: categories of this kind, with already-budgeted sub-tags removed
  // and categories whose parent + every sub are taken dropped entirely.
  const categoryNodes = useMemo<CategoryNode[]>(() => {
    const nodes: CategoryNode[] = [];
    for (const c of formCats) {
      const subs = [...(subsByCat.get(c) ?? [])]
        .filter((s) => !budgetedThisMonth.has(budgetKey(dKind, c, s)))
        .sort((a, b) => a.localeCompare(b, "ru"));
      const parentTaken = budgetedThisMonth.has(budgetKey(dKind, c, null));
      if (!parentTaken || subs.length > 0) nodes.push({ name: c, subs });
    }
    return nodes;
  }, [formCats, subsByCat, budgetedThisMonth, dKind]);

  function resetForm() {
    setFCat("");
    setFSub("");
    setFAmount("");
    setDraftKind(null);
  }
  /** Start an empty draft row in the given section (the «+» button). */
  function startDraft(kind: BudgetKind) {
    setDraftKind(kind);
    setFCat("");
    setFSub("");
    setFAmount("");
  }
  /** Start a draft pre-filled with a tag (from the «Без бюджета» list) — the
   *  optional sub-category lets a sub-tag suggestion fill straight in. */
  function startAdd(kind: BudgetKind, category: string, subcategory = "") {
    setDraftKind(kind);
    setFCat(category);
    setFSub(subcategory);
    setFAmount("");
  }
  function submitLine() {
    const amt = Number(fAmount);
    if (!fCat || !amt || amt <= 0 || dupLine) return;
    const sub = fSub || null;
    // Per-month model, like imported lines: the plan is an override for THIS
    // month. If a line for this tag already exists (e.g. it had a plan in other
    // months), set its override; otherwise create a new line. Then queue a push
    // so the plan reaches Zenmoney «Планы» (obeys push mode).
    const existing = lines.find(
      (l) => l.kind === dKind && l.category === fCat && (l.subcategory ?? null) === sub
    );
    if (existing) {
      setOverride(existing.id, ym, amt);
    } else {
      addLine({
        category: fCat,
        subcategory: sub,
        kind: dKind,
        amount: 0,
        recurrence: "monthly",
        startMonth: ym,
        endMonth: null,
        overrides: { [ym]: amt },
      });
    }
    void queueBudget({ kind: dKind, category: fCat, subcategory: sub, ym, amount: amt });
    resetForm();
  }

  // Set THIS month's plan for a tag, upserting by (kind, category, sub) instead
  // of by line.id — so a row whose line doesn't exist yet (a parent that has
  // sub-plans but no own plan) is just as editable as one that does. Always
  // queues the push (obeys push mode), like submitLine.
  function setPlan(
    tag: { kind: BudgetKind; category: string; subcategory: string | null },
    amount: number
  ) {
    const existing = lines.find(
      (l) =>
        l.kind === tag.kind &&
        l.category === tag.category &&
        (l.subcategory ?? null) === tag.subcategory
    );
    if (existing) {
      void setOverride(existing.id, ym, amount);
    } else if (amount > 0) {
      addLine({
        category: tag.category,
        subcategory: tag.subcategory,
        kind: tag.kind,
        amount: 0,
        recurrence: "monthly",
        startMonth: ym,
        endMonth: null,
        overrides: { [ym]: amount },
      });
    }
    void queueBudget({ ...tag, ym, amount });
  }

  // ── Вид: месяц, годовой свод или сводка по году ──
  const [view, setView] = useState<BudgetView>("month");
  // Настройки приезжают из базы асинхронно, поэтому вид по умолчанию ставим
  // один раз — после этого переключатель принадлежит пользователю.
  const viewApplied = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || viewApplied.current) return;
    viewApplied.current = true;
    setView(settings.defaultView);
  }, [settingsLoaded, settings.defaultView]);

  const year = Number(ym.slice(0, 4));
  /** Годовые виды — свод и дашборд: обоим нужен весь год данных и «Экспорт». */
  const yearView = view !== "month";
  /**
   * Период в шапке — месяц. Годом он остаётся только в годовом своде: там на
   * экране все двенадцать месяцев сразу, и выбирать из них нечего.
   */
  const monthPeriod = view !== "year";
  const rowOrder = settings.rowOrder;
  // Живые категории — чтобы статьи с именем, которого в справочнике больше
  // нет, и без единой траты за год не висели в отчёте (#77). В режиме CSV
  // справочника нет, хук вернёт null, и ничего не отсеивается.
  const livePaths = useLiveCategoryPaths();
  const yearReport = useMemo(
    () =>
      buildBudgetYear(
        lines,
        transactions,
        year,
        scope,
        rowOrder,
        plannedAsPlan,
        livePaths ?? undefined
      ),
    [lines, transactions, year, scope, rowOrder, plannedAsPlan, livePaths]
  );
  /** Сдвиг года сохраняет месяц: вернувшись в месячный вид, попадаешь в тот же. */
  const shiftYear = (d: number) => setYm((m) => addMonths(m, d * 12));

  // ── Выгрузка годового отчёта в Excel ──
  const prevYearReport = useMemo(
    () =>
      buildBudgetYear(lines, transactions, year - 1, scope, rowOrder, [], livePaths ?? undefined),
    [lines, transactions, year, scope, rowOrder, livePaths]
  );
  /**
   * Месяц, по которому считаются показатели «за месяц» и отрезок «с начала
   * года». Для прошедшего года это декабрь — иначе годовой отчёт обрезался бы
   * на случайном месяце, выбранном в месячном виде. Для текущего — текущий.
   */
  const defaultReportMonth =
    year === Number(cur.slice(0, 4)) ? Number(cur.slice(5, 7)) - 1 : 11;
  /**
   * Выбранный вручную месяц отчёта; `null` — «как обычно», по правилу выше.
   *
   * Держим именно так, а не готовым числом: при переходе на другой год выбор
   * «как обычно» должен переехать вместе с ним, а не остаться прошлогодним
   * декабрём. В Excel месяц потом переключается прямо в книге, а PDF — растр,
   * и там это единственная возможность выбрать.
   */
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);
  /**
   * Месяц показателей. На дашборде он берётся ПРЯМО ИЗ ПЕРИОДА В ШАПКЕ — того
   * же контрола «‹ Август 2026 ›», что и в месячном виде: отдельная карточка с
   * двенадцатью кнопками занимала треть первого экрана и была единственным
   * местом в разделе, где период выбирался не в шапке.
   */
  const dashboardMonth = Number(ym.slice(5, 7)) - 1;
  /** Название месяца по номеру: «Август» с заглавной или «август» в перечне. */
  const monthOf = (idx: number, capital = false) => {
    const name = new Date(2000, idx, 1).toLocaleDateString("ru-RU", { month: "long" });
    return capital ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  };
  const reportMonthIndex =
    view === "dashboard" ? dashboardMonth : (pickedMonth ?? defaultReportMonth);
  /** Смена месяца отчёта из окна выгрузки: на дашборде она двигает период. */
  const setReportMonth = (idx: number) => {
    if (view === "dashboard") setYm(`${year}-${String(idx + 1).padStart(2, "0")}`);
    else setPickedMonth(idx);
  };
  /** Дашборд для печати — та же модель, что уходит в Excel. */
  const printDashboard = useMemo(
    () => buildBudgetDashboard(yearReport, prevYearReport, reportMonthIndex),
    [yearReport, prevYearReport, reportMonthIndex]
  );
  const [exportOpen, setExportOpen] = useState(false);

  /** Собрать и отдать файл. Ошибку пробрасываем: по ней окно остаётся открытым,
   *  чтобы можно было попробовать ещё раз, не проходя путь до кнопки заново. */
  const runExport = async (format: BudgetExportFormat) => {
    const fileName = budgetExportFileName(year, reportMonthIndex, format);
    try {
      if (format === "xlsx") {
        const { exportBudgetYearXlsx } = await import("../lib/budgetYearXlsx");
        await exportBudgetYearXlsx(
          yearReport,
          prevYearReport,
          reportMonthIndex,
          base,
          fileName
        );
      } else {
        const { downloadDashboardPdf } = await import("../lib/budgetPdf");
        // Печатная вёрстка живёт порталом на `body` и на экране скрыта — на
        // время съёмки её показывают за краем окна (см. `downloadDashboardPdf`).
        const root = document.querySelector<HTMLElement>(".print-root");
        if (!root) throw new Error("Печатная вёрстка не найдена");
        await downloadDashboardPdf(root, fileName, `Бюджет ${year}`);
      }
    } catch (e) {
      console.error(e);
      alert(
        format === "xlsx"
          ? "Годовой отчёт не выгрузился в Excel. Попробуйте ещё раз — а если повторится, напишите нам."
          : "Отчёт не выгрузился в PDF. Попробуйте ещё раз — а если повторится, напишите нам."
      );
      throw e;
    }
  };

  // ── Заполнение по среднему ──
  const [fillOpen, setFillOpen] = useState(false);
  /** Разложить предложенные суммы по статьям. Планы пишутся одной правкой
   *  (иначе шесть параллельных записей затирают друг друга), а в очередь
   *  отправки в Дзен-мани каждая статья идёт своей строкой. */
  function applyFill(items: FillItem[]) {
    void applyPlans(items.map((it) => ({ ...it, ym })));
    for (const it of items) {
      void queueBudget({
        kind: it.kind,
        category: it.category,
        subcategory: it.subcategory,
        ym,
        amount: it.amount,
      });
    }
  }

  const rows = useMemo<Row[]>(() => {
    // Первый проход — только планы: от фактов они не зависят, а факт категории
    // зависит от того, какие под-строки в итоге окажутся на экране (issue #70).
    const inWindow = lines
      // A line belongs to a month only while it's inside its validity window
      // [startMonth, endMonth]. A budget that starts in June must NOT appear
      // in May/April, even if that category had spending then.
      .filter(
        (line) => ym >= line.startMonth && (!line.endMonth || ym <= line.endMonth)
      )
      .map((line) => {
        const planned = plannedFor(line, ym);
        // Income with no manual plan → show a forecast «≈ из X». In API mode use
        // ZENMONEY's own auto-forecast (so numbers match Дзен, and tags Дзен
        // doesn't forecast get no phantom «≈»); in CSV mode fall back to a local
        // median. Never pushed to Дзен.
        if (planned === 0 && line.kind === "income") {
          let fc = 0;
          if (!zenLoaded) fc = 0; // still reading cache — avoid a median flash
          else if (zenForecasts)
            fc = zenForecasts.get(
              zenPlanKey(line.kind, line.category, line.subcategory ?? null, ym)
            ) ?? 0; // API: trust Дзен (missing = no forecast)
          else fc = forecastFor(line, transactions, ym, 6, scope); // CSV: median estimate
          if (fc > 0) return { line, planned: fc, forecast: true };
        }
        return { line, planned, forecast: false, locked: lockedFor(line, ym) };
      });
    // Show only TAGS actually budgeted this month (план > 0). A sub-tag with no
    // own plan is NOT rolled into its parent (Zenmoney puts such spending under
    // «Вне плана»), so a parent never overstates % when one child is budgeted and
    // another is only auto-forecast (e.g. Банки → Кэшбек budgeted, Проценты only
    // forecast). Unbudgeted tags surface under «Без бюджета».
    const shown = inWindow.filter((r) => r.planned > 0);
    // Статьи, у которых своего плана нет, но на этот месяц НАЗНАЧЕНА операция:
    // сумма и дата известны, и держать такую статью вне бюджета до самого
    // списания незачем. Там, где план есть, ничего не добавляем — Дзен-мани уже
    // прибавил назначенные операции к нему сам.
    const withPlan = new Set(
      shown.map((r) => budgetKey(r.line.kind, r.line.category, r.line.subcategory ?? null))
    );
    const scheduled: { line: BudgetLine; planned: number; forecast: boolean; scheduled: true }[] =
      [];
    for (const p of plannedAsPlan) {
      if (p.ym !== ym) continue;
      const key = budgetKey(p.kind, p.category, p.subcategory);
      if (withPlan.has(key)) continue;
      scheduled.push({
        line: {
          id: `scheduled:${key}`,
          category: p.category,
          subcategory: p.subcategory,
          kind: p.kind,
          amount: 0,
          recurrence: "monthly",
          startMonth: ym,
          endMonth: null,
          createdAt: "",
        },
        planned: p.amount,
        forecast: false,
        scheduled: true,
      });
    }
    const all = [...shown, ...scheduled];
    // Второй проход — факты. Строка категории забирает и траты по своим
    // под-категориям, кроме тех, что показаны отдельной строкой прямо здесь.
    const ownSubs = ownSubsIndex(all);
    const budgeted = all
      .map(
        (r): Row => ({
          ...r,
          fact: factFor(r.line, transactions, ym, scope, ownSubsFor(ownSubs, r.line)),
        })
      )
      // Призрак переименования: имени в справочнике больше нет, трат за месяц
      // нет и быть не может — весь факт уехал на новое имя (#77). Тот же
      // отбор, что в годовом своде, только по факту месяца.
      .filter(
        (r) =>
          !livePaths ||
          r.fact !== 0 ||
          r.line.category === TRANSFER_CATEGORY ||
          livePaths.has(categoryPathKey(r.line.category, r.line.subcategory ?? null))
      );
    // Порядок статей — общий для всего раздела: по алфавиту или по сумме
    // (issue #68). Раньше строки шли по времени создания плана — порядок,
    // который виден только нам, а на экране выглядел случайным. Категории без
    // трат за месяц отделяет уже сам раздел, отдельным спойлером.
    const catFact = new Map<string, number>();
    const catKey = (r: Row) => `${r.line.kind}\u0000${r.line.category}`;
    for (const r of budgeted) catFact.set(catKey(r), (catFact.get(catKey(r)) ?? 0) + r.fact);
    return budgeted.sort((a, b) => {
      if (a.line.category !== b.line.category)
        return compareBudgetRows(
          { name: a.line.category, amount: catFact.get(catKey(a)) ?? 0 },
          { name: b.line.category, amount: catFact.get(catKey(b)) ?? 0 },
          rowOrder
        );
      // Внутри категории первой идёт она сама, следом её под-категории.
      const as = a.line.subcategory ?? "";
      const bs = b.line.subcategory ?? "";
      if (!as || !bs) return as ? 1 : bs ? -1 : 0;
      return compareBudgetRows({ name: as, amount: a.fact }, { name: bs, amount: b.fact }, rowOrder);
    });
  }, [lines, ym, transactions, zenForecasts, zenLoaded, scope, rowOrder, plannedAsPlan, livePaths]);
  const expenseRows = rows.filter((r) => r.line.kind === "expense");
  const incomeRows = rows.filter((r) => r.line.kind === "income");

  // Tags with spending THIS month but no plan — surfaced so they can be
  // budgeted. Aggregated at the TAG level (parent-direct AND each sub-tag), so a
  // sub-category overspending under a budgeted parent still shows, and its
  // «+ План» pre-fills that exact sub-tag.
  const unbudgeted = useMemo(() => {
    const agg = new Map<
      string,
      { kind: BudgetKind; category: string; subcategory: string | null; fact: number }
    >();
    const add = (
      kind: BudgetKind,
      category: string,
      subcategory: string | null,
      amount: number
    ) => {
      const key = budgetKey(kind, category, subcategory);
      const cur = agg.get(key);
      if (cur) cur.fact += amount;
      else agg.set(key, { kind, category, subcategory, fact: amount });
    };
    for (const t of transactions) {
      if (!(t.date || "").startsWith(ym)) continue;
      // Тем же правилом, что и суммы: периметр счетов, переводы через границу и
      // отсев «Без категории» — всё внутри `budgetHit`.
      // Попаданий может быть два: у перевода списание идёт в расходы, а
      // зачисление — в доходы.
      for (const hit of budgetHits(t, scope))
        add(hit.kind, hit.category, hit.subcategory, hit.amount);
    }
    // A tag belongs in «Без бюджета» only if it isn't ALREADY shown in the
    // budget section above. That includes income tags shown via a history
    // forecast (no manual plan, but clearly represented with a «≈» and a
    // click-to-plan) — keying off `budgetedThisMonth` (manual plans only) listed
    // such forecast-only tags BOTH above and here. Key off what's actually shown.
    const shown = new Set(
      rows.map((r) => budgetKey(r.line.kind, r.line.category, r.line.subcategory ?? null))
    );
    // Под-категория не «без бюджета», если план есть у её КАТЕГОРИИ: эти траты
    // уже проедают родительский план и показаны в нём (#70). Иначе одни и те же
    // деньги стояли бы на экране дважды — в строке «Медицина» и здесь же
    // отдельной строкой «Медицина / Лекарства».
    const parentBudgeted = (u: { kind: BudgetKind; category: string; subcategory: string | null }) =>
      u.subcategory !== null && shown.has(budgetKey(u.kind, u.category, null));
    return [...agg.values()]
      .filter(
        (u) =>
          u.fact > 0 &&
          // Переводы планировать нельзя и не нужно. «Переводы» — наша
          // собственная статья, в справочнике Дзен-мани такого тега нет:
          // заведённый по ней план навсегда завис бы неотправленным. Да и по
          // сути перевод между своими счетами не доход и не расход — его
          // показывают, чтобы видеть обороты, а не чтобы на него планировать.
          u.category !== TRANSFER_CATEGORY &&
          !shown.has(budgetKey(u.kind, u.category, u.subcategory)) &&
          !parentBudgeted(u)
      )
      // Тем же порядком, что и статьи с планом: список на одной странице,
      // который местами по алфавиту, а местами по сумме, читается как сбой.
      .sort((a, b) =>
        compareBudgetRows(
          { name: a.subcategory ? `${a.category} ${a.subcategory}` : a.category, amount: a.fact },
          { name: b.subcategory ? `${b.category} ${b.subcategory}` : b.category, amount: b.fact },
          rowOrder
        )
      );
  }, [transactions, ym, rows, scope, rowOrder]);

  /**
   * Переводы за месяц по счетам — то же, что статья «Переводы» в годовом своде
   * и на дашборде.
   *
   * Без этого блока месячный вид оставался единственным местом, где переводов
   * не видно вовсе: в карточках стояло «включая переводы», а откуда взялась
   * разница — посмотреть было негде. Планов у переводов нет и быть не может
   * (см. `unbudgeted`), поэтому и полос с процентами здесь нет — только
   * обороты по счёту с той стороны.
   */
  const transfers = useMemo(() => {
    const agg = new Map<string, { kind: BudgetKind; account: string; sum: number }>();
    for (const t of transactions) {
      if (!(t.date || "").startsWith(ym)) continue;
      for (const hit of budgetHits(t, scope)) {
        if (!hit.transfer) continue;
        const account = hit.subcategory ?? "—";
        const key = `${hit.kind}\u0000${account}`;
        const cur = agg.get(key);
        if (cur) cur.sum += hit.amount;
        else agg.set(key, { kind: hit.kind, account, sum: hit.amount });
      }
    }
    const side = (kind: BudgetKind) =>
      [...agg.values()]
        .filter((x) => x.kind === kind && x.sum > 0)
        .sort((a, b) => b.sum - a.sum);
    return { out: side("expense"), in: side("income") };
  }, [transactions, ym, scope]);

  /** Операции статьи за месяц — по умолчанию за выбранный, но годовой свод
   *  открывает свою ячейку, поэтому месяц передаётся явно. */
  function openCategory(
    cat: string,
    sub: string | null,
    month = ym,
    kind?: BudgetKind
  ) {
    const txs = transactionsForCell(
      transactions,
      scope,
      { kind, category: cat, subcategory: sub },
      month
    );
    const label = sub ? `${cat} › ${sub}` : cat;
    showDrill(`${label} · ${month}`, txs, "Бюджет");
  }

  // Click a day on the cash-flow chart → drill into that day's operations.
  function openDay(day: number) {
    const dd = String(day).padStart(2, "0");
    const date = `${ym}-${dd}`;
    const txs = scopedTx.filter((t) => t.date.startsWith(date));
    if (txs.length === 0) return;
    showDrill(`${day} · ${ym}`, txs, "День");
  }

  if (transactions.length === 0) return <EmptyState />;

  // План раздела: у категории с ЗАМКОМ планы её под-категорий уже внутри её
  // числа, и прибавлять их второй раз нельзя — иначе итог раздела больше того,
  // что показывает Дзен-мани, ровно на сумму таких под-категорий.
  const lockedParents = new Set(
    rows
      .filter((r) => !r.line.subcategory && r.locked)
      .map((r) => `${r.line.kind}\u0000${r.line.category}`)
  );
  const planOf = (r: Row) =>
    r.line.subcategory && lockedParents.has(`${r.line.kind}\u0000${r.line.category}`)
      ? 0
      : r.planned;
  const expPlan = expenseRows.reduce((s, r) => s + planOf(r), 0);
  const expFact = expenseRows.reduce((s, r) => s + r.fact, 0);
  const incPlan = incomeRows.reduce((s, r) => s + planOf(r), 0);
  const incFact = incomeRows.reduce((s, r) => s + r.fact, 0);
  // Переводы за месяц — отдельно от статей: они не траты и не поступления, а
  // оборот по счетам. Показываются второй строкой в карточках.
  let expTransfers = 0;
  let incTransfers = 0;
  for (const t of transactions) {
    if (!(t.date || "").startsWith(ym)) continue;
    for (const hit of budgetHits(t, scope)) {
      if (!hit.transfer) continue;
      if (hit.kind === "expense") expTransfers += hit.amount;
      else incTransfers += hit.amount;
    }
  }
  // Дельта = доходы − расходы, отдельно по плану и по факту. Переводы входят в
  // обе части и внутри бюджета гасятся; перевод наружу — настоящий отток.
  const planDelta = incPlan - expPlan;
  const factDelta = incFact + incTransfers - (expFact + expTransfers);

  // Inline draft row (appears inside a section after the «+»). Mirrors a normal
  // budget row: category/sub picker · amount · ✓ · ✗.
  const draftRow = (
    <div className="card">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="w-4 shrink-0" />
        <div className="w-[30rem] max-w-[60vw] shrink-0">
          <CategoryCascadePicker
            category={fCat}
            subcategory={fSub}
            categories={categoryNodes}
            hideParentOption={(c) => budgetedThisMonth.has(budgetKey(dKind, c, null))}
            onChange={(c, s) => { setFCat(c); setFSub(s); }}
            placeholder="— категория —"
          />
        </div>
        <div className="flex-1" />
        <input
          type="number"
          autoFocus={!!fCat}
          value={fAmount}
          onChange={(e) => setFAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitLine();
            if (e.key === "Escape") resetForm();
          }}
          placeholder={`Сумма, ${base}`}
          className="input text-sm w-32 shrink-0 text-right"
        />
        <Tooltip content="Сохранить">
          <button
            onClick={submitLine}
            disabled={!fCat || !Number(fAmount) || dupLine}
            className="text-income disabled:opacity-30 disabled:cursor-not-allowed shrink-0 p-1"
          >
            <Check className="w-5 h-5" />
          </button>
        </Tooltip>
        <Tooltip content="Отмена">
          <button onClick={resetForm} className="text-muted hover:text-text shrink-0 p-1">
            <X className="w-5 h-5" />
          </button>
        </Tooltip>
      </div>
      {dupLine && (
        <p className="text-xs text-warn px-3 pb-2">
          Бюджет на «{fSub || fCat}» в этом месяце уже есть
        </p>
      )}
    </div>
  );

  const addButton = (kind: BudgetKind) => (
    <Tooltip content={kind === "expense" ? "Добавить категорию расходов" : "Добавить категорию доходов"}>
      <button
        onClick={() => startDraft(kind)}
        className="btn-primary !p-2"
        aria-label="Добавить категорию"
      >
        <Plus className="w-4 h-4" />
      </button>
    </Tooltip>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Бюджет"
        hint="План и факт по статьям: сводка за год, выбранный месяц и помесячная таблица. Планы синхронизируются с Дзен-мани, отчёт выгружается в Excel и PDF."
      />

      {/* Панель: вид и период (слева), действия (справа). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Segmented
            size="sm"
            label="Вид бюджета"
            value={view}
            onChange={(v) => setView(v)}
            // Дашборд первым: с него начинают — «как год в целом», а уже
            // потом идут вглубь, в месяц и в помесячную таблицу.
            options={[
              {
                value: "dashboard" as const,
                label: "Дашборд",
                title: "Сводка по году: показатели, выполнение плана и статьи диаграммами",
              },
              { value: "month" as const, label: "Месяц", title: "План и факт выбранного месяца" },
              { value: "year" as const, label: "Год", title: "Двенадцать месяцев плана и факта с итогами" },
            ]}
            className="mr-1.5"
          />
          <Tooltip content={monthPeriod ? "Предыдущий месяц" : "Предыдущий год"}>
            <button
              onClick={() => (monthPeriod ? setYm((m) => addMonths(m, -1)) : shiftYear(-1))}
              className="btn-ghost !p-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </Tooltip>
          {monthPeriod ? (
            <DateField
              granularity="month"
              value={ym}
              onChange={(e) => e.target.value && setYm(e.target.value)}
              centered
              // Ширина фиксированная и посчитана под самое длинное сокращение
              // («Сен. 2026»): при `min-width` кнопка дышала на каждом шаге, и
              // соседние стрелки ездили вместе с ней. Поля уже обычного поля
              // ввода — тут не текст набирают, а листают месяцы.
              className="input text-sm font-medium w-[138px] !px-2"
            />
          ) : (
            <span className="text-sm font-medium tabular-nums px-3 py-1.5 rounded-lg bg-panel2 border border-border">
              {year}
            </span>
          )}
          <Tooltip content={monthPeriod ? "Следующий месяц" : "Следующий год"}>
            <button
              onClick={() => (monthPeriod ? setYm((m) => addMonths(m, 1)) : shiftYear(1))}
              className="btn-ghost !p-2"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </Tooltip>
          {(monthPeriod ? !isCurrent : year !== Number(cur.slice(0, 4))) && (
            <button
              onClick={() => setYm(cur)}
              className="text-xs text-accent hover:underline ml-1"
            >
              {/* Одно слово в обоих видах: рядом стоит сам период, и «текущий
                  что» из него понятно без повтора. */}
              Текущий
            </button>
          )}
          {/* Что именно считает выбранный месяц — подсказкой, а не строкой на
              экране: два из трёх фактов видно и так (заголовки плиток и сам
              период в шапке), а третий нужен раз в жизни. */}
          {view === "dashboard" && (
            <Tooltip
              content={
                <TooltipFacts
                  title="Показатели на этом экране"
                  facts={[
                    { label: "За месяц", value: `${monthOf(dashboardMonth, true)} ${year}` },
                    {
                      label: "С начала года",
                      value: `Январь — ${monthOf(dashboardMonth)}`,
                    },
                  ]}
                  note={<span className="italic">Прошлый год берётся тем же отрезком</span>}
                />
              }
            >
              <button
                type="button"
                aria-label="За какой период показатели на этом экране"
                className="text-muted hover:text-text"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          {yearView && (
            <Tooltip content="Годовой отчёт файлом: таблицами в Excel или сводкой в PDF">
              <button onClick={() => setExportOpen(true)} className="btn-ghost text-sm">
                <Download className="w-4 h-4" />
                Экспорт
              </button>
            </Tooltip>
          )}
          {/* Заполнение подставляет планы в ОДИН месяц — выбранный. Поэтому
              кнопка живёт только в месячном виде: в годовом своде на экране
              двенадцать месяцев сразу, и «в какой из них попадут суммы» —
              вопрос, которого быть не должно. На дашборде то же самое: это
              отчёт, а не место, где правят планы. */}
          {view === "month" && (
            <Tooltip content="Подставить суммы по истории операций">
              <button onClick={() => setFillOpen(true)} className="btn-ghost text-sm">
                <Wand2 className="w-4 h-4" />
                Заполнить по среднему
              </button>
            </Tooltip>
          )}
          <BudgetSettingsPopover transactions={transactions} />
        </div>
      </div>

      {fillOpen && (
        <BudgetFillModal
          ym={ym}
          transactions={transactions}
          lines={lines}
          base={base}
          scope={scope}
          defaultMonths={settings.forecastMonths}
          defaultBasis={settings.forecastBasis}
          // Окно — единственное место, где эти два вопроса задаются; ответ
          // запоминается, чтобы в следующий раз оно открылось так же.
          onParamsChange={({ months, basis }) =>
            void settings.update({ forecastMonths: months, forecastBasis: basis })
          }
          onApply={applyFill}
          onClose={() => setFillOpen(false)}
        />
      )}

      {exportOpen && (
        <BudgetExportModal
          year={year}
          month={reportMonthIndex}
          onMonthChange={setReportMonth}
          onExport={runExport}
          onClose={() => setExportOpen(false)}
        />
      )}

      {view === "year" && (
        <BudgetYearTable
          report={yearReport}
          base={base}
          hideEmpty={settings.hideEmptyRows}
          onOpenCell={openCategory}
        />
      )}

      {view === "dashboard" && (
        <BudgetDashboardView
          dashboard={printDashboard}
          base={base}
          onOpenRow={(row) =>
            openCategory(row.category, row.subcategory, yearReport.months[reportMonthIndex], row.kind)
          }
        />
      )}

      {/* Печатная вёрстка: на экране скрыта, в PDF — единственное, что попадёт
          на лист. Держим её в обоих годовых видах, из каждого есть «Экспорт». */}
      {yearView && <BudgetDashboardPrint dashboard={printDashboard} base={base} />}

      {view === "month" && (
        <>
      {/* Summary: расходы / доходы / дельта — у каждого явные «Факт» и «План» */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PlanFactCard
          title="Расходы за месяц"
          fact={expFact}
          plan={expPlan}
          factClass="text-expense"
          base={base}
          kind="expense"
          withTransfers={settings.perimeterTransfers ? expFact + expTransfers : undefined}
        />
        <PlanFactCard
          title="Доходы за месяц"
          fact={incFact}
          plan={incPlan}
          factClass="text-income"
          base={base}
          kind="income"
          withTransfers={settings.perimeterTransfers ? incFact + incTransfers : undefined}
        />
        <PlanFactCard
          title="Разница (доходы − расходы)"
          fact={factDelta}
          plan={planDelta}
          factClass={factDelta >= 0 ? "text-income" : "text-expense"}
          signed
          base={base}
          kind="delta"
          withTransfers={settings.perimeterTransfers ? factDelta : undefined}
        />
      </div>

      {/* Full-width cash-flow widget: cumulative income/expense over the month
          with a linear end-of-month forecast (Zen «Планы» style). */}
      <MonthCashflowChart
        transactions={scopedTx}
        ym={ym}
        base={base}
        onDayClick={openDay}
        plannedIncome={incPlan}
        plannedExpense={expPlan}
        plannedIncomeByDay={plannedByDay.income}
        plannedExpenseByDay={plannedByDay.expense}
      />

      <div className="space-y-6">
        <Section
          heading="Расходы"
          rows={expenseRows}
          ym={ym}
          isCurrent={isCurrent}
          monthProgress={monthProgress}
          base={base}
          onOpen={openCategory}
          setPlan={setPlan}
          budgetEdits={budgetEdits}
          aheadByTag={aheadByTag}
          hideEmpty={settings.hideEmptyRows}
          headerAction={addButton("expense")}
          prepend={draftKind === "expense" ? draftRow : undefined}
        />
        <Section
          heading="Доходы"
          rows={incomeRows}
          ym={ym}
          isCurrent={isCurrent}
          monthProgress={monthProgress}
          base={base}
          onOpen={openCategory}
          setPlan={setPlan}
          budgetEdits={budgetEdits}
          aheadByTag={aheadByTag}
          hideEmpty={settings.hideEmptyRows}
          headerAction={addButton("income")}
          prepend={draftKind === "income" ? draftRow : undefined}
        />
        {unbudgeted.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="font-semibold text-lg">Без бюджета</h2>
                <span className="text-sm text-muted">Траты есть, плана нет</span>
              </div>
              <div className="card divide-y divide-border">
                {unbudgeted.map((u) => (
                  <div
                    key={`${u.kind}/${u.category}/${u.subcategory ?? ""}`}
                    className="flex items-center gap-2.5 px-3 py-2.5"
                  >
                    {u.subcategory ? (
                      <CategoryDot category={u.subcategory} parent={u.category} size="w-7 h-7" />
                    ) : (
                      <CategoryDot category={u.category} size="w-7 h-7" />
                    )}
                    <button
                      onClick={() => openCategory(u.category, u.subcategory)}
                      className="text-sm font-medium truncate flex-1 min-w-0 text-left hover:text-accent"
                      title={u.subcategory ? `${u.category} / ${u.subcategory}` : u.category}
                    >
                      {u.subcategory ? (
                        <>
                          <span className="text-muted">{u.category} / </span>
                          {u.subcategory}
                        </>
                      ) : (
                        u.category
                      )}
                    </button>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                        u.kind === "income" ? "text-income bg-income/10" : "text-muted bg-panel2"
                      }`}
                    >
                      {u.kind === "income" ? "Доход" : "Расход"}
                    </span>
                    <span className="text-sm tabular-nums shrink-0 w-32 text-right">
                      {formatMoney(u.fact, base)}
                    </span>
                    <Tooltip content="Задать план на этот месяц">
                      <button
                        onClick={() => startAdd(u.kind, u.category, u.subcategory ?? "")}
                        className="btn-ghost text-sm shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        План
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          )}
        {settings.perimeterTransfers && (transfers.out.length > 0 || transfers.in.length > 0) && (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="font-semibold text-lg">Переводы</h2>
              <span className="text-sm text-muted">
                Оборот между своими счетами — ни расход, ни доход, планов у него нет
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TransferList
                title="Списания"
                rows={transfers.out}
                base={base}
                onOpen={(account) => openCategory(TRANSFER_CATEGORY, account, ym, "expense")}
              />
              <TransferList
                title="Зачисления"
                rows={transfers.in}
                base={base}
                onOpen={(account) => openCategory(TRANSFER_CATEGORY, account, ym, "income")}
              />
            </div>
          </div>
        )}
        </div>
        </>
      )}
    </div>
  );
}

/** Summary card showing «Факт» (prominent, coloured) and «План» side by side. */
// Состояние (цвет пилюли и полоски) считает общий `budgetTone` — тот же, что и
// в годовом своде.
const summaryTone = budgetTone;

function PlanFactCard({
  title,
  fact,
  plan,
  factClass,
  base,
  signed = false,
  kind,
  withTransfers,
}: {
  title: string;
  fact: number;
  plan: number;
  factClass: string;
  base: string;
  signed?: boolean;
  kind: "expense" | "income" | "delta";
  /**
   * Тот же факт, но вместе с переводами. Задан — под суммой появляется вторая
   * строка; ЗАДАВАТЬ ЕГО НАДО ВСЕМ ТРЁМ карточкам сразу, когда переводы
   * учитываются. Иначе у одной карточки строка есть, у другой нет — и пилюли
   * «План» и «%» встают на разной высоте, хотя карточки стоят в один ряд.
   */
  withTransfers?: number;
}) {
  return (
    <div className="card card-pad">
      <div className="label mb-1.5">{title}</div>
      <div className={`stat-num ${factClass} mb-3`}>
        {formatMoney(fact, base, { signed })}
      </div>
      {/* Оборот по счетам показываем ОТДЕЛЬНОЙ строкой, а не вместо факта:
          перекладывание денег между своими счетами тратой не является. У
          «Дельты» переводы внутри бюджета гасят друг друга, и вторая сумма
          совпадает с первой — там строка держит место пустой, чтобы ряд
          карточек не разъезжался. */}
      {withTransfers !== undefined && (
        <div
          className="-mt-2 mb-3 text-[13px] text-muted tabular-nums"
          aria-hidden={withTransfers === fact}
        >
          {withTransfers === fact ? (
            <span className="invisible">—</span>
          ) : (
            <>
              {formatMoney(withTransfers, base, { signed })} включая переводы
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm px-3 py-1 rounded-full bg-panel2 text-muted tabular-nums whitespace-nowrap">
          План {formatMoney(plan, base, { signed })}
        </span>
        {kind === "delta" ? (
          <span
            className={`text-sm font-medium px-3 py-1 rounded-full whitespace-nowrap ${
              fact >= 0 ? PILL_TONE.income : PILL_TONE.expense
            }`}
          >
            {fact >= 0 ? "Профицит" : "Дефицит"}
          </span>
        ) : (
          plan > 0 && (
            <span
              className={`text-sm font-medium px-3 py-1 rounded-full tabular-nums ${
                PILL_TONE[summaryTone(fact / plan, kind === "income")]
              }`}
            >
              {Math.round((fact / plan) * 100)}%
            </span>
          )
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  heading: string;
  rows: Row[];
  ym: string;
  isCurrent: boolean;
  monthProgress: number;
  base: string;
  onOpen: (cat: string, sub: string | null) => void;
  /** Upsert THIS month's plan for a tag (by kind/category/sub) and queue push. */
  setPlan: (
    tag: { kind: BudgetKind; category: string; subcategory: string | null },
    amount: number
  ) => void;
  budgetEdits: Record<string, unknown>;
  /** «Ещё в плане» по статьям: назначенные операции, которые ещё впереди. */
  aheadByTag: Map<string, { sum: number; ops: PlannedOp[] }>;
  /** Прятать ли категории без движения за месяц (настройка раздела). */
  hideEmpty: boolean;
  /** «+» button next to the heading. */
  headerAction?: ReactNode;
  /** Inline draft row, rendered at the TOP of the list (new categories first). */
  prepend?: ReactNode;
}

function Section({
  heading,
  rows,
  base,
  hideEmpty,
  aheadByTag,
  headerAction,
  prepend,
  ...rest
}: SectionProps) {
  /** «Ещё в плане» одной строки — по её тегу. */
  const aheadKey = (r: Row) =>
    [r.line.kind, r.line.category, r.line.subcategory ?? ""].join("\u0000");
  const aheadOf = (r: Row) => aheadByTag.get(aheadKey(r))?.sum ?? 0;
  // Group rows by parent category (parent line first, then its sub-tags),
  // preserving the incoming order so the biggest categories stay on top.
  const order: string[] = [];
  const groups = new Map<string, { parent?: Row; subs: Row[] }>();
  for (const r of rows) {
    const cat = r.line.category;
    let g = groups.get(cat);
    if (!g) {
      g = { subs: [] };
      groups.set(cat, g);
      order.push(cat);
    }
    if (r.line.subcategory) g.subs.push(r);
    else g.parent = r;
  }

  // Sub-tags collapse under their category by default — disclosure keeps the
  // list compact. Toggled per category.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  // Раскрыть/свернуть всё сразу — как на «Категориях», «Сравнении» и в отчёте
  // «Доходы и расходы». Кнопки нет, когда раскрывать нечего: у всех категорий
  // раздела нет подкатегорий с планом.
  const expandable = order.filter((cat) => (groups.get(cat)?.subs.length ?? 0) > 0);
  const allExpanded =
    expandable.length > 0 && expandable.every((cat) => expanded.has(cat));
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(expandable));

  // Категории без движения за месяц — под спойлером. Настройка задаёт только
  // начальное состояние: щелчок по разделителю важнее, но и переключение
  // настройки при открытой странице не должно проходить мимо.
  const [emptyPicked, setEmptyPicked] = useState<boolean | null>(null);
  const emptyOpen = emptyPicked ?? !hideEmpty;
  const setEmptyOpen = (next: boolean) => setEmptyPicked(next);

  // Split categories into those WITH movement this month and those without; the
  // empty ones live under a collapsible divider so the list stays focused on
  // where money actually moved. The wording follows the section's kind
  // («траты» for expenses, «поступления» for income).
  const sectionKind: BudgetKind = rows[0]?.line.kind ?? "expense";
  const emptyNoun = sectionKind === "income" ? "поступлений" : "трат";
  const withOps: string[] = [];
  const emptyCats: string[] = [];
  for (const cat of order) {
    const g = groups.get(cat)!;
    const rollupFact = (g.parent?.fact ?? 0) + g.subs.reduce((s, r) => s + r.fact, 0);
    // Статья с НАЗНАЧЕННОЙ операцией под спойлер не уходит: операции ещё не
    // было по определению, но дата и сумма известны — это «ожидается», а не
    // «пусто», и прятать её значит прятать ровно то, ради чего строка есть.
    const scheduled = !!g.parent?.scheduled || g.subs.some((r) => r.scheduled);
    (rollupFact === 0 && !scheduled ? emptyCats : withOps).push(cat);
  }

  const renderCat = (cat: string) => {
    const g = groups.get(cat)!;
    const hasSubs = g.subs.length > 0;
    const isOpen = expanded.has(cat);
    // A parent with sub-plans but no own plan gets a SYNTHETIC parent row, so
    // it's edited/managed exactly like a parent that does have an own plan
    // (no read-only «GroupHeader» fork). Its own plan/fact are 0; the row
    // shows the children's rollup, and editing creates the parent tag's own
    // plan via setPlan (upsert by tag).
    const kind = g.parent?.line.kind ?? g.subs[0]?.line.kind ?? "expense";
    const parent: Row =
      g.parent ?? {
        line: {
          id: `virt:${kind}:${cat}`,
          category: cat,
          subcategory: null,
          kind,
          amount: 0,
          recurrence: "monthly",
          startMonth: rest.ym,
          endMonth: null,
          createdAt: "",
        },
        planned: 0,
        fact: 0,
        forecast: false,
      };
    return (
      <div key={cat} className="card">
        <BudgetRow
          row={parent}
          base={base}
          hasSubs={hasSubs}
          expanded={isOpen}
          onToggle={() => toggle(cat)}
          rollupFact={
            hasSubs ? parent.fact + g.subs.reduce((s, r) => s + r.fact, 0) : undefined
          }
          // «Ещё в плане» у категории — своё плюс все под-категории, как и факт.
          rollupAhead={
            hasSubs
              ? aheadOf(parent) + g.subs.reduce((s, r) => s + aheadOf(r), 0)
              : aheadOf(parent)
          }
          // План категории — СВОЙ план плюс планы под-категорий, ровно как в
          // Дзен-мани: «Еда дома 50 000» и «Алкоголь 5 000» дают в строке
          // категории 55 000. Так же считается и факт строки (свои траты плюс
          // траты под-категорий) — сравнивать сумму с частью плана значило бы
          // показывать неверный процент.
          //
          // Правка при этом остаётся правкой СВОЕГО плана: введённое число
          // уменьшается на сумму под-категорий (см. `subsTotal`), поэтому
          // «поставил 37 000 → стало 72 000» не повторяется.
          rollupPlanned={
            hasSubs
              ? parent.locked
                ? parent.planned
                : parent.planned + g.subs.reduce((s, r) => s + r.planned, 0)
              : undefined
          }
          {...rest}
        />
        {hasSubs && (
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="border-t border-border">
                {g.subs.map((s) => (
                            <BudgetRow
                    key={s.line.id}
                    row={s}
                    base={base}
                    rollupAhead={aheadOf(s)}
                    nested
                    {...rest}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {/* Шеврон у заголовка раскрывает подкатегории всего раздела — ровно
            как в годовом виде этой же страницы. Раскрывать нечего (ни у одной
            категории нет подкатегорий с планом) — кнопки нет вовсе, а не висит
            неработающей. */}
        <h2 className="font-semibold text-lg">
          {expandable.length > 0 ? (
            <Tooltip
              content={
                allExpanded
                  ? "Свернуть подкатегории раздела"
                  : "Раскрыть подкатегории раздела"
              }
            >
              <button
                type="button"
                onClick={toggleAll}
                aria-expanded={allExpanded}
                aria-label={
                  allExpanded
                    ? `Свернуть подкатегории: ${heading}`
                    : `Раскрыть подкатегории: ${heading}`
                }
                className="flex items-center gap-1.5 hover:text-accent"
              >
                <ChevronDown
                  className={`w-4 h-4 shrink-0 transition-transform duration-300 ${
                    allExpanded ? "" : "-rotate-90"
                  }`}
                />
                {heading}
              </button>
            </Tooltip>
          ) : (
            heading
          )}
        </h2>
        <BarLegend isIncome={sectionKind === "income"} showTick={rest.isCurrent} />
        {headerAction}
      </div>
      {prepend}
      {withOps.map(renderCat)}
      {emptyCats.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setEmptyOpen(!emptyOpen)}
            className="w-full flex items-center gap-3 text-xs text-muted hover:text-text"
            title={emptyOpen ? `Свернуть категории без ${emptyNoun}` : `Показать категории без ${emptyNoun}`}
          >
            <span className="h-px flex-1 bg-border" />
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${emptyOpen ? "" : "-rotate-90"}`}
            />
            <span className="whitespace-nowrap">Без {emptyNoun} в этом месяце · {emptyCats.length}</span>
            <span className="h-px flex-1 bg-border" />
          </button>
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              emptyOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="space-y-3">{emptyCats.map(renderCat)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slim progress bar: coloured fill = actual spend/income as a share of the
 *  plan (tone by status), on a grey «remaining» track. No forecast — a naive
 *  pace projection early in the month was more alarming than useful (it filled
 *  the whole bar red on day 2); the month-end forecast lives in the cash-flow
 *  chart at the top instead. Same height/length on every row; numeric details
 *  live in the tooltip. */
function BudgetBar({
  ratio,
  aheadRatio = 0,
  progress = 0,
  isIncome,
  title,
}: {
  ratio: number;
  /** Доля плана, уже расписанная назначенными операциями впереди. */
  aheadRatio?: number;
  /**
   * Доля прошедшего месяца, 0…1. Больше нуля — на полосе появляется насечка
   * «сегодня». В прошлых и будущих месяцах её нет: там «сегодня» не при чём.
   */
  progress?: number;
  isIncome: boolean;
  title?: ReactNode;
}) {
  const factW = Math.min(Math.max(ratio, 0), 1);
  // Расписанное показываем СЛЕДОМ за потраченным и бледнее: это ещё не трата,
  // но и не свободные деньги. Остаток полосы — то, что действительно свободно.
  const aheadW = Math.min(Math.max(aheadRatio, 0), 1 - factW);
  const tone = BAR_TONE[summaryTone(ratio, isIncome)];
  const tick = progress > 0 && progress < 1;
  return (
    <Tooltip content={title}>
      {/* Обёртка без высоты: она нужна только затем, чтобы насечка вышла ЗА
          пределы полосы. Внутри полосы её съедал бы `overflow-hidden`, а
          вровень с краями она читалась бы как ещё один сегмент. */}
      <div className="relative flex-1">
        <div className="relative h-2 bg-panel2 rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${tone}`}
            style={{ width: `${factW * 100}%` }}
          />
          {aheadW > 0 && (
            <div
              className={`absolute inset-y-0 ${tone} opacity-35`}
              style={{ left: `${factW * 100}%`, width: `${aheadW * 100}%` }}
            />
          )}
        </div>
        {/* Засечка «сегодня» — как в Дзен-мани: видно, обгоняет трата ход
            месяца или отстаёт, и цифру «прошло N% месяца» держать в подсказке
            больше не нужно. Начертание — то же, что у засечки периода Б на
            «Сравнении»: цвет от текста, поэтому она различима и поверх цветной
            заливки, и на сером остатке, и в обеих темах. */}
        {tick && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-solid border-text/80"
            style={{ left: `${(progress * 100).toFixed(2)}%`, height: "200%" }}
          />
        )}
      </div>
    </Tooltip>
  );
}

/** ⓘ hint next to a section heading: explains what the bar's colours mean.
 *  Income and expense read OPPOSITELY (green = «на цель» vs «в пределах»), so
 *  the copy is kind-specific. */
function BarLegend({ isIncome, showTick }: { isIncome: boolean; showTick: boolean }) {
  const swatches = isIncome
    ? [
        { c: "bg-income", t: "План выполнен — 100% и больше" },
        { c: "bg-warn", t: "Почти у цели — 80–100%" },
        { c: "bg-expense", t: "Недобор — меньше 80%" },
      ]
    : [
        { c: "bg-income", t: "В пределах — меньше 80% лимита" },
        { c: "bg-warn", t: "Близко к лимиту — 80–100%" },
        { c: "bg-expense", t: "Лимит превышен — больше 100%" },
      ];
  return (
    <Tooltip
      placement="bottom"
      content={
        <div className="space-y-1.5 text-left leading-snug">
          <div className="font-medium">Как читать полоску</div>
          {swatches.map((s) => (
            <div key={s.t} className="flex items-center gap-2">
              <span className={`inline-block w-3.5 h-2 rounded-full ${s.c}`} />
              <span>{s.t}</span>
            </div>
          ))}
          <div className="space-y-1.5 pt-1.5 mt-1 border-t border-border/60">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-2 rounded-full bg-panel2 ring-1 ring-border" />
              <span>Серый фон — сколько ещё осталось до плана</span>
            </div>
            {showTick && (
              <div className="flex items-center gap-2">
                <span className="relative inline-block w-3.5 h-2 rounded-full bg-panel2 ring-1 ring-border">
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-4 border-l-2 border-solid border-text/80" />
                </span>
                <span>Засечка — сегодняшний день месяца</span>
              </div>
            )}
          </div>
        </div>
      }
    >
      <button
        type="button"
        aria-label="Как читать полоску бюджета"
        className="text-muted hover:text-text shrink-0"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}

const PILL_TONE: Record<string, string> = {
  income: "text-income bg-income/15",
  warn: "text-warn bg-warn/15",
  expense: "text-expense bg-expense/15",
};

/**
 * Одна сторона переводов за месяц: счета с той стороны и суммы, сверху итог.
 *
 * Полос и процентов здесь намеренно нет: планировать перевод между своими
 * счетами не на что, а полоса без плана — это шкала без нуля.
 */
function TransferList({
  title,
  rows,
  base,
  onOpen,
}: {
  title: string;
  rows: { account: string; sum: number }[];
  base: string;
  onOpen: (account: string) => void;
}) {
  const total = rows.reduce((s, r) => s + r.sum, 0);
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-border">
        <span className="label">{title}</span>
        <span className="text-sm font-medium tabular-nums">{formatMoney(total, base)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-2.5 text-sm text-muted">В этом месяце не было</div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <button
              key={r.account}
              type="button"
              onClick={() => onOpen(r.account)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-panel2/40"
            >
              <AccountLogo title={r.account} size={20} />
              <span className="text-sm truncate flex-1 min-w-0">{r.account}</span>
              <span className="text-sm tabular-nums shrink-0">{formatMoney(r.sum, base)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bar fill — same state tone as the pill (calm under budget, red over). */
const BAR_TONE: Record<string, string> = {
  income: "bg-income",
  warn: "bg-warn",
  expense: "bg-expense",
};

/** Тот же статус текстом — заголовок подсказки к полосе. */
const TONE_TEXT: Record<string, string> = {
  income: "text-income",
  warn: "text-warn",
  expense: "text-expense",
};

/** Coloured percentage pill (state-aware). Fixed-width column for alignment. */
function PctPill({
  planned,
  ratio,
  isIncome,
}: {
  planned: number;
  ratio: number;
  isIncome: boolean;
}) {
  return (
    <span className="w-16 shrink-0 flex justify-center">
      {planned > 0 ? (
        <span
          className={`text-xs font-medium tabular-nums px-2 py-0.5 rounded-full ${PILL_TONE[summaryTone(ratio, isIncome)]}`}
        >
          {(ratio * 100).toFixed(0)}%
        </span>
      ) : (
        <span className="text-xs text-muted">—</span>
      )}
    </span>
  );
}

interface RowProps
  extends Omit<
    SectionProps,
    "heading" | "summary" | "rows" | "hideEmpty" | "aheadByTag"
  > {
  /** «Ещё в плане» по категории целиком (своё + под-категории). */
  rollupAhead?: number;
  row: Row;
  /** True when rendered indented under its parent category. */
  nested?: boolean;
  /** Parent rows with sub-tags get a disclosure chevron. */
  hasSubs?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Rolled-up fact/plan (own + sub-tags) for DISPLAY on a parent row — mirrors
   *  how Zenmoney «Планы» shows the parent as the sum of itself + children. The
   *  pencil still edits the parent's OWN plan (`row.planned`). */
  rollupFact?: number;
  rollupPlanned?: number;
}

function BudgetRow({
  row,
  nested,
  hasSubs,
  expanded,
  onToggle,
  rollupFact,
  rollupPlanned,
  rollupAhead,
  ym,
  isCurrent,
  monthProgress,
  base,
  onOpen,
  setPlan,
  budgetEdits,
}: RowProps) {
  const { line, planned, fact } = row;
  // Parent rows display the rolled-up total (own + sub-tags), like Zenmoney
  // «Планы». Editing still targets the parent's OWN plan (`planned`/`fact`).
  const dispFact = rollupFact ?? fact;
  const dispPlanned = rollupPlanned ?? planned;
  const isIncome = line.kind === "income";
  const tag = {
    kind: line.kind,
    category: line.category,
    subcategory: line.subcategory ?? null,
  };
  // Upsert this month's plan for the tag and queue the push to Zenmoney «Планы».
  const setThisMonth = (amount: number) => setPlan(tag, amount);
  const pendingPush = budgetEditId({ ...tag, ym }) in budgetEdits;
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // The «…» actions menu is anchored to this wrapper and rendered via <Popover>
  // (portal + flip) so it's never clipped by the card, the sub-category overflow
  // wrapper, or the viewport edge.
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  // Set on Escape so the input's blur cancels instead of committing.
  const cancelEditRef = useRef(false);

  const ratio = dispPlanned > 0 ? dispFact / dispPlanned : 0;
  // «Ещё в плане»: назначенные операции, которые ещё впереди. Дзен-мани делит
  // остаток надвое — расписанное и свободное; одной полосой «потрачено» этого
  // не видно.
  const ahead = rollupAhead ?? 0;
  const free = dispPlanned - dispFact - ahead;
  const aheadRatio = dispPlanned > 0 ? ahead / dispPlanned : 0;
  const good = isIncome ? ratio >= 1 : ratio < 0.8;
  const near = !isIncome && ratio >= 0.8 && ratio < 1;
  const statusText = isIncome
    ? good ? "План выполнен" : "Недобор"
    : ratio >= 1 ? "Лимит превышен" : near ? "Близко к лимиту" : "В пределах";
  const remaining = isIncome ? dispFact - dispPlanned : dispPlanned - dispFact;
  const toneKey = summaryTone(ratio, isIncome);
  // Подробности строки живут в подсказке к полосе: статус цветом, суммы —
  // двумя колонками, у каждой метка того сегмента полосы, который она
  // объясняет. Списком одинаковых серых фраз это читалось как пелена текста.
  // Хода месяца здесь больше нет — его показывает засечка на самой полосе.
  //
  // Строки ВСЕГДА одни и те же, даже когда назначенных операций нет: набор,
  // который меняется от статьи к статье, заставляет читать подсказку заново
  // каждый раз. Пустое «ещё в плане» показываем прочерком — это ответ, а не
  // отсутствие строки.
  const barFacts: TooltipFact[] = [
    {
      label: isIncome ? "Получено" : "Потрачено",
      value: formatMoney(dispFact, base),
      swatch: BAR_TONE[toneKey],
      strong: true,
    },
    {
      label: "Ещё в плане",
      value: ahead > 0 ? formatMoney(ahead, base) : "—",
      swatch: `${BAR_TONE[toneKey]} opacity-35`,
      ...(ahead > 0 ? {} : { tone: "muted" as const }),
    },
    free >= 0
      ? {
          label: isIncome ? "Ещё ожидается" : "Свободно",
          value: formatMoney(free, base),
          // Пустой хвост полосы и фон самой подсказки — один и тот же серый,
          // поэтому у метки есть обводка: без неё её просто нет.
          swatch: "bg-panel2 ring-1 ring-border",
        }
      : {
          label: "Сверх плана",
          value: formatMoney(-free, base),
          // Куска полосы за планом нет — сама полоса кончается на ста
          // процентах, поэтому у строки значок, а не метка цвета.
          icon: <TrendingUp />,
          // У дохода перебор — это хорошо, у расхода — перерасход. Один цвет
          // на оба случая соврал бы в половине строк.
          tone: isIncome ? ("income" as const) : ("expense" as const),
        },
    { label: "План", value: formatMoney(dispPlanned, base), icon: <Target /> },
    {
      label: isIncome ? "Разница" : "Осталось",
      value: formatMoney(remaining, base, { signed: true }),
      icon: isIncome ? <Scale /> : <Wallet />,
      // Знак уже приведён к «больше нуля — хорошо», поэтому цвет зависит
      // только от него: недобор дохода и перерасход одинаково красные.
      tone: remaining >= 0 ? ("income" as const) : ("expense" as const),
      strong: true,
    },
  ];

  // On a parent row the shown number is the rollup (own + sub-tags); editing
  // targets the parent's OWN plan. So we prefill with the SHOWN amount and, on
  // save, subtract the sub-tags' total back out — the user edits the visible
  // total and the row doesn't jump on a plain click.
  const subsTotal = dispPlanned - planned;
  function startEdit() {
    cancelEditRef.current = false;
    setEditVal(String(dispPlanned));
    setEditing(true);
  }
  /** Called on Enter / blur. Saves only a real, changed amount; pushes it. */
  function commitEdit() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditing(false);
      return;
    }
    const v = Number(editVal);
    const newOwn = Math.max(0, v - subsTotal);
    if (Number.isFinite(v) && v >= 0 && newOwn !== planned) {
      setThisMonth(newOwn);
    }
    setEditing(false);
  }
  // «Убрать план на месяц»: zero this month's plan and push 0 to Zenmoney
  // (which clears the «План» for that tag/month). The category then drops out of
  // the list (group-plan filter), mirroring «нет плана» in Дзен.
  function clearPlan() {
    setThisMonth(0);
  }
  const close = () => setMenuOpen(false);

  const isSub = !!line.subcategory;
  return (
    <div
      className={`group/row flex items-center gap-2.5 px-3 ${nested ? "py-2 pl-10" : "py-2.5"} ${
        nested ? "hover:bg-panel2/30" : ""
      }`}
    >
      {hasSubs ? (
        <button
          onClick={onToggle}
          className="shrink-0 text-muted hover:text-text"
          aria-expanded={expanded}
          aria-label={expanded ? "Свернуть подкатегории" : "Показать подкатегории"}
        >
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ease-in-out ${expanded ? "" : "-rotate-90"}`} />
        </button>
      ) : (
        !nested && <span className="w-4 shrink-0" />
      )}

      {isSub ? (
        <CategoryDot category={line.subcategory!} parent={line.category} size="w-6 h-6" />
      ) : (
        <CategoryDot category={line.category} size="w-7 h-7" />
      )}

      <Tooltip content={isSub ? `${line.category} › ${line.subcategory}` : line.category}>
        <button
          onClick={() => onOpen(line.category, line.subcategory ?? null)}
          className={`truncate text-left w-60 shrink-0 hover:text-accent ${
            isSub ? "text-sm text-muted" : "text-sm font-medium"
          }`}
        >
          {nested && isSub ? line.subcategory : line.category}
        </button>
      </Tooltip>

      <BudgetBar
        ratio={ratio}
        aheadRatio={aheadRatio}
        progress={isCurrent ? monthProgress : 0}
        isIncome={isIncome}
        title={
          <TooltipFacts
            title={<span className={TONE_TEXT[toneKey]}>{statusText}</span>}
            facts={barFacts}
          />
        }
      />

      {/* fact / plan — the plan number edits IN PLACE (borderless, no spinner)
          so nothing around it shifts and the «%» pill / pending icon stay put. */}
      <span className="inline-flex items-center justify-end gap-1 shrink-0 w-44 text-sm tabular-nums whitespace-nowrap">
        <Tooltip content={editing ? null : statusText}>
          <span>{formatMoney(dispFact, base)}</span>
        </Tooltip>
        <span className="text-muted">/</span>
        {editing ? (
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={editVal}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEditVal(e.target.value.replace(/\D/g, ""))}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelEditRef.current = true;
                e.currentTarget.blur();
              }
            }}
            className="bg-transparent outline-none border-0 p-0 w-16 text-right tabular-nums text-accent"
          />
        ) : (
          <Tooltip
            content={
              row.scheduled
                ? "Сумма назначенной операции Дзен-мани — своего плана у статьи нет. Нажмите, чтобы задать"
                : row.forecast
                  ? "Прогноз по истории (медиана 6 мес.). Нажмите, чтобы задать свой план"
                  : "Изменить план — нажмите и введите сумму"
            }
          >
            <button
              onClick={startEdit}
              className={`hover:text-accent ${row.forecast ? "text-muted italic" : "text-muted"}`}
            >
              {/* Часы у назначенной операции и «≈» у прогноза: в обоих случаях
                  план не свой, но причины разные — одну назначили на дату,
                  вторую достроили по истории. */}
              {row.scheduled && (
                <CalendarClock className="inline w-3 h-3 mr-1 -mt-0.5" aria-hidden />
              )}
              {row.forecast ? "≈ " : ""}
              {dispPlanned > 0 ? formatMoney(dispPlanned, base) : "—"}
            </button>
          </Tooltip>
        )}
      </span>
      <PctPill planned={dispPlanned} ratio={ratio} isIncome={isIncome} />
      <Tooltip content={pendingPush ? "Изменено локально, ждёт отправки в Дзен (по схеме из настроек)" : null}>
        <span className="w-4 shrink-0">
          {pendingPush && (
            <ArrowUp className="w-4 h-4 text-warn" aria-label="Ждёт отправки в Дзен" />
          )}
        </span>
      </Tooltip>

      <div ref={menuAnchorRef} className="relative shrink-0">
        <Tooltip content="Действия">
          {/* На широком экране кнопка проявляется по наведению на строку: два
              десятка одинаковых «…» в столбик — это шум, а не управление.
              Ширина места под неё занята всегда, поэтому ничего не прыгает. На
              узких экранах наведения нет, и кнопка видна постоянно; открытое
              меню и фокус с клавиатуры тоже держат её видимой. */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className={`btn-ghost !p-1.5 text-muted hover:text-text transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100 ${
              menuOpen ? "sm:opacity-100" : ""
            }`}
            aria-label="Действия с бюджетом"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </Tooltip>
        <Popover
          open={menuOpen}
          anchorRef={menuAnchorRef}
          onClose={close}
          align="right"
          className="w-60 card !p-1 text-sm shadow-lg"
        >
          <MenuItem icon={Pencil} onClick={() => { close(); startEdit(); }}>
            Изменить план
          </MenuItem>
          {planned > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <MenuItem icon={Trash2} danger onClick={() => { close(); clearPlan(); }}>
                Убрать план на месяц
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  danger,
  onClick,
  children,
}: {
  icon: LucideIcon;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 hover:bg-panel2 ${
        danger ? "text-expense" : ""
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {children}
    </button>
  );
}
