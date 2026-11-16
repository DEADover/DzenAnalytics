/**
 * «Итоги месяца» — заголовочный виджет: сколько осталось от дохода, темп трат,
 * доход и расход с планом.
 *
 * Месяц либо выбирают в самой пилюле (идущий или прошлый), либо он приходит
 * снаружи — когда на главной включены «Фильтры и выбор месяца».
 */

import { useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { CtaLink } from "../../CtaLink";
import { Popover } from "../../Popover";
import { ProgressBar } from "../../ProgressBar";
import { formatMoney, formatDate } from "../../../lib/format";
import { pluralRu } from "../../../lib/plural";
import { periodRange } from "../../../lib/period";
import type { DashboardModel } from "../../../hooks/useDashboardModel";

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
          // На телефоне колонка — полэкрана, и 30 px резали «150 000 ₽» многоточием.
          dense ? "text-[19px]" : "text-[22px] sm:text-[30px]",
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

/* ─────────────────────────────  итоги месяца  ───────────────────────────── */

/**
 * Что это за период и откуда он взялся — подсказкой к пилюле. Первый день
 * месяца приезжает из настроек Дзен-мани молча, и человек вправе спросить,
 * почему «Сентябрь» начинается пятнадцатого.
 */
function monthPillHint(m: DashboardModel): string {
  const r = periodRange(m.ym, m.monthStartDay);
  const span = `Отчётный период: ${formatDate(r.from, "full")} — ${formatDate(r.to, "full")}.`;
  if (m.monthStartDaySource === "calendar") {
    return `${span} Месяц календарный; свой первый день задаётся в «Настройки → Расчёты».`;
  }
  const day = `Месяц начинается ${m.monthStartDay}-го числа`;
  return m.monthStartDaySource === "zen"
    ? `${span} ${day} — так задано в Дзен-мани.`
    : `${span} ${day} — так задано в «Настройки → Расчёты».`;
}

/** Месяц уже прошёл — показан прошлый месяц из переключателя. */
function isClosed(m: DashboardModel): boolean {
  return !m.month.running && m.month.progress >= 1;
}

/**
 * Сколько периода осталось — хвост пилюли. Сегодняшний день считается
 * оставшимся, как в «Свободных деньгах» (`periodDayCount`), поэтому последний
 * день — это `left === 1`.
 */
function monthLeft(m: DashboardModel): string {
  if (isClosed(m)) return "Месяц завершён";
  return m.month.running && m.month.left <= 1
    ? "Последний день"
    : `Осталось ${m.month.left} ${pluralRu(m.month.left, ["день", "дня", "дней"])}`;
}

/**
 * Пилюля периода: название, его даты и остаток — через тонкие разделители.
 *
 * Разделители, а не точки: тремя равноправными кусками через точку строка
 * читалась одной длинной фразой, в которой ничего не главное. Даты и остаток
 * набраны обычным регистром — в сплошном капсе с широким трекингом они
 * сливались с названием. Даты показываем, только когда месяц не календарный:
 * там они ничего не добавляют.
 */
function MonthPill({ m, size }: { m: DashboardModel; size: "sm" | "md" }) {
  const shifted = m.monthStartDay !== 1;
  const r = periodRange(m.ym, m.monthStartDay);
  const sep = (
    <span
      aria-hidden="true"
      className={`w-px self-center bg-border ${size === "md" ? "h-3.5" : "h-3"}`}
    />
  );
  return (
    <span
      className={`inline-flex flex-wrap items-baseline justify-center ${
        size === "md" ? "gap-x-2.5" : "gap-x-2"
      }`}
    >
      <span>{monthName(m.ym)}</span>
      {shifted && (
        <>
          {sep}
          <span className="tabular-nums tracking-normal normal-case font-medium text-muted">
            {formatDate(r.from, "short").slice(0, 5)}
            {" – "}
            {formatDate(r.to, "short").slice(0, 5)}
          </span>
        </>
      )}
      {sep}
      <span className="tracking-normal normal-case text-muted">{monthLeft(m)}</span>
    </span>
  );
}

/**
 * Пилюля месяца с выбором «текущий / прошлый» — как «Другие периоды» в
 * Дзен-мани. Пилюля остаётся заголовком виджета, только теперь по ней можно
 * кликнуть: шеврон говорит, что там выбор. Числа виджета переключаются на
 * выбранный месяц целиком — доход, расход, план и остаток.
 */
function MonthSwitch({
  m,
  current,
  which,
  onChange,
  size,
}: {
  /** Модель выбранного месяца — для подписи на пилюле. */
  m: DashboardModel;
  /** Модель главной — названия текущего и прошлого месяцев для меню. */
  current: DashboardModel;
  which: "current" | "prev";
  onChange: (next: "current" | "prev") => void;
  size: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items = [
    { id: "current" as const, label: `${monthName(current.ym)} (текущий месяц)` },
    { id: "prev" as const, label: `${monthName(current.prevMonth.ym)} (прошлый месяц)` },
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={monthPillHint(m)}
        className="inline-flex items-center gap-2 uppercase hover:opacity-80"
      >
        <MonthPill m={m} size={size} />
        <ChevronDown
          className={clsx(
            "shrink-0 text-muted transition-transform duration-200",
            size === "md" ? "w-4 h-4" : "w-3.5 h-3.5",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} className="card p-1 w-max text-[13px]">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="menuitemradio"
            aria-checked={which === it.id}
            onClick={() => {
              setOpen(false);
              onChange(it.id);
            }}
            className={clsx(
              "w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 hover:bg-panel2 normal-case tracking-normal",
              which === it.id ? "text-accent font-medium" : "text-text font-normal"
            )}
          >
            <Check className={clsx("w-4 h-4 shrink-0", which !== it.id && "invisible")} aria-hidden />
            {it.label}
          </button>
        ))}
      </Popover>
    </>
  );
}

/**
 * «Итоги месяца» с выбором месяца: текущий или прошлый. Выбор живёт в самом
 * виджете и не запоминается — открыли главную, видите текущий месяц, как в
 * Дзен-мани.
 */
export function MonthHero({
  m,
  view,
  fixed = false,
}: {
  m: DashboardModel;
  view: string | undefined;
  /**
   * Месяц выбран снаружи — листанием в шапке главной («Фильтры и выбор
   * месяца»). Своего выбора у пилюли тогда нет, а заголовок страницы — не она.
   */
  fixed?: boolean;
}) {
  const [which, setWhich] = useState<"current" | "prev">("current");
  const shown: DashboardModel = !fixed && which === "prev" ? { ...m, ...m.prevMonth } : m;
  const pill = (size: "sm" | "md") =>
    fixed ? (
      <MonthPill m={m} size={size} />
    ) : (
      <MonthSwitch m={shown} current={m} which={which} onChange={setWhich} size={size} />
    );
  const titleTag = fixed ? "h2" : "h1";
  if (view === "split") return <HeroSplit m={shown} pill={pill("sm")} titleTag={titleTag} />;
  return <HeroOpen m={shown} sunken={view === "framed"} pill={pill("md")} titleTag={titleTag} />;
}

/**
 * Вариант «Открытый»: без поддона, крупная типографика на голом фоне страницы.
 * В обойме с двойным кантом он читался бы как ещё одна карточка с числом, а это
 * заголовок всего экрана.
 */
function HeroOpen({
  m,
  sunken,
  pill,
  titleTag: Title = "h1",
}: {
  m: DashboardModel;
  sunken?: boolean;
  pill: ReactNode;
  /** На странице со своим заголовком пилюля — заголовок второго уровня. */
  titleTag?: "h1" | "h2";
}) {
  const over = m.pace === null ? null : m.pace - 1;
  const past = isClosed(m);
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
      <Title
        className={`self-start rounded-full px-4 py-1.5 text-[13px] uppercase tracking-[0.14em] border border-border text-text font-semibold ${
          sunken ? "bg-panel" : "bg-panel2"
        }`}
      >
        {pill}
      </Title>

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

      {/* Высота — ровно три строки, сколько бы их ни было на деле: фраза
          бывает в одну строку («…после всех трат месяца.») и в три (с темпом
          трат), и кнопки под ней прыгали при переключении месяца.
          4.875em = 3 строки × межстрочный 1.625. */}
      <p
        className={clsx(
          "leading-relaxed text-muted max-w-[30ch] min-h-[4.875em]",
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
        {over !== null && Math.abs(over) < 0.005 &&
          (past ? ", и потратили примерно как обычно." : ", и тратите примерно как обычно.")}
        {over !== null && Math.abs(over) >= 0.005 && (
          <>
            {(m.free.value < 0) !== (over >= 0)
              ? past ? ", хотя потратили на " : ", хотя тратите на "
              : past ? ", и потратили на " : ", и тратите на "}
            <span className={`font-mono tabular-nums ${over >= 0 ? "text-warn" : "text-income"}`}>
              {Math.abs(over * 100).toFixed(0)}%
            </span>
            {past
              ? over >= 0 ? " больше обычного." : " меньше обычного."
              : over >= 0 ? " быстрее обычного." : " медленнее обычного."}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* Лента и итоги открываются за тот месяц, о котором весь этот экран,
            а не за период с прошлого раза или всю историю. Итоги — разбор
            месяца в «Дайджесте» («Главное за …», траты по дням, где тратили):
            таблица «Доходов и расходов» в один столбец на итоги не тянула. На
            утопленной подложке вторая кнопка белая: обычная заливка там почти
            пропадала. */}
        <CtaLink to={`/transactions?month=${m.ym}`} size={sunken ? "md" : "lg"}>
          Лента операций
        </CtaLink>
        <CtaLink
          to={`/digest?month=${m.ym}`}
          variant="secondary"
          size={sunken ? "md" : "lg"}
          onPlate={sunken}
        >
          Разбор месяца
        </CtaLink>
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
function HeroSplit({
  m,
  pill,
  titleTag: Title = "h1",
}: {
  m: DashboardModel;
  pill: ReactNode;
  titleTag?: "h1" | "h2";
}) {
  const over = m.pace === null ? null : m.pace - 1;
  const short = m.free.value < 0;
  const past = isClosed(m);
  return (
    <>
      <Title
        className="self-start rounded-full px-3.5 py-1 text-[11px] uppercase tracking-[0.14em] bg-panel2 border border-border text-text font-semibold"
      >
        {pill}
      </Title>

      {/* Разворот раскрывается только там, где колонка достаточно широка. На
          экранах до 1280 треть сетки — около 320 пикселей, и рядом с рейкой
          крупному числу не остаётся места: тогда рейка уходит вниз, а волосок
          из вертикального становится горизонтальным. */}
      {/* Рейка справа — постоянной ширины, а не по содержимому: «На счетах в
          конце» у прошлого месяца шире, чем «На счетах» у текущего, и
          волосок уезжал при переключении месяца. 10rem вмещают самую длинную
          подпись и суммы до десятков миллионов. */}
      <div className="flex-1 min-h-0 mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_1px_10rem]">
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

          {/* Три строки под текст всегда — кнопки ниже не прыгают от его длины. */}
          <p className="text-[13.5px] leading-relaxed text-muted mt-3 min-h-[4.875em]">
            {/* Причину нехватки называем ту, что есть на самом деле: доход может
                быть больше расхода, а в минус уводить ещё не списанные платежи. */}
            {short
              ? "Расход месяца обогнал доход."
              : "Доход месяца за вычетом всего, что уже потрачено."}
            {over !== null && Math.abs(over) < 0.005 &&
              (past ? " Потратили примерно как обычно." : " Тратите примерно как обычно.")}
            {over !== null && Math.abs(over) >= 0.005 && (
              <>
                {past ? " Траты на " : " Темп трат на "}
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
            <CtaLink to={`/transactions?month=${m.ym}`}>Лента операций</CtaLink>
            <CtaLink to={`/digest?month=${m.ym}`} variant="secondary">
              Разбор месяца
            </CtaLink>
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
            <ProgressBar value={m.month.progress} label="Сколько месяца прошло" />
          </div>
        </div>

        <div className="bg-border" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 content-start xl:flex xl:flex-col xl:justify-between">
          <RailRow label="Доход" value={formatMoney(m.factIncome, m.base)} tone="income" />
          <div className="hidden xl:block h-px bg-border" />
          <RailRow label="Расход" value={formatMoney(m.factExpense, m.base)} tone="expense" />
          <div className="hidden xl:block h-px bg-border" />
          <RailRow label={past ? "На счетах в конце" : "На счетах"} value={formatMoney(m.netWorth, m.base)} />
        </div>
      </div>
    </>
  );
}
