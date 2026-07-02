import { useEffect, useMemo, useState } from "react";
import { Target, Plus, Trash2, Calendar, TrendingUp } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useGoalsStore } from "../store/useGoalsStore";
import { confirm } from "../store/useConfirmStore";
import { groupByMonth } from "../lib/aggregations";
import { formatMoney, formatDate } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { DateField } from "../components/DateField";

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function GoalsPage() {
  const transactions = useDataStore((s) => s.transactions);
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

  // Savings pace drives every goal's projected finish date.
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

  function submit() {
    const t = Number(target);
    const c = Number(current) || 0;
    if (!name.trim() || !Number.isFinite(t) || t <= 0) return;
    addGoal({
      name: name.trim(),
      target: t,
      current: c,
      deadline: deadline || null,
    });
    setName("");
    setTarget("");
    setCurrent("");
    setDeadline("");
    setAdding(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-accent shrink-0" />
            Цели
          </h1>
          <p className="text-muted text-sm mt-1">
            Копите на конкретные цели и следите за прогрессом и расчётным сроком
            достижения. Путь к FIRE переехал на страницу «Здоровье».
          </p>
        </div>
        <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Цель
        </button>
      </div>

      {adding && (
        <div className="card card-pad bg-accent/5 border-accent/40">
          <div className="font-semibold mb-3">Новая цель</div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              placeholder="Название (например, Машина)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
            <input
              type="number"
              placeholder="Сумма цели"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input"
            />
            <input
              type="number"
              placeholder="Уже накоплено (опц.)"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input"
            />
            <DateField
              placeholder="Дедлайн"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={submit} className="btn-primary text-sm">
              Сохранить
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <Target className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Нет целей</div>
          <div className="text-sm text-muted mb-4">
            Создайте цель, чтобы видеть прогресс и расчётный срок достижения
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const ratio = Math.min(g.current / g.target, 1);
            const remaining = Math.max(g.target - g.current, 0);
            const monthsRemaining =
              avgSavings > 0 ? Math.ceil(remaining / avgSavings) : null;
            const projectedFinish =
              monthsRemaining !== null
                ? new Date(
                    new Date().getFullYear(),
                    new Date().getMonth() + monthsRemaining,
                    1
                  )
                    .toISOString()
                    .slice(0, 10)
                : null;
            const deadlineMonths = g.deadline
              ? monthsBetween(new Date().toISOString(), g.deadline)
              : null;
            const onTrack =
              monthsRemaining !== null &&
              deadlineMonths !== null &&
              monthsRemaining <= deadlineMonths;

            return (
              <div key={g.id} className="card card-pad">
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-base">{g.name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {formatMoney(g.current, base)} из{" "}
                      {formatMoney(g.target, base)} ·{" "}
                      {(ratio * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Накоплено"
                      defaultValue={g.current}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== g.current)
                          updateGoal(g.id, { current: v });
                      }}
                      className="input text-sm w-32"
                    />
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Удалить цель?",
                          message: `«${g.name}» будет удалена.`,
                          confirmLabel: "Удалить",
                          tone: "danger",
                        });
                        if (ok) removeGoal(g.id);
                      }}
                      className="btn-ghost !p-2 text-muted hover:text-expense"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="h-3 bg-panel2 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full rounded-full ${
                      ratio >= 1 ? "bg-income" : "bg-accent"
                    }`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {monthsRemaining !== null
                      ? `${monthsRemaining} мес при +${formatMoney(avgSavings, base)}/мес`
                      : "Темп сбережений отрицательный — копить нечего"}
                  </div>
                  {projectedFinish && (
                    <div className="flex items-center gap-1.5 text-muted">
                      <Calendar className="w-3.5 h-3.5" />
                      Прогноз: {formatDate(projectedFinish)}
                    </div>
                  )}
                  {g.deadline && (
                    <div
                      className={`flex items-center gap-1.5 ${
                        onTrack ? "text-income" : "text-expense"
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Дедлайн: {formatDate(g.deadline)} ({onTrack ? "успеваете" : "не успеваете"})
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
