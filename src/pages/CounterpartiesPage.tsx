import { useMemo, useState } from "react";
import { Store, Sparkles, DoorOpen, Receipt, Coins, ListChecks, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from "recharts";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useDiffMode } from "../store/useDiffModeStore";
import { useInBalanceTransactions } from "../hooks/useInBalanceTransactions";
import {
  buildPlaceDossier,
  buildPlaceRows,
  findLostPlaces,
  groupByPlace,
  type OpenRange,
  type PlaceRow,
} from "../lib/places";
import { diffSortValue } from "../lib/diffMode";
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
import { ChartContainer } from "../components/ChartContainer";
import { DataTable } from "../components/DataTable";
import { DeviationPill } from "../components/DeviationPill";
import { DiffModeToggle } from "../components/DiffModeToggle";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { MeterRow } from "../components/MeterRow";
import { PageHeader } from "../components/PageHeader";
import { SectionCard, StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { SeriesTooltip } from "../components/TooltipFacts";

/** Ширины колонок — постоянные: при смене периода колонки не прыгают. */
const COL = { total: "10rem", visits: "7.5rem", avg: "9rem", change: "10.75rem" } as const;

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
  // «впервые» и «перестали ходить» смотрят в историю до него.
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
  const rows = useMemo(() => buildPlaceRows(history, range), [history, range]);
  const lost = useMemo(() => findLostPlaces(history, range, maxDate), [history, range, maxDate]);
  const fresh = useMemo(() => rows.filter((r) => r.isNew), [rows]);

  const selected = rows.find((r) => r.name === picked)?.name ?? rows[0]?.name ?? null;
  const dossier = useMemo(
    () => (selected ? buildPlaceDossier(history, selected, maxDate, monthStartDay) : null),
    [history, selected, maxDate, monthStartDay]
  );

  function openPlace(name: string, scope: "period" | "all") {
    const list = (groupByPlace(history).get(name) ?? []).filter(
      (t) => scope === "all" || ((!range.from || t.date >= range.from) && (!range.to || t.date <= range.to))
    );
    showDrill(name, list, scope === "all" ? "Все покупки" : "Покупки за период");
  }

  if (transactions.length === 0) return <EmptyState />;

  const total = rows.reduce((s, r) => s + r.total, 0);
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const grown = rows.filter((r) => r.prevAvgCheck != null && r.avgCheck > r.prevAvgCheck * 1.05).length;
  const compared = rows.filter((r) => r.prevAvgCheck != null).length;

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
              уменьшают сумму места, но чек не занижают. Рост чека считается
              против года до периода, если покупок с обеих сторон хотя бы три.
            </p>
            <p>
              Нажмите на место в таблице — справа откроется его карточка за всю
              историю: как часто вы туда ходите, в какой день, сколько тратите по
              месяцам.
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
          note={range.from ? `${formatNum(fresh.length)} ${pluralRu(fresh.length, ["новое", "новых", "новых"])}` : "за всю историю"}
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
          value={compared > 0 ? formatNum(grown) : "—"}
          tone={grown > 0 ? "warn" : "default"}
          icon={<TrendingUp className="w-4 h-4" />}
          note={compared > 0 ? `из ${formatNum(compared)}, где есть с чем сравнить` : "не с чем сравнить"}
        />
      </StatRow>

      {/* Карточка места — узкой колонкой справа только там, где таблице хватает
          места на имена и все подписи; уже — встаёт над таблицей. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
        <DataTable<PlaceRow>
          className="order-2 xl:order-none"
          icon={ListChecks}
          title="Места"
          data={rows}
          rowKey={(r) => r.name}
          defaultSortKey="total"
          onRowClick={(r) => setPicked(r.name)}
          onRowDoubleClick={(r) => openPlace(r.name, "period")}
          rowClassName={(r) => (r.name === selected ? "bg-accent/10" : undefined)}
          exportName="counterparties"
          fixed
          columns={[
            {
              key: "name",
              type: "text",
              label: "Контрагент",
              sortValue: (r) => r.name,
              render: (r) => r.name,
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

        <div className="order-1 xl:order-none xl:sticky xl:top-24">
          {dossier && <Dossier dossier={dossier} base={base} onOpenAll={() => openPlace(dossier.name, "all")} />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          icon={Sparkles}
          title="Новые места"
          info={<p>Места, где первая покупка за всю историю пришлась на этот период: новый магазин, кафе, сервис.</p>}
        >
          {!range.from ? (
            <SectionEmpty variant="compact">Выберите период в фильтре — новые места считаются от его начала</SectionEmpty>
          ) : fresh.length === 0 ? (
            <SectionEmpty variant="compact">Новых мест в этом периоде нет</SectionEmpty>
          ) : (
            <div className="space-y-0.5">
              {fresh.slice(0, 10).map((r) => (
                <MeterRow
                  key={r.name}
                  bar="track"
                  label={r.name}
                  share={r.total / fresh[0].total}
                  barCls="bg-accent"
                  cells={[
                    { text: formatDate(r.firstDate, "full"), width: "6.5rem", muted: true, type: "date" },
                    { text: formatMoney(r.total, base), width: "7.5rem" },
                  ]}
                  onClick={() => setPicked(r.name)}
                  title="Открыть карточку места"
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={DoorOpen}
          title="Куда перестали ходить"
          info={
            <p>
              Места, где за полгода до периода были хотя бы три покупки в разные
              месяцы, а с начала периода — ни одной, и пауза уже заметно длиннее
              обычной. Сумма — сколько там в среднем уходило в месяц.
            </p>
          }
        >
          {!range.from ? (
            <SectionEmpty variant="compact">Выберите период в фильтре — сравнение идёт с полугодом до него</SectionEmpty>
          ) : lost.length === 0 ? (
            <SectionEmpty variant="compact">Все привычные места на месте</SectionEmpty>
          ) : (
            <div className="space-y-0.5">
              {lost.map((p) => (
                <MeterRow
                  key={p.name}
                  bar="track"
                  label={p.name}
                  share={p.perMonthBefore / lost[0].perMonthBefore}
                  barCls="bg-muted"
                  cells={[
                    { text: formatDate(p.lastDate, "full"), width: "6.5rem", muted: true, type: "date" },
                    { text: `${formatMoney(p.perMonthBefore, base)} / мес`, width: "9rem" },
                  ]}
                  onClick={() => openPlace(p.name, "all")}
                  title="Показать все покупки"
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Dossier({
  dossier: d,
  base,
  onOpenAll,
}: {
  dossier: NonNullable<ReturnType<typeof buildPlaceDossier>>;
  base: string;
  onOpenAll: () => void;
}) {
  const facts: { label: string; value: string }[] = [
    { label: "Всего потрачено", value: formatMoney(d.total, base) },
    { label: "Покупок", value: formatNum(d.visits) },
    { label: "Средний чек", value: formatMoney(d.avgCheck, base) },
    ...(d.everyDays != null ? [{ label: "Как часто", value: everyText(d.everyDays) }] : []),
    ...(d.favWeekday != null
      ? [{ label: "Чаще всего", value: `По ${WEEKDAYS[d.favWeekday]} · ${formatPct(d.favWeekdayShare, 0)}` }]
      : []),
    { label: "Впервые", value: formatDate(d.firstDate, "full") },
    { label: "Последний раз", value: formatDate(d.lastDate, "full") },
    ...(d.biggest
      ? [{ label: "Самая крупная", value: `${formatMoney(d.biggest.amount, base)} · ${formatDate(d.biggest.date, "full")}` }]
      : []),
  ];
  return (
    <SectionCard
      icon={Store}
      title={<span data-dossier-title>{d.name}</span>}
      subtitle={d.categories.map((c) => c.name).join(" · ") || undefined}
      right={
        <button type="button" className="btn-ghost text-sm" onClick={onOpenAll}>
          Все покупки
        </button>
      }
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm mt-1">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted">{f.label}</dt>
            <dd className="text-right tabular-nums truncate">{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 text-xs text-muted">По месяцам за последний год</div>
      <div className="h-36 mt-1">
        <ChartContainer>
          <BarChart data={d.months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis dataKey="ym" stroke={chartAxisStroke} fontSize={11} tickFormatter={monthTick} interval={1} />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              width={60}
              tickCount={3}
              tickFormatter={(v: number) => formatNum(v, { compact: true })}
            />
            <RTooltip
              {...chartTooltipProps}
              cursor={{ fill: "rgb(var(--c-border) / 0.35)" }}
              content={
                <SeriesTooltip
                  formatValue={(v) => formatMoney(v, base)}
                  formatLabel={(_, rows) => {
                    const m = rows[0]?.payload as { ym?: string; visits?: number } | undefined;
                    if (!m?.ym) return "";
                    const name = formatDate(`${m.ym}-01`, "month");
                    return `${name[0].toUpperCase()}${name.slice(1)} · ${formatNum(m.visits ?? 0)} ${pluralRu(m.visits ?? 0, ["покупка", "покупки", "покупок"])}`;
                  }}
                />
              }
            />
            <Bar dataKey="expense" name="Потрачено" radius={[3, 3, 0, 0]} fill={chartColor.accent} fillOpacity={0.8} />
          </BarChart>
        </ChartContainer>
      </div>
    </SectionCard>
  );
}
