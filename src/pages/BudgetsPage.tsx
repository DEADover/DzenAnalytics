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
  type LucideIcon,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { getZenForecastsFromCache } from "../store/useZenmoneyStore";
import { zenPlanKey } from "../lib/zenBudgets";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useBudgetEditsStore } from "../store/useBudgetEditsStore";
import { budgetEditId } from "../lib/zenmoneyPush";
import { CategoryDot } from "../components/CategoryDot";
import { Popover } from "../components/Popover";
import { CategoryCascadePicker, type CategoryNode } from "../components/CategoryCascadePicker";
import { MonthCashflowChart } from "../components/MonthCashflowChart";
import { Tooltip } from "../components/Tooltip";
import { groupByCategory } from "../lib/aggregations";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import {
  plannedFor,
  factFor,
  forecastFor,
  addMonths,
  type BudgetKind,
  type BudgetLine,
} from "../lib/budgets";
import { formatMoney } from "../lib/format";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { DateField } from "../components/DateField";

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
}

export function BudgetsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const lines = useBudgetsStore((s) => s.lines);
  const addLine = useBudgetsStore((s) => s.addLine);
  const setOverride = useBudgetsStore((s) => s.setOverride);
  const hydrate = useBudgetsStore((s) => s.hydrate);
  const loaded = useBudgetsStore((s) => s.loaded);
  // Plan changes queue here and flush via the normal Push flow (Settings push
  // mode). `pendingBudget` lets a row show «ждёт отправки в Дзен».
  const queueBudget = useBudgetEditsStore((s) => s.queue);
  const budgetEdits = useBudgetEditsStore((s) => s.edits);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

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

  const cur = currentMonth();
  const [ym, setYm] = useState(cur);
  const isCurrent = ym === cur;
  // Past/future months are "complete" for projection purposes (no linear
  // extrapolation); only the current month is partially elapsed.
  const monthProgress = isCurrent
    ? new Date().getDate() / daysInMonth(ym)
    : 1;

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
  const budgetKey = (kind: string, cat: string, sub: string | null) =>
    [kind, cat, sub ?? ""].join("\u0000");
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

  const rows = useMemo<Row[]>(() => {
    const inWindow = lines
      // A line belongs to a month only while it's inside its validity window
      // [startMonth, endMonth]. A budget that starts in June must NOT appear
      // in May/April, even if that category had spending then.
      .filter(
        (line) => ym >= line.startMonth && (!line.endMonth || ym <= line.endMonth)
      )
      .map((line): Row => {
        const planned = plannedFor(line, ym);
        const fact = factFor(line, transactions, ym);
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
          else fc = forecastFor(line, transactions, ym); // CSV: median estimate
          if (fc > 0) return { line, planned: fc, fact, forecast: true };
        }
        return { line, planned, fact, forecast: false };
      });
    // Show only TAGS actually budgeted this month (план > 0). A sub-tag with no
    // own plan is NOT rolled into its parent (Zenmoney puts such spending under
    // «Вне плана»), so a parent never overstates % when one child is budgeted and
    // another is only auto-forecast (e.g. Банки → Кэшбек budgeted, Проценты only
    // forecast). Unbudgeted tags surface under «Без бюджета».
    const budgeted = inWindow.filter((r) => r.planned > 0);
    // A category counts as «with operations» when its rollup fact (own + sub-tags)
    // is non-zero. Categories without any operations this month sink to the very
    // bottom of the list; the rest keep the newest-first order.
    const catFact = new Map<string, number>();
    for (const r of budgeted) {
      const key = `${r.line.kind} ${r.line.category}`;
      catFact.set(key, (catFact.get(key) ?? 0) + r.fact);
    }
    const isEmpty = (r: Row) => (catFact.get(`${r.line.kind} ${r.line.category}`) ?? 0) === 0;
    return budgeted.sort((a, b) => {
      const ae = isEmpty(a) ? 1 : 0;
      const be = isEmpty(b) ? 1 : 0;
      if (ae !== be) return ae - be;
      return a.line.createdAt < b.line.createdAt ? 1 : a.line.createdAt > b.line.createdAt ? -1 : 0;
    });
  }, [lines, ym, transactions, zenForecasts, zenLoaded]);
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
      // «Без категории» isn't a budgetable tag — nothing to plan for the
      // uncategorized bucket, so don't offer it in «Без бюджета».
      if (!t.category || t.category === NO_CATEGORY) continue;
      const sub = t.subcategory ?? null;
      if (t.kind === "income") add("income", t.category, sub, t.amountBase);
      else if (affectsExpense(t.kind)) add("expense", t.category, sub, expenseDelta(t));
    }
    // A tag belongs in «Без бюджета» only if it isn't ALREADY shown in the
    // budget section above. That includes income tags shown via a history
    // forecast (no manual plan, but clearly represented with a «≈» and a
    // click-to-plan) — keying off `budgetedThisMonth` (manual plans only) listed
    // such forecast-only tags BOTH above and here. Key off what's actually shown.
    const shown = new Set(
      rows.map((r) => budgetKey(r.line.kind, r.line.category, r.line.subcategory ?? null))
    );
    return [...agg.values()]
      .filter((u) => u.fact > 0 && !shown.has(budgetKey(u.kind, u.category, u.subcategory)))
      .sort((a, b) => b.fact - a.fact);
  }, [transactions, ym, rows]);

  function openCategory(cat: string, sub: string | null) {
    const txs = transactions.filter(
      (t) =>
        t.category === cat &&
        (t.subcategory ?? null) === sub &&
        t.date.startsWith(ym)
    );
    const label = sub ? `${cat} › ${sub}` : cat;
    showDrill(`${label} · ${ym}`, txs, "Бюджет");
  }

  // Click a day on the cash-flow chart → drill into that day's operations.
  function openDay(day: number) {
    const dd = String(day).padStart(2, "0");
    const date = `${ym}-${dd}`;
    const txs = transactions.filter((t) => t.date.startsWith(date));
    if (txs.length === 0) return;
    showDrill(`${day} · ${ym}`, txs, "День");
  }

  if (transactions.length === 0) return <EmptyState />;

  const expPlan = expenseRows.reduce((s, r) => s + r.planned, 0);
  const expFact = expenseRows.reduce((s, r) => s + r.fact, 0);
  const incPlan = incomeRows.reduce((s, r) => s + r.planned, 0);
  const incFact = incomeRows.reduce((s, r) => s + r.fact, 0);
  // Дельта = доходы − расходы, отдельно по плану и по факту.
  const planDelta = incPlan - expPlan;
  const factDelta = incFact - expFact;

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
        hint="План и факт по категориям и под-категориям, помесячно, с синхронизацией в Дзен."
      />

      {/* Toolbar: month nav (left) + «без бюджета» toggle (right) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Tooltip content="Предыдущий месяц">
            <button onClick={() => setYm((m) => addMonths(m, -1))} className="btn-ghost !p-2">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </Tooltip>
          <DateField
            granularity="month"
            value={ym}
            onChange={(e) => e.target.value && setYm(e.target.value)}
            className="input text-sm font-medium min-w-[150px]"
          />
          <Tooltip content="Следующий месяц">
            <button onClick={() => setYm((m) => addMonths(m, 1))} className="btn-ghost !p-2">
              <ChevronRight className="w-4 h-4" />
            </button>
          </Tooltip>
          {!isCurrent && (
            <button
              onClick={() => setYm(cur)}
              className="text-xs text-accent hover:underline ml-1"
            >
              текущий
            </button>
          )}
        </div>
      </div>

      {/* Summary: расходы / доходы / дельта — у каждого явные «Факт» и «План» */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PlanFactCard
          title="Общий план расходов"
          fact={expFact}
          plan={expPlan}
          factClass="text-expense"
          base={base}
          kind="expense"
        />
        <PlanFactCard
          title="Общий план доходов"
          fact={incFact}
          plan={incPlan}
          factClass="text-income"
          base={base}
          kind="income"
        />
        <PlanFactCard
          title="Дельта (доходы − расходы)"
          fact={factDelta}
          plan={planDelta}
          factClass={factDelta >= 0 ? "text-income" : "text-expense"}
          signed
          base={base}
          kind="delta"
        />
      </div>

      {/* Full-width cash-flow widget: cumulative income/expense over the month
          with a linear end-of-month forecast (Zen «Планы» style). */}
      <MonthCashflowChart
        transactions={transactions}
        ym={ym}
        base={base}
        onDayClick={openDay}
        plannedIncome={incPlan}
        plannedExpense={expPlan}
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
        </div>
    </div>
  );
}

/** Summary card showing «Факт» (prominent, coloured) and «План» side by side. */
// Summary-card state colour: for income «good» = met-or-over, «warn» = close;
// for expense «good» = well under, «warn» = near/at the limit, «bad» = over.
function summaryTone(ratio: number, isIncome: boolean): "income" | "warn" | "expense" {
  if (isIncome) return ratio >= 1 ? "income" : ratio >= 0.8 ? "warn" : "expense";
  return ratio < 0.8 ? "income" : ratio <= 1 ? "warn" : "expense";
}

function PlanFactCard({
  title,
  fact,
  plan,
  factClass,
  base,
  signed = false,
  kind,
}: {
  title: string;
  fact: number;
  plan: number;
  factClass: string;
  base: string;
  signed?: boolean;
  kind: "expense" | "income" | "delta";
}) {
  return (
    <div className="card card-pad">
      <div className="label mb-1.5">{title}</div>
      <div className={`stat-num ${factClass} mb-3`}>
        {formatMoney(fact, base, { signed })}
      </div>
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
  /** «+» button next to the heading. */
  headerAction?: ReactNode;
  /** Inline draft row, rendered at the TOP of the list (new categories first). */
  prepend?: ReactNode;
}

function Section({ heading, rows, base, headerAction, prepend, ...rest }: SectionProps) {
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
  // Budgeted categories with no spending this month collapse under a spoiler.
  const [emptyOpen, setEmptyOpen] = useState(false);

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
    (rollupFact === 0 ? emptyCats : withOps).push(cat);
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
          rollupPlanned={
            hasSubs
              ? parent.planned + g.subs.reduce((s, r) => s + r.planned, 0)
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
                  <BudgetRow key={s.line.id} row={s} base={base} nested {...rest} />
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
        <h2 className="font-semibold text-lg">{heading}</h2>
        <BarLegend isIncome={sectionKind === "income"} />
        {headerAction}
      </div>
      {prepend}
      {withOps.map(renderCat)}
      {emptyCats.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setEmptyOpen((o) => !o)}
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
  isIncome,
  title,
}: {
  ratio: number;
  isIncome: boolean;
  title?: string;
}) {
  const factW = Math.min(Math.max(ratio, 0), 1);
  const tone = BAR_TONE[summaryTone(ratio, isIncome)];
  return (
    <Tooltip content={title}>
      <div className="relative flex-1 h-2 bg-panel2 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${tone}`}
          style={{ width: `${factW * 100}%` }}
        />
      </div>
    </Tooltip>
  );
}

/** ⓘ hint next to a section heading: explains what the bar's colours mean.
 *  Income and expense read OPPOSITELY (green = «на цель» vs «в пределах»), so
 *  the copy is kind-specific. */
function BarLegend({ isIncome }: { isIncome: boolean }) {
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
          <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-border/60">
            <span className="inline-block w-3.5 h-2 rounded-full bg-panel2" />
            <span>Серый фон — сколько ещё осталось до плана</span>
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

/** Bar fill — same state tone as the pill (calm under budget, red over). */
const BAR_TONE: Record<string, string> = {
  income: "bg-income",
  warn: "bg-warn",
  expense: "bg-expense",
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

interface RowProps extends Omit<SectionProps, "heading" | "summary" | "rows"> {
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
  const good = isIncome ? ratio >= 1 : ratio < 0.8;
  const near = !isIncome && ratio >= 0.8 && ratio < 1;
  const statusText = isIncome
    ? good ? "План выполнен" : "Недобор"
    : ratio >= 1 ? "Лимит превышен" : near ? "Близко к лимиту" : "В пределах";
  const remaining = isIncome ? dispFact - dispPlanned : dispPlanned - dispFact;
  // Secondary details (status, remaining, month progress) live in the bar
  // tooltip so the row stays a single line.
  const barTitle = [
    statusText,
    `${isIncome ? "разница" : "осталось"} ${formatMoney(remaining, base, { signed: true })}`,
    isCurrent ? `прошло ${(monthProgress * 100).toFixed(0)}% месяца` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
      className={`flex items-center gap-2.5 px-3 ${nested ? "py-2 pl-10" : "py-2.5"} ${
        nested ? "hover:bg-panel2/30" : ""
      }`}
    >
      {hasSubs ? (
        <button
          onClick={onToggle}
          className="shrink-0 text-muted hover:text-text"
          aria-label={expanded ? "Свернуть под-категории" : "Показать под-категории"}
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

      <BudgetBar ratio={ratio} isIncome={isIncome} title={barTitle} />

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
              row.forecast
                ? "Прогноз по истории (медиана 6 мес.). Нажмите, чтобы задать свой план"
                : "Изменить план — нажмите и введите сумму"
            }
          >
            <button
              onClick={startEdit}
              className={`hover:text-accent ${row.forecast ? "text-muted italic" : "text-muted"}`}
            >
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
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="btn-ghost !p-1.5 text-muted hover:text-text"
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
