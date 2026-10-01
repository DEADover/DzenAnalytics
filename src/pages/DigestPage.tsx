import { useMemo, useState } from "react";
import { pluralRu } from "../lib/plural";
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  Trophy,
  Coins,
  ChevronRight,
  PiggyBank,
  CalendarDays,
  Store,
  Sparkles,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from "recharts";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import {
  buildDigestHistory,
  periodTitle,
  type DigestDay,
  type DigestEntry,
  type DigestPayee,
} from "../lib/digest";
import { counterpartyOf } from "../lib/yearReview";
import {
  formatMoney,
  formatNum,
  formatPct,
  formatDate,
  truncateWords,
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartTooltipProps,
} from "../lib/format";
import { SeriesTooltip, TooltipFacts } from "../components/TooltipFacts";
import { EmptyState } from "../components/EmptyState";
import { CategoryDot } from "../components/CategoryDot";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { SectionCard, StatCell, StatRow } from "../components/SectionCard";
import { MeterRow, MeterHead, type MeterCell } from "../components/MeterRow";
import { nextSort, sortRows, type SortState } from "../components/table/tableKit";
import type { Transaction } from "../types";
import { SectionEmpty } from "../components/SectionEmpty";
import { useLazyList } from "../hooks/useLazyList";


type Tab = "week" | "month";

export function DigestPage() {
  // Digest summaries are pure income/expense analytics → strip turnover /
  // off-balance flows the user excluded (#14).
  const transactions = useAnalyticsTransactions();
  const baseCurrency = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const all = useMemo(() => buildDigestHistory(transactions), [transactions]);
  const [tab, setTab] = useState<Tab>("month");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () => all.filter((e) => e.period === tab),
    [all, tab]
  );

  // Недель бывает под три сотни — список рисуется порциями по мере прокрутки.
  const { shown: lazyShown, hasMore: lazyMore, attachSentinel } = useLazyList(filtered, 60);
  const lazyVisible = useMemo(() => filtered.slice(0, lazyShown), [filtered, lazyShown]);

  const currentId = selected || filtered[0]?.id || null;
  const current = filtered.find((e) => e.id === currentId) || filtered[0] || null;

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Newspaper}
        title="Дайджест"
        info={
          <InfoPopover>
            <p>
              Итоги считаются только по <InfoTerm>завершённым периодам</InfoTerm>:
              текущего месяца и текущей недели в списке нет — на середине месяца
              сравнивать не с чем, любые «−40% к прошлому» были бы неправдой.
              Недели считаем с понедельника; и недели, и месяцы идут за всю
              историю, до самой первой операции. Периоды без единой операции в
              ленту не попадают.
            </p>
            <p>
              Все сравнения — с <InfoTerm>предыдущим таким же периодом</InfoTerm>:
              месяц с месяцем, неделя с неделей. Проценты в карточках категорий —
              оттуда же: насколько потратили больше или меньше, чем в прошлый раз.
            </p>
            <p>
              Общие фильтры сверху здесь не применяются, но операции, исключённые
              из аналитики на странице «Категории», в дайджест не попадают.
            </p>
          </InfoPopover>
        }
      />

      {/* Переключатель — общий контрол продукта, а не свои пилюли: те же две
          кнопки на других страницах выглядели иначе. */}
      <Segmented
        value={tab}
        onChange={setTab}
        label="Период дайджеста"
        options={[
          { value: "month" as Tab, label: "По месяцам" },
          { value: "week" as Tab, label: "По неделям" },
        ]}
      />

      {filtered.length === 0 ? (
        <SectionEmpty icon={Newspaper} title="Нет завершённых периодов для дайджеста" />
      ) : (
        <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-4">
          {/* Список периодов. На широком экране панель тянется во всю высоту
              правой колонки: карточка вынута из потока, поэтому длинный список
              не растягивает строку сетки под себя, а прокручивается внутри. С
              фиксированной высотой панель обрывалась заметно выше разборов
              справа, и низ страницы оставался пустым. */}
          <div className="relative min-h-[16rem]">
          <div className="card p-1.5 max-h-[60vh] overflow-y-auto md:max-h-none md:absolute md:inset-0">
            {/* Сколько периодов — в начале самого списка, к которому оно относится. */}
            <div className="label px-3 pt-2 pb-2.5 mb-1.5 border-b border-border">
              {formatNum(filtered.length)}{" "}
              {pluralRu(filtered.length, ["период", "периода", "периодов"])}
            </div>
            {lazyVisible.map((e) => {
              const isActive = e.id === current?.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "hover:bg-panel2/60 text-muted"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{e.label}</div>
                    <div className="text-[11px] text-muted truncate">
                      {formatMoney(e.expense, baseCurrency)} расход
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-50" />
                </button>
              );
            })}
            {lazyMore && <div ref={attachSentinel} className="h-8" aria-hidden="true" />}
          </div>
          </div>

          {/* Detail */}
          {current && (
            <DigestDetail
              entry={current}
              baseCurrency={baseCurrency}
              onOpenTx={(txs, title) => showDrill(title, txs, "Дайджест")}
              onOpenDay={(date) =>
                showDrill(
                  formatDate(date, "full"),
                  transactions.filter(
                    (t) => t.date.slice(0, 10) === date && (t.kind === "expense" || t.kind === "refund")
                  ),
                  current.label
                )
              }
              onOpenCategory={(category) =>
                showDrill(
                  category,
                  transactions.filter(
                    (t) =>
                      t.date >= current.start && t.date <= current.end && t.category === category
                  ),
                  current.label
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Колонки движителей. Полоса тут не доля от целого, а величина изменения
 * против самой крупной в списке, поэтому она идёт отдельной дорожкой под
 * именем: заливка во всю высоту строки в таком списке читалась как подсветка
 * выделенной строки, а её правый край обрывался посреди пустоты.
 */
const MOVER_COLUMNS: MeterCell[] = [
  // «Рост», а не «Доля»: здесь процент изменения к прошлому периоду.
  { text: "Рост", width: "4rem", sortKey: "pct" },
  { text: "Было → стало", width: "13rem", sortKey: "current", wideOnly: true },
  { text: "Разница", width: "7rem", sortKey: "diff" },
];

function DigestDetail({
  entry,
  baseCurrency,
  onOpenTx,
  onOpenDay,
  onOpenCategory,
}: {
  entry: DigestEntry;
  baseCurrency: string;
  onOpenTx: (txs: Transaction[], title: string) => void;
  /** Операции одной статьи за этот период. */
  onOpenCategory: (category: string) => void;
  /** Траты одного дня — по клику на столбик графика. */
  onOpenDay: (date: string) => void;
}) {
  const expCls =
    entry.expenseDelta > 0.05
      ? "text-expense"
      : entry.expenseDelta < -0.05
        ? "text-income"
        : "text-muted";
  const incCls =
    entry.incomeDelta > 0.05
      ? "text-income"
      : entry.incomeDelta < -0.05
        ? "text-expense"
        : "text-muted";
  const netCls =
    entry.net > entry.prevNet + 100
      ? "text-income"
      : entry.net < entry.prevNet - 100
        ? "text-expense"
        : "text-muted";

  const maxMove = Math.max(
    ...entry.movers.map((m) => Math.abs(m.current - m.previous)),
    1
  );

  // Движители сортируются по любой колонке; по умолчанию — по величине разницы.
  const [sort, setSort] = useState<SortState>({ key: "diff", dir: "desc" });
  const movers = sortRows(
    entry.movers,
    (m) =>
      sort.key === "name"
        ? m.category
        : sort.key === "pct"
          ? m.previous > 0
            ? m.delta
            : null
          : sort.key === "current"
            ? m.current
            : Math.abs(m.current - m.previous),
    sort.dir
  );

  return (
    <div className="space-y-6">
      <StatRow>
        <StatCell
          label="Доход"
          value={formatMoney(entry.income, baseCurrency)}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="income"
          note={compareNote(entry.income, entry.typical?.income, entry.incomeDelta)}
          noteCls={incCls}
          tooltip={compareTip(entry, "income", baseCurrency)}
        />
        <StatCell
          label="Расход"
          value={formatMoney(entry.expense, baseCurrency)}
          icon={<TrendingDown className="w-4 h-4" />}
          tone="expense"
          note={compareNote(entry.expense, entry.typical?.expense, entry.expenseDelta)}
          noteCls={expCls}
          tooltip={compareTip(entry, "expense", baseCurrency)}
        />
        <StatCell
          label="Чистый поток"
          value={formatMoney(entry.net, baseCurrency, { signed: true })}
          icon={<Trophy className="w-4 h-4" />}
          tone={entry.net >= 0 ? "income" : "expense"}
          note={
            entry.typical
              ? `Обычно ${formatMoney(entry.typical.net, baseCurrency, { signed: true })}`
              : deltaNote(
                  Math.abs(entry.prevNet) > 0.01
                    ? (entry.net - entry.prevNet) / Math.abs(entry.prevNet)
                    : 0
                )
          }
          noteCls={netCls}
        />
        {/* Норма сбережений вместо числа операций: «сколько осталось» говорит
            о периоде больше, чем «сколько раз платили». Число операций — в
            уточнении. */}
        <StatCell
          label="Норма сбережений"
          // Когда трат вдвое больше дохода, процент вроде «−1 549%» ничего не
          // говорит — прочерк и объяснение словами.
          value={entry.income > 0 && entry.savingsRate >= -1 ? formatPct(entry.savingsRate, 0) : "—"}
          icon={<PiggyBank className="w-4 h-4" />}
          tone={entry.income > 0 && entry.savingsRate >= 0.2 ? "income" : entry.savingsRate < 0 ? "expense" : "default"}
          note={
            entry.income > 0 && entry.savingsRate < -1
              ? "Расход больше дохода"
              : entry.income <= 0
                ? "Доходов не было"
                : `${formatNum(entry.txCount)} ${pluralRu(entry.txCount, ["операция", "операции", "операций"])}`
          }
        />
      </StatRow>

      {/* Главное одной фразой — под итогами: сверху, как на остальных
          страницах, ряд больших чисел. */}
      {/* Обычной карточкой, как соседние блоки: цветная плашка выбивалась
          из страницы и читалась как предупреждение. */}
      <SectionCard icon={Newspaper} title={`Главное за ${periodTitle(entry)}`}>
        <p className="text-sm leading-relaxed">{headline(entry, baseCurrency)}</p>
      </SectionCard>

      <SectionCard
        icon={CalendarDays}
        title="Траты по дням"
        subtitle={daysSubtitle(entry, baseCurrency)}
      >
        <DaysChart
          days={entry.days}
          biggest={entry.biggestDay?.date}
          base={baseCurrency}
          week={entry.period === "week"}
          onDay={onOpenDay}
        />
      </SectionCard>

      {(entry.topPayees.length > 0 || entry.newPayees.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            icon={Store}
            title="Где тратили"
            info={<p>Получатели с самыми большими тратами за период — по бренду, если он известен. Возвраты уменьшают сумму.</p>}
          >
            <PayeeList payees={entry.topPayees} base={baseCurrency} empty="Трат с получателем не было" />
          </SectionCard>
          <SectionCard
            icon={Sparkles}
            title="Впервые"
            info={<p>Получатели, которым в этом периоде заплатили впервые за всю историю операций: новый магазин, сервис, подписка.</p>}
          >
            <PayeeList payees={entry.newPayees} base={baseCurrency} empty="Новых получателей не было" />
          </SectionCard>
        </div>
      )}

      {entry.movers.length > 0 && (
        <SectionCard
          icon={TrendingUp}
          title="Категории, где «выстрелило»"
          info={
            <p>
              Статьи с самым большим изменением суммы против прошлого такого же
              периода — в рублях, а не в процентах: рост на 200 % у статьи в
              триста рублей не так важен, как рост на 20 % у статьи в сто тысяч.
              Полоса показывает величину изменения, её цвет — сторону. Нажатие
              открывает операции статьи за этот период.
            </p>
          }
        >
          <MeterHead
            columns={MOVER_COLUMNS}
            lead="w-7"
            bar="track"
            nameLabel="Статья"
            sort={sort.key ? { key: sort.key, dir: sort.dir } : undefined}
            onSort={(key) => setSort((cur) => nextSort(cur, key, key === "name" ? "text" : "money"))}
          />
          <div className="space-y-0.5">
            {movers.map((m) => {
              const up = m.current > m.previous;
              const diff = Math.abs(m.current - m.previous);
              return (
                <MeterRow
                  key={m.category}
                  bar="track"
                  // Значок категории — крупно слева, как в «Расходах по
                  // категориям» на главной; куда изменилось — видно по цвету
                  // полосы и знаку в «Разнице».
                  leadIcon={<CategoryDot category={m.category} size="w-7 h-7" />}
                  label={m.category}
                  share={diff / maxMove}
                  barCls={up ? "bg-expense" : "bg-income"}
                  cells={[
                    {
                      text:
                        m.previous > 0
                          ? `${m.delta > 0 ? "+" : ""}${formatPct(m.delta, 0)}`
                          : "—",
                      width: MOVER_COLUMNS[0].width,
                      muted: true,
                    },
                    {
                      text: `${formatMoney(m.previous, baseCurrency, { compact: true })} → ${formatMoney(m.current, baseCurrency, { compact: true })}`,
                      width: MOVER_COLUMNS[1].width,
                      muted: true,
                      wideOnly: true,
                    },
                    {
                      text: `${up ? "+" : "−"}${formatMoney(diff, baseCurrency)}`,
                      width: MOVER_COLUMNS[2].width,
                    },
                  ]}
                  onClick={() => onOpenCategory(m.category)}
                  title="Показать операции статьи за период"
                />
              );
            })}
          </div>
        </SectionCard>
      )}

      {entry.topTransactions.length > 0 && (
        <SectionCard
          icon={Coins} tone="expense"
          title="Самое дорогое за период"
          info={<p>Пять самых крупных расходов периода с комментарием к операции.</p>}
        >
          <div className="space-y-0.5">
            {entry.topTransactions.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  onOpenTx([t], counterpartyOf(t) || t.categoryFull || "Операция")
                }
                title="Показать операцию"
                className="w-full flex items-center gap-3 text-sm rounded-md px-2 py-1.5 text-left hover:bg-panel2/50"
              >
                {/* Значок категории, как в списках операций; порядок и так от
                    дорогого к дешёвому. */}
                <CategoryDot
                  category={t.subcategory || t.category}
                  parent={t.subcategory ? t.category : undefined}
                  size="w-7 h-7"
                />
                {/* Имя и комментарий одной колонкой, сумма соседней: комментарий
                    не заезжает под сумму и обрывается там же, где она начинается. */}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">
                    {counterpartyOf(t) || t.categoryFull || "—"}
                  </span>
                  <span className="block text-xs text-muted truncate">
                    {t.categoryFull} · {formatDate(t.date, "full")}
                    {truncateWords(t.comment, 140) ? ` · ${truncateWords(t.comment, 140)}` : ""}
                  </span>
                </span>
                <span className="text-expense font-semibold tabular-nums shrink-0 leading-5">
                  {formatMoney(t.amountBase, baseCurrency)}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/** «+12% к прошлому периоду» — или пусто, если изменение в пределах процента. */
function deltaNote(delta: number): string | undefined {
  if (Math.abs(delta) <= 0.01) return "≈ как в прошлый раз";
  return `${delta > 0 ? "+" : ""}${formatPct(delta, 0)} к прошлому периоду`;
}

/** Сравнение с обычным периодом, а без него — с прошлым. */
function compareNote(value: number, typical: number | undefined, prevDelta: number): string | undefined {
  if (typical == null) return deltaNote(prevDelta);
  if (Math.abs(typical) < 0.01) return undefined;
  const rel = (value - typical) / Math.abs(typical);
  if (Math.abs(rel) <= 0.03) return "Как обычно";
  return `${rel > 0 ? "+" : ""}${formatPct(rel, 0)} к обычному`;
}

/** Подсказка итога: с чем именно сравнили. */
function compareTip(entry: DigestEntry, key: "income" | "expense", base: string) {
  const prev = key === "income" ? entry.prevIncome : entry.prevExpense;
  const facts = [
    { label: "За период", value: formatMoney(entry[key], base), strong: true },
    { label: entry.period === "month" ? "Прошлый месяц" : "Прошлая неделя", value: formatMoney(prev, base) },
  ];
  if (entry.typical)
    facts.push({
      label: `Обычно — среднее за ${entry.typical.periods} ${
        entry.period === "month"
          ? pluralRu(entry.typical.periods, ["месяц", "месяца", "месяцев"])
          : pluralRu(entry.typical.periods, ["неделю", "недели", "недель"])
      }`,
      value: formatMoney(entry.typical[key], base),
      strong: false,
    });
  return <TooltipFacts title={key === "income" ? "Доход" : "Расход"} facts={facts} />;
}

/**
 * Главное о периоде одной фразой: сколько потратили против обычного, сколько
 * отложили и что выросло сильнее всего.
 */
function headline(entry: DigestEntry, base: string): string {
  const parts: string[] = [];
  // Период — в заголовке карточки, фраза начинается сразу с дела.
  const spent = `Потратили ${formatMoney(entry.expense, base)}`;
  const typ = entry.typical?.expense;
  if (typ && Math.abs(typ) > 0.01) {
    const rel = (entry.expense - typ) / typ;
    parts.push(
      Math.abs(rel) <= 0.03
        ? `${spent} — как обычно`
        : `${spent} — на ${formatPct(Math.abs(rel), 0)} ${rel > 0 ? "больше" : "меньше"} обычного`
    );
  } else parts.push(spent);
  if (entry.income > 0) {
    parts.push(
      entry.net >= 0
        ? `Отложили ${formatPct(entry.savingsRate, 0)} дохода`
        : `Расходы превысили доход на ${formatMoney(-entry.net, base)}`
    );
  }
  const up = entry.movers.find((m) => m.current > m.previous);
  if (up) parts.push(`Сильнее всего выросли траты в категории «${up.category}»: +${formatMoney(up.current - up.previous, base)}`);
  return parts.join(". ") + ".";
}

function daysSubtitle(entry: DigestEntry, base: string): string {
  const parts = [
    `Без трат — ${formatNum(entry.noSpendDays)} ${pluralRu(entry.noSpendDays, ["день", "дня", "дней"])} из ${formatNum(entry.days.length)}`,
  ];
  if (entry.biggestDay)
    parts.push(`Самый дорогой — ${formatDate(entry.biggestDay.date, "full")}, ${formatMoney(entry.biggestDay.expense, base)}`);
  return parts.join(" · ");
}

function DaysChart({
  days,
  biggest,
  base,
  week,
  onDay,
}: {
  days: DigestDay[];
  biggest?: string;
  base: string;
  week: boolean;
  onDay: (date: string) => void;
}) {
  const data = days.map((d) => ({ ...d, label: dayLabel(d.date, week) }));
  return (
    <div className="h-40">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
          <XAxis dataKey="label" stroke={chartAxisStroke} fontSize={11} interval={week ? 0 : 4} />
          <YAxis stroke={chartAxisStroke} fontSize={11} width={48} tickFormatter={(v: number) => formatNum(v, { compact: true })} />
          <RTooltip
            {...chartTooltipProps}
            cursor={{ fill: "rgb(var(--c-border) / 0.35)" }}
            content={
              <SeriesTooltip
                formatValue={(v) => formatMoney(v, base)}
                formatLabel={(_, rows) => formatDate(String(rows[0]?.payload?.date ?? ""), "full")}
              />
            }
          />
          <Bar
            dataKey="expense"
            name="Расход"
            radius={[3, 3, 0, 0]}
            className="cursor-pointer"
            // Клик по столбику — траты этого дня в боковой панели, как по
            // категории ниже. День без трат открывать незачем.
            onClick={(d: { payload?: DigestDay }) => {
              const day = d?.payload;
              if (day && day.expense > 0) onDay(day.date);
            }}
          >
            {data.map((d) => (
              <Cell key={d.date} fill={d.date === biggest ? chartColor.expense : chartColor.accent} fillOpacity={d.date === biggest ? 1 : 0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function dayLabel(iso: string, week: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  return week ? WEEKDAYS[new Date(y, m - 1, d).getDay()] : String(d);
}

function PayeeList({ payees, base, empty }: { payees: DigestPayee[]; base: string; empty: string }) {
  if (payees.length === 0) return <div className="text-sm text-muted">{empty}</div>;
  const max = Math.max(...payees.map((p) => p.expense), 1);
  return (
    <div className="space-y-0.5">
      {payees.map((p) => (
        <MeterRow
          key={p.name}
          bar="track"
          label={p.name}
          share={p.expense / max}
          barCls="bg-accent"
          cells={[
            {
              text: `${formatNum(p.count)} ${pluralRu(p.count, ["покупка", "покупки", "покупок"])}`,
              width: "6.5rem",
              muted: true,
            },
            { text: formatMoney(p.expense, base), width: "7.5rem" },
          ]}
        />
      ))}
    </div>
  );
}
