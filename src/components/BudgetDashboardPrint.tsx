import { Fragment } from "react";
import { createPortal } from "react-dom";
import {
  atMonth,
  achievement,
  growth,
  prevMonth,
  variance,
  ytd,
  type BudgetDashboard,
  type DashboardRow,
  type DashboardSection,
} from "../lib/budgetDashboard";
import {
  donutSlices,
  hasNegative,
  paginateGroups,
  printBars,
  rowsPerPage,
  SHEET_PORTRAIT,
  type PrintBar,
} from "../lib/budgetPrint";
import { formatMoney, formatPct, monthLabelFull } from "../lib/format";
import { MONTHS } from "./BudgetExportModal";

/**
 * Печатный дашборд бюджета — то, что уходит в PDF.
 *
 * Отдельная вёрстка, а не «распечатать страницу как есть»: на экране бюджет
 * это широкая таблица на сорок колонок, которая в лист не влезает никогда
 * (из-за неё печать когда-то и убрали). Здесь та же сводка, что на листе
 * «Дашборд» в Excel, но разложенная под альбомный A4.
 *
 * Диаграммы нарисованы обычными div'ами и одним SVG. Библиотека диаграмм тут
 * не нужна и вредна: в печати важен предсказуемый прямоугольник, а не рендер с
 * анимацией, авто-размерами и своими представлениями о том, когда перерисоваться.
 */

const C_FACT = "#0891B2";
const C_PLAN = "#F59E0B";
const C_GOOD = "#16A34A";
const C_BAD = "#DC2626";
const C_REST = "#E5E7EB";

/**
 * На листе — ОДНА пара диаграмм, зато по всем статьям сразу.
 *
 * Раньше на лист лезли все шесть, и статьи резались на восьмёрки: получалось
 * «первые восемь статей во всех шести разрезах, потом следующие восемь во всех
 * шести». Читать это невозможно — одну и ту же таблицу приходится собирать по
 * листам. Теперь наоборот: пара разрезов показывается целиком, и только если
 * статей действительно много, она продолжается на следующем листе.
 *
 * Пара идёт друг под другом на книжном листе: полосе так достаётся вся ширина
 * страницы, а списку статей — высота (issue #68).
 *
 * Сколько статей влезет на лист, считается от его высоты и от ЧИСЛА диаграмм
 * на нём — прямо в разметке, потому что у переводов плана нет и диаграмма там
 * остаётся одна.
 */

/**
 * Предел шкалы у диаграмм роста: ±100 %.
 *
 * У денег масштаб по максимуму верен, а у процентов один выброс рушил картину:
 * рядом с «+2657 %» падение «−100 %» — предельное, дальше падать некуда — было
 * четвертью полосы, а всё остальное превращалось в чёрточки. Что вышло за
 * предел, упирается в край и помечается штриховкой; точное число рядом.
 */
const PCT_CAP = 1;

/**
 * Штриховка упёршейся полосы — слоем поверх цвета, ИНЛАЙНОМ.
 *
 * Не классом: цвет полосы задаётся инлайном, а сокращение `background` сносит
 * `background-image` из таблицы стилей, и штриховки просто не видно. К тому же
 * в PDF лист снимается растром через клонирование узла, где классы теряются, —
 * так же, как это было с цифрами в бубликах.
 */
const HATCH =
  "repeating-linear-gradient(-45deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 1px, transparent 1px, transparent 3px)";

interface Props {
  dashboard: BudgetDashboard;
  base: string;
}

function money(v: number | null, base: string): string {
  return v === null ? "—" : formatMoney(v, base);
}

/** Горизонтальная диаграмма: подпись, полоса, значение. */
/** Сумма полугодия: `from` — 0 (январь–июнь) или 6 (июль–декабрь). */
function halfSum(values: number[], from: number): number {
  let sum = 0;
  for (let i = from; i < from + 6; i++) sum += values[i] ?? 0;
  return sum;
}

/** Красим только минус: плюс в отчёте — обычное дело, минус надо заметить. */
function diffClass(income: number[], expense: number[], idx: number): string | undefined {
  return (income[idx] ?? 0) - (expense[idx] ?? 0) < 0 ? "print-months-minus" : undefined;
}

function BarChart({
  title,
  bars,
  rows,
  color,
  base,
  percent = false,
  bySign = false,
  invertSign = false,
}: {
  title: string;
  bars: PrintBar[];
  /** Те же строки, из которых собраны полосы, — по ним рисуется дерево. */
  rows: DashboardRow[];
  color: string;
  base: string;
  /** Значения — доли, а не деньги. */
  percent?: boolean;
  /** Красить по знаку: плюс зелёным, минус красным. */
  bySign?: boolean;
  /** Перевернуть знак для цвета: у расхода РОСТ — это «хуже». */
  invertSign?: boolean;
}) {
  const centered = hasNegative(bars);
  return (
    <div className="print-chart">
      {/* Без приписки «шкала до ±100 %»: у обрезанной полосы есть штриховка,
          а точное значение стоит справа от неё — подпись в заголовке только
          отвлекала. Как и на экране. */}
      <div className="print-chart-title">{title}</div>
      <div className="print-bars">
        {bars.map((b, i) => {
          // Под-категория — по самой строке, а не по подписи: у переводов под
          // «под-категорией» лежит счёт по ту сторону, и разбирать «·» в
          // тексте значило бы гадать по строке там, где есть готовое поле.
          const row = rows[i];
          const sub = row?.subcategory ?? null;
          // Родитель мог остаться на предыдущем листе: страницы режутся по
          // числу строк. Тогда ветка бессмысленна — пишем полное имя, как
          // раньше, иначе на листе висело бы одинокое «Кот».
          const parentHere =
            !!sub &&
            rows.slice(0, i).some((r) => r.category === row.category && r.subcategory === null);
          const more =
            !!sub && !!rows[i + 1]?.subcategory && rows[i + 1]?.category === row.category;
          const bad = invertSign ? !b.negative : b.negative;
          const tone = bySign ? (bad ? C_BAD : C_GOOD) : color;
          const width = `${(b.ratio * (centered ? 50 : 100)).toFixed(2)}%`;
          return (
            <Fragment key={b.label}>
              {sub && parentHere ? (
                <div className="print-bar-label print-bar-sub" title={b.label}>
                  <span
                    className={`print-bar-elbow-v${more ? " print-bar-elbow-more" : ""}`}
                  />
                  <span className="print-bar-elbow-h" />
                  <span className="print-bar-name">{sub}</span>
                </div>
              ) : (
                <div className="print-bar-label" title={b.label}>
                  {b.label}
                </div>
              )}
              <div className={`print-bar-track${centered ? " print-bar-centered" : ""}`}>
                {/* Полоса — просто блок с шириной в процентах: в печати это
                    ведёт себя одинаково в любом браузере. */}
                <div
                  className="print-bar-fill"
                  style={{
                    width,
                    background: b.clamped ? `${HATCH}, ${tone}` : tone,
                    // При двусторонней шкале ноль стоит посередине, и минус
                    // растёт влево от него.
                    ...(centered
                      ? b.negative
                        ? { right: "50%" }
                        : { left: "50%" }
                      : { left: 0 }),
                  }}
                />
              </div>
              <div className="print-bar-value">
                {b.value === null
                  ? "—"
                  : percent
                    ? formatPct(b.value)
                    : money(b.value, base)}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Бублик «выполнение плана» с процентом в середине. */
function Donut({
  title,
  fact,
  plan,
  base,
}: {
  title: string;
  fact: number;
  plan: number;
  base: string;
}) {
  const slices = donutSlices(fact, plan, { used: C_FACT, over: C_BAD, rest: C_REST });
  const done = achievement(fact, plan);
  // Радиус подобран так, чтобы длина окружности была ровно 100 — тогда доли
  // ложатся в `stroke-dasharray` процентами, без пересчёта.
  const R = 100 / (2 * Math.PI);
  return (
    <div className="print-donut">
      <div className="print-chart-title">{title}</div>
      <div className="print-donut-body">
        <svg viewBox="0 0 40 40" className="print-donut-svg" role="img" aria-label={title}>
          {slices.map((s, i) => (
            <circle
              key={i}
              cx="20"
              cy="20"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="5"
              strokeDasharray={`${(s.share * 100).toFixed(3)} ${(100 - s.share * 100).toFixed(3)}`}
              strokeDashoffset={(25 - s.offset * 100).toFixed(3)}
              // Поворот ЗДЕСЬ, атрибутом SVG, а не CSS-трансформом всего
              // рисунка: иначе вместе с кольцом ложится набок и процент в
              // середине — вернуть его обратно правилом `transform-origin` не
              // получается, при съёмке в картинку он уезжает.
              transform="rotate(-90 20 20)"
            />
          ))}
          {/* Размер и выключка — атрибутами SVG, а не классом: при съёмке в
              картинку узел клонируется, CSS-класс до него не доезжает, и текст
              наследует шрифт страницы — цифры вылезали за кольцо и обрезались. */}
          <text
            x="20"
            y="20"
            fontSize="6.5"
            fontWeight="700"
            fill="#111827"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {done === null ? "—" : formatPct(done, 0)}
          </text>
        </svg>
        <dl className="print-donut-legend">
          <div>
            <dt>Факт</dt>
            <dd>{money(fact, base)}</dd>
          </div>
          <div>
            <dt>План</dt>
            <dd>{money(plan, base)}</dd>
          </div>
          {/* Третье число — то, ради которого на кольцо и смотрят. На экране
              оно есть, и в отчёте должно быть тем же. */}
          <div>
            <dt>{plan - fact >= 0 ? "Осталось" : "Сверх плана"}</dt>
            <dd className={plan - fact >= 0 ? "print-up" : "print-down"}>
              {money(Math.abs(plan - fact), base)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Плитка показателя: крупное число, под ним план и сравнение. */
function Kpi({
  title,
  fact,
  plan,
  prev,
  base,
  tone,
  withTransfers,
}: {
  title: string;
  fact: number;
  plan: number | null;
  prev: number;
  base: string;
  tone: "expense" | "income" | "delta";
  /** Тот же факт вместе с переводами — второй строкой, как на экране. */
  withTransfers?: number;
}) {
  const g = growth(fact, prev);
  // У расхода рост — это «хуже», у дохода и разницы — «лучше»: зелёный на
  // выросших тратах читался бы как похвала.
  const goodGrowth = g !== null && (tone === "expense" ? g < 0 : g >= 0);
  return (
    <div className={`print-kpi print-kpi-${tone}`}>
      <div className="print-kpi-title">{title}</div>
      <div className="print-kpi-value">{formatMoney(fact, base, { signed: tone === "delta" })}</div>
      {withTransfers !== undefined && withTransfers !== fact && (
        <div className="print-kpi-extra">{money(withTransfers, base)} включая переводы</div>
      )}
      <div className="print-kpi-meta">
        {plan !== null && <span>План {money(plan, base)}</span>}
        {g !== null && (
          <span className={goodGrowth ? "print-up" : "print-down"}>
            {g >= 0 ? "▲" : "▼"} {formatPct(Math.abs(g))} к прошлому году
          </span>
        )}
      </div>
    </div>
  );
}

export function BudgetDashboardPrint({ dashboard: d, base }: Props) {
  const m = d.monthIndex;
  const monthName = monthLabelFull(d.month).replace(/\s\d+ г\.$/, "");
  const e = d.expense;
  const i = d.income;

  const mFact = (t: typeof e) => atMonth(t.factByMonth, m);
  const mPlan = (t: typeof e) => atMonth(t.planByMonth, m);
  const yFact = (t: typeof e) => ytd(t.factByMonth, m);
  const yPlan = (t: typeof e) => ytd(t.planByMonth, m);

  /** Полосы одной меры по списку статей страницы. */
  const bars = (
    rows: DashboardRow[],
    pick: (r: DashboardRow) => number | null,
    percent = false
  ) =>
    printBars(
      rows.map((r) => ({ label: r.label, value: pick(r) })),
      percent ? { cap: PCT_CAP } : {}
    );

  interface ChartSpec {
    title: string;
    pick: (r: DashboardRow) => number | null;
    color: string;
    percent?: boolean;
    bySign?: boolean;
    /** Диаграмма про план: разделу без планов её показывать нечего. */
    needsPlan?: boolean;
  }

  /** Пары разрезов: каждая пара занимает свои листы целиком. */
  const spreads: { title: string; charts: ChartSpec[] }[] = [
    {
      title: "План и факт за месяц",
      charts: [
        { title: "Факт — месяц", pick: (r) => atMonth(r.factByMonth, m), color: C_FACT },
        {
          title: "План — месяц",
          pick: (r) => atMonth(r.planByMonth, m),
          color: C_PLAN,
          needsPlan: true,
        },
      ],
    },
    {
      title: "С начала года: факт и отклонение от плана",
      charts: [
        { title: "Факт — с начала года", pick: (r) => ytd(r.factByMonth, m), color: C_FACT },
        {
          title: "Отклонение от плана — с начала года",
          // Знак приводится к «больше нуля — хорошо» по направлению самой
          // статьи: у дохода перевыполнение плана и недобор читаются наоборот,
          // чем у расхода, а на одном листе теперь бывают и те, и другие.
          pick: (r) => variance(ytd(r.factByMonth, m), ytd(r.planByMonth, m), r.kind),
          color: C_GOOD,
          bySign: true,
          needsPlan: true,
        },
      ],
    },
    {
      title: "Рост",
      charts: [
        {
          title: "Рост к прошлому месяцу",
          pick: (r) => growth(atMonth(r.factByMonth, m), prevMonth(r.factByMonth, r.prevFactByMonth, m)),
          color: C_BAD,
          percent: true,
          bySign: true,
        },
        {
          title: "Рост к прошлому году",
          pick: (r) => growth(ytd(r.factByMonth, m), ytd(r.prevFactByMonth, m)),
          color: C_BAD,
          percent: true,
          bySign: true,
        },
      ],
    },
  ];

  /** Есть ли в разделе планы: у переводов их не бывает — их не планируют. */
  const hasPlan = (section: DashboardSection) =>
    section.rows.some((r) => r.planByMonth.some((v) => v !== 0));

  return createPortal(
    <div className="print-root" aria-hidden="true">
      <section className="print-page">
        {/* Титул отчёта: слева — что это, справа — за что и с чем сравнивается.
            Раньше всё лежало одной серой строкой через точки («Август 2026 · с
            начала года: январь — август»), и чтобы понять, что за отрезок и с
            каким годом сравнение, её приходилось разбирать словами. Теперь это
            подписи и значения — как в остальных подсказках раздела. */}
        <header className="print-head print-cover">
          <div>
            <h1>Бюджет {d.year}</h1>
            <p className="print-cover-kind">Годовой отчёт по статьям</p>
          </div>
          <dl className="print-cover-meta">
            <div>
              <dt>Месяц показателей</dt>
              <dd>
                {monthName} {d.year}
              </dd>
            </div>
            <div>
              <dt>С начала года</dt>
              <dd>Январь — {monthName.toLowerCase()}</dd>
            </div>
            <div>
              <dt>Сравнение</dt>
              <dd>{d.year - 1}</dd>
            </div>
          </dl>
        </header>

        <div className="print-kpis">
          <Kpi
            title="Расходы за месяц"
            fact={mFact(e)}
            plan={mPlan(e)}
            prev={atMonth(e.prevFactByMonth, m)}
            base={base}
            tone="expense"
            withTransfers={e.hasTransfers ? atMonth(e.factAllByMonth, m) : undefined}
          />
          <Kpi
            title="Расходы с начала года"
            fact={yFact(e)}
            plan={yPlan(e)}
            prev={ytd(e.prevFactByMonth, m)}
            base={base}
            tone="expense"
            withTransfers={e.hasTransfers ? ytd(e.factAllByMonth, m) : undefined}
          />
          <Kpi
            title="Доходы с начала года"
            fact={yFact(i)}
            plan={yPlan(i)}
            prev={ytd(i.prevFactByMonth, m)}
            base={base}
            tone="income"
            withTransfers={i.hasTransfers ? ytd(i.factAllByMonth, m) : undefined}
          />
          <Kpi
            title="Разница с начала года"
            fact={ytd(i.factAllByMonth, m) - ytd(e.factAllByMonth, m)}
            plan={yPlan(i) - yPlan(e)}
            prev={ytd(i.prevFactAllByMonth, m) - ytd(e.prevFactAllByMonth, m)}
            base={base}
            tone="delta"
          />
        </div>

        <div className="print-donuts">
          <Donut
            title={`Выполнение плана — ${monthName.toLowerCase()}`}
            fact={mFact(e)}
            plan={mPlan(e)}
            base={base}
          />
          <Donut
            title="Выполнение плана — с начала года"
            fact={yFact(e)}
            plan={yPlan(e)}
            base={base}
          />
        </div>

        {/* Помесячный свод: та самая таблица, которую ждут от годового отчёта.
            Раньше нижняя половина титульного листа пустовала, а «сколько вышло
            в каждом месяце» приходилось собирать глазами по диаграммам.
            Полугодиями в два столбца — так двенадцать месяцев ложатся в высоту
            листа и используют его ширину. Суммы по статьям, без переводов: они
            внутри бюджета гасят друг друга, и итог сходится с плитками.
            Колонок три, а не пять: план помесячно стоит на самих диаграммах, а
            шесть колонок в двух таблицах при шрифте от 10 пунктов на лист уже
            не влезали — числа обрезало правым краем. */}
        <div className="print-months-pair">
          {[0, 6].map((from) => (
            <table className="print-months" key={from}>
              <thead>
                <tr>
                  <th>{from === 0 ? "I полугодие" : "II полугодие"}</th>
                  <th>Расход</th>
                  <th>Доход</th>
                  <th>Разница</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.slice(from, from + 6).map((name, k) => {
                  const idx = from + k;
                  return (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{money(atMonth(e.factByMonth, idx), base)}</td>
                      <td>{money(atMonth(i.factByMonth, idx), base)}</td>
                      <td className={diffClass(i.factByMonth, e.factByMonth, idx)}>
                        {formatMoney(
                          atMonth(i.factByMonth, idx) - atMonth(e.factByMonth, idx),
                          base,
                          { signed: true }
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Итого</td>
                  <td>{money(halfSum(e.factByMonth, from), base)}</td>
                  <td>{money(halfSum(i.factByMonth, from), base)}</td>
                  <td
                    className={
                      halfSum(i.factByMonth, from) - halfSum(e.factByMonth, from) < 0
                        ? "print-months-minus"
                        : undefined
                    }
                  >
                    {formatMoney(
                      halfSum(i.factByMonth, from) - halfSum(e.factByMonth, from),
                      base,
                      { signed: true }
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}
        </div>

      </section>

      {/* Дальше — разрезы по статьям, каждый на книжных листах и с разрывом
          страницы между разделами: расходы, доходы и в самом конце переводы
          (issue #68). Раньше всё это лежало одной кучей на альбомных листах, и
          доходы в отчёт не попадали вовсе. */}
      {spreads.flatMap((spread) =>
        d.sections.flatMap((section) => {
          const charts = spread.charts.filter((c) => !c.needsPlan || hasPlan(section));
          if (charts.length === 0) return [];
          // Статьи, по которым В ЭТОМ РАЗРЕЗЕ нет ни одного значения, на лист не
          // идут: строка «— 0 ₽» ничего не сообщает, а у переводов таких было
          // больше половины (счёт есть, но в декабре по нему не двигали). Отбор
          // ровно по тем диаграммам, что стоят на листе: статья с планом, но без
          // факта, остаётся — иначе исчезло бы то, ради чего смотрят план.
          const alive = section.rows.filter((r) =>
            charts.some((c) => {
              const v = c.pick(r);
              return v !== null && v !== 0;
            })
          );
          if (alive.length === 0) return [];
          // Сколько строк влезет — считаем по ЧИСЛУ ДИАГРАММ на этом листе, а
          // не по двум всегда: у переводов плана нет, вторая диаграмма
          // отпадает, и лист с восемнадцатью строками наполовину пустовал.
          const chunks = paginateGroups(
            alive,
            rowsPerPage(charts.length, SHEET_PORTRAIT),
            (r) => r.subcategory !== null
          );
          return chunks.map((rows, chunkIndex) => (
            <section
              className="print-page print-portrait"
              key={`${spread.title}-${section.key}-${chunkIndex}`}
            >
              <header className="print-head print-head-slim">
                <h2>
                  {section.title} · {spread.title.toLowerCase()}
                  {chunks.length > 1 ? ` · ${chunkIndex + 1} из ${chunks.length}` : ""}
                </h2>
                <p>
                  {monthName} {d.year} · сравнение с {d.year - 1}
                </p>
              </header>
              <div className="print-column">
                {charts.map((c) => (
                  <BarChart
                    key={c.title}
                    title={c.title}
                    bars={bars(rows, c.pick, c.percent)}
                    rows={rows}
                    color={c.color}
                    base={base}
                    percent={c.percent}
                    // У расхода рост — это «хуже», у дохода наоборот. Переводы
                    // не красим по знаку вовсе: оборот по счетам сам по себе не
                    // бывает ни хорошим, ни плохим.
                    bySign={c.bySign && section.key !== "transfer"}
                    invertSign={section.key === "expense"}
                  />
                ))}
              </div>
            </section>
          ));
        })
      )}
    </div>,
    document.body
  );
}
