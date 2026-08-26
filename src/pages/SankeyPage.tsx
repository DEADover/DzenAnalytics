import { useEffect, useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { GitFork, TrendingUp, TrendingDown, Trophy, PiggyBank } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { buildSankey } from "../lib/aggregations";
import { formatMoney, formatPct, chartTooltipProps } from "../lib/format";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../components/TooltipFacts";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { StatCell } from "../components/SectionCard";

const COLORS = {
  income: "#10B981",
  account: "#22D3EE",
  category: "#EF4444",
  savings: "#A78BFA",
  funding: "#F59E0B",
};

export function SankeyPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const data = useMemo(() => buildSankey(filtered), [filtered]);

  /** Итоги того же отбора: диаграмма отвечает «куда», а не «сколько». */
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.kind === "income") income += t.amountBase;
      else if (affectsExpense(t.kind)) expense += expenseDelta(t);
    }
    return { income, expense, net: income - expense, count: filtered.length };
  }, [filtered]);

  /** Операции одной статьи или одного источника — по клику на узел. */
  function openNode(name: string, kind: string) {
    const rows = filtered.filter((t) =>
      kind === "income"
        ? t.kind === "income" && (t.category || "Прочие доходы") === name
        : affectsExpense(t.kind) && (t.category || "Прочие") === name
    );
    if (rows.length === 0) return;
    showDrill(name, rows, kind === "income" ? "Источник дохода" : "Статья расхода");
  }

  const header = (
    <PageHeader
      icon={GitFork}
      title="Потоки денег"
      hint="Откуда пришли деньги и куда ушли — одной картиной"
      right={
        <InfoPopover>
          <p>
            Слева — <InfoTerm>источники доходов</InfoTerm>, справа —{" "}
            <InfoTerm>категории расходов</InfoTerm>, между ними бюджет периода.
            Толщина ленты и есть сумма: широкая лента — много денег, узкая — мало.
          </p>
          <p>
            Если доход больше трат, разница уходит вправо отдельной лентой
            «Сбережения». Если трат больше дохода, слева появляется лента
            «Привлечено со счетов» — это та часть расходов, которую покрыли не
            доходом периода, а тем, что уже лежало на счетах.
          </p>
          <p>
            Переводы между своими счетами в потоки не идут. Возврат не рисуется
            отдельным доходом, а уменьшает ленту своей же статьи. Мелкие статьи
            собраны в «Прочие»: восемь источников и двенадцать статей расхода
            рисуются по отдельности, остальные складываются.
          </p>
          <p>
            Нажатие на статью или источник открывает его операции. «Прочие»
            открыть нельзя — за ними стоит не одна статья, а всё, что не попало
            в перечисленные.
          </p>
        </InfoPopover>
      }
    />
  );

  if (transactions.length === 0) return <EmptyState />;

  if (data.links.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <GlobalFilters />
        <div className="card-tray card-pad text-center py-12 text-muted">
          Нет данных для построения потоков в текущем фильтре.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <GlobalFilters />

      {/* Итоги отбора. Диаграмма показывает пропорции и ничего не говорит о
          суммах: чтобы узнать, сколько всего пришло, приходилось уходить на
          другую страницу. */}
      <div className="tray">
        <div className="tray-core px-5 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <StatCell
              label="Доход"
              value={formatMoney(totals.income, base)}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="income"
              note={`${totals.count} ${totals.count % 10 === 1 && totals.count % 100 !== 11 ? "операция" : "операций"} в отборе`}
            />
            <StatCell
              label="Расход"
              value={formatMoney(totals.expense, base)}
              icon={<TrendingDown className="w-4 h-4" />}
              tone="expense"
              note={
                totals.income > 0
                  ? `${formatPct(totals.expense / totals.income, 0)} от дохода`
                  : undefined
              }
              pad
            />
            <StatCell
              label="Чистый поток"
              value={formatMoney(totals.net, base, { signed: true })}
              icon={<Trophy className="w-4 h-4" />}
              tone={totals.net >= 0 ? "income" : "expense"}
              note={totals.net >= 0 ? "ушло в сбережения" : "покрыто со счетов"}
              pad
            />
            <StatCell
              label="Норма сбережений"
              value={totals.income > 0 ? formatPct(totals.net / totals.income, 0) : "—"}
              icon={<PiggyBank className="w-4 h-4" />}
              tone={totals.net >= 0 ? "income" : "expense"}
              note="доля дохода, которая осталась"
              pad
            />
          </div>
        </div>
      </div>

      <div className="card-tray px-4 py-3">
        <div className="h-[600px]">
          <ResponsiveContainer>
            <Sankey
              data={data}
              // Поля под подписи: узлы стоят вплотную к краям области, а имя
              // рисуется СНАРУЖИ прямоугольника — без полей текст обрезался
              // границей svg, и диаграмма стояла безымянными полосами.
              margin={{ top: 8, right: 170, bottom: 8, left: 170 }}
              nodePadding={20}
              nodeWidth={14}
              linkCurvature={0.5}
              // Без релаксации: узлы встают в том порядке, в каком лежат в
              // данных, — источники и статьи по убыванию суммы, «Сбережения»
              // первыми справа. Пересекаться лентам тут всё равно негде: все
              // они идут из одного «Бюджета» и в него же, — а с релаксацией
              // порядок каждый раз получался свой (issue: «сбережения всегда
              // наверху»).
              iterations={0}
              // Ленты «Сбережения» и «Привлечено со счетов» красим в цвет их
              // узла: это не рядовые статьи, а ответ на вопрос «хватило дохода
              // или нет», и в сером частоколе они терялись (issue #91).
              link={(props: unknown) => {
                const p = props as {
                  sourceX?: number; targetX?: number;
                  sourceY?: number; targetY?: number;
                  sourceControlX?: number; targetControlX?: number;
                  linkWidth?: number; index?: number;
                  payload?: {
                    target?: number | { name?: string; kind?: string };
                    source?: number | { name?: string; kind?: string };
                  };
                };
                // Recharts отдаёт концы ленты то номером узла, то самим узлом —
                // зависит от того, до или после раскладки. Разбираем оба вида.
                const nodeOf = (
                  ref: number | { name?: string; kind?: string } | undefined
                ): { name?: string; kind?: string } | undefined =>
                  typeof ref === "number" ? data.nodes[ref] : ref;
                const target = nodeOf(p.payload?.target);
                const source = nodeOf(p.payload?.source);
                const kind = target?.kind === "savings" ? "savings"
                  : source?.kind === "funding" ? "funding" : null;
                const stroke = kind ? COLORS[kind] : "rgb(var(--c-muted))";
                return (
                  <path
                    key={`link-${p.index}`}
                    d={`M${p.sourceX},${p.sourceY}C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={p.linkWidth}
                    strokeOpacity={kind ? 0.3 : 0.15}
                  />
                );
              }}
              node={({ x, y, width, height, index, payload }: {
                x?: number; y?: number; width?: number; height?: number; index?: number;
                payload?: {
                  name?: string;
                  kind?: "income" | "account" | "category" | "savings" | "funding";
                  value?: number;
                };
              }) => {
                const xv = x ?? 0;
                const yv = y ?? 0;
                const w = width ?? 0;
                const h = height ?? 0;
                const kind = payload?.kind || "account";
                // Expense-category nodes get their own per-category colour
                // (API / deterministic), matching every other page. Income
                // sources and the budget node keep their flow colours.
                const fill =
                  kind === "category" && payload?.name
                    ? colorForCategory(payload.name, categoryMeta)
                    : COLORS[kind];
                const isLeft = xv < 200;
                const name = payload?.name ?? "";
                // «Прочие» — не статья, а всё, что не попало в перечисленные:
                // открывать по ним нечего, и вид у них обычный, без курсора.
                const clickable =
                  (kind === "category" || kind === "income") && !name.startsWith("Прочие");
                return (
                  <g
                    key={`node-${index}`}
                    onClick={clickable ? () => openNode(name, kind) : undefined}
                    style={clickable ? { cursor: "pointer" } : undefined}
                  >
                    <title>
                      {name}: {formatMoney(payload?.value ?? 0, base)}
                      {clickable ? " — нажмите, чтобы открыть операции" : ""}
                    </title>
                    <rect x={xv} y={yv} width={w} height={h} fill={fill} fillOpacity={0.85} />
                    {/* Сумма рядом с названием: раньше её показывала только
                        подсказка при наведении, и прочесть диаграмму, не водя
                        мышью по каждой ленте, было нельзя. */}
                    <text
                      x={isLeft ? xv - 6 : xv + w + 6}
                      y={yv + h / 2 - (h > 26 ? 6 : 0)}
                      textAnchor={isLeft ? "end" : "start"}
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="rgb(var(--c-text))"
                    >
                      {name}
                    </text>
                    {h > 26 && (
                      <text
                        x={isLeft ? xv - 6 : xv + w + 6}
                        y={yv + h / 2 + 7}
                        textAnchor={isLeft ? "end" : "start"}
                        dominantBaseline="middle"
                        fontSize={10}
                        fill="rgb(var(--c-muted))"
                      >
                        {formatMoney(payload?.value ?? 0, base, { compact: true })}
                      </text>
                    )}
                  </g>
                );
              }}
            >
              <Tooltip
                {...chartTooltipProps}
                content={(props) => (
                  <FlowTooltip
                    {...(props as unknown as { active?: boolean; payload?: readonly unknown[] })}
                    base={base}
                    total={totals.income}
                  />
                )}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
        {/* Легенда одной строкой под диаграммой: пять чипов вразброс по центру
            занимали высоту наравне с содержимым. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-[11px] text-muted">
          <LegendChip color={COLORS.income} label="Источники доходов" />
          <LegendChip color={COLORS.account} label="Бюджет" />
          <LegendChip
            label="Категории расходов"
            gradient="conic-gradient(#22D3EE 0 90deg, #A78BFA 90deg 180deg, #F59E0B 180deg 270deg, #10B981 270deg 360deg)"
          />
          {data.nodes.some((n) => n.kind === "savings") && (
            <LegendChip color={COLORS.savings} label="Сбережения" />
          )}
          {data.nodes.some((n) => n.kind === "funding") && (
            <LegendChip color={COLORS.funding} label="Привлечено со счетов" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Чип легенды: квадрат цвета и подпись. */
function LegendChip({
  color,
  gradient,
  label,
}: {
  color?: string;
  /** Многоцветный чип — у категорий цвет свой у каждой. */
  gradient?: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-sm shrink-0"
        style={{ background: gradient ?? color }}
      />
      {label}
    </span>
  );
}

/**
 * Подсказка потоков: у ленты — откуда и куда, у узла — что это за узел.
 *
 * Общая `SeriesTooltip` сюда не годилась: она берёт заголовок из `label`, а у
 * Sankey его нет — карточка выходила с пустой строкой сверху и одинокой суммой,
 * без единого слова о том, к чему эта сумма относится.
 *
 * Ленту от узла отличаем по `source`/`target`: у Recharts они приходят номерами
 * узлов, а не объектами, поэтому имена достаём из самого списка узлов. Своё имя
 * ленты («Бюджет - Транспорт») он собирает через дефис — для потока правильнее
 * стрелка, она показывает сторону движения денег.
 */
function FlowTooltip({
  active,
  payload,
  base,
  total,
}: {
  active?: boolean;
  payload?: readonly unknown[];
  base: string;
  /** Доход отбора — от него считается доля потока. */
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0] as {
    name?: string;
    value?: number;
    payload?: {
      name?: string;
      kind?: string;
      value?: number;
      source?: number | { name?: string };
      target?: number | { name?: string };
    };
  };
  const inner = entry.payload ?? {};
  const value = Number(entry.value ?? inner.value ?? 0);
  if (!Number.isFinite(value)) return null;

  // Узел от ленты отличает `kind`: он есть только у узлов, мы сами его туда и
  // кладём. У ленты Recharts не отдаёт ни `source`, ни `target` — только своё
  // собранное имя «Бюджет - Транспорт», из него и берём стороны. Стрелка вместо
  // дефиса: у потока есть направление, и подсказка обязана его показывать.
  const isNode = typeof inner.kind === "string";
  const rawName = inner.name || entry.name || "Поток";
  const sides = isNode ? null : rawName.split(" - ");
  const isLink = !!sides && sides.length === 2;
  const nodeName = rawName;
  const title = isLink ? `${sides![0]} → ${sides![1]}` : nodeName;

  const facts: TooltipFact[] = [
    {
      label: isLink ? "Прошло по ленте" : "Всего",
      value: formatMoney(value, base),
      strong: true,
    },
  ];
  if (total > 0) {
    facts.push({
      label: "Доля от дохода",
      value: formatPct(value / total, 1),
      tone: "muted",
    });
  }
  // Подсказка про клик — только там, где он есть: у ленты и у «Прочих» его нет.
  const clickable =
    isNode &&
    (inner.kind === "category" || inner.kind === "income") &&
    !nodeName.startsWith("Прочие");
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={title}
        facts={facts}
        note={clickable ? "Нажмите — откроются операции" : undefined}
      />
    </ChartTooltipCard>
  );
}
