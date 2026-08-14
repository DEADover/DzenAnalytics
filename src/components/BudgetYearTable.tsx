import { Fragment, useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import {
  hasTransfers,
  yearDiff,
  type BudgetYearReport,
  type YearCell,
  type YearRow,
  type YearSection,
} from "../lib/budgetYear";
import type { BudgetKind } from "../lib/budgets";
import { formatMoney, formatNum, monthLabel, monthLabelFull } from "../lib/format";
import { AccountLogo } from "./AccountLogo";
import { CategoryDot } from "./CategoryDot";
import { TRANSFER_CATEGORY } from "../lib/budgetScope";
import { Tooltip } from "./Tooltip";

/** Три колонки на месяц плюс столько же на год — их и заполняем. */
const SUB_COLUMNS = ["План", "Факт", "Разница"] as const;

/** Левый край месячной тройки: сама черта и отступ, отодвигающий её от чисел
 *  предыдущего месяца. Один класс на шапку и на строки — иначе линия в теле
 *  таблицы и линия в заголовке разъезжаются на пиксель. */
const GROUP_EDGE = "border-l border-border/60 pl-4 pr-2";

/** Ноль показываем прочерком: в сетке из тридцати шести колонок сплошные нули
 *  читаются хуже пустоты, а отличать «ноль» от «нет данных» здесь не нужно. */
function num(v: number): React.ReactNode {
  return v === 0 ? <span className="text-muted">—</span> : formatNum(v);
}

/**
 * Годовой свод: по каждому месяцу план, факт и разница между ними, плюс итог за
 * год. Классический вид бюджета — тот, к которому привыкли по Дзен-мани и по
 * табличным бюджетам вообще (issue #25).
 *
 * Числа даны без символа валюты: тридцать шесть колонок с «₽» не помещаются ни
 * на экран, ни на лист. Валюта названа над таблицей, точные суммы с ней — в
 * подсказке ячейки.
 */
export function BudgetYearTable({
  report,
  base,
  onOpenCell,
}: {
  report: BudgetYearReport;
  base: string;
  /** Клик по факту — операции этой статьи за этот месяц. */
  onOpenCell: (
    category: string,
    subcategory: string | null,
    ym: string,
    kind: BudgetKind
  ) => void;
}) {
  // Под-категории раскрываются по категории, как в месячном виде.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * Раскрыть или свернуть все под-категории РАЗДЕЛА — щёлкать каждую в своде за
   * год слишком долго.
   *
   * Ключ раскрытия хранит и направление: «Банки» бывают и расходом, и доходом,
   * и раскрываться они должны порознь.
   */
  const sectionKeys = (section: YearSection) =>
    section.groups.filter((g) => g.subs.length > 0).map((g) => `${section.kind} ${g.category}`);
  const sectionExpanded = (section: YearSection) => {
    const keys = sectionKeys(section);
    return keys.length > 0 && keys.every((k) => expanded.has(k));
  };
  const toggleSection = (section: YearSection) =>
    setExpanded((prev) => {
      const keys = sectionKeys(section);
      const next = new Set(prev);
      if (keys.every((k) => next.has(k))) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });

  /** Всего колонок — для заголовков разделов на всю ширину. */
  const COLS = 1 + (report.months.length + 1) * SUB_COLUMNS.length;

  /**
   * Тройка ячеек одного месяца. Клик живёт на ФАКТЕ: за ним стоят операции, а
   * за планом и разницей — ничего, что можно открыть.
   */
  const monthCells = (
    c: YearCell,
    kind: BudgetKind,
    label: string,
    key: string,
    onClick: (() => void) | null,
    strong = false,
    /** Дописка к подсказке — например, сколько в этой сумме своего у категории. */
    note?: string
  ) => {
    const diff = yearDiff(c, kind);
    const empty = c.plan === 0 && c.fact === 0;
    const cls = `py-1 text-right tabular-nums whitespace-nowrap ${
      strong ? "font-medium" : ""
    }`;
    return (
      <Fragment key={key}>
        {/* Черта — на левом краю месяца, и в шапке, и в каждой строке: только
            так она читается сплошной линией. Отступы у крайних колонок больше
            обычных: без них черта прилипала к соседней «Разнице». */}
        <td className={`${cls} ${GROUP_EDGE} text-muted`}>{num(c.plan)}</td>
        <td className={`${cls} px-2`}>
          {empty || !onClick ? (
            num(c.fact)
          ) : (
            <Tooltip
              content={`${label} · план ${formatMoney(c.plan, base)} · факт ${formatMoney(
                c.fact,
                base
              )}${note ? ` · ${note}` : ""}`}
            >
              <button
                type="button"
                onClick={onClick}
                className="rounded px-1 -mx-1 hover:bg-panel2/60 hover:text-accent"
              >
                {num(c.fact)}
              </button>
            </Tooltip>
          )}
        </td>
        {/* Знак разницы уже приведён к «больше нуля — хорошо», поэтому цвет
            зависит только от него, а не от того, доход это или расход. */}
        <td
          className={`${cls} pl-2 pr-4 ${
            empty || diff === 0
              ? "text-muted"
              : diff > 0
                ? "text-income"
                : "text-expense"
          }`}
        >
          {empty ? <span className="text-muted">—</span> : formatNum(diff)}
        </td>
      </Fragment>
    );
  };

  const dataRow = (
    row: YearRow,
    opts: { nested?: boolean; group?: string; own?: YearRow }
  ) => (
    <tr key={row.key} className={opts.nested ? "text-muted" : ""}>
      <th
        scope="row"
        className={`sticky left-0 bg-panel text-left font-normal px-2 py-1 ${
          opts.nested ? "pl-9" : ""
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {opts.group !== undefined ? (
            <button
              type="button"
              onClick={() => toggle(opts.group!)}
              className="shrink-0 text-muted hover:text-text"
              aria-label={
                expanded.has(opts.group) ? "Свернуть подкатегории" : "Показать подкатегории"
              }
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  expanded.has(opts.group) ? "" : "-rotate-90"
                }`}
              />
            </button>
          ) : (
            !opts.nested && <span className="w-3.5 shrink-0" />
          )}
          {row.subcategory && row.category === TRANSFER_CATEGORY ? (
            // У переводов под-категория — это счёт по ту сторону, а не тег.
            // Логотип банка тут узнаётся мгновенно, кружок категории — нет.
            <AccountLogo title={row.subcategory} size={20} />
          ) : row.subcategory ? (
            <CategoryDot category={row.subcategory} parent={row.category} size="w-5 h-5" />
          ) : (
            <CategoryDot category={row.category} size="w-5 h-5" />
          )}
          <span className="truncate">{row.subcategory ?? row.category}</span>
        </div>
      </th>
      {row.cells.map((c, i) => {
        // Своё у категории — только в подсказке. Отдельной строкой оно было
        // дублем названия (так же сделано в самом Дзен-мани), но объяснять
        // расхождение между итогом категории и суммой её под-категорий чем-то
        // надо: иначе непонятно, откуда лишние деньги.
        const own = opts.own?.cells[i];
        const note =
          own && (own.plan !== 0 || own.fact !== 0)
            ? `из них своих ${formatMoney(own.fact, base)}`
            : undefined;
        return monthCells(
          c,
          row.kind,
          `${row.subcategory ?? row.category} · ${monthLabel(report.months[i])}`,
          report.months[i],
          () => onOpenCell(row.category, row.subcategory, report.months[i], row.kind),
          false,
          note
        );
      })}
      {monthCells(
        { plan: row.plan, fact: row.fact },
        row.kind,
        `${row.subcategory ?? row.category} · за год`,
        "год",
        null,
        true
      )}
    </tr>
  );

  const sectionBody = (section: YearSection, heading: string) => (
    <tbody className="divide-y divide-border/60">
      <tr>
        <th
          scope="rowgroup"
          colSpan={COLS}
          className="sticky left-0 text-left px-2 pt-4 pb-1 font-semibold bg-panel"
        >
          {/* Шеврон раскрывает под-категории всего раздела. Если раскрывать
              нечего — ни у одной категории нет под-категорий, — кнопки нет
              вовсе, а не висит неработающей. */}
          {sectionKeys(section).length > 0 ? (
            <button
              type="button"
              onClick={() => toggleSection(section)}
              className="flex items-center gap-1.5 hover:text-accent"
              aria-expanded={sectionExpanded(section)}
              aria-label={
                sectionExpanded(section)
                  ? `Свернуть подкатегории: ${heading}`
                  : `Раскрыть подкатегории: ${heading}`
              }
            >
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform ${
                  sectionExpanded(section) ? "" : "-rotate-90"
                }`}
              />
              {heading}
            </button>
          ) : (
            heading
          )}
        </th>
      </tr>
      {section.groups.length === 0 && (
        <tr>
          <td colSpan={COLS} className="px-2 py-3 text-muted">
            За этот год ничего нет.
          </td>
        </tr>
      )}
      {section.groups.map((g) => (
        <Fragment key={g.category}>
          {dataRow(g.total, {
            group: g.subs.length > 0 ? `${section.kind} ${g.category}` : undefined,
            own: g.subs.length > 0 ? g.parent : undefined,
          })}
          {g.subs.length > 0 &&
            expanded.has(`${section.kind} ${g.category}`) &&
            g.subs.map((s) => dataRow(s, { nested: true }))}
        </Fragment>
      ))}
      <tr className="font-medium border-t-2 border-border">
        <th scope="row" className="sticky left-0 bg-panel text-left px-2 py-1">
          Итого {heading.toLowerCase()}
        </th>
        {section.totals.map((c, i) =>
          monthCells(
            c,
            section.kind,
            `Итого · ${monthLabel(report.months[i])}`,
            report.months[i],
            null,
            true
          )
        )}
        {monthCells(
          { plan: section.plan, fact: section.fact },
          section.kind,
          "Итого за год",
          "год",
          null,
          true
        )}
      </tr>
      {/* Вторая строка итога — только когда переводы в разделе есть. Она про
          другой вопрос: не «сколько потрачено», а «сколько прошло по счетам». */}
      {hasTransfers(section) && (
        <tr className="font-medium text-muted">
          <th scope="row" className="sticky left-0 bg-panel text-left px-2 py-1 font-medium">
            {section.kind === "expense" ? "Расход" : "Доход"}, включая переводы
          </th>
          {section.totalsAll.map((c, i) =>
            monthCells(
              c,
              section.kind,
              `Включая переводы · ${monthLabel(report.months[i])}`,
              report.months[i],
              null,
              true
            )
          )}
          {monthCells(
            { plan: section.planAll, fact: section.factAll },
            section.kind,
            "Включая переводы, за год",
            "год",
            null,
            true
          )}
        </tr>
      )}
    </tbody>
  );

  // По полным итогам — как и помесячные ячейки `report.delta`. Иначе годовой
  // столбец «Разница» не сошёлся бы с суммой своих же месяцев.
  const deltaPlan = report.income.planAll - report.expense.planAll;
  const deltaFact = report.income.factAll - report.expense.factAll;

  /** Строка дельты: тут «разница» — это отклонение факта от плана, а знак у
   *  самой дельты уже говорит «профицит или дефицит», поэтому цвет берём по
   *  значению, а не по знаку отклонения. */
  const deltaCells = (c: YearCell, key: string) => {
    const cls = "py-1.5 text-right tabular-nums whitespace-nowrap font-medium";
    const empty = c.plan === 0 && c.fact === 0;
    return (
      <Fragment key={key}>
        <td className={`${cls} ${GROUP_EDGE} text-muted`}>{num(c.plan)}</td>
        <td
          className={`${cls} px-2 ${
            empty ? "" : c.fact >= 0 ? "text-income" : "text-expense"
          }`}
        >
          {num(c.fact)}
        </td>
        <td className={`${cls} pl-2 pr-4 text-muted`}>
          {empty ? num(0) : formatNum(c.fact - c.plan)}
        </td>
      </Fragment>
    );
  };

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 bg-panel text-left px-2 py-2 min-w-[13rem] align-bottom"
            >
              {/* Пояснение к колонкам — в подсказке, а не строкой над таблицей:
                  читают его один раз, а место оно занимало всегда. */}
              <span className="inline-flex items-center gap-1.5">
                Статья
                <Tooltip
                  content={
                    <>
                      Суммы в {base}. «Разница» у расходов — сколько осталось до
                      плана, у доходов — насколько план перевыполнен; больше нуля
                      везде значит «хорошо».
                    </>
                  }
                >
                  <button
                    type="button"
                    aria-label="Как читать таблицу"
                    className="text-muted hover:text-accent"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </span>
            </th>
            {report.months.map((m) => (
              <th
                key={m}
                colSpan={SUB_COLUMNS.length}
                className="px-1 pt-2 pb-0.5 text-center font-medium border-l border-border/60"
              >
                {/* Полное название: тройка колонок под ним всё равно шире
                    любого месяца, и сокращать было незачем. Год убираем — он
                    один на всю таблицу и назван в шапке страницы. */}
                {monthLabelFull(m).replace(/\s\d+ г\.$/, "")}
              </th>
            ))}
            <th
              colSpan={SUB_COLUMNS.length}
              className="px-1 pt-2 pb-0.5 text-center font-semibold border-l border-border"
            >
              За год
            </th>
          </tr>
          <tr className="text-muted">
            {[...report.months, "год"].map((m) =>
              SUB_COLUMNS.map((s, i) => (
                <th
                  key={`${m} ${s}`}
                  className={`pb-1.5 text-right font-normal min-w-[5rem] ${
                    i === 0 ? GROUP_EDGE : i === SUB_COLUMNS.length - 1 ? "pl-2 pr-4" : "px-2"
                  }`}
                >
                  {s}
                </th>
              ))
            )}
          </tr>
        </thead>
        {sectionBody(report.expense, "Расходы")}
        {sectionBody(report.income, "Доходы")}
        <tfoot>
          <tr className="border-t-2 border-border">
            <th scope="row" className="sticky left-0 bg-panel text-left px-2 py-1.5 font-medium">
              Дельта
            </th>
            {report.delta.map((c, i) => deltaCells(c, report.months[i]))}
            {deltaCells({ plan: deltaPlan, fact: deltaFact }, "год")}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
