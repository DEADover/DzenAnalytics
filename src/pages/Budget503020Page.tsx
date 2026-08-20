import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { PieChart as PieIcon, Home, ShoppingBag, PiggyBank, Info, ChevronDown } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import {
  useFiltersStore,
  applyFilters,
  type DatePreset,
} from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { buildNeedsWants, savingsRateSeries } from "../lib/needsWants";
import { PeriodPills } from "../components/PeriodPills";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SeriesTooltip } from "../components/TooltipFacts";
import { Stat } from "../components/Stat";
import { EmptyState } from "../components/EmptyState";
import {
  formatMoney,
  monthLabel,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";

const NEEDS_COLOR = "#3B82F6";
const WANTS_COLOR = "#F59E0B";
const SAVINGS_COLOR = "#10B981";

/**
 * «50/30/20» — fixed expenses (needs) vs everything else (wants) vs what's
 * left over (savings), against the rule-of-thumb 50/30/20, plus a 12-month
 * savings-rate trend. Reuses the user's existing category flags
 * (fixed/discretionary) — no extra setup.
 */
export function Budget503020Page() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);

  // Snapshot period for the split (own period, like the history charts).
  const [period, setPeriod] = useState<DatePreset>("3m");
  const effectiveFilters = useMemo(
    () => ({ ...filters, preset: period, from: null, to: null }),
    [filters, period]
  );
  const filtered = useMemo(
    () => applyFilters(transactions, effectiveFilters, monthStartDay),
    [transactions, effectiveFilters, monthStartDay]
  );

  // «Нужды» = обязательные траты. По умолчанию обязательно: трата — нужда,
  // если «обязательная» не выставлена в `false`. Учитывается обязательность на
  // уровне подкатегории, затем категории (#5). Флаг редактируется в блоке
  // «Обязательность расходов в категориях» на странице «Категории».
  const split = useMemo(
    () => buildNeedsWants(filtered, categoryMeta),
    [filtered, categoryMeta]
  );

  // Trend is always the last 12 months (independent of the snapshot period),
  // but still respects account/category/currency filters.
  const trendFiltered = useMemo(
    () =>
      applyFilters(
        transactions,
        { ...filters, preset: "12m", from: null, to: null },
        monthStartDay
      ),
    [transactions, filters, monthStartDay]
  );
  const trend = useMemo(
    () =>
      savingsRateSeries(trendFiltered, 12).map((p) => ({
        month: monthLabel(p.ym),
        rate: Math.round(p.rate * 1000) / 10,
      })),
    [trendFiltered]
  );

  if (transactions.length === 0) return <EmptyState />;

  // Bar widths: share of income (savings clamped to ≥0 so the bar stays sane
  // when overspending; the actual % still shows in the cards).
  const denom = split.needs + split.wants + Math.max(split.savings, 0);
  const w = (x: number) => (denom > 0 ? (x / denom) * 100 : 0);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const overspent = split.savings < 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PieIcon}
        title="50/30/20"
        hint="Нужды / желания / сбережения против бюджетного ориентира 50/30/20"
        right={<PeriodPills value={period} onChange={setPeriod} />}
      />
      <GlobalFilters showDateRange={false} dateRangeHint="Правило 50/30/20 считается за месяц, выбранный ниже" />

      <details className="card-tray card-pad text-sm group">
        <summary className="cursor-pointer flex items-center gap-2 font-medium list-none">
          <Info className="w-4 h-4 text-accent shrink-0" />
          Что это за правило и как настроить деление
          <ChevronDown className="w-4 h-4 ml-auto text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-2 text-muted leading-relaxed">
          <p>
            <strong>50/30/20</strong> — простой ориентир для бюджета: <strong>50%</strong>{" "}
            дохода уходит на <strong>нужды</strong> (обязательное), <strong>30%</strong> —
            на <strong>желания</strong> (необязательное), <strong>20%</strong> остаётся в{" "}
            <strong>сбережениях</strong>. Это не жёсткий закон, а удобная точка отсчёта.
          </p>
          <p>Как доли считаются здесь:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Нужды</strong> — обязательные расходы. <strong>По умолчанию
              обязательными считаются все категории расходов</strong>; желанием
              становится только то, что вы явно отметили как{" "}
              <strong>«Необязательную»</strong>.
            </li>
            <li>
              <strong>Желания</strong> — расходы в категориях, отмеченных как
              необязательные.
            </li>
            <li>
              <strong>Сбережения</strong> — доход минус расход (что осталось).
            </li>
          </ul>
          <p className="pt-1">
            Обязательность берётся из поля «обязательная» у категории в{" "}
            <strong>Дзен-мани</strong>. Изменить её можно в блоке{" "}
            <strong>«Обязательность расходов в категориях»</strong> на странице{" "}
            <Link to="/categories" className="text-accent hover:underline">
              «Категории»
            </Link>{" "}
            — переключателем <strong>Обязательная / Необязательная</strong>. Изменение
            сразу видно здесь и <strong>синхронизируется в облако</strong> Дзен-мани
            (в режиме API).
          </p>
        </div>
      </details>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat
          label="Нужды"
          value={pct(split.needsPct)}
          tone={split.needsPct > 0.5 ? "expense" : "default"}
          icon={<Home className="w-4 h-4" />}
          hint={`${formatMoney(split.needs, base)} · цель ≤ 50%`}
        />
        <Stat
          label="Желания"
          value={pct(split.wantsPct)}
          tone={split.wantsPct > 0.3 ? "warn" : "default"}
          icon={<ShoppingBag className="w-4 h-4" />}
          hint={`${formatMoney(split.wants, base)} · цель ≤ 30%`}
        />
        <Stat
          label="Сбережения"
          value={pct(split.savingsPct)}
          tone={split.savingsPct >= 0.2 ? "income" : "expense"}
          icon={<PiggyBank className="w-4 h-4" />}
          hint={`${formatMoney(split.savings, base, { signed: true })} · цель ≥ 20%`}
        />
      </div>

      {split.needs > 0 && split.wants === 0 && (
        <div className="card card-pad bg-accent/5 border-accent/40 flex items-start gap-2 text-sm">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <span className="text-muted">
            Все расходы засчитаны в «нужды» — по умолчанию все категории считаются
            обязательными. Чтобы перенести часть в «желания», отметьте такие
            категории как <strong>«Необязательная»</strong> в блоке{" "}
            <strong>«Обязательность расходов в категориях»</strong> на странице{" "}
            <Link to="/categories" className="text-accent hover:underline">
              «Категории»
            </Link>{" "}
            (изменение уйдёт в облако Дзен-мани).
          </span>
        </div>
      )}

      <div className="card-tray card-pad">
        <div className="font-semibold mb-1">Факт против цели</div>
        <div className="text-xs text-muted mb-4">
          Доли от дохода. Пунктир — границы правила 50/30/20.
        </div>
        <div className="relative">
          <div className="flex h-8 rounded-full overflow-hidden">
            {split.needs > 0 && (
              <div
                style={{ width: `${w(split.needs)}%`, backgroundColor: NEEDS_COLOR }}
                className="flex items-center justify-center text-white text-xs font-medium"
              >
                {w(split.needs) > 8 ? pct(split.needsPct) : ""}
              </div>
            )}
            {split.wants > 0 && (
              <div
                style={{ width: `${w(split.wants)}%`, backgroundColor: WANTS_COLOR }}
                className="flex items-center justify-center text-white text-xs font-medium"
              >
                {w(split.wants) > 8 ? pct(split.wantsPct) : ""}
              </div>
            )}
            {split.savings > 0 && (
              <div
                style={{ width: `${w(split.savings)}%`, backgroundColor: SAVINGS_COLOR }}
                className="flex items-center justify-center text-white text-xs font-medium"
              >
                {w(split.savings) > 8 ? pct(split.savingsPct) : ""}
              </div>
            )}
          </div>
          {/* Target boundary markers at 50% and 80% (= 50 + 30). */}
          <div
            className="absolute top-0 h-8 border-l-2 border-dashed border-text/50"
            style={{ left: "50%" }}
          />
          <div
            className="absolute top-0 h-8 border-l-2 border-dashed border-text/50"
            style={{ left: "80%" }}
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NEEDS_COLOR }} />
            Нужды · {formatMoney(split.needs, base)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: WANTS_COLOR }} />
            Желания · {formatMoney(split.wants, base)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SAVINGS_COLOR }} />
            Сбережения · {formatMoney(split.savings, base, { signed: true })}
          </span>
        </div>
        {overspent && (
          <div className="text-xs text-expense mt-2">
            Расходы превысили доход за период — сбережения отрицательные.
          </div>
        )}
      </div>

      <div className="card-tray card-pad">
        <div className="font-semibold mb-1">Норма сбережений за 12 месяцев</div>
        <div className="text-xs text-muted mb-4">
          (доход − расход) / доход по месяцам. Пунктир — цель 20%.
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                {...chartTooltipProps}
                content={
                  <SeriesTooltip formatValue={(v) => `${Math.round(v)}%`} />
                }
              />
              <ReferenceLine
                y={20}
                stroke="#888780"
                strokeDasharray="5 4"
                label={{ value: "цель 20%", position: "right", fontSize: 10, fill: "#888780" }}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke={SAVINGS_COLOR}
                fill={SAVINGS_COLOR}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
