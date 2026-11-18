/**
 * «Цели» на главной: сколько накоплено по каждой цели и когда она будет
 * достигнута.
 *
 * Прогресс и срок считает `goalMetrics` — тот же расчёт, что на странице
 * «Цели». Данные (живые счета, курсы на сегодня) читаются здесь, а не на
 * главной: они нужны только тем, кто этот виджет поставил.
 */

import { useEffect, useMemo } from "react";
import { BlockTitle } from "./blocks/shared";
import { ProgressBar } from "../ProgressBar";
import { SectionEmpty } from "../SectionEmpty";
import { SmoothNavLink } from "../SmoothNavLink";
import { useAnalyticsTransactions } from "../../hooks/useAnalyticsTransactions";
import { useGoalsMoney } from "../../hooks/useGoalsMoney";
import { useSmoothNavigate } from "../../hooks/useSmoothNavigate";
import { useGoalsStore } from "../../store/useGoalsStore";
import { goalMetrics, monthYear } from "../../lib/goalMetrics";
import { formatMoney, formatPct } from "../../lib/format";

export function GoalsWidget({ base }: { base: string }) {
  // Темп сбережений — без оборотов и внебалансовых счетов, как на «Целях».
  const transactions = useAnalyticsTransactions();
  const goals = useGoalsStore((s) => s.goals);
  const loaded = useGoalsStore((s) => s.loaded);
  const hydrate = useGoalsStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) void hydrate();
  }, [loaded, hydrate]);
  const { money, avgSavings } = useGoalsMoney(transactions);
  const smoothNavigate = useSmoothNavigate();

  const rows = useMemo(
    () =>
      goals
        .map((g) => ({ g, m: goalMetrics(g, money, avgSavings) }))
        // Незакрытые первыми, ближе к финишу — выше; достигнутые в конце.
        .sort((a, b) => Number(a.m.done) - Number(b.m.done) || b.m.ratio - a.m.ratio),
    [goals, money, avgSavings]
  );

  return (
    <>
      <BlockTitle
        title="Цели"
        info={
          <p>
            Сколько накоплено по каждой цели и когда она будет достигнута. Срок
            считается по вашим отчислениям, если они заданы у цели, иначе — по
            среднему темпу сбережений за полгода. У цели со сроком видно,
            успеваете ли вы к нему. Числа те же, что в разделе «Цели».
          </p>
        }
        to="/goals"
        linkLabel="Цели"
      />
      {rows.length === 0 ? (
        <SectionEmpty
          variant="compact"
          action={
            <SmoothNavLink to="/goals" className="btn-ghost text-sm">
              Поставить цель
            </SmoothNavLink>
          }
        >
          {loaded ? "Целей пока нет" : "Загружаем цели…"}
        </SectionEmpty>
      ) : (
        <div className="scroll-soft flex flex-col gap-2 flex-1 min-h-0 -mx-2 px-2" data-testid="goals-widget">
          {rows.map(({ g, m }) => {
            const late = !m.done && g.deadline !== null && !m.onTrack;
            let forecast: string;
            if (m.done) forecast = "Достигнута";
            else if (m.effective.months === null || !m.effective.finish) forecast = "При таком темпе не накопить";
            else forecast = `Прогноз: ${monthYear(m.effective.finish)}`;
            return (
              <button
                key={g.id}
                type="button"
                data-goal={g.name}
                onClick={() => smoothNavigate("/goals")}
                className="w-full shrink-0 text-left group py-2 px-2 rounded-lg transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[15px] font-medium flex-1 group-hover:text-accent">
                    {g.name}
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                    {formatPct(m.ratio, 0)}
                  </span>
                </div>
                <ProgressBar value={m.ratio} tone={m.done ? "income" : "accent"} className="mt-1.5" />
                <div className="mt-1.5 flex items-baseline gap-2 text-[12px] text-muted tabular-nums">
                  <span className="truncate flex-1">
                    {formatMoney(m.current, base)} из {formatMoney(g.target, base)}
                  </span>
                  <span className={`shrink-0 ${m.done ? "text-income" : late ? "text-warn" : ""}`}>
                    {forecast}
                    {late && " · Позже срока"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
