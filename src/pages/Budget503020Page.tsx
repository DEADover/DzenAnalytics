import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { PieChart as PieIcon, Home, ShoppingBag, PiggyBank, Target, Settings2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { buildNeedsWants, savingsRateSeries } from "../lib/needsWants";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CardHeader } from "../components/CardHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { SeriesTooltip, TooltipFacts } from "../components/TooltipFacts";
import { Tooltip } from "../components/Tooltip";
import { StatCell, StatRow } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import { Callout } from "../components/Callout";
import {
  formatMoney,
  monthLabel,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  chartColor,
} from "../lib/format";

const NEEDS_COLOR = chartColor.accent;
const WANTS_COLOR = chartColor.warn;
const SAVINGS_COLOR = chartColor.income;

/** Где задаётся обязательность категорий — справочник в настройках. */
const SETTINGS_LINK = "/settings?tab=operations";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * «50/30/20» — обязательные траты (нужды), необязательные (желания) и что
 * осталось (сбережения) против ориентира 50/30/20, плюс норма сбережений за
 * 12 месяцев. Деление берётся из обязательности категорий Дзен-мани — своей
 * настройки у раздела нет.
 */
export function Budget503020Page() {
  const all = useDataStore((s) => s.transactions);
  // Как и остальная аналитика — без оборотов и внебалансовых счетов (#14).
  const transactions = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  // Обязательность правится только с подключённым Дзен-мани: в CSV её нет.
  const zenConnected = useZenmoneyStore((s) => !!s.token);

  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);

  // Период — общий фильтр, как на остальных страницах. Раньше у раздела был
  // свой переключатель под фильтром, а даты фильтра стояли погашенными: два
  // периода на одном экране и непонятно, какой действует.
  const filtered = useMemo(
    () => applyFilters(transactions, filters, monthStartDay),
    [transactions, filters, monthStartDay]
  );
  const split = useMemo(() => buildNeedsWants(filtered, categoryMeta), [filtered, categoryMeta]);

  // Динамика — всегда последние 12 месяцев: норма одного месяца скачет, и
  // смысл графика в тренде. Фильтры счетов и категорий она учитывает.
  const trend = useMemo(() => {
    const trendFiltered = applyFilters(
      transactions,
      { ...filters, preset: "12m", from: null, to: null },
      monthStartDay
    );
    return savingsRateSeries(trendFiltered, 12, monthStartDay).map((p) => ({
      month: monthLabel(p.ym),
      rate: Math.round(p.rate * 1000) / 10,
    }));
  }, [transactions, filters, monthStartDay]);

  if (all.length === 0) return <EmptyState />;

  // Ширина отрезков — доля дохода. Сбережения при перерасходе прижаты к нулю,
  // чтобы полоса не ломалась; настоящий процент — в итогах.
  const denom = split.needs + split.wants + Math.max(split.savings, 0);
  const w = (x: number) => (denom > 0 ? (x / denom) * 100 : 0);
  const overspent = split.savings < 0;
  const noIncome = split.income <= 0;

  const segments = [
    {
      key: "needs",
      label: "Нужды",
      value: split.needs,
      share: split.needsPct,
      color: NEEDS_COLOR,
      target: "не больше 50%",
      what: "Траты в обязательных категориях",
    },
    {
      key: "wants",
      label: "Желания",
      value: split.wants,
      share: split.wantsPct,
      color: WANTS_COLOR,
      target: "не больше 30%",
      what: "Траты в категориях, отмеченных необязательными",
    },
    {
      key: "savings",
      label: "Сбережения",
      value: Math.max(split.savings, 0),
      share: split.savingsPct,
      color: SAVINGS_COLOR,
      target: "не меньше 20%",
      what: "Доход минус все расходы",
    },
  ];

  const cellTip = (s: (typeof segments)[number]) => (
    <TooltipFacts
      title={s.what}
      facts={[
        { label: s.label, value: formatMoney(s.key === "savings" ? split.savings : s.value, base) },
        { label: "Доход за период", value: formatMoney(split.income, base) },
        { label: "Доля дохода", value: noIncome ? "—" : pct(s.share), strong: true },
        { label: "Ориентир", value: s.target },
      ]}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PieIcon}
        title="50/30/20"
        info={
          <InfoPopover>
            <p>
              <InfoTerm>50/30/20</InfoTerm> — простой ориентир для бюджета: 50% дохода
              уходит на <InfoTerm>нужды</InfoTerm>, 30% — на <InfoTerm>желания</InfoTerm>,
              20% остаётся в <InfoTerm>сбережениях</InfoTerm>. Это не закон, а удобная
              точка отсчёта.
            </p>
            <p>
              <InfoTerm>Нужды</InfoTerm> — траты в обязательных категориях,{" "}
              <InfoTerm>желания</InfoTerm> — в необязательных, <InfoTerm>сбережения</InfoTerm>{" "}
              — доход минус все расходы. Доли считаются от дохода за период из фильтра;
              возвраты уменьшают расход своей категории.
            </p>
            <p>
              По умолчанию обязательны все категории расходов — так их хранит Дзен-мани.
              Желанием становится только то, что вы отметили необязательным.
            </p>
          </InfoPopover>
        }
      />

      <GlobalFilters />

      {/* Где настраивается деление — на виду, а не в свёрнутом блоке: без этого
          все траты оказываются «нуждами», и непонятно, что с этим делать. */}
      <Callout icon={Settings2}>
        {zenConnected ? (
          <>
            Что считать нуждой, а что желанием, задаёт обязательность категории:{" "}
            <Link to={SETTINGS_LINK} className="text-accent hover:underline">
              Настройки → Справочники → Категории
            </Link>
            , колонка «Обязательность». Изменение сразу видно здесь и уходит в Дзен-мани.
          </>
        ) : (
          <>
            Что считать нуждой, а что желанием, задаёт обязательность категории в
            Дзен-мани. Настроить её здесь можно после{" "}
            <Link to="/settings" className="text-accent hover:underline">
              подключения Дзен-мани
            </Link>
            ; в выгрузке CSV её нет, поэтому все траты считаются нуждами.
          </>
        )}
        {zenConnected && split.needs > 0 && split.wants === 0 && (
          <>
            {" "}
            <strong>Сейчас все траты — нужды:</strong> ни одна категория не отмечена
            необязательной.
          </>
        )}
      </Callout>

      <StatRow>
        {segments.map((s) => (
          <StatCell
            key={s.key}
            label={s.label}
            value={noIncome ? "—" : pct(s.share)}
            tone={
              noIncome
                ? "default"
                : s.key === "needs"
                  ? s.share > 0.5
                    ? "expense"
                    : "default"
                  : s.key === "wants"
                    ? s.share > 0.3
                      ? "warn"
                      : "default"
                    : s.share >= 0.2
                      ? "income"
                      : "expense"
            }
            icon={
              s.key === "needs" ? (
                <Home className="w-4 h-4" />
              ) : s.key === "wants" ? (
                <ShoppingBag className="w-4 h-4" />
              ) : (
                <PiggyBank className="w-4 h-4" />
              )
            }
            note={`${formatMoney(s.key === "savings" ? split.savings : s.value, base, {
              signed: s.key === "savings",
            })} · ориентир ${s.target}`}
            tooltip={cellTip(s)}
          />
        ))}
      </StatRow>

      <div className="card-tray card-pad">
        <CardHeader
          icon={Target}
          title="Факт против ориентира"
          subtitle="Доли от дохода за период. Пунктир — границы 50 и 80%."
        />
        {noIncome ? (
          <div className="text-sm text-muted">
            За период нет доходов — делить не от чего. Выберите период подлиннее.
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="flex h-8 rounded-full overflow-hidden">
                {segments
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <Tooltip key={s.key} content={cellTip(s)}>
                      <div
                        style={{ width: `${w(s.value)}%`, backgroundColor: s.color }}
                        className="flex items-center justify-center text-on-tone text-xs font-medium cursor-help"
                      >
                        {w(s.value) > 8 ? pct(s.share) : ""}
                      </div>
                    </Tooltip>
                  ))}
              </div>
              {/* Границы ориентира: 50% и 80% (= 50 + 30). */}
              {[50, 80].map((x) => (
                <div
                  key={x}
                  className="absolute top-0 h-8 border-l-2 border-dashed border-text/50 pointer-events-none"
                  style={{ left: `${x}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-muted">
              {segments.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label} · {formatMoney(s.key === "savings" ? split.savings : s.value, base, {
                    signed: s.key === "savings",
                  })}
                </span>
              ))}
            </div>
            {overspent && (
              <div className="text-xs text-expense mt-2">
                Расходы превысили доход за период — сбережения отрицательные.
              </div>
            )}
          </>
        )}
      </div>

      <div className="card-tray card-pad">
        <CardHeader
          icon={PiggyBank}
          title="Норма сбережений за 12 месяцев"
          subtitle="Какая доля дохода оставалась каждый месяц. Пунктир — ориентир 20%."
        />
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
              <YAxis stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <RTooltip
                {...chartTooltipProps}
                content={<SeriesTooltip formatValue={(v) => `${Math.round(v)}%`} />}
              />
              <ReferenceLine
                y={20}
                stroke={chartColor.muted}
                strokeDasharray="5 4"
                label={{ value: "Ориентир 20%", position: "right", fontSize: 10, fill: chartColor.muted }}
              />
              <Area
                type="monotone"
                dataKey="rate"
                name="Норма сбережений"
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
