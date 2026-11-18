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
import { formatMoney, formatNum, formatPct } from "../../lib/format";

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

  const summary = useMemo(() => {
    let saved = 0;
    let target = 0;
    let remaining = 0;
    let done = 0;
    for (const { g, m } of rows) {
      // Накопленное сверх цели в свод не идёт: лишнее на одной цели не
      // закрывает недостающее на другой.
      saved += Math.min(m.current, g.target);
      target += g.target;
      remaining += m.remaining;
      if (m.done) done += 1;
    }
    return { saved, target, remaining, done };
  }, [rows]);

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
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="goals-widget">
          {/* Свод по всем целям: без него виджет — просто список полосок, и
              не видно главного — сколько уже отложено из задуманного. */}
          <div className="rounded-[14px] bg-panel2 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Накоплено</span>
              <span className="text-[11px] text-muted tabular-nums">
                Достигнуто {formatNum(summary.done)} из {formatNum(rows.length)}
              </span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[28px] font-bold tracking-[-0.03em] tabular-nums leading-[1.1] whitespace-nowrap">
                {formatMoney(summary.saved, base)}
              </span>
              <span className="text-[13px] text-muted tabular-nums whitespace-nowrap">
                {summary.remaining > 0
                  ? `Осталось ${formatMoney(summary.remaining, base)}`
                  : "Все цели достигнуты"}
              </span>
            </div>
            <ProgressBar
              value={summary.target > 0 ? summary.saved / summary.target : 0}
              tone={summary.done === rows.length ? "income" : "accent"}
              className="mt-2.5 bg-panel"
            />
          </div>

          <div className="scroll-soft flex flex-col gap-2.5 flex-1 min-h-0 -mx-2 px-2">
            {rows.map(({ g, m }) => {
              const late = !m.done && g.deadline !== null && !m.onTrack;
              const inTime = !m.done && g.deadline !== null && m.onTrack;
              const tone = m.done ? "income" : late ? "warn" : "accent";
              let forecast: string;
              if (m.done) forecast = "Цель достигнута";
              else if (m.effective.months === null || !m.effective.finish) forecast = "При таком темпе не накопить";
              else forecast = `Прогноз: ${monthYear(m.effective.finish)}`;
              // Сколько откладывать, чтобы успеть: срок ещё впереди, а темпа не хватает.
              const needed =
                late && m.deadlineMonths !== null && m.deadlineMonths > 0
                  ? m.remaining / m.deadlineMonths
                  : null;
              return (
                <button
                  key={g.id}
                  type="button"
                  data-goal={g.name}
                  onClick={() => smoothNavigate("/goals")}
                  className="w-full shrink-0 text-left group flex items-center gap-3.5 rounded-[14px] border border-border px-3.5 py-3 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <GoalRing ratio={m.ratio} tone={tone} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium flex-1 group-hover:text-accent">
                        {g.name}
                      </span>
                      {(m.done || late || inTime) && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                            late ? "bg-warn/10 text-warn" : "bg-income/10 text-income"
                          }`}
                        >
                          {m.done ? "Достигнута" : late ? "Позже срока" : "В срок"}
                        </span>
                      )}
                    </span>
                    <span className="block mt-0.5 text-[13px] tabular-nums truncate">
                      {formatMoney(m.current, base)}{" "}
                      <span className="text-muted">из {formatMoney(g.target, base)}</span>
                    </span>
                    <span className="block mt-1 text-[12px] text-muted tabular-nums truncate">
                      {forecast}
                      {!m.done && g.deadline && ` · Срок: ${monthYear(g.deadline)}`}
                    </span>
                    {needed !== null && (
                      <span className="block mt-0.5 text-[12px] text-warn tabular-nums truncate">
                        Чтобы успеть — {formatMoney(needed, base)} в месяц
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const RING_TONE = {
  accent: "rgb(var(--c-accent))",
  income: "rgb(var(--c-income))",
  warn: "rgb(var(--c-warn))",
} as const;

/** Кольцо прогресса цели с процентом внутри. */
function GoalRing({ ratio, tone }: { ratio: number; tone: keyof typeof RING_TONE }) {
  const r = 22;
  const len = 2 * Math.PI * r;
  const part = Math.max(0, Math.min(1, ratio));
  return (
    <span className="relative shrink-0 w-[56px] h-[56px] grid place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" stroke="rgb(var(--c-panel2))" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke={RING_TONE[tone]}
          strokeDasharray={`${part * len} ${len}`}
        />
      </svg>
      <span className="relative text-[13px] font-semibold tabular-nums">{formatPct(part, 0)}</span>
    </span>
  );
}
