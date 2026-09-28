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
import { PieChart as PieIcon, Home, ShoppingBag, PiggyBank, Target } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { periodKey, periodRange, shiftPeriod } from "../lib/period";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { buildNeedsWants, savingsRateSeries } from "../lib/needsWants";
import { robustBounds } from "../lib/dashboardModel";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CardHeader } from "../components/CardHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { SeriesTooltip, TooltipFacts } from "../components/TooltipFacts";
import { Tooltip } from "../components/Tooltip";
import { StatCell, StatRow } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import {
  formatMoney,
  monthLabel,
  formatDate,
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
  const lastDate = useMemo(() => all.reduce((m, t) => (t.date > m ? t.date : m), ""), [all]);
  const range = useMemo(
    () =>
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, lastDate, filters.monthYM, monthStartDay),
    [filters.preset, filters.from, filters.to, filters.monthYM, lastDate, monthStartDay]
  );

  // Динамика — по периоду фильтра, если в нём хотя бы три месяца. Короче —
  // график из одной-двух точек ничего не показывает, и тогда берём 12 месяцев,
  // которые кончаются выбранным: видно, как к нему пришли.
  const trend = useMemo(() => {
    const own = savingsRateSeries(filtered, 0, monthStartDay);
    let series = own;
    let byFilter = true;
    const endIso = range.to ?? lastDate;
    if (own.length < 3 && endIso) {
      byFilter = false;
      const endYm = periodKey(endIso, monthStartDay);
      const from = periodRange(shiftPeriod(endYm, -11), monthStartDay).from;
      const to = periodRange(endYm, monthStartDay).to;
      series = savingsRateSeries(
        applyFilters(transactions, { ...filters, preset: "custom", from, to }, monthStartDay),
        12,
        monthStartDay
      );
    }
    // Месяц почти без дохода даёт норму в −900 %, и обычные ±30 % сжимаются в
    // линию у нуля. Шкала — по типичному размаху (как у столбцов главной),
    // но не уже ±100 %: обычные месяцы не режутся никогда. Точка за шкалой
    // рисуется на её краю с настоящим числом рядом, в подсказке — тоже оно.
    const real = series.map((p) => Math.round(p.rate * 1000) / 10);
    const { lo, hi, clipped } = robustBounds(real, 100);
    // Деления круглые и с нулём: по голым границам Recharts ставил −60 и 54.
    const bottom = Math.min(lo, 0);
    const top = Math.max(hi, 25);
    const step = top - bottom <= 150 ? 25 : top - bottom <= 300 ? 50 : 100;
    const from = Math.floor(bottom / step) * step;
    const to = Math.ceil(top / step) * step;
    const ticks: number[] = [];
    for (let v = from; v <= to; v += step) ticks.push(v);
    return {
      byFilter,
      clipped,
      domain: [from, to] as [number, number],
      ticks,
      points: series.map((p, i) => ({
        month: monthLabel(p.ym),
        rate: Math.min(Math.max(real[i], lo), hi),
        rateReal: real[i],
        cut: real[i] < lo || real[i] > hi,
      })),
    };
  }, [filtered, transactions, filters, range.to, lastDate, monthStartDay]);

  if (all.length === 0) return <EmptyState />;

  // Ширина отрезков — доля дохода. Сбережения при перерасходе прижаты к нулю,
  // чтобы полоса не ломалась; настоящий процент — в итогах.
  const denom = split.needs + split.wants + Math.max(split.savings, 0);
  const w = (x: number) => (denom > 0 ? (x / denom) * 100 : 0);
  const overspent = split.savings < 0;
  const noIncome = split.income <= 0;
  // За какой период посчитано — даты из общего фильтра: при фильтре «по
  // кнопке» его на странице не видно, а доли без периода не прочитать.
  const periodText =
    range.from && range.to
      ? `${formatDate(range.from, "full")} — ${formatDate(range.to, "full")}`
      : "всю историю";

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
              уходит на обязательное, 30% — на то, без чего можно обойтись, 20%
              откладывается. Это не закон, а удобная точка отсчёта.
            </p>
            <p>
              <InfoTerm>Нужды</InfoTerm> — траты в обязательных категориях,{" "}
              <InfoTerm>желания</InfoTerm> — в необязательных, <InfoTerm>сбережения</InfoTerm>{" "}
              — доход минус все расходы. Доли считаются от дохода за период из общего
              фильтра; возвраты уменьшают расход своей категории. График внизу — по
              месяцам того же периода, а если в нём меньше трёх месяцев — за 12 месяцев
              до его конца.
            </p>
            <p>
              Что считать нуждой, а что желанием, задаёт{" "}
              <InfoTerm>обязательность категории</InfoTerm> в Дзен-мани. По умолчанию
              обязательны все категории расходов; желанием становится только то, что
              отмечено необязательным.{" "}
              {zenConnected ? (
                <>
                  Поменять можно в{" "}
                  <Link to={SETTINGS_LINK} className="text-accent hover:underline">
                    Настройки → Справочники → Категории
                  </Link>
                  , колонка «Обязательность»: изменение сразу видно здесь и уходит в
                  Дзен-мани.
                </>
              ) : (
                <>
                  Настроить её можно после{" "}
                  <Link to="/settings" className="text-accent hover:underline">
                    подключения Дзен-мани
                  </Link>
                  : в выгрузке CSV её нет, поэтому все траты считаются нуждами.
                </>
              )}
            </p>
          </InfoPopover>
        }
      />

      <GlobalFilters />


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
            note={
              // Ни одной необязательной категории — главное, что нужно знать
              // про «Желания»: без этого 0% выглядит как успех.
              s.key === "wants" && split.wants === 0 && split.needs > 0
                ? "Нет необязательных категорий — см. «?»"
                : `${formatMoney(s.key === "savings" ? split.savings : s.value, base, {
                    signed: s.key === "savings",
                  })} · ориентир ${s.target}`
            }
            tooltip={cellTip(s)}
          />
        ))}
      </StatRow>

      <div className="card-tray card-pad">
        <CardHeader
          icon={Target}
          title="Факт против ориентира"
          subtitle={`Доли от дохода за ${periodText}. Пунктир — границы 50 и 80%.`}
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
          title="Норма сбережений по месяцам"
          subtitle={
            trend.byFilter
              ? `Какая доля дохода оставалась каждый месяц периода. Пунктир — ориентир 20%.${trend.clipped ? CUT_NOTE : ""}`
              : `12 месяцев до конца выбранного периода — в нём самом меньше трёх месяцев. Пунктир — ориентир 20%.${trend.clipped ? CUT_NOTE : ""}`
          }
        />
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={trend.points}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                domain={trend.domain}
                ticks={trend.ticks}
                allowDataOverflow
                tickFormatter={(v) => pctLabel(v)}
              />
              <RTooltip
                {...chartTooltipProps}
                content={(props) => (
                  <SeriesTooltip
                    {...props}
                    // Настоящее значение, а не высота точки на срезанной шкале.
                    payload={props.payload?.map((p) => ({
                      name: String(p.name ?? ""),
                      color: p.color,
                      dataKey: String(p.dataKey ?? ""),
                      value: (p.payload as { rateReal?: number } | undefined)?.rateReal ?? p.value,
                    }))}
                    formatValue={(v) => pctLabel(v)}
                  />
                )}
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
                dot={(props: CutDotProps) => <CutDot key={props.index} {...props} />}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/** Пояснение под заголовком, когда на графике есть срезанные точки. */
const CUT_NOTE = " Редкие выбросы прижаты к краю шкалы, их настоящее значение подписано.";

interface CutDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { rateReal: number; cut: boolean };
}

/**
 * Точка графика нормы сбережений. Обычная — как у `Area` по умолчанию;
 * срезанная — полая, цветом расхода, с настоящим процентом рядом: высота
 * такой точки ничего не значит, значит только число.
 */
function CutDot({ cx, cy, payload }: CutDotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;
  if (!payload.cut) {
    return <circle cx={cx} cy={cy} r={3} stroke={SAVINGS_COLOR} strokeWidth={2} fill="rgb(var(--c-panel))" />;
  }
  const below = payload.rateReal < 0;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} stroke="rgb(var(--c-expense))" strokeWidth={2} fill="rgb(var(--c-panel))" />
      <text
        x={cx}
        y={below ? cy - 9 : cy + 16}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill="rgb(var(--c-expense))"
      >
        {pctLabel(payload.rateReal)}
      </text>
    </g>
  );
}

/** «−293%» — с типографским минусом, как в остальных процентах сервиса. */
function pctLabel(v: number): string {
  const r = Math.round(v);
  return r < 0 ? `−${-r}%` : `${r}%`;
}
