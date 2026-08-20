import { Fragment, useState } from "react";
import {
  achievement,
  atMonth,
  growth,
  prevMonth,
  variance,
  ytd,
  type BudgetDashboard,
  type DashboardRow,
  type DashboardSection,
  type DashboardSectionKey,
} from "../lib/budgetDashboard";
import { donutSlices, hasNegative, printBars, type PrintBar } from "../lib/budgetPrint";
import { formatMoney, formatPct } from "../lib/format";
import { MONTHS } from "./BudgetExportModal";
import { Segmented } from "./Segmented";
import { Tooltip } from "./Tooltip";
import { TooltipFacts } from "./TooltipFacts";

/**
 * Дашборд бюджета на экране — та же сводка, что уходит в PDF и в Excel
 * (issue #68).
 *
 * Считает её общая модель `buildBudgetDashboard`, поэтому цифры на экране и в
 * файле совпадают по определению, а не по совпадению. Разница только в
 * оформлении: тут тема сервиса и переключатели, там — белый лист.
 *
 * Два горизонта, как в управленческих отчётах: ВЫБРАННЫЙ МЕСЯЦ и С НАЧАЛА ГОДА
 * (январь → выбранный включительно). Прошлый год берётся тем же отрезком.
 */

/** Предел шкалы у диаграмм роста: ±100 %, как и в печатной версии. */
const PCT_CAP = 1;

interface Props {
  dashboard: BudgetDashboard;
  base: string;
  /** Месяц показателей: он же уходит в выгрузку. */
  /** Клик по категории — её операции за выбранный месяц. */
  onOpenRow: (row: DashboardRow) => void;
}

function money(v: number | null, base: string): string {
  return v === null ? "—" : formatMoney(v, base);
}

/** Плитка показателя: крупное число, под ним план и сравнение с прошлым годом. */
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
  /**
   * Тот же факт вместе с переводами. Пишется второй строкой ровно так же, как
   * в месячном виде: одно и то же число не должно называться на соседних
   * закладках по-разному.
   */
  withTransfers?: number;
}) {
  const g = growth(fact, prev);
  const factClass =
    tone === "expense" ? "text-expense" : tone === "income" ? "text-income" : fact >= 0 ? "text-income" : "text-expense";
  // У расхода рост — это «хуже», у дохода и разницы — «лучше». Красить всё
  // подряд зелёным на плюсе значило бы хвалить за выросшие траты.
  const goodGrowth = g !== null && (tone === "expense" ? g < 0 : g >= 0);
  return (
    <div className="card-tray card-pad">
      <div className="label mb-1.5">{title}</div>
      <div className={`stat-num whitespace-nowrap ${factClass} mb-2`}>
        {formatMoney(fact, base, { signed: tone === "delta" })}
      </div>
      {withTransfers !== undefined && (
        <div
          className="-mt-1.5 mb-2 text-[13px] text-muted tabular-nums whitespace-nowrap"
          aria-hidden={withTransfers === fact}
        >
          {withTransfers === fact ? (
            <span className="invisible">—</span>
          ) : (
            `${money(withTransfers, base)} включая переводы`
          )}
        </div>
      )}
      {/* План и сравнение — ВСЕГДА двумя строками, а не рядом с переносом по
          месту. Иначе высота плитки зависит от длины чисел: в апреле подпись
          влезала в строку, в июне — уже нет, и плитки прыгали при каждом
          переключении месяца. */}
      <div className="flex flex-col items-start gap-1.5 text-sm">
        <span className="px-3 py-1 rounded-full bg-panel2 text-muted tabular-nums whitespace-nowrap">
          {plan === null ? "Плана нет" : `План ${money(plan, base)}`}
        </span>
        {g === null ? (
          // Держим место строки: без неё плитка без прошлого года была бы ниже
          // соседних. Пустую строку прячем и от читалок.
          <span className="invisible" aria-hidden>
            —
          </span>
        ) : (
          <span
            className={`tabular-nums whitespace-nowrap ${
              goodGrowth ? "text-income" : "text-expense"
            }`}
          >
            {g >= 0 ? "▲" : "▼"} {formatPct(Math.abs(g))} к прошлому году
          </span>
        )}
      </div>
    </div>
  );
}

/** Кольцо «выполнение плана»: освоено, перерасход, остаток. */
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
  const slices = donutSlices(fact, plan, {
    used: "rgb(var(--c-accent))",
    over: "rgb(var(--c-expense))",
    rest: "rgb(var(--c-panel2))",
  });
  const done = achievement(fact, plan);
  // Радиус подобран так, чтобы длина окружности была ровно 100 — тогда доли
  // ложатся в `stroke-dasharray` процентами, без пересчёта.
  const R = 100 / (2 * Math.PI);
  return (
    <div className="card-tray card-pad">
      <div className="label mb-3">{title}</div>
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 40 40" className="w-24 h-24 shrink-0" role="img" aria-label={title}>
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
              transform="rotate(-90 20 20)"
            />
          ))}
          <text
            x="20"
            y="20"
            fontSize="7"
            fontWeight="700"
            fill="rgb(var(--c-text))"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {done === null ? "—" : formatPct(done, 0)}
          </text>
        </svg>
        <dl className="grid gap-2 text-sm min-w-0">
          <div>
            <dt className="label">Факт</dt>
            <dd className="tabular-nums font-medium">{money(fact, base)}</dd>
          </div>
          <div>
            <dt className="label">План</dt>
            <dd className="tabular-nums font-medium">{money(plan, base)}</dd>
          </div>
          {/* Третье число — то, ради которого на кольцо и смотрят: сколько ещё
              можно потратить. Раньше его приходилось считать в уме, а место
              справа от кольца пустовало. */}
          <div>
            <dt className="label">{plan - fact >= 0 ? "Осталось" : "Сверх плана"}</dt>
            <dd
              className={`tabular-nums font-medium ${
                plan - fact >= 0 ? "text-income" : "text-expense"
              }`}
            >
              {money(Math.abs(plan - fact), base)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Горизонтальная диаграмма: статья, полоса, значение. */
function BarChart({
  title,
  rows,
  bars,
  base,
  percent = false,
  bySign = false,
  invertSign = false,
  onOpenRow,
}: {
  title: string;
  rows: DashboardRow[];
  bars: PrintBar[];
  base: string;
  percent?: boolean;
  bySign?: boolean;
  invertSign?: boolean;
  onOpenRow: (row: DashboardRow) => void;
}) {
  const centered = hasNegative(bars);
  return (
    <div className="card-tray card-pad min-w-0">
      <div className="label mb-3">{title}</div>
      {/* Колонка подписей шире полутора десятков символов: статьи с длинными
          именами обрезались на каждой диаграмме, а место под них есть. */}
      <div className="grid grid-cols-[minmax(0,15rem)_1fr_minmax(0,7rem)] gap-x-3 gap-y-1.5 items-center">
        {bars.map((b, i) => {
          // Под-категория — по самой строке, а не по подписи: у переводов под
          // «под-категорией» лежит счёт по ту сторону, и разбирать «·» в тексте
          // значило бы гадать по строке там, где есть готовое поле.
          const sub = rows[i]?.subcategory ?? null;
          // Ветка продолжается, если следующая строка — сестра этой: тогда
          // линия идёт насквозь, а не обрывается в промежутке между строками.
          const more =
            !!rows[i + 1]?.subcategory && rows[i + 1]?.category === rows[i]?.category;
          const bad = invertSign ? !b.negative : b.negative;
          const tone = bySign
            ? bad
              ? "bg-expense"
              : "bg-income"
            : percent
              ? "bg-accent2"
              : "bg-accent";
          const width = `${(b.ratio * (centered ? 50 : 100)).toFixed(2)}%`;
          return (
            <Fragment key={b.label}>
              <button
                type="button"
                onClick={() => onOpenRow(rows[i])}
                className={`text-xs text-left truncate hover:text-accent ${
                  sub ? "relative pl-4 text-muted" : ""
                }`}
              >
                {/* Уголок к родительской статье: она стоит прямо над своими
                    под-категориями, поэтому повторять её имя в подписи
                    («Еда дома · Алкоголь») больше не нужно — достаточно
                    показать, чья это ветка. Уголок рисуется отдельными
                    полосками, чтобы не удлинять текст и не мешать обрезке. */}
                {sub && (
                  <>
                    <span
                      className={`absolute left-1 -top-1.5 w-px bg-border ${
                        more ? "-bottom-1.5" : "bottom-1/2"
                      }`}
                    />
                    <span className="absolute left-1 top-1/2 w-2 h-px bg-border" />
                  </>
                )}
                {sub ?? b.label}
              </button>
              {/* Подсказка — только у обрезанных полос: там, где полоса
                  упёрлась в край шкалы, её длина не отвечает величине, и это
                  надо объяснить. У остальных строк подсказки нет: значение
                  стоит справа, а «клик по категории — её операции» написано в
                  шапке раздела — повторять это на каждой строке значит мешать
                  читать диаграмму. */}
              <Tooltip
                content={
                  b.clamped ? (
                    <TooltipFacts
                      title={b.label}
                      facts={[
                        {
                          label: "Значение",
                          value: b.value === null ? "—" : formatPct(b.value),
                          tone: bySign ? (bad ? "expense" : "income") : undefined,
                          swatch: tone,
                          strong: true,
                        },
                      ]}
                      note={<span className="italic">Полоса упёрлась в край шкалы: ±100%</span>}
                    />
                  ) : null
                }
              >
                <div className="relative h-2.5 rounded-full bg-panel2">
                  {/* Ноль при двусторонней шкале стоит посередине, и минус
                      растёт влево от него — как и в печатной версии. */}
                  {centered && <span className="absolute inset-y-0 left-1/2 w-px bg-border" />}
                  <div
                    className={`absolute inset-y-0 rounded-full ${tone} ${
                      b.clamped ? "opacity-70" : ""
                    }`}
                    style={{
                      width,
                      ...(centered ? (b.negative ? { right: "50%" } : { left: "50%" }) : { left: 0 }),
                    }}
                  />
                </div>
              </Tooltip>
              <div className="text-xs text-right tabular-nums whitespace-nowrap">
                {b.value === null ? "—" : percent ? formatPct(b.value) : money(b.value, base)}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function BudgetDashboardView({ dashboard: d, base, onOpenRow }: Props) {
  const m = d.monthIndex;
  const monthName = MONTHS[m].toLowerCase();
  const e = d.expense;
  const i = d.income;

  // Раздел выбирается переключателем: расход и доход на одной диаграмме
  // читались бы как сравнение, хотя это разные стороны бюджета.
  const [picked, setPicked] = useState<DashboardSectionKey>("expense");
  const section: DashboardSection | undefined =
    d.sections.find((s) => s.key === picked) ?? d.sections[0];

  const mFact = (t: typeof e) => atMonth(t.factByMonth, m);
  const mPlan = (t: typeof e) => atMonth(t.planByMonth, m);
  const yFact = (t: typeof e) => ytd(t.factByMonth, m);
  const yPlan = (t: typeof e) => ytd(t.planByMonth, m);

  const rows = section?.rows ?? [];
  const hasPlan = rows.some((r) => r.planByMonth.some((v) => v !== 0));
  const bars = (pick: (r: DashboardRow) => number | null, percent = false) =>
    printBars(
      rows.map((r) => ({ label: r.label, value: pick(r) })),
      percent ? { cap: PCT_CAP } : {}
    );

  const bySign = section?.key !== "transfer";
  const invertSign = section?.key === "expense";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
          // Разница и так считается вместе с переводами: внутри бюджета они
          // гасят друг друга. Второй строки у неё нет, но место под неё
          // держится — иначе плитка стояла бы ниже соседних.
          withTransfers={
            e.hasTransfers || i.hasTransfers
              ? ytd(i.factAllByMonth, m) - ytd(e.factAllByMonth, m)
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Donut
          title={`Выполнение плана — ${monthName}`}
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

      {section && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold text-lg">Статьи</h2>
            <Segmented
              size="sm"
              label="Раздел бюджета"
              value={section.key}
              onChange={setPicked}
              options={d.sections.map((s) => ({ value: s.key, label: s.title }))}
            />
            <span className="text-sm text-muted">Клик по категории — её операции</span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <BarChart
              title="Факт — месяц"
              rows={rows}
              bars={bars((r) => atMonth(r.factByMonth, m))}
              base={base}
              onOpenRow={onOpenRow}
            />
            {hasPlan && (
              <BarChart
                title="План — месяц"
                rows={rows}
                bars={bars((r) => atMonth(r.planByMonth, m))}
                base={base}
                onOpenRow={onOpenRow}
              />
            )}
            <BarChart
              title="Факт — с начала года"
              rows={rows}
              bars={bars((r) => ytd(r.factByMonth, m))}
              base={base}
              onOpenRow={onOpenRow}
            />
            {hasPlan && (
              <BarChart
                title="Отклонение от плана — с начала года"
                rows={rows}
                bars={bars((r) =>
                  variance(ytd(r.factByMonth, m), ytd(r.planByMonth, m), r.kind)
                )}
                base={base}
                bySign={bySign}
                invertSign={false}
                onOpenRow={onOpenRow}
              />
            )}
            <BarChart
              title="Рост к прошлому месяцу"
              rows={rows}
              bars={bars(
                (r) =>
                  growth(atMonth(r.factByMonth, m), prevMonth(r.factByMonth, r.prevFactByMonth, m)),
                true
              )}
              base={base}
              percent
              bySign={bySign}
              invertSign={invertSign}
              onOpenRow={onOpenRow}
            />
            <BarChart
              title="Рост к прошлому году"
              rows={rows}
              bars={bars((r) => growth(ytd(r.factByMonth, m), ytd(r.prevFactByMonth, m)), true)}
              base={base}
              percent
              bySign={bySign}
              invertSign={invertSign}
              onOpenRow={onOpenRow}
            />
          </div>
        </div>
      )}
    </div>
  );
}
