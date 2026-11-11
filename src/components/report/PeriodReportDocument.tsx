import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MONTHS_SHORT } from "../../lib/months";
import clsx from "clsx";
import logoDa from "../../assets/logo-da.png";
import type { PeriodReport } from "../../hooks/usePeriodReport";
import { currencySymbol, formatDate, formatMoney, formatPct, monthTitle, niceStep, truncateWords } from "../../lib/format";
import { describeObservation } from "../../lib/observationTile";
import { compareNote, deltaNote, deltaTone, netTone, type NoteTone } from "../../lib/digestNotes";
import { spanDays } from "../../lib/period";
import { changeOf, packSections, tableRows, type ReportBucket, type ReportCategory } from "../../lib/periodReport";
import { pluralRu } from "../../lib/plural";
import { reportCompareNote, reportDatesNote, reportHeadline } from "../../lib/periodReportText";

/**
 * «Отчёт за период» — листы A4 одним документом.
 *
 * Та же разметка идёт в превью на странице, в PDF (снимок каждого `.pr-page`)
 * и в HTML-файл (разметка как есть плюс `PERIOD_REPORT_CSS`). Поэтому здесь
 * только простые элементы и свои классы `pr-`: ни Tailwind, ни библиотеки
 * графиков — в файле, открытом без сервиса, их не будет. Графики — обычный
 * SVG; подсказка у столбца — CSS по наведению, без скриптов.
 *
 * Листы раскладываются по месту: блоки сначала измеряются в невидимом
 * черновике, потом идут на листы по порядку — блок, который не влез, целиком
 * переходит на следующий (`packSections`). Жёсткий состав листов оставлял
 * пустоту: у месяца по дням таблицы по месяцам нет, и лист с ней пустовал.
 */

const SHORT_MONTHS = MONTHS_SHORT;
/** Промежуток между блоками на листе — как `gap` у `.pr-page`. */
const SECTION_GAP = 22;
/** Ширина содержимого листа: 794 минус поля по 48. */
const CONTENT_W = 698;

/*
 * Оформление графиков — атрибутами SVG, а не классами: снимок для PDF
 * копирует SVG целиком как есть, и стили из классов внутри него теряются —
 * подписи осей выходили крупными и чёрными, а все подсказки разом ложились на
 * график чёрной плашкой. Наведение в HTML-файле работает по-прежнему: правило
 * CSS сильнее атрибута и проявляет подсказку (`.pr-col:hover .pr-tip`).
 */
const AXIS_TEXT = { fontSize: 9.5, fill: "#9aa1ad" } as const;
const TIP_TEXT = { fontSize: 10, fontWeight: 600, fill: "#ffffff" } as const;
function gridLine(zero: boolean) {
  return { stroke: zero ? "#cfd4dc" : "#e5e7eb", strokeWidth: 1 } as const;
}

/** Накопленная сумма по порядку: 1, 2, 3 → 1, 3, 6. */
function cumulative(xs: number[]): number[] {
  const out: number[] = [];
  xs.reduce((acc, x) => {
    const next = acc + x;
    out.push(next);
    return next;
  }, 0);
  return out;
}

function money(v: number, base: string, signed = false): string {
  return formatMoney(v, base, { decimals: 0, signed });
}

function PageHead() {
  return (
    <header className="pr-head">
      <span className="pr-brand">
        <img src={logoDa} alt="" />
        DzenAnalytics
      </span>
      <span>Отчёт за период</span>
    </header>
  );
}

function PageFoot({ n, total, generated }: { n: number; total: number; generated: string }) {
  return (
    <footer className="pr-foot">
      <span>Составлено в DzenAnalytics · {generated}</span>
      <span>
        {n} / {total}
      </span>
    </footer>
  );
}

/**
 * Подпись столбца на оси. У месяцев год ставится у первой подписи и там, где
 * он сменился с прошлой показанной: при подписи через несколько месяцев
 * январь на оси может и не попасться.
 */
function bucketLabel(b: ReportBucket, prevShown: ReportBucket | null, kind: "month" | "day"): string {
  if (kind === "day") return String(Number(b.key.slice(8, 10)));
  const m = Number(b.key.slice(5, 7)) - 1;
  const newYear = !prevShown || prevShown.key.slice(0, 4) !== b.key.slice(0, 4);
  return newYear ? `${SHORT_MONTHS[m]} ${b.key.slice(2, 4)}` : SHORT_MONTHS[m];
}

function bucketTitle(b: ReportBucket, kind: "month" | "day"): string {
  return kind === "day" ? formatDate(b.key, "full") : monthTitle(b.key);
}

/**
 * Доходы и расходы столбиками, линия — чистый поток месяца, а у разбивки по
 * дням — итог с начала периода: дневной поток скачет от зарплаты к нулю и
 * ничего не говорит, а накопленный показывает, куда идёт период.
 */
function CashflowChart({ report }: { report: PeriodReport }) {
  const { buckets, bucket, base } = report;
  const W = CONTENT_W;
  // У недели семь столбиков — им хватит и меньшей высоты; лист не пустеет.
  const H = report.isMonth || report.bucket === "month" ? 236 : 168;
  const left = 56;
  const top = 10;
  const bottom = H - 24;
  const plotW = W - left;
  const line = bucket === "day" ? cumulative(buckets.map((b) => b.net)) : buckets.map((b) => b.net);
  const vals = [...buckets.flatMap((b) => [b.income, b.expense]), ...line];
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const step = niceStep((max - min) / 4);
  const hi = Math.ceil(max / step) * step;
  const lo = Math.floor(min / step) * step;
  const y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * (bottom - top);
  const n = buckets.length;
  const slot = plotW / Math.max(1, n);
  const bw = Math.max(2, Math.min(16, slot * 0.34));
  const labelEvery = Math.max(1, Math.ceil(n / (bucket === "day" ? 16 : 14)));
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const cx = (i: number) => left + slot * i + slot / 2;
  const linePath = line.map((v, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="pr-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Доходы и расходы">
      {ticks.map((v) => (
        <g key={v}>
          <line {...gridLine(v === 0)} x1={left} x2={W} y1={y(v)} y2={y(v)} />
          <text {...AXIS_TEXT} x={left - 8} y={y(v) + 3} textAnchor="end">
            {formatMoney(v, base, { compact: true })}
          </text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x = cx(i);
        return (
          <g key={b.key}>
            <rect x={x - bw - 1} y={y(Math.max(0, b.income))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, b.income)))} rx={Math.min(3, bw / 2)} fill="#16a34a" />
            <rect x={x + 1} y={y(Math.max(0, b.expense))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, b.expense)))} rx={Math.min(3, bw / 2)} fill="#dc2626" fillOpacity={0.85} />
            {i % labelEvery === 0 && (
              <text {...AXIS_TEXT} x={x} y={H - 6} textAnchor="middle">
                {bucketLabel(b, i >= labelEvery ? buckets[i - labelEvery] : null, bucket)}
              </text>
            )}
          </g>
        );
      })}
      {n > 1 && <path d={linePath} fill="none" stroke="#0891b2" strokeWidth={2} strokeLinejoin="round" />}
      {line.map((v, i) => (
        <circle key={buckets[i].key} cx={cx(i)} cy={y(v)} r={n > 31 ? 1.6 : 2.6} fill="#0891b2" />
      ))}
      {/* Подсказки — поверх всего, чтобы столбцы соседей их не перекрывали. */}
      {buckets.map((b, i) => {
        const x = cx(i);
        const tipW = 168;
        const tipX = Math.min(Math.max(x - tipW / 2, left), W - tipW);
        return (
          <g key={b.key} className="pr-col">
            <rect className="pr-hit" x={left + slot * i} y={top} width={slot} height={bottom - top} fill="transparent" />
            <g className="pr-tip" opacity={0} transform={`translate(${tipX}, ${top})`}>
              <rect width={tipW} height={66} rx={6} fill="#12161d" />
              <text {...TIP_TEXT} x={10} y={16}>{bucketTitle(b, bucket)}</text>
              <text {...TIP_TEXT} x={10} y={31}>Доходы {money(b.income, base)}</text>
              <text {...TIP_TEXT} x={10} y={45}>Расходы {money(b.expense, base)}</text>
              <text {...TIP_TEXT} x={10} y={59}>
                {bucket === "day" ? "С начала периода" : "Чистый поток"} {money(line[i], base, true)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function DeltaShort({ now, prev, upIsGood }: { now: number; prev: number | null; upIsGood: boolean }) {
  if (prev === null) return null;
  if (prev === 0) return <span className="pr-muted">новое</span>;
  const ch = now / prev - 1;
  if (Math.abs(ch) < 0.005) return <span className="pr-muted">0%</span>;
  return (
    <span className={ch > 0 === upIsGood ? "pr-good" : "pr-bad"}>
      {ch > 0 ? "+" : "−"}
      {formatPct(Math.abs(ch), 0)}
    </span>
  );
}

function CategoryBars({ rows, base, upIsGood }: { rows: ReportCategory[]; base: string; upIsGood: boolean }) {
  const maxShare = Math.max(...rows.map((r) => r.share), 0.0001);
  return (
    <div className="pr-bars">
      {rows.map((r) => (
        <div key={r.name} className="pr-bar-row">
          <span className="pr-bar-name">
            <i className="pr-dot" style={{ background: r.color }} />
            <span>{r.name}</span>
          </span>
          <span className="pr-track">
            <span className="pr-fill" style={{ display: "block", width: `${(r.share / maxShare) * 100}%`, background: r.color }} />
          </span>
          <span className="pr-bar-num">{money(r.total, base)}</span>
          <span className="pr-bar-share">{formatPct(r.share, 0)}</span>
          <span className="pr-bar-delta">
            <DeltaShort now={r.total} prev={r.prev} upIsGood={upIsGood} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** «Обычно 210 000 ₽» — среднее за прошлые такие же периоды. */
function Typical({ report, value }: { report: PeriodReport; value: number | undefined }) {
  if (value === undefined || !report.typical) return null;
  return (
    <span className="pr-typ">
      Обычно {money(value, report.base)}
    </span>
  );
}

/** Подпись под числом плитки — цветом по смыслу, как в «Дайджесте». */
function Note({ text, tone }: { text: string | undefined; tone: NoteTone }) {
  if (!text) return null;
  return <span className={clsx("pr-delta", tone === "good" && "pr-good", tone === "bad" && "pr-bad")}>{text}</span>;
}

function Cover({ report }: { report: PeriodReport }) {
  const { totals: t, prevTotals: p, base } = report;
  const incDelta = changeOf(t.income, p?.income) ?? 0;
  const expDelta = changeOf(t.expense, p?.expense) ?? 0;
  return (
    <>
      <div>
        <div className="pr-eyebrow">Отчёт за период</div>
        <h1 className="pr-title">{report.title}</h1>
        <div className="pr-dates">{reportDatesNote(report)}</div>
        {(report.prevRange || report.typical) && <div className="pr-sub">{reportCompareNote(report)}</div>}
        <p className="pr-lead" data-report-headline>
          {reportHeadline(report)}
        </p>
      </div>

      <div className="pr-kpis">
        <div className="pr-kpi">
          <span className="pr-kpi-label">Доходы</span>
          <span className="pr-kpi-value pr-income">{money(t.income, base)}</span>
          <Note text={compareNote(t.income, report.typical?.income, incDelta, report.running)} tone={deltaTone(incDelta, true)} />
          <Typical report={report} value={report.typical?.income} />
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Расходы</span>
          <span className="pr-kpi-value pr-expense">{money(t.expense, base)}</span>
          <Note text={compareNote(t.expense, report.typical?.expense, expDelta, report.running)} tone={deltaTone(expDelta, false)} />
          <Typical report={report} value={report.typical?.expense} />
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Чистый поток</span>
          <span className={clsx("pr-kpi-value", t.net >= 0 ? "pr-income" : "pr-expense")}>{money(t.net, base, true)}</span>
          <Note
            text={
              report.typical
                ? `Обычно${report.running ? " к этому дню" : ""} ${money(report.typical.net, base, true)}`
                : deltaNote(p && Math.abs(p.net) > 0.01 ? (t.net - p.net) / Math.abs(p.net) : 0)
            }
            tone={p ? netTone(t.net, p.net) : "muted"}
          />
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Норма сбережений</span>
          <span
            className={clsx(
              "pr-kpi-value",
              t.income > 0 && (t.rate ?? 0) >= 0.2 ? "pr-income" : (t.rate ?? 0) < 0 ? "pr-expense" : undefined
            )}
          >
            {t.income > 0 && t.rate !== null && t.rate >= -1 ? formatPct(t.rate, 0) : "—"}
          </span>
          <Note
            text={
              t.income > 0 && t.rate !== null && t.rate < -1
                ? "Расход больше дохода"
                : t.income <= 0
                  ? "Доходов не было"
                  : `${t.count} ${pluralRu(t.count, ["операция", "операции", "операций"])}`
            }
            tone="muted"
          />
        </div>
      </div>

      {report.capital && (
        <div className="pr-capital">
          <div className="pr-capital-cell">
            <span>Капитал на {formatDate(report.range.from, "full")}</span>
            <b>{money(report.capital.start, base)}</b>
          </div>
          <span className="pr-arrow">→</span>
          <div className="pr-capital-cell">
            <span>На {formatDate(report.lastDay, "full")}</span>
            <b>{money(report.capital.end, base)}</b>
          </div>
          <div className="pr-capital-cell pr-capital-delta">
            <span>Изменение</span>
            <b className={report.capital.end >= report.capital.start ? "pr-good" : "pr-bad"}>
              {money(report.capital.end - report.capital.start, base, true)}
            </b>
          </div>
        </div>
      )}
    </>
  );
}

function Flow({ report }: { report: PeriodReport }) {
  const { totals: t, base } = report;
  const months = report.bucket === "month" ? report.buckets.length : 0;
  return (
    <>
      <div>
        <h2 className="pr-h2">Движение денег</h2>
        <p className="pr-sub">
          {report.bucket === "day" ? "По дням" : "По отчётным месяцам"} · {t.count} {pluralRu(t.count, ["операция", "операции", "операций"])}
          {months > 1 && ` · в среднем за месяц доходы ${money(t.income / months, base)}, расходы ${money(t.expense / months, base)}`}
        </p>
      </div>
      <div className="pr-legend">
        <span>
          <i style={{ background: "#16a34a" }} />
          Доходы
        </span>
        <span>
          <i style={{ background: "#dc2626" }} />
          Расходы
        </span>
        <span>
          <i className="pr-line-mark" style={{ background: "#0891b2" }} />
          {report.bucket === "day" ? "Итог с начала периода" : "Чистый поток"}
        </span>
      </div>
      <CashflowChart report={report} />
    </>
  );
}

function Categories({ report }: { report: PeriodReport }) {
  return (
    <>
      <div>
        <h2 className="pr-h2">Куда ушли деньги</h2>
        <p className="pr-sub">
          Расходы по категориям вместе с подкатегориями, доля от всех трат
          {report.prevTotals ? " и изменение к прошлому периоду" : ""}
        </p>
      </div>
      {report.expenseCategories.length > 0 ? (
        <CategoryBars rows={report.expenseCategories} base={report.base} upIsGood={false} />
      ) : (
        <p className="pr-empty">Расходов за период нет.</p>
      )}
    </>
  );
}

function PayeeTable({ rows, base, empty }: { rows: PeriodReport["payees"]; base: string; empty: string }) {
  if (rows.length === 0) return <p className="pr-empty">{empty}</p>;
  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th>Получатель</th>
          <th className="pr-num">Покупок</th>
          <th className="pr-num">Сумма</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.name}>
            <td className="pr-name">{p.name}</td>
            <td className="pr-num pr-muted">{p.count}</td>
            <td className="pr-num">{money(p.total, base)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** «Где тратили» и «Впервые» — рядом, как в «Дайджесте». */
function PayeesNew({ report }: { report: PeriodReport }) {
  return (
    <div className="pr-cols">
      <div>
        <h3 className="pr-h3">Где тратили</h3>
        <PayeeTable rows={report.payees} base={report.base} empty="Трат с получателем не было" />
      </div>
      <div>
        <h3 className="pr-h3">Впервые</h3>
        <PayeeTable rows={report.newPayees} base={report.base} empty="Новых получателей не было" />
      </div>
    </div>
  );
}

function Income({ report }: { report: PeriodReport }) {
  return (
    <>
      <div>
        <h2 className="pr-h2">Откуда пришли деньги</h2>
        <p className="pr-sub">Доходы по категориям, доля от всех поступлений{report.prevTotals ? " и изменение к прошлому периоду" : ""}</p>
      </div>
      <CategoryBars rows={report.incomeCategories} base={report.base} upIsGood />
    </>
  );
}

function Operations({ report }: { report: PeriodReport }) {
  return (
    <>
      <h2 className="pr-h2">Самое дорогое за период</h2>
      <table className="pr-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Получатель</th>
            <th>Категория</th>
            <th className="pr-num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {report.operations.map((o) => (
            <tr key={o.id}>
              <td className="pr-date">{formatDate(o.date, "full")}</td>
              <td className="pr-name" style={{ width: "45%" }}>
                {o.payee || o.category || "—"}
                {o.comment.trim() && <span className="pr-comment">{truncateWords(o.comment, 140)}</span>}
              </td>
              <td className="pr-name pr-muted" style={{ width: "30%" }}>
                {o.category}
              </td>
              <td className="pr-num pr-bad">{money(o.amount, report.base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Months({ report }: { report: PeriodReport }) {
  const { base } = report;
  const rows = tableRows(report);
  const years = rows[0]?.kind === "year";
  return (
    <>
      <h2 className="pr-h2">{years ? "По годам" : "По месяцам"}</h2>
      <table className="pr-table">
        <thead>
          <tr>
            <th>{years ? "Год" : "Месяц"}</th>
            <th className="pr-num">Доходы</th>
            <th className="pr-num">Расходы</th>
            <th className="pr-num">Чистый поток</th>
            <th className="pr-num">Сбережения</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="pr-name">{years ? r.key : monthTitle(r.key)}</td>
              <td className="pr-num pr-good">{money(r.income, base)}</td>
              <td className="pr-num pr-bad">{money(r.expense, base)}</td>
              <td className="pr-num">{money(r.net, base, true)}</td>
              <td className="pr-num pr-muted">{r.income > 0 ? formatPct(r.net / r.income, 0) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Итого</td>
            <td className="pr-num">{money(report.totals.income, base)}</td>
            <td className="pr-num">{money(report.totals.expense, base)}</td>
            <td className="pr-num">{money(report.totals.net, base, true)}</td>
            <td className="pr-num">{report.totals.rate === null ? "—" : formatPct(report.totals.rate, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

/** Сколько счетов в таблице; остальные — одной строкой. */
const ACCOUNTS_MAX = 12;

function Accounts({ report }: { report: PeriodReport }) {
  const { base } = report;
  const shown = report.accounts.slice(0, ACCOUNTS_MAX);
  const rest = report.accounts.slice(ACCOUNTS_MAX);
  const sum = (f: (a: (typeof rest)[number]) => number) => rest.reduce((s, a) => s + f(a), 0);
  return (
    <>
      <div>
        <h2 className="pr-h2">Счета</h2>
        <p className="pr-sub">Остаток на начало и конец периода в {currencySymbol(base)}, по курсу дня</p>
      </div>
      <table className="pr-table">
        <thead>
          <tr>
            <th>Счёт</th>
            <th className="pr-num">На {formatDate(report.range.from, "full")}</th>
            <th className="pr-num">На {formatDate(report.lastDay, "full")}</th>
            <th className="pr-num">Изменение</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => {
            const d = a.end - a.start;
            return (
              <tr key={a.key}>
                <td className="pr-name">{a.label}</td>
                <td className="pr-num pr-muted">{money(a.start, base)}</td>
                <td className="pr-num">{money(a.end, base)}</td>
                <td className={clsx("pr-num", d > 0.5 ? "pr-good" : d < -0.5 ? "pr-bad" : "pr-muted")}>
                  {Math.abs(d) < 0.5 ? "—" : money(d, base, true)}
                </td>
              </tr>
            );
          })}
          {rest.length > 0 && (
            <tr>
              <td className="pr-name pr-muted">
                Ещё {rest.length} {pluralRu(rest.length, ["счёт", "счёта", "счетов"])}
              </td>
              <td className="pr-num pr-muted">{money(sum((a) => a.start), base)}</td>
              <td className="pr-num">{money(sum((a) => a.end), base)}</td>
              <td className="pr-num pr-muted">{money(sum((a) => a.end - a.start), base, true)}</td>
            </tr>
          )}
        </tbody>
        {report.capital && (
          <tfoot>
            <tr>
              <td>Капитал</td>
              <td className="pr-num">{money(report.capital.start, base)}</td>
              <td className="pr-num">{money(report.capital.end, base)}</td>
              <td className="pr-num">{money(report.capital.end - report.capital.start, base, true)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </>
  );
}

/** Сколько статей бюджета на листе; остальные — одной строкой. */
const BUDGET_MAX = 14;

/** «82 %» — доля факта в плане; плана нет — пусто. */
const ofPlan = (fact: number, plan: number) => (plan > 0 ? formatPct(fact / plan, 0) : "");

function Budget({ report }: { report: PeriodReport }) {
  const { base } = report;
  const budget = report.budget!;
  const shown = budget.rows.slice(0, BUDGET_MAX);
  const rest = budget.rows.slice(BUDGET_MAX);
  const restPlan = rest.reduce((s, r) => s + r.plan, 0);
  const restFact = rest.reduce((s, r) => s + r.fact, 0);
  const card = (label: string, fact: number, plan: number, signed = false) => (
    <div className="pr-kpi">
      <span className="pr-kpi-label">{label}</span>
      <span className="pr-kpi-value">{money(fact, base, signed)}</span>
      <span className="pr-delta">
        {signed ? `План ${money(plan, base, true)}` : `из ${money(plan, base)}${plan > 0 ? ` · ${ofPlan(fact, plan)}` : ""}`}
      </span>
    </div>
  );
  const plain = (name: string, fact: number, key: string) => (
    <div key={key} className="pr-plan">
      <span className="pr-bar-name pr-muted">
        <span>{name}</span>
      </span>
      <span />
      <span className="pr-plan-num">{money(fact, base)}</span>
    </div>
  );
  return (
    <>
      <div>
        <h2 className="pr-h2">Бюджет</h2>
        <p className="pr-sub">
          {monthTitle(budget.month)} · план и факт — как в разделе «Бюджеты»
          {report.running ? ", факт идущего месяца — на сегодня" : ""}
        </p>
      </div>
      <div className="pr-budget-sum">
        {card(budget.incomeTitle, budget.income.fact, budget.income.plan)}
        {card("Расходы", budget.expense.fact, budget.expense.plan)}
        {card("Разница", budget.delta.fact, budget.delta.plan, true)}
      </div>
      <div className="pr-bars">
        {shown.map((r) => {
          const scale = Math.max(r.plan, r.fact, 1);
          const over = r.fact > r.plan;
          return (
            <div key={r.category} className="pr-plan">
              <span className="pr-bar-name">
                <span>{r.category}</span>
              </span>
              <span className="pr-plan-track">
                <span className={clsx("pr-plan-fill", over && "pr-over")} style={{ width: `${(r.fact / scale) * 100}%` }} />
                <span className="pr-plan-mark" style={{ left: `calc(${(Math.max(r.plan, 0) / scale) * 100}% - 1px)` }} />
              </span>
              <span className="pr-plan-num">
                <span className={over ? "pr-bad" : undefined}>{money(r.fact, base)}</span>
                <span className="pr-muted"> из {money(r.plan, base)}</span>
              </span>
            </div>
          );
        })}
        {rest.length > 0 && (
          <div className="pr-plan">
            <span className="pr-bar-name pr-muted">
              <span>
                Ещё {rest.length} {pluralRu(rest.length, ["статья", "статьи", "статей"])}
              </span>
            </span>
            <span />
            <span className="pr-plan-num">
              {money(restFact, base)}
              <span className="pr-muted"> из {money(restPlan, base)}</span>
            </span>
          </div>
        )}
        {Math.abs(budget.unplanned) >= 0.5 && plain("Вне плана", budget.unplanned, "unplanned")}
        {budget.groups.map((g) => plain(g.category, g.fact, `group:${g.category}`))}
      </div>
    </>
  );
}

function Observations({ report }: { report: PeriodReport }) {
  const lived = spanDays(report.range.from, report.lastDay);
  return (
    <>
      <div>
        <h2 className="pr-h2">Наблюдения</h2>
        <p className="pr-sub">То, что не видно в итогах</p>
      </div>
      <div className="pr-obs">
        {report.observations.map((o) => {
          const tile = describeObservation(
            o,
            {
              period: report.isMonth ? "month" : "week",
              running: report.running ? { day: lived, days: spanDays(report.range.from, report.range.to) } : undefined,
              days: [],
            },
            report.base
          );
          const Icon = tile.icon;
          return (
            <div key={o.id} className="pr-ob">
              <span className="pr-ob-label">
                <Icon aria-hidden />
                {tile.label}
              </span>
              <span className={clsx("pr-ob-value", tile.tone === "good" && "pr-good", tile.tone === "bad" && "pr-bad")}>{tile.value}</span>
              <span className="pr-ob-text">{tile.text}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Расход по дням столбиками; самый дорогой день — темнее. */
function DaysChart({ report }: { report: PeriodReport }) {
  const { series, biggest } = report.days;
  const W = CONTENT_W;
  const H = 110;
  const left = 56;
  const bottom = H - 4;
  const max = Math.max(1, ...series.map((d) => d.expense));
  const step = niceStep(max / 2);
  const hi = Math.ceil(max / step) * step;
  const y = (v: number) => 6 + ((hi - v) / hi) * (bottom - 6);
  const slot = (W - left) / Math.max(1, series.length);
  const bw = Math.max(1, slot * 0.7);
  return (
    <svg className="pr-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Траты по дням">
      {[0, step, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <g key={v}>
          <line {...gridLine(v === 0)} x1={left} x2={W} y1={y(v)} y2={y(v)} />
          <text {...AXIS_TEXT} x={left - 8} y={y(v) + 3} textAnchor="end">
            {formatMoney(v, report.base, { compact: true })}
          </text>
        </g>
      ))}
      {series.map((d, i) =>
        d.expense > 0 ? (
          <rect
            key={d.date}
            x={left + slot * i + (slot - bw) / 2}
            y={y(d.expense)}
            width={bw}
            height={Math.max(0.5, y(0) - y(d.expense))}
            fill={d.date === biggest?.date ? "#b91c1c" : "#dc2626"}
            fillOpacity={d.date === biggest?.date ? 1 : 0.55}
          />
        ) : null
      )}
    </svg>
  );
}

/** Сколько дней в графике трат по дням — длиннее он превращается в штриховку. */
const DAYS_CHART_MAX = 400;

function Days({ report }: { report: PeriodReport }) {
  const { days, base } = report;
  return (
    <>
      <div>
        <h2 className="pr-h2">Траты по дням</h2>
        <p className="pr-sub">
          {report.running ? "Прожитые дни периода" : "Все дни периода"} — {days.lived} {pluralRu(days.lived, ["день", "дня", "дней"])}
        </p>
      </div>
      <div className="pr-stats">
        <div className="pr-kpi">
          <span className="pr-kpi-label">Дней без трат</span>
          <span className="pr-stat-value">
            {days.noSpend} из {days.lived}
          </span>
          <span className="pr-delta">{formatPct(days.lived ? days.noSpend / days.lived : 0, 0)} дней периода</span>
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Самый дорогой день</span>
          <span className="pr-stat-value">{days.biggest ? money(days.biggest.expense, base) : "—"}</span>
          <span className="pr-delta">{days.biggest ? formatDate(days.biggest.date, "full") : "Трат не было"}</span>
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">В среднем за день</span>
          <span className="pr-stat-value">{money(days.avg, base)}</span>
          <span className="pr-delta">
            {report.typical && report.typical.expense > 0
              ? `Обычно ${money(report.typical.expense / Math.max(1, days.lived), base)}`
              : "Расход, делённый на дни"}
          </span>
        </div>
      </div>
      {/* У недели дни и так видны столбиками в «Движении денег» выше —
          второй такой же график только отнимал бы место. */}
      {report.isMonth || report.bucket === "month"
        ? days.series.length > 0 && days.series.length <= DAYS_CHART_MAX && <DaysChart report={report} />
        : null}
    </>
  );
}

/** «Категории, где «выстрелило»» — как в «Дайджесте»: изменение в рублях, полоса — его величина. */
function Movers({ report }: { report: PeriodReport }) {
  const { base } = report;
  const maxMove = Math.max(...report.movers.map((m) => Math.abs(m.now - m.prev)), 1);
  return (
    <>
      <div>
        <h2 className="pr-h2">Категории, где «выстрелило»</h2>
        <p className="pr-sub">Самые большие изменения против прошлого такого же периода — в рублях</p>
      </div>
      <div className="pr-bars">
        {report.movers.map((m) => {
          const d = m.now - m.prev;
          const up = d > 0;
          return (
            <div key={m.category} className="pr-move-row">
              <span className="pr-bar-name">
                <span>{m.category}</span>
              </span>
              <span className="pr-track">
                <span className="pr-fill" style={{ display: "block", width: `${(Math.abs(d) / maxMove) * 100}%`, background: up ? "#dc2626" : "#16a34a" }} />
              </span>
              <span className="pr-bar-share">{m.prev > 0 ? `${up ? "+" : ""}${formatPct(m.now / m.prev - 1, 0)}` : "—"}</span>
              <span className="pr-muted pr-bar-num" style={{ fontWeight: 400 }}>
                {money(m.prev, base)} → {money(m.now, base)}
              </span>
              <span className={clsx("pr-bar-num", up ? "pr-bad" : "pr-good")}>{money(d, base, true)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Блоки отчёта по порядку — те, которым есть что показать. Сначала всё, что
 * есть на странице «Дайджеста», в его порядке; потом то, чего там нет:
 * категории, доходы, месяцы, счета, бюджет.
 */
function sectionsOf(report: PeriodReport): { key: string; node: ReactNode }[] {
  const out: { key: string; node: ReactNode }[] = [
    { key: "cover", node: <Cover report={report} /> },
    { key: "flow", node: <Flow report={report} /> },
    { key: "days", node: <Days report={report} /> },
  ];
  if (report.observations.length > 0) out.push({ key: "observations", node: <Observations report={report} /> });
  out.push({ key: "payees", node: <PayeesNew report={report} /> });
  if (report.movers.length > 0) out.push({ key: "movers", node: <Movers report={report} /> });
  if (report.operations.length > 0) out.push({ key: "operations", node: <Operations report={report} /> });
  out.push({ key: "categories", node: <Categories report={report} /> });
  if (report.incomeCategories.length > 0) out.push({ key: "income", node: <Income report={report} /> });
  if (tableRows(report).length > 0) out.push({ key: "months", node: <Months report={report} /> });
  if (report.accounts.length > 0) out.push({ key: "accounts", node: <Accounts report={report} /> });
  if (report.budget) out.push({ key: "budget", node: <Budget report={report} /> });
  return out;
}

export function PeriodReportDocument({ report, generated }: { report: PeriodReport; generated: string }) {
  const sections = sectionsOf(report);
  const measureRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ for: PeriodReport; pages: number[][] } | null>(null);
  const ready = layout?.for === report ? layout.pages : null;

  useLayoutEffect(() => {
    if (ready || !measureRef.current || !probeRef.current) return;
    const heights = [...measureRef.current.children].map((el) => (el as HTMLElement).offsetHeight);
    const room = probeRef.current.offsetHeight;
    setLayout({ for: report, pages: packSections(heights, room, SECTION_GAP) });
  }, [ready, report]);

  if (!ready) {
    // Черновик для замеров: настоящий лист с шапкой и подвалом — свободное
    // место между ними и есть высота под блоки — и блоки по ширине листа.
    return (
      <div className="pr-doc" aria-hidden style={{ position: "relative", height: 0, overflow: "hidden", visibility: "hidden" }}>
        <section className="pr-page" style={{ position: "absolute" }}>
          <PageHead />
          <div ref={probeRef} style={{ flex: 1 }} />
          <PageFoot n={1} total={1} generated={generated} />
        </section>
        <div ref={measureRef} style={{ position: "absolute", width: CONTENT_W }}>
          {sections.map((s) => (
            <div key={s.key} className="pr-section">
              {s.node}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pr-doc">
      {ready.map((idx, p) => (
        <section key={p} className="pr-page print-page print-portrait" data-report-page={p + 1}>
          <PageHead />
          {idx.map((i) => (
            <div key={sections[i].key} className="pr-section" data-report-section={sections[i].key}>
              {sections[i].node}
            </div>
          ))}
          <PageFoot n={p + 1} total={ready.length} generated={generated} />
        </section>
      ))}
    </div>
  );
}
