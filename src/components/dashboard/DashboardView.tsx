/**
 * Главная страница.
 *
 * Экран собран из виджетов, и собирает его сам человек: порядок, ширина и
 * состав хранятся в `useDashboardLayoutStore`, а страница их только
 * раскладывает. Отсюда и устройство файла — сначала содержимое каждого виджета,
 * потом одна сетка, которая проходит по сохранённой раскладке.
 *
 * Сетка одна на всю страницу, в три колонки; виджет занимает треть, две трети
 * или всю ширину. Других размеров нет намеренно: при любых трёх размерах
 * перестановка складывается в ровные ряды, а при произвольных пропорциях
 * остаются дыры.
 *
 * Модель считается здесь один раз и раздаётся блокам; переходы (открыть
 * операции месяца, категории, счёта) тоже живут здесь — сами блоки не должны
 * знать ни про хранилища, ни про то, как открывается drawer.
 */

import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import {
  BlockTitle,
  CashflowBars,
  AccountsList,
  CategoriesList,
  UpcomingList,
  ObservationsList,
  ActivityHeat,
  ZenPlannedList,
  MonthOverMonthBlock,
} from "./blocks";
import { LinksRow } from "./LinksRow";
import {
  EmptyDashboard,
  HiddenWidgets,
  LayoutToolbar,
  WidgetGap,
  WidgetShell,
} from "./WidgetLayout";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import {
  isBareWidget,
  packLayout,
  widgetMeta,
  widgetView,
  type WidgetPlacement,
} from "../../lib/dashboardLayout";
import { useDashboardLayoutStore } from "../../store/useDashboardLayoutStore";
import { formatMoney, monthLabel, formatDate } from "../../lib/format";
import { pluralRu } from "../../lib/plural";
import { useDashboardModel, type DashboardModel } from "../../hooks/useDashboardModel";
import { useAnalyticsTransactions } from "../../hooks/useAnalyticsTransactions";
import { useZenPlanned } from "../../hooks/useZenPlanned";
import { usePlannedDeletionsStore } from "../../store/usePlannedDeletionsStore";
import { useDrillStore } from "../../store/useDrillStore";
import { useCategoryMetaStore } from "../../store/useCategoryMetaStore";
import { CategorySunburst } from "../CategorySunburst";
import { buildHierarchy } from "../../lib/aggregations";
import { useReportPeriodStore } from "../../store/useReportPeriodStore";
import { periodKey, shiftPeriod } from "../../lib/period";
import { monthOverMonth } from "../../lib/monthOverMonth";
import { monthEnd } from "../../lib/dashboardModel";
import { affectsExpense } from "../../lib/txKindStyle";

/** Название месяца отдельно от года: в пилюле год только шумит. */
function monthName(ym: string): string {
  const [y, mo] = ym.split("-");
  const s = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Колонка «ярлык — число» в подвале героя.
 *
 * Прежде это была строка «ярлык слева, число справа»: их было три, и списком
 * они читались нормально. Осталось две, и список из двух строк выглядит
 * обрубком — а рядом друг с другом доход и расход образуют пару, которую и
 * хочется сравнить.
 */
function StatCol({
  label,
  value,
  plan,
  tone,
  dense,
  divided,
}: {
  label: string;
  value: string;
  /** Плановая сумма месяца из «Бюджета». Стоит под фактом и не смешивается с ним. */
  plan?: string;
  tone?: "income" | "expense";
  /** В карточке набрано теснее: там высота считанная, а не вся страница. */
  dense?: boolean;
  /** Волосок слева — граница между колонками. */
  divided?: boolean;
}) {
  return (
    <div className={clsx("min-w-0", divided && "border-l border-border pl-4", !divided && "pr-4")}>
      <div
        className={clsx(
          "uppercase tracking-[0.1em] text-muted",
          dense ? "text-[11px]" : "text-[12.5px]"
        )}
      >
        {label}
      </div>
      <div
        className={clsx(
          "font-mono tabular-nums font-semibold mt-1.5 truncate",
          dense ? "text-[19px]" : "text-[30px]",
          tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""
        )}
      >
        {value}
      </div>
      {plan && (
        <div
          className={clsx(
            "text-muted font-mono tabular-nums mt-1 truncate",
            dense ? "text-[11.5px]" : "text-[12.5px]"
          )}
        >
          План {plan}
        </div>
      )}
    </div>
  );
}

/**
 * Итог «Запланированных операций»: расход и приход одной строкой.
 *
 * Два числа рядом, а не одно: складывать их значило бы придумать «чистый
 * остаток», а каждое здесь отвечает за свои строки списка. Знак и цвет
 * повторяют строки, поэтому разбираться, что есть что, не нужно.
 *
 * Разделитель ставится только между двумя числами. Если ожидается что-то одно,
 * точка посреди пустоты читалась бы как потерянное второе слагаемое.
 */
function PlannedTotals({ out, income, base }: { out: number; income: number; base: string }) {
  const hasOut = out > 0;
  const hasIn = income > 0;
  const big = "font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none";
  return (
    <div
      className="flex items-baseline gap-2 flex-wrap pb-3 mb-1 border-b border-border"
      style={{ wordSpacing: "-0.22em" }}
    >
      {/* Ничего не ожидается — показываем ноль без знака: подписывать плюсом
          или минусом нечего. */}
      {!hasOut && !hasIn && <span className={`${big} text-muted`}>{formatMoney(0, base)}</span>}
      {hasOut && <span className={`${big} text-expense`}>−{formatMoney(out, base)}</span>}
      {hasOut && hasIn && (
        <span className="w-px h-5 bg-border shrink-0 self-center" aria-hidden="true" />
      )}
      {hasIn && <span className={`${big} text-income`}>+{formatMoney(income, base)}</span>}
    </div>
  );
}

/* ─────────────────────────────  итоги месяца  ───────────────────────────── */

/** Подпись пилюли месяца: название и сколько дней осталось. */
function monthPill(m: DashboardModel): string {
  return (
    monthName(m.ym) +
    (m.month.left === 0
      ? " · последний день"
      : ` · осталось ${m.month.left} ${pluralRu(m.month.left, ["день", "дня", "дней"])}`)
  );
}

/**
 * Вариант «Открытый»: без поддона, крупная типографика на голом фоне страницы.
 * В обойме с двойным кантом он читался бы как ещё одна карточка с числом, а это
 * заголовок всего экрана.
 */
function HeroOpen({ m, sunken }: { m: DashboardModel; sunken?: boolean }) {
  const over = m.pace === null ? null : m.pace - 1;
  return (
    // На голом фоне итоги прижаты к низу колонки: страница под ними
    // продолжается, и это читается нижней границей первого экрана. В карточке
    // прижимать не к чему — итоги упирались в её кант. Там всё набрано на
    // ступень мельче, свободное место делится между блоками поровну, а снизу
    // карточка оставляет запас больше верхнего (см. `WidgetShell`).
    // Свободное место делится между блоками поровну в обоих видах. Прежде в
    // открытом оно всё уходило в один просвет над итогами: те прижимались к
    // низу колонки, а над ними зияла дыра под сотню пикселей.
    //
    // Десять пикселей снизу в открытом виде — оптическая поправка. По линейке
    // колонка и так заканчивалась вровень с соседней карточкой, но у той
    // содержимое отступает от канта на поля поддона, и её последняя строка
    // стоит заметно выше. Ровно по коробке — значит ниже на глаз.
    <div className={clsx("flex flex-col h-full gap-5 justify-between", !sunken && "pb-2.5")}>
      {/* Пилюля — она же заголовок страницы: другого h1 на экране нет, а
          оставлять главную вовсе без заголовка нельзя. Потому и набрана в
          полную силу — приглушённой десяткой она читалась как подпись к
          чему-то, а не как заголовок экрана. Разрядка при этом меньше
          прежней: чем крупнее буквы, тем меньше её нужно. */}
      {/* На утопленной подложке пилюля и вторая кнопка залиты белым: их
          обычная заливка светлее подложки едва-едва, и на ней они пропадали. */}
      <h1
        className={`self-start rounded-full px-4 py-1.5 text-[13px] uppercase tracking-[0.14em] border border-border text-text font-semibold ${
          sunken ? "bg-panel" : "bg-panel2"
        }`}
      >
        {monthPill(m)}
      </h1>

      <div
        className={clsx(
          "font-mono font-semibold tabular-nums leading-none tracking-tight",
          sunken ? "text-[40px]" : "text-[56px] 3xl:text-6xl",
          m.free.value < 0 && "text-expense"
        )}
        style={{ wordSpacing: "-0.22em" }}
      >
        {formatMoney(Math.abs(m.free.value), m.base)}
      </div>

      <p
        className={clsx(
          "leading-relaxed text-muted max-w-[30ch]",
          sunken ? "text-[14.5px]" : "text-[17px]"
        )}
      >
        {/* Причину нехватки называем ту, что есть на самом деле. «Расход
            обогнал доход» — утверждение о фактах месяца, и когда доход
            больше расхода, а в минус уводят ещё не списанные платежи, оно
            просто неверно.
 
            Сумму будущих списаний называем ЧИСЛОМ. Из виджета ушли
            «Запланированные платежи», и на экране остались доход с расходом —
            по ним число героя не сходится: между ними ровно то, что ещё
            спишется. Пока это «то, что ещё спишется» без суммы, расхождение
            выглядит ошибкой счёта. */}
        {/* Только факт месяца: доход минус расход.
 
            Будущих списаний тут больше нет. Раньше из суммы вычитались
            регулярные платежи, посчитанные по истории, — но у Дзен-мани есть и
            свои планы, и какой из двух ответов человеку нужен, неизвестно.
            Число, собранное из факта и одной из двух догадок, нельзя ни
            проверить по экрану, ни объяснить. Запланированные операции живут
            своим виджетом, там их и видно — обоими способами. */}
        {m.free.value < 0
          ? "Столько потрачено сверх дохода за этот месяц"
          : "Столько осталось от дохода после всех трат месяца"}
        {/* Две фразы подряд сравнивают РАЗНОЕ: первая — расход с доходом
            внутри этого месяца, вторая — темп трат с прошлыми месяцами.
            Стоя рядом без связки, они читались противоречием: «расход
            обогнал доход. Темп на 27% ниже обычного» — как это, обогнал, но
            ниже? Противоречия нет: тратить можно медленнее обычного и всё
            равно больше, чем заработал.

            Поэтому связка ставится по смыслу: когда факты тянут в разные
            стороны — «хотя», когда в одну — «и». Тогда вторая половина
            читается как уточнение к первой, а не как спор с ней. */}
        {over === null && "."}
        {over !== null && Math.abs(over) < 0.005 && ", и тратите примерно как обычно."}
        {over !== null && Math.abs(over) >= 0.005 && (
          <>
            {(m.free.value < 0) !== (over >= 0) ? ", хотя тратите на " : ", и тратите на "}
            <span className={`font-mono tabular-nums ${over >= 0 ? "text-warn" : "text-income"}`}>
              {Math.abs(over * 100).toFixed(0)}%
            </span>
            {over >= 0 ? " быстрее обычного." : " медленнее обычного."}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          // Как и «Месячный отчёт» рядом: лента открывается за тот месяц,
          // о котором весь этот экран, а не за период с прошлого раза.
          to={`/transactions?month=${m.ym}`}
          className={clsx(
            "group inline-flex items-center gap-3 rounded-full bg-text text-panel font-medium",
            sunken ? "h-[44px] pl-5 pr-2 text-[13.5px]" : "h-[52px] pl-6 pr-2.5 text-[14px]"
          )}
        >
          Лента операций
          <span className={clsx(
            sunken ? "w-7 h-7" : "w-8 h-8",
            "rounded-full bg-panel/20 grid place-items-center transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none")}>
            <ArrowUpRight className={sunken ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" />
          </span>
        </Link>
        <Link
          // Отчёт открываем сразу за тот месяц, о котором весь этот экран:
          // иначе с разбора августа человек попадал на всю историю и сужал
          // период руками.
          to={`/report?month=${m.ym}`}
          // Та же высота, что у соседа: у главной кнопки её задаёт вложенный
          // кружок, и «Месячный отчёт» рядом выглядел бы приплюснутым.
          //
          // Заливка и полный контраст текста — чтобы кнопка читалась как
          // кнопка: обведённая контуром и приглушённым текстом, она
          // сливалась с белым фоном. Второстепенной её оставляет заливка
          // подложкой, а не чёрным, как у соседней.
          className={clsx(
            "inline-flex items-center rounded-full border border-border text-text font-medium transition-colors duration-200 hover:border-accent/50",
            sunken ? "h-[44px] px-5 text-[13.5px]" : "h-[52px] px-6 text-[14px]",
            sunken ? "bg-panel hover:bg-panel/70" : "bg-panel2 hover:bg-panel2/70"
          )}
        >
          Месячный отчёт
        </Link>
      </div>

      {/* Доход и расход — двумя колонками, а не строками списка.
          Запланированные платежи отсюда ушли (у них свой виджет), и в столбик
          осталось бы две сиротливые строки; рядом же они читаются тем, чем и
          являются, — парой, которую сравнивают между собой. */}
      <div className="border-t border-border pt-3">
        <div className="grid grid-cols-2">
          <StatCol
            label="Доход"
            value={formatMoney(m.factIncome, m.base)}
            plan={m.planIncome !== null ? formatMoney(m.planIncome, m.base) : undefined}
            tone="income"
            dense={sunken}
          />
          <StatCol
            label="Расход"
            value={formatMoney(m.factExpense, m.base)}
            plan={m.planExpense !== null ? formatMoney(m.planExpense, m.base) : undefined}
            tone="expense"
            dense={sunken}
            divided
          />
        </div>
      </div>
    </div>
  );
}

/** Строка рейки: подпись сверху, число под ней, всё по правому краю. */
function RailRow({ label, value, tone }: { label: string; value: string; tone?: "income" | "expense" }) {
  return (
    <div className="text-right">
      <span className="text-[11px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <b
        className={`block font-mono tabular-nums font-semibold text-[15.5px] mt-0.5 whitespace-nowrap ${
          tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""
        }`}
      >
        {value}
      </b>
    </div>
  );
}

/**
 * Вариант «Разворот»: то же число, но в поддоне и с рейкой чисел справа.
 *
 * Волосок делит карточку надвое: слева типографика и два действия, справа
 * три числа, растянутые на всю высоту. Внизу слева — сколько месяца
 * пройдено: без неё низ колонки пустовал, а вопрос «много ли ещё впереди»
 * ровно тот, что задают, глядя на остаток.
 */
function HeroSplit({ m }: { m: DashboardModel }) {
  const over = m.pace === null ? null : m.pace - 1;
  const short = m.free.value < 0;
  return (
    <>
      <h1 className="self-start rounded-full px-3.5 py-1 text-[11px] uppercase tracking-[0.14em] bg-panel2 border border-border text-text font-semibold">
        {monthPill(m)}
      </h1>

      {/* Разворот раскрывается только там, где колонка достаточно широка. На
          экранах до 1280 треть сетки — около 320 пикселей, и рядом с рейкой
          крупному числу не остаётся места: тогда рейка уходит вниз, а волосок
          из вертикального становится горизонтальным. */}
      <div className="flex-1 min-h-0 mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1px_auto]">
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
            {/* «К концу месяца» больше не про это: будущие списания в сумму не
                входят, это чистое сальдо прошедшей части месяца. */}
            {short ? "Потрачено сверх дохода" : "Осталось от дохода"}
          </span>
          <div
            className={`font-mono font-semibold tabular-nums text-[36px] 3xl:text-[40px] leading-none tracking-tight mt-2.5 ${
              short ? "text-expense" : ""
            }`}
            style={{ wordSpacing: "-0.22em" }}
          >
            {formatMoney(Math.abs(m.free.value), m.base)}
          </div>

          <p className="text-[13.5px] leading-relaxed text-muted mt-3">
            {/* Причину нехватки называем ту, что есть на самом деле: доход может
                быть больше расхода, а в минус уводить ещё не списанные платежи. */}
            {short
              ? "Расход месяца обогнал доход."
              : "Доход месяца за вычетом всего, что уже потрачено."}
            {over !== null && Math.abs(over) < 0.005 && " Тратите примерно как обычно."}
            {over !== null && Math.abs(over) >= 0.005 && (
              <>
                {" Темп трат на "}
                <span className={`font-mono tabular-nums ${over >= 0 ? "text-warn" : "text-income"}`}>
                  {Math.abs(over * 100).toFixed(0)}%
                </span>
                {over >= 0 ? " выше обычного." : " ниже обычного."}
              </>
            )}
          </p>

          {/* Оба действия столбиком: в колонку шириной в треть карточки они
              рядом не встают, а главное из них должно остаться заметным. */}
          <div className="flex flex-col items-start gap-2.5 mt-4">
            <Link
              to={`/transactions?month=${m.ym}`}
              className="group inline-flex h-[42px] items-center gap-3 rounded-full pl-5 pr-1.5 bg-text text-panel text-[13.5px] font-medium"
            >
              Лента операций
              <span className="w-[30px] h-[30px] rounded-full bg-panel/20 grid place-items-center transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none">
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </Link>
            <Link
              to={`/report?month=${m.ym}`}
              className="inline-flex h-[42px] items-center rounded-full px-5 bg-panel2 border border-border text-text text-[13.5px] font-medium transition-colors duration-200 hover:border-accent/50 hover:bg-panel2/70"
            >
              Месячный отчёт
            </Link>
          </div>

          {/* Полоса «месяц пройден» — украшение подвала колонки, и живёт она
              только в развороте. На узком экране рейка съезжает вниз и место
              подвала занимает сама, а полоса выталкивала бы карточку за
              отведённые ей 480 пикселей. */}
          <div className="hidden xl:block mt-auto pt-4">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted whitespace-nowrap">
                Месяц пройден
              </span>
              <span className="font-mono tabular-nums text-[12.5px] font-semibold whitespace-nowrap">
                {m.month.day} из {m.month.days} {pluralRu(m.month.days, ["дня", "дней", "дней"])}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(m.month.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="bg-border" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 content-start xl:flex xl:flex-col xl:justify-between">
          <RailRow label="Доход" value={formatMoney(m.factIncome, m.base)} tone="income" />
          <div className="hidden xl:block h-px bg-border" />
          <RailRow label="Расход" value={formatMoney(m.factExpense, m.base)} tone="expense" />
          <div className="hidden xl:block h-px bg-border" />
          <RailRow label="На счетах" value={formatMoney(m.netWorth, m.base)} />
        </div>
      </div>
    </>
  );
}

/** Месяцы в предложном падеже: «в январе», «в марте», «в августе». */
const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
] as const;

export function DashboardView() {
  const m = useDashboardModel();
  const transactions = useAnalyticsTransactions();
  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  // «Сегодня» — последняя дата С ДАННЫМИ, а не системная: по обрезанной
  // истории часы дали бы пустой хвост окна и заниженное сравнение.
  const lastDate = useMemo(
    () => transactions.reduce((mx, t) => (t.date > mx ? t.date : mx), ""),
    [transactions]
  );
  const mom = useMemo(
    () => monthOverMonth(transactions, m.ym, monthStartDay, lastDate || monthEnd(m.ym)),
    [transactions, m.ym, monthStartDay, lastDate]
  );
  /**
   * «в июле» — название прошлого месяца в ПРЕДЛОЖНОМ падеже.
   *
   * Своим списком, а не через `toLocaleDateString`: тот отдаёт именительный
   * («июль»), и подпись читалась «В июль за те же 28 дней».
   */
  const prevMonthLabel = useMemo(() => {
    const mo = Number(shiftPeriod(m.ym, -1).slice(5, 7));
    return MONTHS_IN[mo - 1] ?? "";
  }, [m.ym]);

  const layout = useDashboardLayoutStore((s) => s.layout);
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setEditing = useDashboardLayoutStore((s) => s.setEditing);
  const move = useDashboardLayoutStore((s) => s.move);
  const shift = useDashboardLayoutStore((s) => s.shift);
  const setLinks = useDashboardLayoutStore((s) => s.setLinks);
  const moveBefore = useDashboardLayoutStore((s) => s.moveBefore);

  // Планы Дзен-мани — второй вид «Запланированных платежей». Отрезок тот же,
  // что у своих регулярных: от сегодня до конца отчётного месяца.
  const todayIso = new Date().toISOString().slice(0, 10);
  // С просроченными: платёж, который прошляпили, — главное, что виджет обязан
  // показать (issue #87).
  const zenPlannedAll = useZenPlanned(todayIso, monthEnd(m.ym), true);
  // Просроченные, снятые вручную и ещё не уехавшие в облако, на главной не
  // показываем вовсе: на «Регулярных» они висят зачёркнутыми, чтобы правку
  // можно было откатить, а здесь это был бы шум.
  const plannedDeletions = usePlannedDeletionsStore((st) => st.deletions);
  // Переводы не показываем: перекладывание между своими счетами ни спишется, ни
  // придёт. Расход и доход считаем врозь — складывать их в одно число значило
  // бы придумать «чистый остаток», которого в этом виджете никто не просил.
  const zenPlanned = useMemo(
    () =>
      zenPlannedAll?.filter(
        (p) => p.kind !== "transfer" && plannedDeletions[p.id] === undefined
      ) ?? null,
    [zenPlannedAll, plannedDeletions]
  );
  const zenPlannedOut = useMemo(
    () =>
      (zenPlanned ?? [])
        .filter((p) => p.kind === "expense")
        .reduce((sum, p) => sum + p.amountBase, 0),
    [zenPlanned]
  );
  const zenPlannedIn = useMemo(
    () =>
      (zenPlanned ?? [])
        .filter((p) => p.kind === "income")
        .reduce((sum, p) => sum + p.amountBase, 0),
    [zenPlanned]
  );

  // Кольца статей: те же деревья, что на «Категориях», только за текущий месяц.
  const monthTx = useMemo(
    () => transactions.filter((t) => periodKey(t.date, monthStartDay) === m.ym),
    [transactions, monthStartDay, m.ym]
  );
  const donutExpense = useMemo(() => buildHierarchy(monthTx, "expense"), [monthTx]);
  const donutIncome = useMemo(() => buildHierarchy(monthTx, "income"), [monthTx]);

  /**
   * Открыть список операций статьи или подстатьи — за ТЕКУЩИЙ месяц.
   *
   * Виджеты главной все про этот месяц: и доли в кольце, и суммы в списке
   * статей посчитаны по нему. Открывать по ним сквозную историю значило бы
   * показать другие числа, чем те, по которым щёлкнули.
   */
  const drillCategory = useMemo(() => {
    const match = (kind: "expense" | "income", t: (typeof transactions)[number]) =>
      kind === "expense" ? affectsExpense(t.kind) : t.kind === "income";
    return (kind: "expense" | "income", name: string, full = false) =>
      showDrill(
        `${name} · ${monthLabel(m.ym)}`,
        monthTx.filter(
          (t) => match(kind, t) && (full ? t.categoryFull === name : t.category === name)
        ),
        kind === "expense" ? "Расходы по статье" : "Доходы по статье"
      );
  }, [monthTx, showDrill, m.ym]);

  const drag = useWidgetDrag(
    (dragKey, overKey) => void move(dragKey, overKey),
    (dragKey, beforeKey) => void moveBefore(dragKey, beforeKey)
  );

  // Режим настройки не переживает уход со страницы: вернувшись на главную,
  // человек ждёт готовый экран, а не разложенные ручки.
  useEffect(() => () => setEditing(false), [setEditing]);

  // Escape — выход из режима, как из любого другого временного состояния.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, setEditing]);

  const { onMonth, onCategory, onAccount, onDay } = useMemo(
    () => ({
      onMonth: (ym: string) =>
        showDrill(
          monthLabel(ym),
          transactions.filter((t) => periodKey(t.date, monthStartDay) === ym),
          "Месяц"
        ),
      // Возвраты тоже берём: именно они уменьшили ту сумму, по которой кликнули.
      // Тоже за текущий месяц: проценты в виджете считаны по нему.
      onCategory: (name: string) =>
        showDrill(
          `${name} · ${monthLabel(m.ym)}`,
          monthTx.filter((t) => affectsExpense(t.kind) && t.category === name),
          "Расходы по категории"
        ),
      onDay: (date: string) =>
        showDrill(
          formatDate(date),
          transactions.filter((t) => t.date.slice(0, 10) === date),
          "Операции за день"
        ),
      onAccount: (title: string) =>
        showDrill(
          title,
          transactions.filter(
            (t) => t.account === title || t.outcomeAccount === title || t.incomeAccount === title
          ),
          "Операции по счёту"
        ),
    }),
    [transactions, monthTx, showDrill, monthStartDay, m.ym]
  );

  /** Содержимое виджета. Обойму, ширину и ручки надевает `WidgetShell`. */
  function widgetBody(p: WidgetPlacement): ReactNode {
    switch (p.kind) {
      case "month": {
        // «В рамке» — тот же «Открытый», только в поддоне и на серой
        // подложке: содержание одно, разная подача.
        const view = widgetView(widgetMeta("month"), p.view)?.id;
        if (view === "split") return <HeroSplit m={m} />;
        return <HeroOpen m={m} sunken={view === "framed"} />;
      }

      case "accounts":
        return (
          <>
            <BlockTitle title="Балансы счетов" to="/accounts" linkLabel="Счета" />
            {/* Черта под итогом — та же, что делит строки списка: без неё
                крупное число и первая строка счёта читались как одно целое. */}
            <div
              className={`font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none pb-3 mb-1 border-b border-border ${
                m.netWorth < 0 ? "text-expense" : ""
              }`}
              style={{ wordSpacing: "-0.22em" }}
            >
              {formatMoney(m.netWorth, m.base)}
            </div>
            <AccountsList m={m} onAccount={onAccount} />
          </>
        );

      case "upcoming": {
        // Два ответа на один вопрос: наш расчёт по истории и планы, заведённые
        // в самом Дзен-мани. Итог считается по тем же строкам, что показаны,
        // иначе сумма над списком не сошлась бы с ним.
        const zen = widgetView(widgetMeta("upcoming"), p.view)?.id === "zen";
        return (
          <>
            <BlockTitle title="Запланированные операции" to="/recurring" linkLabel="Регулярные" />
            {/* Итог подан так же, как совокупный баланс у соседней карточки:
                крупным числом под заголовком. Мелкой строчкой в шапке он
                выбивался из ряда. */}
            <PlannedTotals
              out={zen ? zenPlannedOut : m.upcomingTotalBase}
              income={zen ? zenPlannedIn : 0}
              base={m.base}
            />
            {zen ? (
              <ZenPlannedList
                rows={zenPlanned}
                base={m.base}
                today={todayIso}
                until={monthEnd(m.ym)}
              />
            ) : (
              <UpcomingList m={m} />
            )}
          </>
        );
      }

      case "links":
        return (
          <LinksRow
            links={p.links ?? []}
            editing={editing}
            onChange={(links) => void setLinks(p.key, links)}
          />
        );

      case "cashflow":
        return (
          <>
            <BlockTitle
              title="Доходы и расходы"
              info={
                <>
                  <p>
                    Последние 12 месяцев, дальше — прогноз. Зелёный столбец слева в паре —
                    доход, красный справа — расход; прогнозные месяцы бледнее и обведены
                    пунктиром.
                  </p>
                  <p>
                    Прогноз считается по типичному месяцу за последние полгода — по
                    медиане, а не по среднему, чтобы одна крупная покупка не поднимала
                    всю линию. Текущий, неполный месяц в расчёт не берётся. Если история
                    позволяет, к каждому месяцу применяется поправка на сезон: декабрь
                    обычно дороже июля, и три прогнозных столбца тогда различаются.
                  </p>
                  <p>
                    Шкала срезана по обычному размаху: один месяц с крупной покупкой
                    прижимал бы остальные ко дну. Срезанный столбец несёт зубчатую
                    кромку и подписан настоящей суммой.
                  </p>
                </>
              }
              to="/cashflow"
              linkLabel="Cash-flow"
            />
            <CashflowBars m={m} onMonth={onMonth} height={260} />
          </>
        );

      case "monthOverMonth":
        return (
          <>
            <BlockTitle
              title="Месяц к месяцу"
              info={
                <p>
                  Пока месяц идёт, от прошлого берётся <b>столько же дней</b>:
                  третьего числа любой месяц выглядел бы провалом рядом с целым
                  прошлым. Сколько дней взято, написано в шапке и под числом.
                  Норма сбережений — доля дохода, которая осталась.
                </p>
              }
              to="/compare"
              linkLabel="Сравнение"
            />
            <MonthOverMonthBlock mom={mom} base={m.base} prevLabel={prevMonthLabel} />
          </>
        );

      case "categories":
        return (
          <>
            <BlockTitle
              title="Расходы по категориям"
              info={
                <p>
                  Процент — доля статьи во всех расходах месяца, как на
                  «Категориях». Полоса меряется от самой крупной статьи: так видно
                  соотношение между ними.
                </p>
              }
              to="/categories"
              linkLabel="Категории"
            />
            <CategoriesList m={m} onCategory={onCategory} />
          </>
        );

      case "donutExpense":
        return (
          <>
            <BlockTitle title="Кольцо расходов" to="/categories?kind=expense" linkLabel="Категории" />
            <CategorySunburst
              compact
              data={donutExpense}
              meta={categoryMeta}
              base={m.base}
              kind="expense"
              onOpenCategory={(name) => drillCategory("expense", name)}
              onOpenSubcategory={(full) => drillCategory("expense", full, true)}
            />
          </>
        );

      case "donutIncome":
        return (
          <>
            <BlockTitle title="Кольцо доходов" to="/categories?kind=income" linkLabel="Категории" />
            <CategorySunburst
              compact
              data={donutIncome}
              meta={categoryMeta}
              base={m.base}
              kind="income"
              onOpenCategory={(name) => drillCategory("income", name)}
              onOpenSubcategory={(full) => drillCategory("income", full, true)}
            />
          </>
        );

      case "activity":
        return (
          <>
            <BlockTitle
              title="Активность в этом месяце"
              info={
                <p>
                  Чем темнее клетка, тем больше потрачено в этот день. Шкала строится по
                  обычному размаху, а не по рекордному дню — иначе одна крупная покупка
                  делала бы весь месяц бледным. Клик по дню открывает его операции.
                </p>
              }
              to="/calendar"
              linkLabel="Календарь"
            />
            <ActivityHeat m={m} onDay={onDay} />
          </>
        );

      case "observations":
        return (
          <>
            <BlockTitle
              title="Авто-наблюдения"
              info={
                <p>
                  Статьи, пробившие план или разогнавшиеся против обычного, подорожавшие
                  подписки и пропущенные регулярные платежи. Не больше двух наблюдений
                  одного вида, чтобы список оставался разным.
                </p>
              }
              to="/anomalies"
              linkLabel="Аномалии"
            />
            <ObservationsList m={m} />
          </>
        );
    }
  }

  const visible = layout.filter((p) => !p.hidden);
  // Дырки в рядах считаем сами: сетка их оставляет, но в разметке их нет, а
  // значит и уронить в них виджет нельзя. В обычном виде они не нужны — там
  // ряды складывает сама сетка, и результат тот же.
  const cells = editing
    ? packLayout(visible)
    : visible.map((placement) => ({ type: "widget" as const, placement }));

  return (
    <div className="flex flex-col gap-5 3xl:gap-6">
      <LayoutToolbar layout={layout} />

      {visible.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 3xl:gap-6">
          {cells.map((cell) => {
            if (cell.type === "gap") {
              const gapKey = `gap:${cell.before ?? "end"}`;
              return (
                <WidgetGap
                  key={gapKey}
                  span={cell.span}
                  dragging={drag.dragKey !== null}
                  highlight={drag.overKey === gapKey}
                  onEnter={() => drag.enter(gapKey)}
                  onDrop={(sourceKey) => drag.dropBefore(sourceKey, cell.before)}
                />
              );
            }
            const p = cell.placement;
            const i = visible.indexOf(p);
            return (
            <WidgetShell
              key={p.key}
              placement={p}
              meta={widgetMeta(p.kind)}
              bare={isBareWidget(widgetMeta(p.kind), p.view)}
              sunken={widgetView(widgetMeta(p.kind), p.view)?.sunken === true}
              editing={editing}
              dragging={drag.dragKey === p.key}
              dropTarget={
                drag.overKey === p.key && drag.dragKey !== null && drag.dragKey !== p.key
              }
              onDragStart={() => drag.start(p.key)}
              onDragEnter={() => drag.enter(p.key)}
              onDragEnd={drag.end}
              onDrop={(sourceKey) => drag.drop(sourceKey, p.key)}
              onShift={(dir) => void shift(p.key, dir)}
              canBack={i > 0}
              canForward={i < visible.length - 1}
            >
              {widgetBody(p)}
            </WidgetShell>
            );
          })}
        </section>
      )}

      {editing && <HiddenWidgets layout={layout} />}
    </div>
  );
}
