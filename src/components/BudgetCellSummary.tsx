import { CalendarClock } from "lucide-react";
import { StatCell, StatRow } from "./SectionCard";
import { ProgressBar } from "./ProgressBar";
import { CategoryDot } from "./CategoryDot";
import { formatDate, formatMoney } from "../lib/format";
import type { PlannedOp } from "../lib/plannedOps";
import { planResidue } from "../lib/zenPlanRules";

export interface BudgetCellSub {
  name: string;
  plan: number;
  fact: number;
  onOpen: () => void;
}

/**
 * Сводка статьи бюджета над её операциями — то, что Дзен-мани показывает,
 * когда «проваливаешься» в категорию: план, сколько уже прошло, остаток,
 * подкатегории и назначенные на месяц платежи.
 */
export function BudgetCellSummary({
  kind,
  plan,
  fact,
  ahead,
  subs,
  upcoming,
  category,
  base,
}: {
  kind: "expense" | "income";
  plan: number;
  fact: number;
  /** Назначено на даты и ещё впереди. */
  ahead: number;
  subs: BudgetCellSub[];
  upcoming: PlannedOp[];
  /** Категория — для значков подкатегорий. */
  category: string;
  base: string;
}) {
  const income = kind === "income";
  const residue = planResidue(plan, fact, ahead);
  const over = plan > 0 && fact > plan ? fact - plan : 0;
  return (
    <div className="space-y-3" data-budget-cell-summary>
      <StatRow>
        <StatCell label="План" value={formatMoney(plan, base)} />
        <StatCell
          label={income ? "Поступило" : "Потрачено"}
          value={formatMoney(fact, base)}
          tone={income ? "income" : "expense"}
        />
        <StatCell
          label={income ? "Ещё поступит" : "Остаток"}
          value={formatMoney(residue, base)}
          tone={residue > 0 ? "accent" : "default"}
          note={over > 0 ? (income ? `Сверх плана ${formatMoney(over, base)}` : `Перерасход ${formatMoney(over, base)}`) : undefined}
          noteCls={income ? "text-income" : "text-expense"}
        />
        <StatCell label="Ещё в плане" value={formatMoney(ahead, base)} />
      </StatRow>
      {plan > 0 && (
        <ProgressBar
          value={fact / plan}
          tone={income ? "income" : fact > plan ? "expense" : "accent"}
          label={`${Math.round((fact / plan) * 100)}% плана`}
        />
      )}
      {(subs.length > 0 || upcoming.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {subs.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted">Подкатегории</div>
              {subs.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={s.onOpen}
                  className="w-full text-left rounded-control px-2 py-1.5 hover:bg-panel2 space-y-1"
                  data-budget-cell-sub={s.name}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <CategoryDot category={s.name} parent={category} size="w-4 h-4" />
                    <span className="flex-1 min-w-0 truncate">{s.name}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {formatMoney(s.fact, base)}
                      {s.plan !== 0 && (
                        <span className="text-muted"> / {formatMoney(s.plan, base)}</span>
                      )}
                    </span>
                  </div>
                  {s.plan > 0 && (
                    <ProgressBar
                      value={s.fact / s.plan}
                      tone={income ? "income" : s.fact > s.plan ? "expense" : "accent"}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted">Запланировано</div>
              {upcoming.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 text-sm px-2 py-1.5"
                  data-budget-cell-planned
                >
                  <CalendarClock className="w-4 h-4 text-muted shrink-0" aria-hidden />
                  <span className="text-muted tabular-nums whitespace-nowrap">
                    {formatDate(p.date, "short")}
                  </span>
                  <span className="flex-1 min-w-0 truncate">
                    {p.payee || p.comment || p.category}
                  </span>
                  <span
                    className={`tabular-nums whitespace-nowrap ${income ? "text-income" : "text-expense"}`}
                  >
                    {formatMoney(p.amountBase, base)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
