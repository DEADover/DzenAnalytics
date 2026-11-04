import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import logoDa from "../../assets/logo-da.png";
import type { PeriodReport } from "../../hooks/usePeriodReport";
import { currencySymbol, formatDate, formatMoney, formatPct, monthTitle, niceStep } from "../../lib/format";
import { describeObservation } from "../../lib/observationTile";
import { spanDays } from "../../lib/period";
import { changeOf, packSections, rangeText, tableRows, type ReportBucket, type ReportCategory } from "../../lib/periodReport";
import { pluralRu } from "../../lib/plural";

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

const SHORT_MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
/** Промежуток между блоками на листе — как `gap` у `.pr-page`. */
const SECTION_GAP = 22;
/** Ширина содержимого листа: 794 минус поля по 48. */
const CONTENT_W = 698;

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

const VS = "к прошлому периоду";

/** «+12% к прошлому периоду» с цветом по смыслу: `upIsGood` — рост к лучшему. */
function Delta({ now, prev, upIsGood }: { now: number; prev: number | null | undefined; upIsGood: boolean }) {
  const ch = changeOf(now, prev);
  if (ch === null) return <span className="pr-delta">{prev === 0 && now !== 0 ? "В прошлом периоде не было" : "—"}</span>;
  if (Math.abs(ch) < 0.005) return <span className="pr-delta">Как в прошлом периоде</span>;
  const good = ch > 0 === upIsGood;
  return (
    <span className="pr-delta">
      <b className={good ? "pr-good" : "pr-bad"}>
        {ch > 0 ? "+" : "−"}
        {formatPct(Math.abs(ch), 0)}
      </b>{" "}
      {VS}
    </span>
  );
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
  const H = 236;
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
          <line className={v === 0 ? "pr-zero" : "pr-grid"} x1={left} x2={W} y1={y(v)} y2={y(v)} />
          <text className="pr-axis" x={left - 8} y={y(v) + 3} textAnchor="end">
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
              <text className="pr-axis" x={x} y={H - 6} textAnchor="middle">
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
            <g className="pr-tip" transform={`translate(${tipX}, ${top})`}>
              <rect width={tipW} height={66} rx={6} />
              <text x={10} y={16}>{bucketTitle(b, bucket)}</text>
              <text x={10} y={31}>Доходы {money(b.income, base)}</text>
              <text x={10} y={45}>Расходы {money(b.expense, base)}</text>
              <text x={10} y={59}>
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

function Cover({ report }: { report: PeriodReport }) {
  const { totals: t, prevTotals: p, base } = report;
  return (
    <>
      <div>
        <div className="pr-eyebrow">Отчёт за период</div>
        <h1 className="pr-title">{report.title}</h1>
        <div className="pr-dates">
          {report.title !== report.dates && report.dates}
          {report.running && `${report.title !== report.dates ? " · " : ""}период идёт, данные по ${formatDate(report.lastDay, "full")}`}
        </div>
        {report.prevRange && <div className="pr-sub">Сравнение — с {rangeText(report.prevRange)}</div>}
        {report.filters.length > 0 && (
          <div className="pr-filters">
            {report.filters.map((f) => (
              <span key={f} className="pr-chip">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pr-kpis">
        <div className="pr-kpi">
          <span className="pr-kpi-label">Доходы</span>
          <span className="pr-kpi-value pr-income">{money(t.income, base)}</span>
          {p && <Delta now={t.income} prev={p.income} upIsGood />}
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Расходы</span>
          <span className="pr-kpi-value pr-expense">{money(t.expense, base)}</span>
          {p && <Delta now={t.expense} prev={p.expense} upIsGood={false} />}
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Чистый поток</span>
          <span className="pr-kpi-value">{money(t.net, base, true)}</span>
          {p && (
            <span className="pr-delta">
              {Math.abs(p.net - t.net) < 0.5 ? (
                "Как в прошлом периоде"
              ) : (
                <>
                  <b className={t.net > p.net ? "pr-good" : "pr-bad"}>{money(t.net - p.net, base, true)}</b> {VS}
                </>
              )}
            </span>
          )}
        </div>
        <div className="pr-kpi">
          <span className="pr-kpi-label">Норма сбережений</span>
          <span className="pr-kpi-value">{t.rate === null ? "—" : formatPct(t.rate, 0)}</span>
          {p && t.rate !== null && p.rate !== null && (
            <span className="pr-delta">
              <b className={t.rate >= p.rate ? "pr-good" : "pr-bad"}>
                {t.rate >= p.rate ? "+" : "−"}
                {Math.abs(Math.round((t.rate - p.rate) * 100))} п. п.
              </b>{" "}
              {VS}
            </span>
          )}
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

function PayeesIncome({ report }: { report: PeriodReport }) {
  const { base } = report;
  return (
    <div className="pr-cols">
      <div>
        <h3 className="pr-h3">Где тратили</h3>
        {report.payees.length > 0 ? (
          <table className="pr-table">
            <thead>
              <tr>
                <th>Получатель</th>
                <th className="pr-num">Покупок</th>
                <th className="pr-num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {report.payees.map((p) => (
                <tr key={p.name}>
                  <td className="pr-name">{p.name}</td>
                  <td className="pr-num pr-muted">{p.count}</td>
                  <td className="pr-num">{money(p.total, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pr-empty">Нет трат с получателем.</p>
        )}
      </div>
      <div>
        <h3 className="pr-h3">Откуда пришли деньги</h3>
        {report.incomeCategories.length > 0 ? (
          <table className="pr-table">
            <thead>
              <tr>
                <th>Категория</th>
                <th className="pr-num">Доля</th>
                <th className="pr-num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {report.incomeCategories.map((c) => (
                <tr key={c.name}>
                  <td className="pr-name">
                    <i className="pr-dot" style={{ background: c.color, display: "inline-block", marginRight: 8 }} />
                    {c.name}
                  </td>
                  <td className="pr-num pr-muted">{formatPct(c.share, 0)}</td>
                  <td className="pr-num">{money(c.total, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pr-empty">Доходов за период нет.</p>
        )}
      </div>
    </div>
  );
}

function Operations({ report }: { report: PeriodReport }) {
  return (
    <>
      <h3 className="pr-h3">Крупные траты</h3>
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
              <td className="pr-name" style={{ width: "40%" }}>
                {o.payee || "Без получателя"}
              </td>
              <td className="pr-name pr-muted" style={{ width: "35%" }}>
                {o.category}
              </td>
              <td className="pr-num">{money(o.amount, report.base)}</td>
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

/** Сколько статей бюджета на листе. */
const BUDGET_MAX = 10;

function Budget({ report }: { report: PeriodReport }) {
  const { base } = report;
  const budget = report.budget!;
  const rows = budget.rows.slice(0, BUDGET_MAX);
  const months =
    budget.months.length === 1
      ? monthTitle(budget.months[0])
      : `${monthTitle(budget.months[0])} — ${monthTitle(budget.months[budget.months.length - 1])}`;
  return (
    <>
      <div>
        <h2 className="pr-h2">Бюджет</h2>
        <p className="pr-sub">
          {months} · план и факт по правилам раздела «Бюджеты»
          {report.running ? ", факт идущего месяца — на сегодня" : ""}
        </p>
      </div>
      <div className="pr-budget-sum">
        {budget.plan.expense > 0 && (
          <div className="pr-kpi">
            <span className="pr-kpi-label">Расходы по статьям с планом</span>
            <span className="pr-kpi-value">{formatPct(budget.plannedFact / budget.plan.expense, 0)}</span>
            <span className="pr-delta">
              {money(budget.plannedFact, base)} из {money(budget.plan.expense, base)}
            </span>
          </div>
        )}
        {budget.plan.expense > 0 && (
          <div className="pr-kpi">
            <span className="pr-kpi-label">Траты вне плана</span>
            <span className="pr-kpi-value">{money(budget.unplanned, base)}</span>
            <span className="pr-delta">В статьях, где плана нет</span>
          </div>
        )}
        {budget.plan.income > 0 && (
          <div className="pr-kpi">
            <span className="pr-kpi-label">Доходы: факт из плана</span>
            <span className="pr-kpi-value">{formatPct(budget.fact.income / budget.plan.income, 0)}</span>
            <span className="pr-delta">
              {money(budget.fact.income, base)} из {money(budget.plan.income, base)}
            </span>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="pr-bars">
          {rows.map((r) => {
            const scale = Math.max(r.plan, r.fact, 1);
            const over = r.fact > r.plan;
            return (
              <div key={r.category} className="pr-plan">
                <span className="pr-bar-name">
                  <span>{r.category}</span>
                </span>
                <span className="pr-plan-track">
                  <span className={clsx("pr-plan-fill", over && "pr-over")} style={{ width: `${(r.fact / scale) * 100}%` }} />
                  <span className="pr-plan-mark" style={{ left: `calc(${(r.plan / scale) * 100}% - 1px)` }} />
                </span>
                <span className="pr-plan-num">
                  <span className={over ? "pr-bad" : undefined}>{money(r.fact, base)}</span>
                  <span className="pr-muted"> из {money(r.plan, base)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
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
            { period: "month", running: report.running ? { day: lived, days: spanDays(report.range.from, report.range.to) } : undefined, days: [] },
            report.base,
            report.isMonth ? undefined : "чем за такой же срок до периода"
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

/** Блоки отчёта по порядку — те, которым есть что показать. */
function sectionsOf(report: PeriodReport): { key: string; node: ReactNode }[] {
  const out: { key: string; node: ReactNode }[] = [
    { key: "cover", node: <Cover report={report} /> },
    { key: "flow", node: <Flow report={report} /> },
    { key: "categories", node: <Categories report={report} /> },
    { key: "payees", node: <PayeesIncome report={report} /> },
  ];
  if (report.operations.length > 0) out.push({ key: "operations", node: <Operations report={report} /> });
  if (tableRows(report).length > 0) out.push({ key: "months", node: <Months report={report} /> });
  if (report.accounts.length > 0) out.push({ key: "accounts", node: <Accounts report={report} /> });
  if (report.budget) out.push({ key: "budget", node: <Budget report={report} /> });
  if (report.observations.length > 0) out.push({ key: "observations", node: <Observations report={report} /> });
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
