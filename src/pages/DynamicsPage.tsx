import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Activity, BarChart3, LineChart as LineChartIcon } from "lucide-react";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters, FILTER_NONE } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { getLiveAccountsFromCache, type LiveAccount } from "../store/useZenmoneyStore";
import { toBase } from "../lib/csv";
import { useLocalPeriod } from "../hooks/useLocalPeriod";
import { useCounterpartyTitles } from "../hooks/useDictionaries";
import {
  buildDynamics,
  bucketKey,
  METRIC_LABELS,
  GRANULARITY_LABELS,
  GRANULARITY_UNIT,
  type DynamicsMetric,
  type DynamicsPoint,
  type Granularity,
} from "../lib/dynamics";
import { presetToRange } from "../store/useFiltersStore";
import {
  formatMoney,
  formatNum,
  displayPayee,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { ChartTooltipCard, TooltipFacts } from "../components/TooltipFacts";
import { MultiSelect } from "../components/MultiSelect";
import { InfoPopover } from "../components/InfoPopover";

const METRICS: DynamicsMetric[] = ["expense", "income", "net", "balance"];
const GRANULARITIES: Granularity[] = ["day", "week", "month", "year"];

/** Цвет ряда по смыслу метрики — те же токены, что и везде в сервисе. */
const METRIC_COLOR: Record<DynamicsMetric, string> = {
  expense: "rgb(var(--c-expense))",
  income: "rgb(var(--c-income))",
  net: "rgb(var(--c-accent))",
  balance: "rgb(var(--c-accent))",
};

const NO_PAYEE = "— без получателя —";

/**
 * «Динамика» (issue #39) — отфильтрованные операции на временной оси.
 *
 * Отвечает на вопрос «сколько и как часто»: всплески видно на фоне пустых
 * интервалов, а «Среднее» считается по всему периоду, а не по дням с
 * операциями. Период, счета, категории и поиск берём из общей панели фильтров;
 * получателя добавляем своим пикером — в общей панели его нет.
 */
export function DynamicsPage() {
  const all = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const drill = useDrillStore((s) => s.show);

  const [metric, setMetric] = useState<DynamicsMetric>("expense");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [asBars, setAsBars] = useState(false);
  const [payees, setPayees] = useState<Set<string>>(new Set());
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);

  // Реальные остатки по счетам (режим API) — без них «Баланс» был бы
  // накопленным потоком с нуля и уходил бы в минус у того, кто копил до начала
  // выгрузки. Та же привязка, что у графика «Баланс по счетам» на «Счетах».
  useEffect(() => {
    let cancelled = false;
    void getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [all]);

  // Свой период (по умолчанию «С начала года»): отчёт про историю, а глобальный
  // «текущий месяц» схлопнул бы график в несколько точек. Остальные фильтры —
  // общие.
  const lp = useLocalPeriod("ytd");
  const effectiveFilters = useMemo(
    () => ({ ...filters, preset: lp.preset, monthYM: lp.monthYM, from: lp.from, to: lp.to }),
    [filters, lp.preset, lp.monthYM, lp.from, lp.to]
  );

  const filtered = useMemo(
    () => applyFilters(all, effectiveFilters, monthStartDay),
    [all, effectiveFilters, monthStartDay]
  );

  // Получатели здесь и справочник контрагентов — разные множества, и это не
  // ошибка: в списке ровно те, кто встретился в операциях за период, а в
  // справочнике — все заведённые в Дзен-мани, включая тех, по кому за период
  // ничего не было. Плюс банк присылает получателей строкой («11043 MOP SBP»),
  // и контрагента у них нет вовсе. Поэтому не сводим числа, а показываем стык:
  // список делится на «из справочника» и «только в операциях».
  const dictTitles = useCounterpartyTitles();

  const payeeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of filtered) set.add(displayPayee(t) || NO_PAYEE);
    const all = Array.from(set);
    const known = all
      .filter((p) => p !== NO_PAYEE && dictTitles.has(p))
      .sort((a, b) => a.localeCompare(b, "ru"));
    const unknown = all
      .filter((p) => p !== NO_PAYEE && !dictTitles.has(p))
      .sort((a, b) => a.localeCompare(b, "ru"));
    // «Без получателя» — наверху и без заголовка: это не запись справочника и
    // не банковская строка, а их отсутствие.
    const head = set.has(NO_PAYEE) ? [NO_PAYEE] : [];
    return { options: [...head, ...known, ...unknown], known, unknown };
  }, [filtered, dictTitles]);

  /** Заголовок группы получателя. `null` — строка идёт без заголовка. */
  const payeeGroup = useCallback(
    (p: string) => {
      if (dictTitles.size === 0 || p === NO_PAYEE) return null;
      return dictTitles.has(p)
        ? `Из справочника · ${payeeOptions.known.length}`
        : `Только в операциях · ${payeeOptions.unknown.length}`;
    },
    [dictTitles, payeeOptions]
  );

  const byPayee = useMemo(() => {
    if (payees.size === 0) return filtered;
    if (payees.has(FILTER_NONE)) return [];
    return filtered.filter((t) => payees.has(displayPayee(t) || NO_PAYEE));
  }, [filtered, payees]);

  // Ось строим по выбранному периоду, а не по датам операций: «за год» с
  // единственной покупкой в декабре должен остаться графиком за год.
  const range = useMemo(() => {
    const maxDate = all.reduce((m, t) => (t.date > m ? t.date : m), "");
    return effectiveFilters.preset === "custom"
      ? { from: effectiveFilters.from, to: effectiveFilters.to }
      : presetToRange(
          effectiveFilters.preset,
          maxDate,
          effectiveFilters.monthYM,
          monthStartDay
        );
  }, [effectiveFilters, all, monthStartDay]);

  const rates = useDataStore((s) => s.rates);
  const realBalances = useMemo(() => {
    if (!liveAccounts || liveAccounts.length === 0) return null;
    const m: Record<string, number> = {};
    for (const a of liveAccounts) m[a.title] = toBase(a.balance, a.currency, rates);
    return m;
  }, [liveAccounts, rates]);

  /** Остаток не выводится из отобранных операций: он складывается из начального
   *  остатка счёта и всего его оборота. Поэтому «Балансу» отдаём операции
   *  целиком — фильтры по категории и получателю к остатку неприменимы, — а
   *  фильтр по счетам, наоборот, осмыслен и работает. */
  const balanceSource = useMemo(() => {
    const accounts =
      filters.accounts.size === 0
        ? null
        : filters.accounts.has(FILTER_NONE)
          ? new Set<string>()
          : new Set(filters.accounts);
    return { all, accounts, realBalances };
  }, [all, filters.accounts, realBalances]);

  const series = useMemo(
    () => buildDynamics(byPayee, metric, granularity, monthStartDay, range, balanceSource),
    [byPayee, metric, granularity, monthStartDay, range, balanceSource]
  );

  /** Операции интервала — для окна детализации по клику на точке. */
  function openBucket(key: string) {
    const inBucket = byPayee.filter(
      (t) => t.date && bucketKey(t.date, granularity, monthStartDay) === key
    );
    const relevant = inBucket.filter((t) =>
      metric === "expense"
        ? t.kind === "expense" || t.kind === "refund"
        : metric === "income"
          ? t.kind === "income"
          : t.kind !== "transfer"
    );
    if (relevant.length === 0) return;
    const point = series.points.find((p) => p.key === key);
    drill(point?.label ?? key, relevant, METRIC_LABELS[metric]);
  }

  if (all.length === 0) return <EmptyState />;

  const color = METRIC_COLOR[metric];
  const hasNegative = series.points.some((p) => p.value < 0);
  // «Итого» у баланса — не сумма, а остаток на конец периода.
  const totalLabel = metric === "balance" ? "Остаток на конец" : "Итого";
  const avgLabel = `Среднее за ${GRANULARITY_UNIT[granularity]}`;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title="Динамика"
        hint="Отобранные операции на временной оси — сколько и как часто"
      />

      <GlobalFilters period={lp} />

      <div className="card-tray card-pad space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-panel2 rounded-full p-1 border border-border shadow-tray">
            {METRICS.map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={clsx(
                  "px-2.5 py-1 text-xs rounded-full transition-colors",
                  metric === m ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
                )}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>

          <div className="flex bg-panel2 rounded-full p-1 border border-border shadow-tray">
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={clsx(
                  "px-2.5 py-1 text-xs rounded-full transition-colors",
                  granularity === g
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-text"
                )}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>

          <MultiSelect
            label="Получатель"
            options={payeeOptions.options}
            groupOf={payeeGroup}
            selected={payees}
            onChange={setPayees}
            unitForms={["получатель", "получателя", "получателей"]}
            searchPlaceholder="Поиск получателя…"
            menuMinWidth={260}
            compactSummary
            summaryMinWidth="4.2rem"
          />

          <button
            type="button"
            onClick={() => setAsBars((v) => !v)}
            className="btn-ghost !p-1.5 text-muted hover:text-accent shrink-0"
            title={asBars ? "Показать линией" : "Показать столбцами"}
            aria-label={asBars ? "Показать линией" : "Показать столбцами"}
          >
            {asBars ? (
              <LineChartIcon className="w-4 h-4" />
            ) : (
              <BarChart3 className="w-4 h-4" />
            )}
          </button>

          <InfoPopover>
                  <p>
                    <strong className="text-text">Пустые интервалы не пропускаются</strong>{" "}
                    — по графику видно не только суммы, но и частоту: всплески на
                    фоне нулей.
                  </p>
                  <p>
                    <strong className="text-text">Среднее</strong> считается по всем
                    интервалам периода, включая пустые. Средний расход в день — это
                    сумма, делённая на все дни, а не только на дни с покупками.
                  </p>
                  <p>
                    <strong className="text-text">Расходы</strong> — траты за вычетом
                    возвратов, как и на остальных экранах. Поэтому интервал, где
                    вернули больше, чем потратили, уходит ниже нуля — в подсказке
                    видно разбивку на траты и возвраты. <strong className="text-text">Чистый доход</strong> —
                    доходы минус расходы за интервал.{" "}
                    <strong className="text-text">Баланс</strong> — реальный
                    остаток на счетах: оборот поднят до текущих балансов из
                    Дзен-мани, поэтому виден и капитал, накопленный до начала
                    выгрузки. Переводы между своими счетами остаток не меняют —
                    но меняют, если отобрана только часть счетов.
                  </p>
                  <p>
                    <strong className="text-text">Получатель</strong> — те, кто
                    встретился в операциях за период, поэтому их число не совпадает
                    со справочником контрагентов: там есть записи, по которым за
                    период ничего не было, а здесь — присланные банком строки, для
                    которых контрагент не заведён. В списке они разделены на «из
                    справочника» и «только в операциях».
                  </p>
                  <p>Клик по графику открывает операции этого интервала.</p>
                </InfoPopover>
        </div>

        {series.points.length === 0 ? (
          <div className="text-sm text-muted text-center py-16">
            За выбранный период нет подходящих операций — измените фильтр выше.
          </div>
        ) : (
          <>
            <div className="h-80">
              <ResponsiveContainer>
                <ComposedChart
                  data={series.points}
                  onClick={(e: unknown) => {
                    const ev = e as
                      | { activePayload?: { payload?: { key?: string } }[] }
                      | undefined;
                    const key = ev?.activePayload?.[0]?.payload?.key;
                    if (key) openBucket(key);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <defs>
                    <linearGradient id="dyn-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                  <XAxis
                    dataKey="label"
                    stroke={chartAxisStroke}
                    fontSize={11}
                    minTickGap={40}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickFormatter={(v) => formatNum(v, { compact: true })}
                  />
                  <Tooltip
                    {...chartTooltipProps}
                    content={<DynTooltip metric={metric} base={base} />}
                  />
                  {hasNegative && (
                    <ReferenceLine y={0} stroke={chartAxisStroke} strokeOpacity={0.6} />
                  )}
                  {asBars ? (
                    <Bar
                      dataKey="value"
                      name={METRIC_LABELS[metric]}
                      fill={color}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                      maxBarSize={28}
                    />
                  ) : metric === "balance" ? (
                    <Area
                      type="monotone"
                      dataKey="value"
                      name={METRIC_LABELS[metric]}
                      stroke={color}
                      strokeWidth={2}
                      fill="url(#dyn-fill)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : (
                    <Line
                      type="linear"
                      dataKey="value"
                      name={METRIC_LABELS[metric]}
                      stroke={color}
                      strokeWidth={1.8}
                      // Точки на плотной шкале превращаются в кашу — рисуем их
                      // только когда интервалов немного.
                      dot={series.points.length <= 120 ? { r: 2.5, fill: color } : false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Крупный итог — главная цифра отчёта, как в оригинале. */}
            <div className="flex items-end justify-end gap-6 flex-wrap border-t border-border pt-4">
              <div className="text-right">
                <div
                  className="text-3xl md:text-4xl font-semibold tabular-nums font-mono"
                  style={{ color }}
                >
                  {formatMoney(series.total, base, { signed: metric === "net" })}
                </div>
                <div className="label mt-1">{totalLabel}</div>
              </div>
              <div className="text-3xl md:text-4xl text-border select-none leading-none">
                /
              </div>
              <div className="text-right">
                <div className="text-3xl md:text-4xl font-semibold tabular-nums font-mono text-text">
                  {formatMoney(series.average, base, { signed: metric === "net" })}
                </div>
                <div className="label mt-1">{avgLabel}</div>
              </div>
            </div>

            <div className="text-xs text-muted text-right">
              {formatNum(series.count)}{" "}
              {pluralRu(series.count, ["операция", "операции", "операций"])} ·{" "}
              {formatNum(series.points.length)}{" "}
              {pluralRu(series.points.length, ["интервал", "интервала", "интервалов"])}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Подсказка графика.
 *
 * Делает две вещи, которых не даёт стандартная: показывает ПОЛНУЮ дату с годом
 * (на оси год ужат до двух цифр) и разбивает расход на траты и возвраты, когда
 * возвраты в интервале были. Без разбивки столбец ниже нуля читается как
 * ошибка — а это возврат, который погасил траты, как и на всех остальных
 * экранах сервиса.
 */
function DynTooltip({
  active,
  payload,
  metric,
  base,
}: {
  active?: boolean;
  payload?: { payload?: DynamicsPoint }[];
  metric: DynamicsMetric;
  base: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const signed = metric === "net" || (metric === "expense" && point.value < 0);
  return (
    // Подсказка на общих компонентах продукта, а не своей вёрсткой: у графиков
    // подсказки обязаны выглядеть одинаково, иначе рядом с бюджетным графиком
    // это читается как два разных приложения.
    <ChartTooltipCard>
      <TooltipFacts
        title={point.fullLabel}
        facts={[
          {
            label: METRIC_LABELS[metric],
            value: formatMoney(point.value, base, { signed }),
            strong: true,
          },
          ...(point.refunds != null
            ? [
                { label: "Траты", value: formatMoney(point.gross ?? 0, base) },
                { label: "Возвраты", value: `−${formatMoney(point.refunds, base)}` },
              ]
            : []),
        ]}
      />
    </ChartTooltipCard>
  );
}
