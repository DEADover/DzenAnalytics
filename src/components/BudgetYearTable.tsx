import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Coins, HelpCircle, Scale, Target } from "lucide-react";
import {
  hasTransfers,
  yearDiff,
  type BudgetYearReport,
  type YearCell,
  type YearGroup,
  type YearRow,
  type YearSection,
} from "../lib/budgetYear";
import type { BudgetKind } from "../lib/budgets";
import { formatMoney, formatNum, monthLabel, monthLabelFull } from "../lib/format";
import { AccountLogo } from "./AccountLogo";
import { CategoryDot } from "./CategoryDot";
import { TRANSFER_CATEGORY } from "../lib/budgetScope";
import { Tooltip } from "./Tooltip";
import { TooltipFacts } from "./TooltipFacts";

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
  hideEmpty,
  onOpenCell,
}: {
  report: BudgetYearReport;
  base: string;
  /** Прятать статьи, по которым за год не было ни одной операции. */
  hideEmpty: boolean;
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
    // Только по видимым статьям: раскрывать то, что спрятано под спойлером
    // «Без операций за год», кнопке нечего. И под-категории считаем те же, что
    // покажутся, — иначе шеврон открывал бы пустоту.
    visibleGroups(section)
      .filter((g) => subsOf(g).length > 0)
      .map((g) => `${section.kind} ${g.category}`);
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

  /**
   * Статьи без единой операции за год — под спойлером, как «Без трат в этом
   * месяце» в месячном виде (issue #68).
   *
   * Настройка задаёт только НАЧАЛЬНОЕ состояние: щелчок по разделителю тут же
   * важнее того, что записано в настройках, но и переключение настройки при
   * открытой таблице не должно проходить мимо. Отсюда «своё значение, а если
   * его нет — из настройки».
   */
  const [emptyOpen, setEmptyOpen] = useState<Partial<Record<BudgetKind, boolean>>>({});
  const emptyShown = (kind: BudgetKind) => emptyOpen[kind] ?? !hideEmpty;
  const toggleEmpty = (kind: BudgetKind) =>
    setEmptyOpen((prev) => ({ ...prev, [kind]: !(prev[kind] ?? !hideEmpty) }));

  /** Всего колонок — для заголовков разделов на всю ширину. */
  const COLS = 1 + (report.months.length + 1) * SUB_COLUMNS.length;

  /**
   * Закреплённая шапка — тем же способом, что в отчёте «Доходы и расходы»
   * (см. подробный разбор в `ReportPage`).
   *
   * Коротко: `position: sticky` отсчитывается от ближайшего прокручиваемого
   * предка, а им здесь неизбежно оказывается обёртка с `overflow-x: auto` —
   * без неё сорока колонкам не прожить. По вертикали она не прокручивается,
   * прилипать не к чему. Поэтому шапку рисуем ДВАЖДЫ: настоящая живёт в
   * таблице и задаёт ширины, а поверх лежит её двойник в липкой обёртке,
   * которой ближайший прокручиваемый предок — сама страница.
   *
   * Отличие от отчёта одно: шапка тут в две строки — месяцы и тройки
   * «План · Факт · Разница», — поэтому ширины снимаются со ВТОРОЙ строки
   * (в первой ячейки на три колонки каждая) плюс со столбца статей.
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  const cloneClipRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [tableWidth, setTableWidth] = useState(0);
  const [cloneHeight, setCloneHeight] = useState(0);

  const copyScroll = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };
  const syncScroll = () => copyScroll(scrollerRef.current, cloneClipRef.current);
  const syncBack = () => copyScroll(cloneClipRef.current, scrollerRef.current);

  const measure = () => {
    const table = tableRef.current;
    if (!table) return;
    const rows = table.querySelectorAll("thead tr");
    const next: number[] = [];
    const first = rows[0]?.querySelector("th");
    if (first) next.push(first.getBoundingClientRect().width);
    rows[1]?.querySelectorAll("th").forEach((th) => next.push(th.getBoundingClientRect().width));
    const w = table.getBoundingClientRect().width;
    const clone = cloneRef.current;
    if (clone) {
      const ch = clone.getBoundingClientRect().height;
      setCloneHeight((prev) => (Math.abs(prev - ch) < 0.5 ? prev : ch));
    }
    // Меняем состояние только при настоящем расхождении — замер бежит после
    // каждого рендера, и безусловный `set` крутил бы рендеры вечно. Сравниваем
    // по НАКОПЛЕННОМУ сдвигу: на сорока колонках систематическая разница «чуть
    // меньше допуска» складывается, и к правому краю двойник уезжает.
    setColWidths((prev) => {
      if (prev.length !== next.length) return next;
      let a = 0;
      let b = 0;
      for (let i = 0; i < next.length; i++) {
        a += prev[i];
        b += next[i];
        if (Math.abs(a - b) >= 0.5) return next;
      }
      return prev;
    });
    setTableWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    syncScroll();
  };

  // После каждого рендера: столбцы двигает всё — раскрыли подкатегории,
  // открыли спойлер пустых статей, приехали данные, сменился год.
  useLayoutEffect(measure);

  // …а наблюдатель и `resize` — для того, что рендера не вызывает: потянули
  // окно, доехали шрифты.
  useLayoutEffect(() => {
    const table = tableRef.current;
    const scroller = scrollerRef.current;
    if (!table || !scroller) return;
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    ro.observe(scroller);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(syncScroll, [colWidths, tableWidth]);

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
              content={
                // Те же три колонки, что и в таблице, только столбиком и с
                // цветом у разницы: одной фразой через точки подсказка
                // читалась как поток, а списком серых фраз — как пелена.
                <TooltipFacts
                  title={label}
                  facts={[
                    { label: "План", value: formatMoney(c.plan, base), icon: <Target /> },
                    {
                      label: "Факт",
                      value: formatMoney(c.fact, base),
                      icon: <Coins />,
                      strong: true,
                    },
                    {
                      label: "Разница",
                      value: formatMoney(diff, base, { signed: true }),
                      icon: <Scale />,
                      // Знак уже приведён к «больше нуля — хорошо».
                      tone: diff >= 0 ? "income" : "expense",
                      strong: true,
                    },
                  ]}
                  note={note && <span className="italic">{note}</span>}
                />
              }
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
    // Подсветка всей строки под курсором: у таблицы под сорок колонок, и вести
    // глаз от названия статьи до нужного месяца без опоры не получалось.
    // Закреплённый первый столбец красится отдельно и НЕПРОЗРАЧНЫМ цветом:
    // под ним при прокрутке уезжают ячейки этой же строки, и полупрозрачная
    // подсветка показала бы их насквозь.
    <tr key={row.key} className={`group ${opts.nested ? "text-muted" : ""} hover:bg-panel2`}>
      <th
        scope="row"
        className={`sticky left-0 bg-panel group-hover:bg-panel2 text-left font-normal px-2 py-1 ${
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
            ? `Из них своих ${formatMoney(own.fact, base)}`
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

  /**
   * Было ли по строке движение за год.
   *
   * С допуском в половину копейки: суммы приходят в базовой валюте, после
   * пересчёта по курсу дня в них остаются хвосты вроде 0,004 — на экране это
   * всё равно «0», и строка из нулей считалась бы «с движением».
   */
  const moved = (row: YearRow) => Math.abs(row.fact) >= 0.005;

  /**
   * Статьи с движением за год и статьи без него — в списке они идут порознь.
   *
   * Статья с НАЗНАЧЕННОЙ операцией считается живой: операции ещё не было по
   * определению, но дата и сумма известны — прятать её значит прятать ровно то,
   * ради чего строка и появилась.
   */
  const shows = (g: YearGroup) => moved(g.total) || !!g.total.scheduled;
  const liveGroups = (section: YearSection) => section.groups.filter(shows);
  const emptyGroups = (section: YearSection) => section.groups.filter((g) => !shows(g));
  const visibleGroups = (section: YearSection) =>
    emptyShown(section.kind) ? section.groups : liveGroups(section);
  /** План спрятанных статей — он всё равно учтён в итоге раздела. */
  const emptyPlan = (section: YearSection) =>
    emptyGroups(section).reduce((s, g) => s + g.total.plan, 0);

  /**
   * Под-категории категории — с тем же отбором, что и сами категории.
   *
   * Прятать только категории целиком мало: у живой категории под-категория без
   * единой операции за год — та же строка из прочерков, просто на уровень
   * ниже. Открывается тем же переключателем «Статьи без операций».
   */
  const subsOf = (g: YearGroup) =>
    emptyShown(g.total.kind) ? g.subs : g.subs.filter(moved);

  /** Строка категории и, если раскрыта, её под-категории. */
  const groupRows = (g: YearGroup) => {
    const subs = subsOf(g);
    return (
      <Fragment key={g.category}>
        {dataRow(g.total, {
          group: subs.length > 0 ? `${g.total.kind} ${g.category}` : undefined,
          own: subs.length > 0 ? g.parent : undefined,
        })}
        {subs.length > 0 &&
          expanded.has(`${g.total.kind} ${g.category}`) &&
          subs.map((s) => dataRow(s, { nested: true }))}
      </Fragment>
    );
  };

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
      {liveGroups(section).map(groupRows)}
      {/* Статья с планом, но без единой операции за год — это строка, в которой
          нечего читать. Она никуда не девается: разделитель говорит, сколько
          таких статей, и открывает их. Итоги раздела всегда считаются по всем
          статьям, включая скрытые. */}
      {emptyGroups(section).length > 0 && (
        <>
          <tr>
            <td colSpan={COLS} className="px-2 py-2">
              <button
                type="button"
                onClick={() => toggleEmpty(section.kind)}
                aria-expanded={emptyShown(section.kind)}
                className="w-full flex items-center gap-3 text-xs text-muted hover:text-text"
              >
                <span className="h-px flex-1 bg-border" />
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                    emptyShown(section.kind) ? "" : "-rotate-90"
                  }`}
                />
                {/* План скрытых статей называем прямо: он входит в «Итого», и
                    без этой подписи итог не сходился бы с суммой видимых
                    строк — а объяснения этому на экране не было бы. */}
                <span className="whitespace-nowrap">
                  Без операций за год · {emptyGroups(section).length}
                  {emptyPlan(section) > 0 && (
                    <> · план за год {formatMoney(emptyPlan(section), base)}</>
                  )}
                </span>
                <span className="h-px flex-1 bg-border" />
              </button>
            </td>
          </tr>
          {emptyShown(section.kind) && emptyGroups(section).map(groupRows)}
        </>
      )}
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

  /**
   * Две строки шапки. Рисуются и в таблице, и в двойнике — из одного места,
   * иначе они однажды разъедутся.
   *
   * В двойнике кнопка подсказки убрана из обхода с клавиатуры и от читалок
   * (`aria-hidden` на всей обёртке): для них есть настоящая шапка, а два
   * одинаковых заголовка подряд только запутали бы.
   */
  const headerRows = (forClone: boolean) => (
    <>
      <tr>
        <th
          rowSpan={2}
          className="sticky left-0 z-[15] bg-panel text-left px-2 py-2 min-w-[13rem] align-bottom"
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
                tabIndex={forClone ? -1 : undefined}
                // Мышь фокусирует кнопку даже с `tabIndex={-1}`, а фокус внутри
                // `aria-hidden`-поддерева — это то, чего быть не должно.
                onMouseDown={forClone ? (e) => e.preventDefault() : undefined}
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
            className="bg-panel px-1 pt-2 pb-0.5 text-center font-medium border-l border-border/60"
          >
            {/* Полное название: тройка колонок под ним всё равно шире
                любого месяца, и сокращать было незачем. Год убираем — он
                один на всю таблицу и назван в шапке страницы. */}
            {monthLabelFull(m).replace(/\s\d+ г\.$/, "")}
          </th>
        ))}
        <th
          colSpan={SUB_COLUMNS.length}
          className="bg-panel px-1 pt-2 pb-0.5 text-center font-semibold border-l border-border"
        >
          За год
        </th>
      </tr>
      <tr className="text-muted">
        {[...report.months, "год"].map((m) =>
          SUB_COLUMNS.map((s, i) => (
            <th
              key={`${m} ${s}`}
              className={`bg-panel pb-1.5 text-right font-normal min-w-[5rem] ${
                i === 0 ? GROUP_EDGE : i === SUB_COLUMNS.length - 1 ? "pl-2 pr-4" : "px-2"
              }`}
            >
              {s}
            </th>
          ))
        )}
      </tr>
    </>
  );

  return (
    // `overflow-clip`, а НЕ `overflow-hidden`: скруглённые углы карточки надо
    // вернуть — непрозрачные ячейки шапки закрашивают их, — но `hidden` сделал
    // бы карточку контейнером прокрутки и убил бы закрепление.
    <div className="card overflow-clip">
      {/* Двойник шапки: липнет под шапку приложения, пока таблица на экране.
          Лежит ПЕРЕД таблицей и вынут из потока отрицательным отступом ниже,
          поэтому до прокрутки стоит ровно на месте настоящей шапки.
          `select-none` — чтобы выделение таблицы не забирало заголовки дважды. */}
      <div
        ref={cloneRef}
        className="sticky z-20 select-none"
        style={{ top: "var(--app-header-h)" }}
        aria-hidden
      >
        {/* Прокрутка настоящая, а не только программная: иначе жест вбок по
            закреплённой полосе на телефоне не двигал бы ничего. Полосу прячем —
            она уже есть у таблицы. */}
        <div
          ref={cloneClipRef}
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={syncBack}
        >
          <table
            className="text-xs border-separate border-spacing-0"
            style={{
              tableLayout: "fixed",
              width: tableWidth > 0 ? `${tableWidth}px` : undefined,
            }}
          >
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: `${w}px` }} />
              ))}
            </colgroup>
            <thead>{headerRows(true)}</thead>
          </table>
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto"
        style={cloneHeight > 0 ? { marginTop: `${-cloneHeight}px` } : undefined}
        onScroll={syncScroll}
      >
      <table
        ref={tableRef}
        className="w-full text-xs border-separate border-spacing-0"
      >
        <thead>{headerRows(false)}</thead>
        {sectionBody(report.expense, "Расходы")}
        {sectionBody(report.income, "Доходы")}
        <tfoot>
          <tr className="border-t-2 border-border">
            {/* Не «Дельта»: в этой же таблице «Разница» — это колонка внутри
                месяца, и одно слово на две разные величины путало бы. Полное
                «Доходы − расходы» читается без легенды и совпадает по смыслу с
                карточкой месяца и показателем дашборда. */}
            <th scope="row" className="sticky left-0 bg-panel text-left px-2 py-1.5 font-medium">
              Доходы − расходы
            </th>
            {report.delta.map((c, i) => deltaCells(c, report.months[i]))}
            {deltaCells({ plan: deltaPlan, fact: deltaFact }, "год")}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
