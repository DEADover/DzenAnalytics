import { useMemo, useState } from "react";
import {
  Store,
  Sparkles,
  Receipt,
  Coins,
  ListChecks,
  TrendingUp,
  CalendarDays,
  History,
  Trophy,
  ChevronRight,
  PieChart,
  Flame,
} from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from "recharts";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useDiffMode } from "../store/useDiffModeStore";
import { useInBalanceTransactions } from "../hooks/useInBalanceTransactions";
import {
  buildPlaceDossier,
  buildPlaceRows,
  groupByPlace,
  placesForHalf,
  priceRisers,
  type OpenRange,
  type PlaceDossier,
  type PlaceRow,
} from "../lib/places";
import { diffSortValue } from "../lib/diffMode";
import { periodRange, spanDays, toIsoDate } from "../lib/period";
import { pluralRu } from "../lib/plural";
import {
  formatMoney,
  formatNum,
  formatPct,
  formatDate,
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartTooltipProps,
} from "../lib/format";
import { CATEGORY_PALETTE } from "../lib/categoryColor";
import { CategoryDot } from "../components/CategoryDot";
import { ChartContainer } from "../components/ChartContainer";
import { DataTable } from "../components/DataTable";
import { DeviationPill } from "../components/DeviationPill";
import { DiffModeToggle } from "../components/DiffModeToggle";
import { EmptyState } from "../components/EmptyState";
import { FactTile } from "../components/FactTile";
import { GlobalFilters } from "../components/GlobalFilters";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { MeterRow } from "../components/MeterRow";
import { PageHeader } from "../components/PageHeader";
import { SectionCard, StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { Segmented } from "../components/Segmented";
import { Tooltip } from "../components/Tooltip";
import { SeriesTooltip, TooltipFacts } from "../components/TooltipFacts";

/** Ширины колонок — постоянные: при смене периода колонки не прыгают. */
const COL = { total: "10rem", visits: "7.5rem", avg: "9rem", change: "10.75rem" } as const;

/** Сколько мест в «Новых» и «Перестали ходить» — дальше это уже не вывод, а список. */
const INSIGHT_LIMIT = 5;

type Metric = "expense" | "visits" | "avgCheck";
const METRIC_LABEL: Record<Metric, string> = { expense: "Потрачено", visits: "Покупок", avgCheck: "Средний чек" };
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const WEEKDAYS = ["понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам", "воскресеньям"];

/** «Каждый день», «Раз в неделю», «Раз в 10 дней», «Раз в месяц», «Раз в 3 месяца». */
function everyText(days: number): string {
  if (days <= 1) return "Каждый день";
  if (days >= 6 && days <= 8) return "Раз в неделю";
  if (days >= 13 && days <= 16) return "Раз в две недели";
  if (days >= 27 && days <= 35) return "Раз в месяц";
  if (days >= 60) {
    const m = Math.round(days / 30.4);
    return `Раз в ${m} ${pluralRu(m, ["месяц", "месяца", "месяцев"])}`;
  }
  return `Раз в ${days} ${pluralRu(days, ["день", "дня", "дней"])}`;
}

/** «сегодня», «вчера», «5 дней назад», «2 месяца назад», «больше года назад». */
function agoText(date: string, today: string): string {
  const days = spanDays(date, today) - 1;
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 45) return `${days} ${pluralRu(days, ["день", "дня", "дней"])} назад`;
  if (days < 365) {
    const m = Math.round(days / 30.4);
    return `${m} ${pluralRu(m, ["месяц", "месяца", "месяцев"])} назад`;
  }
  return "больше года назад";
}

/** «с ноября 2021» — с какого месяца место в истории. */
function sinceText(date: string): string {
  const [y, m] = date.split("-").map(Number);
  // «ноября», а не «ноябрь»: родительный падеж после «с» даёт формат с числом.
  const genitive = new Date(y, m - 1, 15).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }).split(" ")[1];
  return `с ${genitive} ${y}`;
}

/** Подпись месяца на оси: «окт», а у января — с годом, чтобы ось не путала годы. */
function monthTick(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const short = new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
  return m === 1 ? `${short} ${String(y).slice(2)}` : short;
}

export function CounterpartiesPage() {
  // Без счетов вне баланса, пока они не считаются, — как во всех итогах.
  const transactions = useInBalanceTransactions();
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);
  const [checkMode, setCheckMode] = useDiffMode("counterparties.check", "pct");
  const [picked, setPicked] = useState<string | null>(null);

  const maxDate = useMemo(
    () => transactions.reduce((m, t) => (t.date > m ? t.date : m), ""),
    [transactions]
  );
  // Тот же отрезок, что у общего фильтра, — но нужен он здесь сам по себе:
  // «впервые» и рост чека смотрят в историю до него.
  const range: OpenRange = useMemo(
    () =>
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, maxDate, filters.monthYM, monthStartDay),
    [filters.preset, filters.from, filters.to, filters.monthYM, maxDate, monthStartDay]
  );
  // Все остальные условия фильтра — счета, категории, поиск — действуют и на
  // историю: иначе «впервые» считалось бы по чужим счетам.
  const history = useMemo(
    () => applyFilters(transactions, { ...filters, preset: "all" }, monthStartDay),
    [transactions, filters, monthStartDay]
  );
  const byPlace = useMemo(() => groupByPlace(history), [history]);
  const rows = useMemo(() => buildPlaceRows(history, range), [history, range]);
  const fresh = useMemo(() => rows.filter((r) => r.isNew), [rows]);
  const risers = useMemo(() => priceRisers(rows, INSIGHT_LIMIT), [rows]);

  const selected = (picked && byPlace.has(picked) ? picked : null) ?? rows[0]?.name ?? null;
  const dossier = useMemo(
    () => (selected ? buildPlaceDossier(history, selected, maxDate, monthStartDay) : null),
    [history, selected, maxDate, monthStartDay]
  );

  function openPlace(name: string, scope: "period" | "all") {
    const list = (byPlace.get(name) ?? []).filter(
      (t) => scope === "all" || ((!range.from || t.date >= range.from) && (!range.to || t.date <= range.to))
    );
    showDrill(name, list, scope === "all" ? "Все покупки" : "Покупки за период");
  }
  function openOne(name: string, id: string) {
    const tx = byPlace.get(name)?.find((t) => t.id === id);
    if (tx) showDrill(name, [tx], "Самая крупная покупка");
  }
  /** Выбрать место; на узком экране карточка над таблицей — показать её. */
  function pick(name: string) {
    setPicked(name);
    requestAnimationFrame(() => {
      const card = document.querySelector("[data-place-card]");
      const r = card?.getBoundingClientRect();
      if (r && (r.top < 0 || r.top > window.innerHeight)) card!.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (transactions.length === 0) return <EmptyState />;

  const total = rows.reduce((s, r) => s + r.total, 0);
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const grown = rows.filter((r) => r.prevAvgCheck != null && r.avgCheck > r.prevAvgCheck * 1.05).length;
  const compared = rows.filter((r) => r.prevAvgCheck != null).length;
  const freshTotal = fresh.reduce((s, r) => s + r.total, 0);

  const header = (
    <>
      <PageHeader
        icon={Store}
        title="Контрагенты"
        info={
          <InfoPopover>
            <p>
              Магазины, кафе и сервисы, где вы тратите, — за период и счета из{" "}
              <InfoTerm>общего фильтра</InfoTerm>. Имя берётся из справочника
              контрагентов, а не из банковской строки. Операции без контрагента
              сюда не попадают.
            </p>
            <p>
              <InfoTerm>Средний чек</InfoTerm> — средняя покупка; возвраты
              уменьшают сумму места, но чек не занижают. Изменение чека считается
              против года до периода, если покупок с обеих сторон хотя бы три.
            </p>
            <p>
              Нажмите на место — откроется его карточка за всю историю: как часто
              вы туда ходите, в какой день, сколько тратите по месяцам.
            </p>
          </InfoPopover>
        }
      />
      <GlobalFilters />
    </>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SectionEmpty icon={Store} title="В выборке нет покупок с контрагентом">
          Контрагента можно указать в операции или правилом — тогда место появится здесь
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <StatRow>
        <StatCell
          label="Мест"
          value={formatNum(rows.length)}
          icon={<Store className="w-4 h-4" />}
          note={
            range.from
              ? `${formatNum(fresh.length)} ${pluralRu(fresh.length, ["новое", "новых", "новых"])} в периоде`
              : "за всю историю"
          }
        />
        <StatCell
          label="Потрачено"
          value={formatMoney(total, base)}
          tone="expense"
          icon={<Coins className="w-4 h-4" />}
          note={`${formatNum(visits)} ${pluralRu(visits, ["покупка", "покупки", "покупок"])}`}
        />
        <StatCell
          label="Средний чек"
          value={visits > 0 ? formatMoney(rows.reduce((s, r) => s + r.avgCheck * r.visits, 0) / visits, base) : "—"}
          icon={<Receipt className="w-4 h-4" />}
          note="по всем местам"
        />
        <StatCell
          label="Чек вырос"
          value={compared > 0 ? `${formatNum(grown)} из ${formatNum(compared)}` : "—"}
          tone={grown > 0 ? "warn" : "default"}
          icon={<TrendingUp className="w-4 h-4" />}
          note={compared > 0 ? "мест, где есть с чем сравнить" : "не с чем сравнить"}
          tooltip="Средний чек периода выше, чем за год до него, больше чем на 5 %. Сравниваются места, где покупок хотя бы три и тогда, и сейчас."
        />
      </StatRow>

      <SpendShare rows={rows} base={base} onPick={pick} />

      {/* Выводы — над таблицей: под списком из полусотни мест их никто бы не увидел. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          icon={Sparkles}
          title="Новые места"
          subtitle={
            range.from && fresh.length > 0
              ? `${formatNum(fresh.length)} ${pluralRu(fresh.length, ["место", "места", "мест"])} · ${formatMoney(freshTotal, base)}`
              : undefined
          }
          info={<p>Места, где первая покупка за всю историю пришлась на этот период: новый магазин, кафе, сервис.</p>}
        >
          {!range.from ? (
            <SectionEmpty variant="compact">Выберите период в фильтре — новые места считаются от его начала</SectionEmpty>
          ) : fresh.length === 0 ? (
            <SectionEmpty variant="compact">В этом периоде вы ходили только в знакомые места</SectionEmpty>
          ) : (
            <div className="space-y-0.5">
              {fresh.slice(0, INSIGHT_LIMIT).map((r) => (
                <MeterRow
                  key={r.name}
                  bar="track"
                  leadIcon={<CategoryDot category={r.category} size="w-7 h-7" />}
                  label={r.name}
                  share={r.total / fresh[0].total}
                  barCls="bg-accent"
                  cells={[{ text: formatMoney(r.total, base), width: "7rem" }]}
                  onClick={() => pick(r.name)}
                  title="Открыть карточку места"
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Flame}
          title="Где подорожало"
          subtitle={risers.length > 0 ? "Средний чек против года до периода" : undefined}
          info={
            <p>
              Места, где средняя покупка стала дороже, чем за год до периода,
              больше чем на 5 %. Сверху — где прибавка сильнее всего бьёт по
              кошельку: рост чека, умноженный на число покупок, а не самый большой
              процент — +40 % к чашке кофе заметнее на чеке, чем в бюджете.
            </p>
          }
        >
          {compared === 0 ? (
            <SectionEmpty variant="compact">Сравнивать не с чем: нужно хотя бы по три покупки в периоде и за год до него</SectionEmpty>
          ) : risers.length === 0 ? (
            <SectionEmpty variant="compact">Чеки там, где вы бываете часто, не выросли</SectionEmpty>
          ) : (
            <div className="space-y-0.5">
              {risers.map(({ row: r, growth }) => (
                <MeterRow
                  key={r.name}
                  bar="track"
                  leadIcon={<CategoryDot category={r.category} size="w-7 h-7" />}
                  label={r.name}
                  share={growth / risers.reduce((m, x) => Math.max(m, x.growth), 0)}
                  barCls="bg-warn"
                  cells={[
                    {
                      text: `${formatNum(Math.round(r.prevAvgCheck!))} → ${formatMoney(Math.round(r.avgCheck), base)}`,
                      width: "9.5rem",
                      muted: true,
                    },
                    { text: `+${formatPct(growth, 0)}`, width: "3.5rem", type: "pct" },
                  ]}
                  onClick={() => pick(r.name)}
                  title="Открыть карточку места"
                />
              ))}
            </div>
          )}
        </SectionCard>

      </div>

      {/* Карточка места — узкой колонкой справа только там, где таблице хватает
          места на имена и все подписи; уже — встаёт над таблицей. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem] items-start">
        <DataTable<PlaceRow>
          className="order-2 xl:order-none"
          icon={ListChecks}
          title="Все места"
          data={rows}
          rowKey={(r) => r.name}
          defaultSortKey="total"
          onRowClick={(r) => pick(r.name)}
          onRowDoubleClick={(r) => openPlace(r.name, "period")}
          rowClassName={(r) => (r.name === selected ? "bg-accent/10 shadow-[inset_3px_0_0_rgb(var(--c-accent))]" : undefined)}
          exportName="counterparties"
          fixed
          columns={[
            {
              key: "name",
              type: "text",
              label: "Контрагент",
              sortValue: (r) => r.name,
              exportValue: (r) => r.name,
              cellTitle: (r) => `${r.name} · ${r.category}`,
              render: (r) => (
                <span className="flex items-center gap-2.5 min-w-0">
                  <CategoryDot category={r.category} size="w-5 h-5" />
                  <span className="truncate">{r.name}</span>
                  {r.isNew && (
                    <span className="shrink-0 rounded-full bg-accent/15 text-accent text-[10px] font-semibold px-1.5 py-px">
                      Новое
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "total",
              type: "main",
              tone: "expense",
              width: COL.total,
              label: "Сумма",
              sortValue: (r) => r.total,
              render: (r) => formatMoney(r.total, base),
            },
            {
              key: "visits",
              type: "count",
              width: COL.visits,
              label: "Покупок",
              sortValue: (r) => r.visits,
              render: (r) => formatNum(r.visits),
            },
            {
              key: "avg",
              type: "money",
              muted: true,
              width: COL.avg,
              label: "Средний чек",
              sortValue: (r) => r.avgCheck,
              render: (r) => formatMoney(r.avgCheck, base),
            },
            {
              key: "change",
              type: "change",
              width: COL.change,
              wideOnly: true,
              label: "Изменение",
              headerTitle: "Средний чек периода против года до него",
              headerLead: <DiffModeToggle mode={checkMode} onChange={setCheckMode} base={base} />,
              sortValue: (r) => (r.prevAvgCheck == null ? null : diffSortValue(r.avgCheck, r.prevAvgCheck, checkMode)),
              exportValue: (r) => (r.prevAvgCheck == null ? null : r.avgCheck - r.prevAvgCheck),
              render: (r) =>
                r.prevAvgCheck == null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <DeviationPill
                    current={r.avgCheck}
                    baseline={r.prevAvgCheck}
                    base={base}
                    mode={checkMode}
                    kind="expense"
                    upTitle="Чек выше, чем за год до периода"
                    downTitle="Чек ниже, чем за год до периода"
                  />
                ),
            },
          ]}
        />

        <div className="order-1 xl:order-none xl:sticky xl:top-24 scroll-mt-24" data-place-card>
          {dossier && (
            <PlaceCard
              dossier={dossier}
              base={base}
              range={range}
              monthStartDay={monthStartDay}
              onOpenAll={() => openPlace(dossier.name, "all")}
              onOpenBiggest={(id) => openOne(dossier.name, id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Карточка места: кто это, сколько и как часто, траты по месяцам. */
function PlaceCard({
  dossier: d,
  base,
  range,
  monthStartDay,
  onOpenAll,
  onOpenBiggest,
}: {
  dossier: PlaceDossier;
  base: string;
  range: OpenRange;
  monthStartDay: number;
  onOpenAll: () => void;
  onOpenBiggest: (id: string) => void;
}) {
  const today = toIsoDate(new Date());
  const lead = d.categories[0]?.name ?? "";
  const catTotal = d.categories.reduce((s, c) => s + c.amount, 0);
  // Месяцы выбранного периода — плотным цветом, остальные бледнее: видно, где
  // на годовом графике то, что сейчас в таблице.
  const inRange = (ym: string) => {
    const r = periodRange(ym, monthStartDay);
    return (!range.from || r.to >= range.from) && (!range.to || r.from <= range.to);
  };
  const [metric, setMetric] = useState<Metric>("expense");
  const months = d.months.map((m) => ({ ...m, hit: inRange(m.ym) }));
  const allHit = months.every((m) => m.hit);
  const { last, prev } = d.yearOverYear;
  const maxDay = Math.max(...d.weekdays, 1);

  return (
    <div className="card-tray px-4 py-4 space-y-4">
      {/* Шапка: значок главной статьи, имя, статьи — и действие справа. */}
      <div className="flex items-start gap-3">
        <CategoryDot category={lead} size="w-10 h-10" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-tight line-clamp-2 break-words" data-dossier-title>
            {d.name}
          </div>
          <div className="text-xs text-muted truncate mt-0.5">
            {d.categories.map((c) => c.name).join(" · ") || "Без категории"}
          </div>
        </div>
        <button type="button" className="btn-ghost text-sm shrink-0" onClick={onOpenAll}>
          Все покупки
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <FactTile small label="Всего" value={formatMoney(d.total, base, { compact: d.total >= 1_000_000 })} tone="expense" sub={sinceText(d.firstDate)} />
        <FactTile
          small
          label="Покупок"
          value={formatNum(d.visits)}
          sub={d.everyDays != null ? everyText(d.everyDays).toLowerCase() : undefined}
        />
        <FactTile small label="Средний чек" value={formatMoney(d.avgCheck, base)} sub="одна покупка" />
      </div>

      <ul className="space-y-2 text-sm">
        {d.favWeekday != null && (
          <li className="flex items-center gap-2.5">
            <CalendarDays className="w-4 h-4 text-muted shrink-0" />
            <span className="min-w-0 truncate">
              Чаще всего по {WEEKDAYS[d.favWeekday]}
              <span className="text-muted"> · {formatPct(d.favWeekdayShare, 0)} покупок</span>
            </span>
          </li>
        )}
        {d.categoryShare != null && lead && (
          <li className="flex items-center gap-2.5">
            <PieChart className="w-4 h-4 text-muted shrink-0" />
            <span className="min-w-0 truncate">
              {formatPct(d.categoryShare, 0)} всех трат на «{lead}»
            </span>
          </li>
        )}
        <li className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-muted shrink-0" />
          <span className="min-w-0 truncate">
            Последний раз {agoText(d.lastDate, today)}
            <span className="text-muted"> · {formatDate(d.lastDate, "full")}</span>
          </span>
        </li>
        {d.biggest && (
          <li>
            <button
              type="button"
              className="flex items-center gap-2.5 w-full text-left hover:text-accent transition-colors"
              onClick={() => onOpenBiggest(d.biggest!.id)}
              title="Показать операцию"
            >
              <Trophy className="w-4 h-4 text-muted shrink-0" />
              <span className="min-w-0 truncate">
                Самая крупная — <span className="tabular-nums">{formatMoney(d.biggest.amount, base)}</span>
                <span className="text-muted"> · {formatDate(d.biggest.date, "full")}</span>
              </span>
            </button>
          </li>
        )}
      </ul>

      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="caps-label">По месяцам</div>
          <Segmented
            size="sm"
            label="Что показывать на графике"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "expense" as Metric, label: "Сумма" },
              { value: "visits" as Metric, label: "Покупки" },
              { value: "avgCheck" as Metric, label: "Чек" },
            ]}
          />
        </div>
        <div className="text-xs text-muted mt-1 flex items-center gap-1.5 flex-wrap tabular-nums">
          За 12 месяцев {formatMoney(last, base)}
          {prev > 0 && (
            <>
              <span>·</span>
              <DeviationPill
                current={last}
                baseline={prev}
                base={base}
                mode="pct"
                kind="expense"
                upTitle="Больше, чем за двенадцать месяцев до того"
                downTitle="Меньше, чем за двенадцать месяцев до того"
              />
              <span>к году раньше</span>
            </>
          )}
        </div>
        <div className="h-36 mt-2">
          <ChartContainer>
            <BarChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
              <XAxis dataKey="ym" stroke={chartAxisStroke} fontSize={11} tickFormatter={monthTick} interval={1} tickLine={false} />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                width={60}
                tickCount={3}
                tickLine={false}
                axisLine={false}
                allowDecimals={metric !== "visits"}
                tickFormatter={(v: number) => formatNum(v, { compact: true })}
              />
              <RTooltip
                {...chartTooltipProps}
                cursor={{ fill: "rgb(var(--c-border) / 0.35)" }}
                content={
                  <SeriesTooltip
                    formatValue={(v) => (metric === "visits" ? `${formatNum(v)} ${pluralRu(v, ["покупка", "покупки", "покупок"])}` : formatMoney(v, base))}
                    formatLabel={(_, rows) => {
                      const m = rows[0]?.payload as { ym?: string; visits?: number } | undefined;
                      if (!m?.ym) return "";
                      const name = formatDate(`${m.ym}-01`, "month");
                      const n = m.visits ?? 0;
                      const tail = metric === "visits" ? "" : ` · ${formatNum(n)} ${pluralRu(n, ["покупка", "покупки", "покупок"])}`;
                      return `${name[0].toUpperCase()}${name.slice(1)}${tail}`;
                    }}
                  />
                }
              />
              <Bar dataKey={metric} name={METRIC_LABEL[metric]} radius={[3, 3, 0, 0]}>
                {months.map((m) => (
                  <Cell key={m.ym} fill={chartColor.accent} fillOpacity={allHit || m.hit ? 0.9 : 0.35} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      </div>

      <div>
        <div className="caps-label mb-2">По дням недели</div>
        {/* Семь столбиков без осей: важна форма недели, а не точные числа —
            они в подсказке. Любимый день — акцентом. */}
        <div className="grid grid-cols-7 gap-1.5 items-end h-14">
          {d.weekdays.map((n, i) => (
            <Tooltip key={i} content={`${WEEKDAY_FULL[i]} · ${formatNum(n)} ${pluralRu(n, ["покупка", "покупки", "покупок"])}`}>
              <div className="h-full flex items-end">
                <div
                  className={i === d.favWeekday ? "w-full rounded-t-[3px] bg-accent" : "w-full rounded-t-[3px] bg-accent/35"}
                  style={{ height: `${Math.max(n > 0 ? 6 : 2, (n / maxDay) * 100)}%` }}
                />
              </div>
            </Tooltip>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5 mt-1 text-[11px] text-muted text-center">
          {WEEKDAY_SHORT.map((w, i) => (
            <span key={w} className={i === d.favWeekday ? "text-accent font-semibold" : undefined}>
              {w}
            </span>
          ))}
        </div>
      </div>

      {d.categories.length > 1 && (
        <div>
          <div className="caps-label mb-1.5">По статьям</div>
          <div className="space-y-0.5">
            {d.categories.map((c) => (
              <MeterRow
                key={c.name}
                bar="track"
                leadIcon={<CategoryDot category={c.name} size="w-6 h-6" />}
                label={c.name}
                share={c.amount / d.categories[0].amount}
                barCls="bg-accent"
                cells={[
                  { text: formatPct(c.amount / (catTotal || 1), 0), width: "3.5rem", muted: true, type: "pct" },
                  { text: formatMoney(c.amount, base, { compact: true }), width: "6.5rem" },
                ]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Сколько мест показывать отдельными кусками полосы — остальные одним. */
const SHARE_TOP = 8;

/**
 * Куда уходят деньги: одна полоса на все траты периода, куски — крупнейшие
 * места, хвост — «остальные». Отвечает на вопрос «сколько мест забирают
 * половину денег», которого в таблице не видно.
 */
function SpendShare({
  rows,
  base,
  onPick,
}: {
  rows: PlaceRow[];
  base: string;
  onPick: (name: string) => void;
}) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (total <= 0) return null;
  const top = rows.slice(0, SHARE_TOP);
  const rest = total - top.reduce((s, r) => s + r.total, 0);
  const half = placesForHalf(rows);
  const color = (i: number) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];

  return (
    <SectionCard
      icon={PieChart}
      title="Куда уходят деньги"
      subtitle={`Половина трат — в ${formatNum(half)} ${pluralRu(half, ["месте", "местах", "местах"])} из ${formatNum(rows.length)}`}
      info={
        <p>
          Все траты периода одной полосой: каждый кусок — место, его ширина —
          доля в сумме. Отдельно показаны {SHARE_TOP} крупнейших, остальные — одним
          серым куском. Нажатие открывает карточку места.
        </p>
      }
    >
      <div className="flex h-4 rounded-track overflow-hidden gap-px mt-1">
        {top.map((r, i) => (
          <Tooltip
            key={r.name}
            content={
              <TooltipFacts
                title={r.name}
                facts={[
                  { label: "Потрачено", value: formatMoney(r.total, base), tone: "expense", swatchColor: color(i) },
                  { label: "Доля", value: formatPct(r.total / total, 1) },
                  { label: "Покупок", value: formatNum(r.visits) },
                ]}
              />
            }
          >
            <button
              type="button"
              aria-label={`${r.name}: ${formatPct(r.total / total, 0)}`}
              onClick={() => onPick(r.name)}
              className="h-full transition-opacity hover:opacity-80"
              style={{ width: `${(r.total / total) * 100}%`, background: color(i) }}
            />
          </Tooltip>
        ))}
        {rest > 0 && <div className="h-full bg-muted/30" style={{ width: `${(rest / total) * 100}%` }} />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mt-3 text-sm">
        {top.map((r, i) => (
          <button
            key={r.name}
            type="button"
            onClick={() => onPick(r.name)}
            className="flex items-center gap-2 min-w-0 text-left hover:text-accent transition-colors"
          >
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color(i) }} />
            <span className="truncate">{r.name}</span>
            <span className="ml-auto text-muted tabular-nums shrink-0">{formatPct(r.total / total, 0)}</span>
          </button>
        ))}
        {rest > 0 && (
          <div className="flex items-center gap-2 min-w-0 text-muted">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-muted/30" />
            <span className="truncate">
              Ещё {formatNum(rows.length - top.length)} {pluralRu(rows.length - top.length, ["место", "места", "мест"])}
            </span>
            <span className="ml-auto tabular-nums shrink-0">{formatPct(rest / total, 0)}</span>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
