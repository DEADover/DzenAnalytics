import { useEffect, useMemo, useState } from "react";
import {
  Target,
  Plus,
  Trash2,
  Pencil,
  Calendar,
  CalendarClock,
  TrendingUp,
  Wallet,
  Landmark,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useGoalsStore, type Goal } from "../store/useGoalsStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { groupByMonth } from "../lib/aggregations";
import { formatMoney, formatDate } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { Combobox } from "../components/Combobox";
import { Tooltip } from "../components/Tooltip";
import { DateField } from "../components/DateField";

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** date `months` from the start of the current month, ISO yyyy-mm-dd. Built from
 *  LOCAL fields (not `toISOString`, which shifts to UTC and can roll the 1st back
 *  into the previous month for east-of-UTC zones). */
function addMonthsIso(months: number): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + months, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Compact «мес. yyyy» — a forecast is month-level, so the day would be false
 *  precision, and this keeps the chip short enough never to truncate. Parses the
 *  y-m fields directly so no timezone conversion can shift the month. */
function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("ru-RU", {
    month: "short",
    year: "numeric",
  });
}

/** «N мес · мес. yyyy», or a short reason when there's no finite finish. */
function forecastLabel(f: Forecast, done: boolean): string {
  if (done) return "цель достигнута";
  if (f.months === null || !f.finish) return "темп отрицательный";
  return `${f.months} мес · ${monthYear(f.finish)}`;
}

interface AccountBalance {
  title: string;
  balanceBase: number;
  savings: boolean;
}

/** One forecast: months left at a given monthly pace, and the finish date. */
interface Forecast {
  months: number | null; // null = never (pace ≤ 0) ; 0 = already done
  finish: string | null;
}

/** All derived numbers for one goal. Single source of truth for the summary
 *  tiles, the cards and the projection chart, so they can't drift apart. */
function goalMetrics(g: Goal, accounts: AccountBalance[], avgSavings: number) {
  // Bound to an account → progress is its live balance; otherwise the
  // hand-entered amount (issue #45). A bound account that vanished (renamed /
  // archived) falls back to the manual value so the goal never reads as empty.
  const boundBalance = g.accountTitle
    ? accounts.find((a) => a.title === g.accountTitle)?.balanceBase ?? null
    : null;
  const boundMissing = !!g.accountTitle && boundBalance == null;
  const current = boundBalance ?? g.current;
  const ratio = g.target > 0 ? Math.min(current / g.target, 1) : 0;
  const done = ratio >= 1;
  const remaining = Math.max(g.target - current, 0);
  const contribution =
    g.monthlyContribution && g.monthlyContribution > 0 ? g.monthlyContribution : null;

  const project = (pace: number): Forecast => {
    if (done) return { months: 0, finish: null };
    if (!(pace > 0)) return { months: null, finish: null };
    const months = Math.ceil(remaining / pace);
    return { months, finish: addMonthsIso(months) };
  };
  const byPace = project(avgSavings);
  const byContribution = contribution ? project(contribution) : null;

  // The forecast the deadline verdict is judged against: the user's own planned
  // contribution when set (that's their commitment), else the household pace.
  const effective = byContribution ?? byPace;
  const deadlineMonths = g.deadline
    ? monthsBetween(new Date().toISOString(), g.deadline)
    : null;
  const onTrack =
    effective.months !== null && deadlineMonths !== null && effective.months <= deadlineMonths;

  return {
    current,
    ratio,
    done,
    remaining,
    contribution,
    byPace,
    byContribution,
    effective,
    deadlineMonths,
    onTrack,
    boundMissing,
  };
}

export function GoalsPage() {
  // Savings-pace projection must ignore turnover / off-balance flows (#14).
  const transactions = useAnalyticsTransactions();
  const rates = useDataStore((s) => s.rates);
  const base = rates.base;
  const goals = useGoalsStore((s) => s.goals);
  const addGoal = useGoalsStore((s) => s.add);
  const updateGoal = useGoalsStore((s) => s.update);
  const removeGoal = useGoalsStore((s) => s.remove);
  const hydrate = useGoalsStore((s) => s.hydrate);
  const loaded = useGoalsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Household savings pace drives the default (fallback) forecast.
  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const recent = months.slice(-6);
  const avgIncome = recent.length
    ? recent.reduce((s, m) => s + m.income, 0) / recent.length
    : 0;
  const avgExpense = recent.length
    ? recent.reduce((s, m) => s + m.expense, 0) / recent.length
    : 0;
  const avgSavings = avgIncome - avgExpense;

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [deadline, setDeadline] = useState("");
  const [accountTitle, setAccountTitle] = useState("");
  const [monthly, setMonthly] = useState("");

  // Live accounts with balances in the base currency — a goal can track one of
  // them instead of a hand-entered amount (issue #45). Savings accounts first:
  // that's what people usually put a goal on.
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      const toBase = (amount: number, currency: string) =>
        currency === rates.base ? amount : amount * (rates.rates[currency] || 1);
      setAccounts(
        live
          .filter((a) => !a.archive)
          .map((a) => ({
            title: a.title,
            balanceBase: toBase(a.balance, a.currency),
            savings: a.savings,
          }))
          .sort(
            (a, b) => Number(b.savings) - Number(a.savings) || a.title.localeCompare(b.title)
          )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [transactions, rates]);

  const accountTitles = useMemo(() => accounts.map((a) => a.title), [accounts]);
  const balanceOf = (title: string | null | undefined) =>
    title ? accounts.find((a) => a.title === title)?.balanceBase ?? null : null;

  // Summary across all goals (bound-aware) for the tiles.
  const summary = useMemo(() => {
    let saved = 0;
    let remaining = 0;
    let done = 0;
    for (const g of goals) {
      const m = goalMetrics(g, accounts, avgSavings);
      saved += m.current;
      remaining += m.remaining;
      if (m.done) done += 1;
    }
    return { saved, remaining, done };
  }, [goals, accounts, avgSavings]);

  function resetForm() {
    setName("");
    setTarget("");
    setCurrent("");
    setDeadline("");
    setAccountTitle("");
    setMonthly("");
  }

  function submit() {
    const t = Number(target);
    const c = Number(current) || 0;
    if (!name.trim() || !Number.isFinite(t) || t <= 0) return;
    addGoal({
      name: name.trim(),
      target: t,
      current: c,
      deadline: deadline || null,
      accountTitle: accountTitle || null,
      monthlyContribution: Number(monthly) > 0 ? Number(monthly) : null,
    });
    resetForm();
    setAdding(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  const formValid = name.trim().length > 0 && Number(target) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Цели"
        icon={Target}
        hint="Копите на конкретные цели и следите за прогрессом и расчётным сроком достижения"
        right={
          // Hidden while the add form is open — the form has its own «Отмена»,
          // so a second one in the header would just be redundant.
          !adding && (
            <button onClick={() => setAdding(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Новая цель
            </button>
          )
        }
      />

      {goals.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat
            dense
            label="Целей"
            value={goals.length}
            icon={<Target className="w-4 h-4" />}
            tooltip={
              summary.done > 0
                ? `${summary.done} из ${goals.length} достигнуто`
                : "Все цели в работе"
            }
          />
          <Stat
            dense
            label="Накоплено"
            value={formatMoney(summary.saved, base)}
            tone="income"
            icon={<Landmark className="w-4 h-4" />}
            tooltip="Сумма прогресса по всем целям: для привязанных к счёту — их текущий баланс, для остальных — введённое вручную."
          />
          <Stat
            dense
            label="Осталось"
            value={formatMoney(summary.remaining, base)}
            icon={<Target className="w-4 h-4" />}
            tooltip="Сколько ещё нужно накопить суммарно по всем недостигнутым целям."
          />
          <Stat
            dense
            label="Темп"
            value={`${avgSavings >= 0 ? "+" : ""}${formatMoney(avgSavings, base)}`}
            tone={avgSavings > 0 ? "income" : avgSavings < 0 ? "expense" : "default"}
            icon={<TrendingUp className="w-4 h-4" />}
            tooltip="Средние сбережения в месяц (доходы минус расходы за последние 6 месяцев). На их основе строится общий прогноз достижения целей."
          />
        </div>
      )}

      {adding && (
        <div className="card card-pad border-accent/40 bg-accent/[0.03]">
          <div className="font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-accent" />
            Новая цель
          </div>
          <GoalForm
            name={name}
            setName={setName}
            target={target}
            setTarget={setTarget}
            accountTitle={accountTitle}
            setAccountTitle={setAccountTitle}
            current={current}
            setCurrent={setCurrent}
            monthly={monthly}
            setMonthly={setMonthly}
            deadline={deadline}
            setDeadline={setDeadline}
            accountTitles={accountTitles}
            balanceOf={balanceOf}
            base={base}
            autoFocus
          />
          <div className="flex gap-2 mt-5">
            <button onClick={submit} disabled={!formValid} className="btn-primary text-sm">
              Сохранить
            </button>
            <button
              onClick={() => {
                resetForm();
                setAdding(false);
              }}
              className="btn-ghost text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        !adding && (
          <div className="card-tray card-pad text-center py-14">
            <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <Target className="w-7 h-7 text-accent" />
            </div>
            <div className="font-semibold mb-1">Пока нет целей</div>
            <div className="text-sm text-muted mb-5 max-w-sm mx-auto">
              Создайте цель — и увидите прогресс, расчётный срок достижения и статус по
              дедлайну.
            </div>
            <button onClick={() => setAdding(true)} className="btn-primary text-sm mx-auto">
              <Plus className="w-4 h-4" />
              Создать первую цель
            </button>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              base={base}
              avgSavings={avgSavings}
              accounts={accounts}
              accountTitles={accountTitles}
              balanceOf={balanceOf}
              onUpdate={updateGoal}
              onRemove={removeGoal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Label + control wrapper — one consistent field shape across the forms. */
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      {/* Smaller, single-line label (`whitespace-nowrap`) so even a long one like
          «Ежемесячные отчисления» stays on ONE row — every input in a row then
          starts at the same y, with a tight, uniform gap to its label. */}
      <div className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted font-medium whitespace-nowrap">
        <span>{label}</span>
        {hint && (
          <Tooltip content={hint}>
            <span className="text-muted/70 cursor-help normal-case tracking-normal">ⓘ</span>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

/** Shared add / edit field grid — identical layout in both places. */
function GoalForm({
  name,
  setName,
  target,
  setTarget,
  accountTitle,
  setAccountTitle,
  current,
  setCurrent,
  monthly,
  setMonthly,
  deadline,
  setDeadline,
  accountTitles,
  balanceOf,
  base,
  autoFocus,
  stagger,
}: {
  name: string;
  setName: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  accountTitle: string;
  setAccountTitle: (v: string) => void;
  current: string;
  setCurrent: (v: string) => void;
  monthly: string;
  setMonthly: (v: string) => void;
  deadline: string;
  setDeadline: (v: string) => void;
  accountTitles: string[];
  balanceOf: (t: string | null | undefined) => number | null;
  base: string;
  autoFocus?: boolean;
  /** Stagger the fields' entrance (used by the card's edit overlay). */
  stagger?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${
        stagger ? "goal-edit-fields" : ""
      }`}
    >
      <Field label="Название">
        <input
          placeholder="Например, Машина"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input text-sm"
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Сумма цели">
        <input
          type="number"
          inputMode="decimal"
          placeholder="0"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="input text-sm tabular-nums"
        />
      </Field>
      <Field
        label="Источник прогресса"
        hint="Откуда брать текущий прогресс: «Сумма вручную» — вы вводите накопленное сами в поле рядом; либо выберите накопительный счёт — прогресс будет обновляться по его балансу автоматически на каждой синхронизации."
      >
        <Combobox
          value={accountTitle}
          options={accountTitles}
          onChange={setAccountTitle}
          placeholder="Сумма вручную"
          allowCustom={false}
          clearable
        />
      </Field>
      {accountTitle ? (
        <Field label="Уже накоплено">
          <div className="input text-sm flex items-center text-muted bg-panel2/60 cursor-not-allowed">
            {balanceOf(accountTitle) != null
              ? formatMoney(balanceOf(accountTitle)!, base)
              : "по балансу счёта"}
          </div>
        </Field>
      ) : (
        <Field label="Уже накоплено" hint="Необязательно">
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="input text-sm tabular-nums"
          />
        </Field>
      )}
      <Field
        label="Ежемесячные отчисления"
        hint="Сколько планируете откладывать на эту цель в месяц. Если задать — построим отдельный прогноз достижения именно по этим отчислениям, независимо от общего темпа сбережений."
      >
        <input
          type="number"
          inputMode="decimal"
          placeholder="Необязательно"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          className="input text-sm tabular-nums"
        />
      </Field>
      <Field label="Дедлайн" hint="Необязательно">
        <DateField
          placeholder="дд.мм.гггг"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="input text-sm"
        />
      </Field>
    </div>
  );
}

/** Compact metadata line inside a card — icon + single truncating value. */
function Chip({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "income" | "expense" | "accent";
  children: React.ReactNode;
}) {
  const color = {
    muted: "text-muted",
    income: "text-income",
    expense: "text-expense",
    accent: "text-accent",
  }[tone];
  return (
    <span className={`flex items-center gap-1.5 min-w-0 ${color}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function GoalCard({
  goal: g,
  base,
  avgSavings,
  accounts,
  accountTitles,
  balanceOf,
  onUpdate,
  onRemove,
}: {
  goal: Goal;
  base: string;
  avgSavings: number;
  accounts: AccountBalance[];
  accountTitles: string[];
  balanceOf: (t: string | null | undefined) => number | null;
  onUpdate: (id: string, patch: Partial<Goal>) => void;
  onRemove: (id: string) => void;
}) {
  const m = goalMetrics(g, accounts, avgSavings);
  const pct = Math.round(m.ratio * 100);

  // `editing` = the edit overlay is in the DOM; `closing` plays the fade-out
  // before it unmounts. The view content stays in flow the whole time (only its
  // opacity changes), so the card never changes size between the two modes.
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [name, setName] = useState(g.name);
  const [target, setTarget] = useState(String(g.target));
  const [current, setCurrent] = useState(String(g.current));
  const [deadline, setDeadline] = useState(g.deadline ?? "");
  const [accountTitle, setAccountTitle] = useState(g.accountTitle ?? "");
  const [monthly, setMonthly] = useState(
    g.monthlyContribution ? String(g.monthlyContribution) : ""
  );

  function openEdit() {
    setName(g.name);
    setTarget(String(g.target));
    setCurrent(String(g.current));
    setDeadline(g.deadline ?? "");
    setAccountTitle(g.accountTitle ?? "");
    setMonthly(g.monthlyContribution ? String(g.monthlyContribution) : "");
    setClosing(false);
    setEditing(true);
  }

  function closeEdit() {
    setClosing(true);
    window.setTimeout(() => {
      setEditing(false);
      setClosing(false);
    }, 160);
  }

  function saveEdit() {
    const t = Number(target);
    if (!name.trim() || !(t > 0)) return;
    onUpdate(g.id, {
      name: name.trim(),
      target: t,
      current: accountTitle ? g.current : Number(current) || 0,
      deadline: deadline || null,
      accountTitle: accountTitle || null,
      monthlyContribution: Number(monthly) > 0 ? Number(monthly) : null,
    });
    closeEdit();
  }

  return (
    <div className="card-tray card-pad flex flex-col gap-4">
      {/* Header: name + saved/target, then % and actions (never shift) */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-base truncate flex items-center gap-2">
            {m.done ? (
              <CheckCircle2 className="w-4 h-4 text-income shrink-0" />
            ) : (
              <CircleDashed className="w-4 h-4 text-accent shrink-0" />
            )}
            <span className="truncate">{g.name}</span>
          </div>
          <div className="text-sm text-muted mt-0.5 tabular-nums truncate">
            {formatMoney(m.current, base)} <span className="text-muted/60">из</span>{" "}
            {formatMoney(g.target, base)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div
            className={`text-xl font-semibold tabular-nums ${
              m.done ? "text-income" : "text-text"
            }`}
          >
            {pct}%
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip content="Редактировать цель">
              <button
                onClick={() => (editing && !closing ? closeEdit() : openEdit())}
                className={`p-1.5 rounded-full transition-colors duration-200 ${
                  editing && !closing
                    ? "text-accent bg-accent/10"
                    : "text-muted hover:text-text hover:bg-panel2"
                }`}
                aria-label="Редактировать цель"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="Удалить цель">
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Удалить цель?",
                    message: `«${g.name}» будет удалена.`,
                    confirmLabel: "Удалить",
                    tone: "danger",
                  });
                  if (ok) onRemove(g.id);
                }}
                className="btn-icon-danger"
                aria-label="Удалить цель"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 bg-panel2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            m.done ? "bg-income" : "bg-accent"
          }`}
          style={{ width: `${m.ratio * 100}%` }}
        />
      </div>

      {/* Body: the view content ALWAYS stays in flow (only its opacity changes),
          so the card keeps the exact same size when the edit overlay opens on
          top of it. */}
      <div className="relative">
        <div
          className={`space-y-4 transition-opacity duration-150 ${
            editing && !closing ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
          aria-hidden={editing && !closing}
        >
          {/* Projection chart — trajectory to target vs. the deadline. */}
          <GoalChart
            current={m.current}
            target={g.target}
            avgSavings={avgSavings}
            monthly={m.contribution}
            deadline={g.deadline}
            deadlineMonths={m.deadlineMonths}
            done={m.done}
            onTrack={m.onTrack}
          />

          {/* Exactly four metadata cells, always present → every card is the
              same height regardless of how much text each one carries. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs pt-1 border-t border-border/60">
            <Tooltip content="Когда цель будет достигнута при вашем среднем темпе сбережений (доходы минус расходы за последние 6 месяцев).">
              <span className="min-w-0">
                <Chip icon={TrendingUp}>
                  По темпу сбережений: {forecastLabel(m.byPace, m.done)}
                </Chip>
              </span>
            </Tooltip>
            {m.byContribution ? (
              <Tooltip
                content={`Когда цель будет достигнута, если откладывать ${formatMoney(
                  m.contribution!,
                  base
                )} в месяц.`}
              >
                <span className="min-w-0">
                  <Chip icon={Wallet} tone="accent">
                    По вашим отчислениям: {forecastLabel(m.byContribution, m.done)}
                  </Chip>
                </span>
              </Tooltip>
            ) : (
              <Chip icon={Wallet}>Отчисления не заданы</Chip>
            )}
            {g.deadline ? (
              <Chip
                icon={CalendarClock}
                tone={m.done ? "muted" : m.onTrack ? "income" : "expense"}
              >
                Дедлайн: {formatDate(g.deadline)}
                {!m.done && ` (${m.onTrack ? "успеваете" : "не успеваете"})`}
              </Chip>
            ) : (
              <Chip icon={CalendarClock}>Дедлайн не задан</Chip>
            )}
            {g.accountTitle ? (
              <Chip icon={Landmark} tone={m.boundMissing ? "expense" : "muted"}>
                {m.boundMissing
                  ? `Счёт «${g.accountTitle}» не найден`
                  : `По счёту «${g.accountTitle}»`}
              </Chip>
            ) : (
              <Chip icon={Calendar}>Сумма вводится вручную</Chip>
            )}
          </div>
        </div>

        {/* Edit overlay — absolutely positioned so it doesn't change the card
            size; fields stagger in, and the whole panel fades out on close. */}
        {editing && (
          <div className={`absolute inset-0 ${closing ? "goal-edit-out" : ""}`}>
            <GoalForm
              name={name}
              setName={setName}
              target={target}
              setTarget={setTarget}
              accountTitle={accountTitle}
              setAccountTitle={setAccountTitle}
              current={current}
              setCurrent={setCurrent}
              monthly={monthly}
              setMonthly={setMonthly}
              deadline={deadline}
              setDeadline={setDeadline}
              accountTitles={accountTitles}
              balanceOf={balanceOf}
              base={base}
              stagger
            />
            <div
              className="flex gap-2 mt-4 animate-menu-item"
              style={{ animationDelay: "0.24s" }}
            >
              <button
                onClick={saveEdit}
                disabled={!name.trim() || !(Number(target) > 0)}
                className="btn-primary text-sm"
              >
                Сохранить
              </button>
              <button onClick={closeEdit} className="btn-ghost text-sm">
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small legend swatch + caption, used under the projection chart. */
function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {swatch}
      <span className="text-muted">{children}</span>
    </span>
  );
}

/**
 * Mini projection: how the saved amount climbs toward the target over time,
 * at the household pace and (if set) at the goal's own monthly contribution.
 * A titled block with an SVG plot plus HTML overlay labels (finish month on the
 * curve, deadline on its marker) and a legend, so it reads on its own without a
 * tooltip. `preserveAspectRatio="none"` + `vector-effect` keeps strokes crisp
 * while the width is fluid; the height is fixed so it never shifts the card.
 */
function GoalChart({
  current,
  target,
  avgSavings,
  monthly,
  deadline,
  deadlineMonths,
  done,
  onTrack,
}: {
  current: number;
  target: number;
  avgSavings: number;
  monthly: number | null;
  deadline: string | null;
  deadlineMonths: number | null;
  done: boolean;
  onTrack: boolean;
}) {
  const W = 100;
  const H = 40;
  // Vertical margins reserved (in viewBox units) so the drawn curve sits in a
  // middle band — the top strip holds the finish-date label, the bottom strip
  // holds the «сейчас» / deadline labels, and neither ever crosses a line.
  const TOP = 12;
  const BASE = 32;
  const remaining = Math.max(target - current, 0);
  const currentFrac = target > 0 ? Math.min(current / target, 1) : 0;

  const monthsAt = (pace: number) =>
    done ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
  const mPace = monthsAt(avgSavings);
  const mContrib = monthly ? monthsAt(monthly) : null;

  // Horizon: far enough to show whichever finish / deadline is latest, plus ~20%
  // headroom so the finish/deadline markers sit inside the plot (not jammed on
  // the right edge, coinciding with the axis-end label). Capped so a near-zero
  // pace doesn't squash the curve into the left edge.
  const rawHorizon = Math.max(mPace ?? 0, mContrib ?? 0, deadlineMonths ?? 0, 6);
  const horizon = Math.min(Math.max(Math.ceil(rawHorizon * 1.2), 6), 120);

  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const y = (valFrac: number) => BASE - clamp01(valFrac) * (BASE - TOP);
  const x = (mFrac: number) => clamp01(mFrac) * W;
  /** Same y, but as a percent of the container height — for HTML overlays. */
  const topPct = (valFrac: number) => (y(valFrac) / H) * 100;

  const linePts = (pace: number) => {
    const steps = 20;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const mo = (i / steps) * horizon;
      const val = pace > 0 ? Math.min(current + pace * mo, target) : current;
      pts.push([x(i / steps), y(target > 0 ? val / target : 0)]);
    }
    return pts;
  };
  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  const pacePts = avgSavings > 0 ? linePts(avgSavings) : [
    [x(0), y(currentFrac)],
    [x(1), y(currentFrac)],
  ] as [number, number][];
  const contribPts = monthly ? linePts(monthly) : null;

  // Primary line = the contribution plan when present, else the household pace.
  const primaryPts = contribPts ?? pacePts;
  const areaPath = `${toPath(primaryPts)} L${W} ${BASE} L0 ${BASE} Z`;

  const primaryColor = done
    ? "text-income"
    : deadlineMonths != null && !onTrack
      ? "text-expense"
      : "text-accent";
  const deadlineDone = onTrack || done;

  // Overlay label x-positions (percent of width), clamped off the edges.
  const clampX = (p: number) => Math.min(Math.max(p, 7), 93);
  const finishPctOf = (months: number | null) =>
    !done && months != null && months > 0 && months <= horizon
      ? clampX((months / horizon) * 100)
      : null;
  // Goal-achievement markers: where each projection line reaches the target.
  const pacePctFinish = finishPctOf(mPace);
  const contribPctFinish = finishPctOf(mContrib);
  const primaryMonths = mContrib ?? mPace;
  const finishPct = monthly ? contribPctFinish : pacePctFinish; // primary line's finish
  const secondaryFinishPct = monthly ? pacePctFinish : null; // pace line's finish (muted)
  const finishIso = primaryMonths != null ? addMonthsIso(primaryMonths) : null;
  const deadlinePct =
    deadlineMonths != null ? clampX((Math.max(deadlineMonths, 0) / horizon) * 100) : null;

  const primaryLegend = monthly ? "По отчислениям" : "По темпу сбережений";
  // Axis labels: X is time (this month → the plot's horizon), Y is money (0 → target).
  const nowLabel = monthYear(addMonthsIso(0));
  const endLabel = monthYear(addMonthsIso(horizon));

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted">Прогноз накоплений</div>

      <div className="flex gap-1.5">
        {/* Y axis: money, 0 → target */}
        <div className="relative w-7 shrink-0 h-28 text-[9px] text-muted">
          <span
            className="absolute right-0 -translate-y-1/2 leading-none"
            style={{ top: `${topPct(1)}%` }}
          >
            Цель
          </span>
          <span
            className="absolute right-0 -translate-y-1/2 leading-none"
            style={{ top: `${topPct(0)}%` }}
          >
            0
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="relative w-full h-28">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              role="img"
              aria-label="Прогноз достижения цели"
            >
              {/* Y axis line (left) */}
              <line
                x1="0"
                y1={y(1)}
                x2="0"
                y2={BASE}
                className="stroke-border"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {/* target level */}
              <line
                x1="0"
                y1={y(1)}
                x2={W}
                y2={y(1)}
                className="stroke-border"
                strokeWidth="1"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              {/* baseline = X axis */}
              <line
                x1="0"
                y1={BASE}
                x2={W}
                y2={BASE}
                className="stroke-border"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
          {/* area + primary projection */}
          <path d={areaPath} className={`${primaryColor} fill-current`} fillOpacity="0.12" />
          <path
            d={toPath(primaryPts)}
            className={`${primaryColor} stroke-current`}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* secondary (household pace) — shown only when a contribution line is
              the primary one, dashed and muted */}
          {contribPts && avgSavings > 0 && (
            <path
              d={toPath(pacePts)}
              className="stroke-muted"
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* goal-achievement markers: vertical drop from where a projection
              line meets the target down to the axis. Secondary (pace) drawn
              muted and behind; primary in the line's own colour on top. */}
          {secondaryFinishPct != null && (
            <line
              x1={(secondaryFinishPct / 100) * W}
              y1={y(1)}
              x2={(secondaryFinishPct / 100) * W}
              y2={BASE}
              className="stroke-muted"
              strokeWidth="1"
              strokeDasharray="1 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {finishPct != null && (
            <line
              x1={(finishPct / 100) * W}
              y1={y(1)}
              x2={(finishPct / 100) * W}
              y2={BASE}
              className={`${primaryColor} stroke-current`}
              strokeWidth="1.25"
              strokeDasharray="1 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* deadline marker — SOLID vertical line, so it reads differently from
              the DOTTED achievement markers (and matches the solid legend swatch). */}
          {deadlinePct != null && (
            <line
              x1={(deadlinePct / 100) * W}
              y1={TOP - 4}
              x2={(deadlinePct / 100) * W}
              y2={BASE + 2}
              className={deadlineDone ? "stroke-income" : "stroke-expense"}
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* ── HTML overlays (crisp text over the stretched SVG) ─────────────── */}
        {/* current progress marker — «you are here» dot on the curve start */}
        <div
          className={`absolute w-2.5 h-2.5 rounded-full bg-current ring-2 ring-panel ${primaryColor}`}
          style={{ left: "0.5%", top: `${topPct(currentFrac)}%`, transform: "translate(-50%,-50%)" }}
        />
        {/* finish date — in the reserved TOP strip, above the curve */}
        {finishPct != null && finishIso && (
          <div
            className={`absolute top-0 -translate-x-1/2 text-[10px] font-medium ${primaryColor} whitespace-nowrap`}
            style={{ left: `${finishPct}%` }}
          >
            {monthYear(finishIso)}
          </div>
        )}
            {/* deadline date — in the reserved BOTTOM strip, under its marker */}
            {deadlinePct != null && deadline && (
              <div
                className={`absolute bottom-0 -translate-x-1/2 text-[10px] whitespace-nowrap ${
                  deadlineDone ? "text-income" : "text-expense"
                }`}
                style={{ left: `${deadlinePct}%` }}
              >
                дедлайн · {monthYear(deadline)}
              </div>
            )}
          </div>

          {/* X axis: time, this month → the plot's horizon */}
          <div className="flex justify-between text-[9px] text-muted mt-0.5">
            <span>{nowLabel}</span>
            <span>{endLabel}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px]">
        <Legend
          swatch={
            <span className={`inline-block w-3.5 h-[2px] rounded-full bg-current ${primaryColor}`} />
          }
        >
          {primaryLegend}
        </Legend>
        {contribPts && avgSavings > 0 && (
          <Legend
            swatch={<span className="inline-block w-3.5 border-t border-dashed border-muted" />}
          >
            По общему темпу
          </Legend>
        )}
        {finishPct != null && (
          <Legend
            swatch={
              <span className={`inline-block w-0 h-3 border-l border-dotted border-current ${primaryColor}`} />
            }
          >
            Достижение
          </Legend>
        )}
        {deadlinePct != null && (
          <Legend
            swatch={
              <span
                className={`inline-block w-[2px] h-3 ${
                  deadlineDone ? "bg-income" : "bg-expense"
                }`}
              />
            }
          >
            Дедлайн
          </Legend>
        )}
        <Legend swatch={<span className="inline-block w-3.5 border-t border-dashed border-border" />}>
          Цель
        </Legend>
      </div>
    </div>
  );
}
