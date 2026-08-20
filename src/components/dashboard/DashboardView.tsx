/**
 * Главная страница.
 *
 * Первый экран — разворот: слева крупная типографика и одно действие, справа
 * карточки с данными. Дальше графики, активность и наблюдения.
 *
 * Модель считается здесь один раз и раздаётся блокам; переходы (открыть
 * операции месяца, категории, счёта) тоже живут здесь — сами блоки не должны
 * знать ни про хранилища, ни про то, как открывается drawer.
 */

import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import {
  BlockTitle,
  CashflowBars,
  AccountsList,
  CategoriesList,
  UpcomingList,
  ObservationsList,
  ActivityHeat,
  QuickLinks,
} from "./blocks";
import { formatMoney, monthLabel, formatDate } from "../../lib/format";
import { useDashboardModel } from "../../hooks/useDashboardModel";
import { useAnalyticsTransactions } from "../../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../../store/useDrillStore";
import { useReportPeriodStore } from "../../store/useReportPeriodStore";
import { periodKey } from "../../lib/period";
import { affectsExpense } from "../../lib/txKindStyle";

/**
 * Поддон с двойным кантом.
 *
 * Радиус ядра — 16, а не 22: у вложенных скруглений центры дуг должны
 * совпадать, иначе на просвете в 6 px внешняя и внутренняя кривые расходятся и
 * кант выглядит кривым. 22 − 6 = 16.
 */
function Tray({ children }: { children: ReactNode }) {
  return (
    <div className="tray h-full flex flex-col">
      <div className="tray-core flex-1 min-h-0 flex flex-col p-5">{children}</div>
    </div>
  );
}

/** Название месяца отдельно от года: в пилюле год только шумит. */
function monthName(ym: string): string {
  const [y, mo] = ym.split("-");
  const s = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function daysWord(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  switch (n % 10) {
    case 1:
      return "день";
    case 2:
    case 3:
    case 4:
      return "дня";
    default:
      return "дней";
  }
}

/**
 * Строка «ярлык — число» в колонке героя.
 *
 * Именно строкой, а не плиткой в три колонки: колонка узкая, и в трёх колонках
 * «Расход прогноз» переносился на две строки, а число рядом обрезалось.
 */
function StatRow({
  label,
  value,
  plan,
  tone,
}: {
  label: string;
  value: string;
  /** Плановая сумма месяца из «Бюджета». Стоит под фактом и не смешивается с ним. */
  plan?: string;
  tone?: "income" | "expense";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-[12px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <span className="shrink-0 text-right">
        <span
          className={`block font-mono tabular-nums font-semibold text-[18px] ${
            tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""
          }`}
        >
          {value}
        </span>
        {plan && (
          <span className="block text-[11.5px] text-muted font-mono tabular-nums">
            План {plan}
          </span>
        )}
      </span>
    </div>
  );
}

export function DashboardView() {
  const m = useDashboardModel();
  const transactions = useAnalyticsTransactions();
  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const { onMonth, onCategory, onAccount, onDay } = useMemo(
    () => ({
      onMonth: (ym: string) =>
        showDrill(
          monthLabel(ym),
          transactions.filter((t) => periodKey(t.date, monthStartDay) === ym),
          "Месяц"
        ),
      // Возвраты тоже берём: именно они уменьшили ту сумму, по которой кликнули.
      onCategory: (name: string) =>
        showDrill(
          name,
          transactions.filter((t) => affectsExpense(t.kind) && t.category === name),
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
    [transactions, showDrill, monthStartDay]
  );

  const over = m.pace === null ? null : m.pace - 1;

  return (
    <div className="flex flex-col gap-5 3xl:gap-6">
      {/* ── Первый экран: разворот ── */}
      {/* Колонка героя намеренно узкая и с фиксированной шириной: её содержимое
          — короткий текст и одно число, и на широком экране растянутая половина
          экрана превращалась в пустое поле. Всё, что шире, отдано данным. */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] 3xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] gap-5 3xl:gap-6">
        <div className="flex flex-col gap-5 pt-2 lg:pt-4">
          {/* Пилюля — она же заголовок страницы: другого h1 на экране нет, а
              оставлять главную вовсе без заголовка нельзя. Потому и набрана в
              полную силу — приглушённой десяткой она читалась как подпись к
              чему-то, а не как заголовок экрана. Разрядка при этом меньше
              прежней: чем крупнее буквы, тем меньше её нужно. */}
          <h1 className="self-start rounded-full px-4 py-1.5 text-[13px] uppercase tracking-[0.14em] bg-panel2 border border-border text-text font-semibold">
            {monthName(m.ym)} · осталось {m.month.left} {daysWord(m.month.left)}
          </h1>

          <div
            className={`font-mono font-semibold tabular-nums text-5xl 3xl:text-6xl leading-none tracking-tight ${
              m.free.value < 0 ? "text-expense" : ""
            }`}
            style={{ wordSpacing: "-0.22em" }}
          >
            {formatMoney(Math.abs(m.free.value), m.base)}
          </div>

          <p className="text-[16px] leading-relaxed text-muted max-w-[30ch]">
            {m.free.value < 0
              ? "Столько не хватает: расход месяца уже обогнал доход."
              : "Столько остаётся после уже потраченного и того, что ещё спишется."}
            {over !== null && (
              <>
                {" "}
                Темп на{" "}
                <span
                  className={`font-mono tabular-nums ${over >= 0 ? "text-warn" : "text-income"}`}
                >
                  {Math.abs(over * 100).toFixed(0)} %
                </span>{" "}
                {over >= 0 ? "выше" : "ниже"} обычного.
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              // Как и «Месячный отчёт» рядом: лента открывается за тот месяц,
              // о котором весь этот экран, а не за период с прошлого раза.
              to={`/transactions?month=${m.ym}`}
              className="group inline-flex h-[52px] items-center gap-3 rounded-full pl-6 pr-2.5 bg-text text-panel text-[14px] font-medium"
            >
              Лента операций
              <span className="w-8 h-8 rounded-full bg-panel/20 grid place-items-center transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none">
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
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
              className="inline-flex h-[52px] items-center rounded-full px-6 bg-panel2 border border-border text-text text-[14px] font-medium transition-colors duration-200 hover:border-accent/50 hover:bg-panel2/70"
            >
              Месячный отчёт
            </Link>
          </div>

          <div className="mt-auto border-t border-border pt-2">
            <StatRow
              label="Доход"
              value={formatMoney(m.factIncome, m.base)}
              plan={
                m.planIncome !== null
                  ? formatMoney(m.planIncome, m.base)
                  : undefined
              }
              tone="income"
            />
            <StatRow
              label="Расход"
              value={formatMoney(m.factExpense, m.base)}
              plan={
                m.planExpense !== null
                  ? formatMoney(m.planExpense, m.base)
                  : undefined
              }
              tone="expense"
            />
            <StatRow
              label="Запланированные платежи"
              value={formatMoney(m.upcomingTotalBase, m.base)}
            />
          </div>
        </div>

        {/* Справа стопка карточек; на широком экране она встаёт в два столбца,
            а не растягивается. */}
        {/* Высота строки задана явно: потолок на контейнере карточки не сжимал —
            они вылезали за него и налезали на следующий раздел. Здесь высоту
            получает сама дорожка сетки, поддоны её заполняют, а списки внутри
            начинают прокручиваться. */}
        <div className="grid gap-4 lg:grid-cols-2 lg:auto-rows-[30rem]">
          <Tray>
            <BlockTitle title="Балансы счетов" to="/accounts"
            linkLabel="Счета"
          />
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
          </Tray>

          <Tray>
            <BlockTitle title="Запланированные платежи" to="/recurring" linkLabel="Регулярные" />
            {/* Итог подан так же, как совокупный баланс у соседней карточки:
                крупным числом под заголовком. Мелкой строчкой в шапке он
                выбивался из ряда. */}
            <div
              className="font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none pb-3 mb-1 border-b border-border text-expense"
              style={{ wordSpacing: "-0.22em" }}
            >
              {formatMoney(m.upcomingTotalBase, m.base)}
            </div>
            <UpcomingList m={m} />
          </Tray>
        </div>
      </section>

      {/* ── Быстрые переходы ── */}
      {/* Стоят сразу за первым экраном, а не в самом низу страницы: внизу их
          находил только тот, кто до него доскроллил. Здесь они делят страницу
          на «что с деньгами сейчас» и «как это разглядывать» — и заодно
          отбивают первый экран от второго. */}
      <QuickLinks />

      {/* ── Второй экран: график и статьи ── */}
      {/* Высота ряда задана явно — иначе длинный список статей растягивал его
          вместе с графиком: у кого пятнадцать категорий, у того карточка
          вырастала вдвое. Теперь список прокручивается внутри. */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 3xl:gap-6 lg:auto-rows-[30rem]">
        <Tray>
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
        </Tray>

        <Tray>
          <BlockTitle
            title="Расходы по категориям"
            info={<p>Полоса показывает долю статьи от самой крупной за месяц.</p>}
            to="/categories"
            linkLabel="Категории"
          />
          <CategoriesList m={m} onCategory={onCategory} />
        </Tray>
      </section>

      {/* ── Третий ряд: активность и наблюдения, поровну ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 3xl:gap-6">
        <Tray>
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
        </Tray>

        <Tray>
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
        </Tray>
      </section>

    </div>
  );
}
