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
} from "../lib/budgetDashboard";
import {
  donutSlices,
  hasNegative,
  paginate,
  printBars,
  rowsPerPage,
  type PrintBar,
} from "../lib/budgetPrint";
import { formatMoney, formatPct, monthLabelFull } from "../lib/format";

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
 */
const CHART_ROWS = 1;
/** Сколько статей влезает: считается от высоты листа, а не подбирается. */
const ROWS_PER_PAGE = rowsPerPage(CHART_ROWS);

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
function BarChart({
  title,
  bars,
  color,
  base,
  percent = false,
  bySign = false,
  invertSign = false,
}: {
  title: string;
  bars: PrintBar[];
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
      <div className="print-chart-title">
        {title}
        {percent && <span className="print-chart-note"> · шкала до ±100 %</span>}
      </div>
      <div className="print-bars">
        {bars.map((b) => {
          const bad = invertSign ? !b.negative : b.negative;
          const tone = bySign ? (bad ? C_BAD : C_GOOD) : color;
          const width = `${(b.ratio * (centered ? 50 : 100)).toFixed(2)}%`;
          return (
            <Fragment key={b.label}>
              <div className="print-bar-label" title={b.label}>
                {b.label}
              </div>
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
}: {
  title: string;
  fact: number;
  plan: number | null;
  prev: number;
  base: string;
  tone: "expense" | "income" | "delta";
}) {
  const g = growth(fact, prev);
  return (
    <div className={`print-kpi print-kpi-${tone}`}>
      <div className="print-kpi-title">{title}</div>
      <div className="print-kpi-value">{formatMoney(fact, base, { signed: tone === "delta" })}</div>
      <div className="print-kpi-meta">
        {plan !== null && <span>План {money(plan, base)}</span>}
        {g !== null && (
          <span className={g >= 0 ? "print-up" : "print-down"}>
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

  /** Пары разрезов: каждая пара занимает свои листы целиком. */
  const spreads: {
    title: string;
    charts: { title: string; pick: (r: DashboardRow) => number | null; color: string; percent?: boolean; bySign?: boolean; invertSign?: boolean }[];
  }[] = [
    {
      title: "Факт и план за месяц",
      charts: [
        { title: "Факт — месяц", pick: (r) => atMonth(r.factByMonth, m), color: C_FACT },
        { title: "План — месяц", pick: (r) => atMonth(r.planByMonth, m), color: C_PLAN },
      ],
    },
    {
      title: "С начала года: факт и отклонение от плана",
      charts: [
        { title: "Факт — с начала года", pick: (r) => ytd(r.factByMonth, m), color: C_FACT },
        {
          title: "Отклонение от плана — с начала года",
          pick: (r) => variance(ytd(r.factByMonth, m), ytd(r.planByMonth, m), "expense"),
          color: C_GOOD,
          bySign: true,
        },
      ],
    },
    {
      title: "Рост расходов",
      charts: [
        {
          title: "Рост к прошлому месяцу",
          pick: (r) => growth(atMonth(r.factByMonth, m), prevMonth(r.factByMonth, r.prevFactByMonth, m)),
          color: C_BAD,
          percent: true,
          bySign: true,
          invertSign: true,
        },
        {
          title: "Рост к прошлому году",
          pick: (r) => growth(ytd(r.factByMonth, m), ytd(r.prevFactByMonth, m)),
          color: C_BAD,
          percent: true,
          bySign: true,
          invertSign: true,
        },
      ],
    },
  ];

  return createPortal(
    <div className="print-root" aria-hidden="true">
      <section className="print-page">
        <header className="print-head">
          <h1>Бюджет {d.year} — годовой отчёт</h1>
          <p>
            {monthName} {d.year} · с начала года: январь — {monthName.toLowerCase()}
          </p>
        </header>

        <div className="print-kpis">
          <Kpi
            title="Расходы за месяц"
            fact={mFact(e)}
            plan={mPlan(e)}
            prev={atMonth(e.prevFactByMonth, m)}
            base={base}
            tone="expense"
          />
          <Kpi
            title="Расходы с начала года"
            fact={yFact(e)}
            plan={yPlan(e)}
            prev={ytd(e.prevFactByMonth, m)}
            base={base}
            tone="expense"
          />
          <Kpi
            title="Доходы с начала года"
            fact={yFact(i)}
            plan={yPlan(i)}
            prev={ytd(i.prevFactByMonth, m)}
            base={base}
            tone="income"
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

        {e.hasTransfers && (
          <p className="print-note">
            «Разница» считается вместе с переводами — внутри бюджета они гасят
            друг друга. Расход без переводов за месяц:{" "}
            {money(mFact(e), base)}, вместе с ними{" "}
            {money(atMonth(e.factAllByMonth, m), base)}.
          </p>
        )}
      </section>

      {spreads.flatMap((spread) => {
        const chunks = paginate(d.rows, ROWS_PER_PAGE);
        return chunks.map((rows, chunkIndex) => (
          <section className="print-page" key={`${spread.title}-${chunkIndex}`}>
            <header className="print-head print-head-slim">
              <h2>
                {spread.title}
                {chunks.length > 1 ? ` · ${chunkIndex + 1} из ${chunks.length}` : ""}
              </h2>
              <p>
                {monthName} {d.year} · сравнение с {d.year - 1}
              </p>
            </header>
            <div className="print-grid">
              {spread.charts.map((c) => (
                <BarChart
                  key={c.title}
                  title={c.title}
                  bars={bars(rows, c.pick, c.percent)}
                  color={c.color}
                  base={base}
                  percent={c.percent}
                  bySign={c.bySign}
                  invertSign={c.invertSign}
                />
              ))}
            </div>
          </section>
        ));
      })}
    </div>,
    document.body
  );
}
