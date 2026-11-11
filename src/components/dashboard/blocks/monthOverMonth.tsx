import { pluralRu } from "../../../lib/plural";
import {
  isImprovement,
  type MoMMetric,
  type MonthOverMonth,
} from "../../../lib/monthOverMonth";
import { ArrowUp, ArrowDown } from "lucide-react";
import { formatMoney, formatNum, formatPct } from "../../../lib/format";






/**
 * «Месяц к месяцу» — сравнение отчётного месяца с предыдущим.
 *
 * Главная отвечает на вопрос «сколько», но не отвечает на «нормально ли это»:
 * «Итоги месяца» показывают только текущий, и сравнить его не с чем.
 *
 * Пока месяц идёт, от прошлого берётся столько же дней — об этом сказано прямо
 * в шапке («30 из 31 дня») и под числом («в июле за те же 30 дней»). Подпись
 * стоит рядом с числом, а не в подвале: она объясняет, почему сравнение вообще
 * имеет смысл, и в подвале её никто не читает.
 */
export function MonthOverMonthBlock({
  mom,
  base,
  prevLabel,
}: {
  mom: MonthOverMonth;
  base: string;
  /** Название прошлого месяца в ПРЕДЛОЖНОМ падеже: «в июле за те же…». */
  prevLabel: string;
}) {
  const net = mom.net;
  const netUp = isImprovement(net, false);
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="rounded-[14px] bg-panel2 px-4 py-3.5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
            Чистый поток
          </span>
          {mom.running && (
            <span className="text-[11px] text-muted tabular-nums">
              {mom.days} из {mom.daysInMonth} {pluralRu(mom.daysInMonth, ["дня", "дней", "дней"])}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[32px] font-bold tracking-[-0.03em] tabular-nums leading-[1.05]">
            {formatMoney(net.now, base, { signed: true })}
          </span>
          <DeltaChip metric={net} base={base} up={netUp} />
        </div>
        <div className="text-[12px] text-muted mt-1 tabular-nums">
          {mom.running
            ? `В ${prevLabel} за те же ${mom.days} ${pluralRu(mom.days, ["день", "дня", "дней"])} — ${formatMoney(net.prev, base)}`
            : `В ${prevLabel} — ${formatMoney(net.prev, base)}`}
        </div>
      </div>

      {/* Плитки забирают всю оставшуюся высоту: крупное число прижато к низу
          вместе со строкой «Было…», ярлык держится верха. Так все четыре
          числа и все четыре сравнения стоят по своим линиям. */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3">
        <MomTile label="Доходы" metric={mom.income} base={base} tone="income" />
        <MomTile label="Расходы" metric={mom.expense} base={base} tone="expense" lowerIsBetter />
        <MomTile label="Норма сбережений" metric={mom.savingsRate} base={base} percent />
        <MomTile label="Средний чек" metric={mom.avgExpense} base={base} lowerIsBetter />
      </div>
    </div>
  );
}

/** Пилюля с отклонением. Центрируется по высоте числа, а не садится на его
 *  базовую линию: у крупного числа она от этого провисает. */
function DeltaChip({
  metric,
  base,
  up,
}: {
  metric: MoMMetric;
  base: string;
  up: boolean | null;
}) {
  if (up === null) {
    return (
      <span className="inline-flex items-center rounded-lg bg-panel px-2 py-0.5 text-[12.5px] font-semibold text-muted">
        Без изменений
      </span>
    );
  }
  const cls = up ? "bg-income/10 text-income" : "bg-expense/10 text-expense";
  const Icon = metric.delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12.5px] font-semibold tabular-nums ${cls}`}>
      <Icon className="w-3 h-3" />
      {formatMoney(Math.abs(metric.delta), base)}
      {metric.ratio !== null && ` · ${Math.round(Math.abs(metric.ratio) * 100)}%`}
    </span>
  );
}

function MomTile({
  label,
  metric,
  base,
  tone,
  percent = false,
  lowerIsBetter = false,
}: {
  label: string;
  metric: MoMMetric;
  base: string;
  tone?: "income" | "expense";
  /** Показатель — доля, а не деньги: печатаем процентами. */
  percent?: boolean;
  lowerIsBetter?: boolean;
}) {
  const up = isImprovement(metric, lowerIsBetter);
  const show = (v: number) => (percent ? formatPct(v) : formatMoney(v, base));
  const numCls =
    tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "";
  return (
    <div className="rounded-[14px] border border-border px-4 py-3.5 flex flex-col">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</span>
      {/* Пружина ПЕРЕД числом: оно с подписью держится низа плитки, а зазор
          в 20px разводит их так, что число садится по центру. */}
      <span
        // На телефоне плитка — четверть экрана: 24 px переносили «150 000 ₽»
        // на две строки, знак рубля оставался внизу один.
        className={`mt-auto mb-5 text-[19px] sm:text-[24px] font-semibold tabular-nums tracking-[-0.025em] leading-[1.1] whitespace-nowrap ${numCls}`}
      >
        {show(metric.now)}
      </span>
      <span className="text-[12px] text-muted tabular-nums">
        Было {show(metric.prev)}
        {/* У доли показываем РАЗНИЦУ двух процентов, а не процент от процента:
            14,6 % → −9,6 % это «−24,2 %», а не «−166 %». Строго это пункты, но
            «Было 14,6 %» стоит рядом, и из пары читается, что это разность. */}
        {up !== null && (percent || metric.ratio !== null) && (
          <>
            {" · "}
            <span className={`font-medium ${up ? "text-income" : "text-expense"}`}>
              {metric.delta > 0 ? "+" : "−"}
              {percent
                ? `${formatNum(Math.abs(metric.delta) * 100, { fractionDigits: 1 })}%`
                : `${Math.round(Math.abs(metric.ratio ?? 0) * 100)}%`}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
