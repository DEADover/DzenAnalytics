import { MONTHS_SHORT, WEEKDAYS } from "./shared";
import { median } from "../../../lib/stats";
import { pluralRu } from "../../../lib/plural";
import { CalendarDays } from "lucide-react";
import { formatMoney, formatDate, monthLabel, dayTitle } from "../../../lib/format";
import { heatStep, robustCeiling, monthEnd } from "../../../lib/dashboardModel";
import { periodRange, spanDays, localToday } from "../../../lib/period";
import type { DashboardModel } from "../../../hooks/useDashboardModel";
import { SectionEmpty } from "../../SectionEmpty";


/**
 * Активность по дням.
 *
 * У шкалы есть подписи в деньгах: «меньше / больше» не отвечало на вопрос
 * «а сколько это». Ступени строятся из токена расхода через `color-mix`,
 * поэтому тёмная тема работает по устройству, а не по совпадению.
 */
export function ActivityHeat({
  m,
  onDay,
}: {
  m: DashboardModel;
  /** Открыть операции конкретного дня. */
  onDay?: (date: string) => void;
}) {
  // Сетка остаётся КАЛЕНДАРНОЙ — месяц привычнее читать целиком. Но отчётный
  // период может начинаться не 1-го числа, и тогда он ложится на два месяца:
  // показываем тот, где лежит бо́льшая его часть («Август» с днём 28 — это
  // 28.08–27.09, то есть почти весь сентябрь), а дни вне периода гасим.
  const period = periodRange(m.ym, m.monthStartDay);
  const gridYM = (() => {
    if (m.monthStartDay === 1) return m.ym;
    // Сколько дней периода попало в его первый месяц и сколько — во второй.
    const head = spanDays(period.from, monthEnd(period.from.slice(0, 7)));
    const tail = Number(period.to.slice(8));
    return tail > head ? period.to.slice(0, 7) : period.from.slice(0, 7);
  })();
  const year = Number(gridYM.slice(0, 4));
  const monthIdx = Number(gridYM.slice(5, 7)) - 1;
  const days = new Date(year, monthIdx + 1, 0).getDate();
  const todayKey = localToday();

  const ymd = (d: number) => `${gridYM}-${String(d).padStart(2, "0")}`;
  /** День принадлежит отчётному периоду. */
  const inPeriod = (iso: string) => iso >= period.from && iso <= period.to;

  // Календарная сетка: столбец — день недели, строка — неделя месяца. Ведущие
  // пустые клетки нужны, чтобы первое число встало под свой день недели.
  const lead = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const cells: { key: string; day: number | null }[] = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `lead-${i}`, day: null });
  for (let d = 1; d <= days; d++) cells.push({ key: ymd(d), day: d });

  const spendOn = (iso: string) => m.dayMap.get(iso)?.expense ?? 0;

  // Все дни ОТЧЁТНОГО периода, а не месяца сетки: числа под календарём
  // («дней без трат», «самые дорогие дни») должны считать тот же отрезок, что
  // и остальная главная.
  // Шагаем по UTC: от локальной полуночи toISOString отдаёт предыдущий день,
  // и весь отрезок съезжал на сутки назад.
  const periodDays: string[] = [];
  for (
    let t = Date.parse(period.from + "T00:00:00Z");
    t <= Date.parse(period.to + "T00:00:00Z");
    t += 86_400_000
  ) {
    periodDays.push(new Date(t).toISOString().slice(0, 10));
  }
  const values = periodDays.map(spendOn);
  // Шкала — по устойчивому максимуму: один крупный день иначе загонял все
  // остальные в самую бледную ступень.
  const { cap } = robustCeiling(values);
  const shade = (step: number) =>
    step === 0
      ? "rgb(var(--c-panel2))"
      : `color-mix(in srgb, rgb(var(--c-expense)) ${[0, 22, 44, 68, 100][step]}%, rgb(var(--c-panel2)))`;

  const past = periodDays.filter((iso) => iso <= todayKey);
  const quiet = past.filter((iso) => spendOn(iso) <= 0).length;
  const busiest = past.reduce((best, iso) => (spendOn(iso) > spendOn(best) ? iso : best), past[0] ?? period.from);

  const avgDay = past.length ? past.reduce((a, iso) => a + spendOn(iso), 0) / past.length : 0;
  const opsCount = past.reduce((a, iso) => a + (m.dayMap.get(iso)?.count ?? 0), 0);
  // «Обычный день» — медиана по дням, где траты были. Среднее задирает один
  // крупный день, и «в среднем 10 437 ₽» перестаёт описывать обычный день.
  const spentDays = past.map(spendOn).filter((v) => v > 0);
  const medianDay = median(spentDays);
  const topDays = [...past]
    .filter((iso) => spendOn(iso) > 0)
    .sort((a, b) => spendOn(b) - spendOn(a))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex flex-col xl:flex-row xl:items-start gap-5 flex-1 min-h-0">
      {/* Колонке календаря нужна своя ширина: без неё она ужималась под
          соседний список и клетка выходила по 25 px. */}
      <div className="flex flex-col gap-2 w-full xl:w-[26rem] xl:shrink-0">
      <div className="grid grid-cols-7 gap-2 text-[11.5px] text-muted text-center max-w-[26rem] w-full">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-2 max-w-[26rem] w-full"
        role="img"
        aria-label={`Расходы по дням за ${monthLabel(gridYM)}. Самый крупный день — ${formatMoney(
          spendOn(busiest),
          m.base
        )}.`}
      >
        {cells.map((c) => {
          if (c.day === null) return <span key={c.key} />;
          const iso = ymd(c.day);
          // День за границей отчётного периода: он относится к соседнему
          // месяцу и в числах под календарём не участвует — гасим его, чтобы
          // календарь не спорил с остальным экраном.
          const outside = !inPeriod(iso);
          const future = iso > todayKey;
          const value = future || outside ? 0 : spendOn(iso);
          const step = future || outside ? 0 : heatStep(value, cap);
          // Цвет числа — по ступени, иначе оно тонет в собственной клетке.
          // Приглушённый серый годится только на пустой: на верхних ступенях он
          // давал полтора к одному по тёмной теме, на средних — два с небольшим
          // по светлой. Теперь на закрашенных клетках число полноцветное, а на
          // двух верхних, где клетка почти сплошь красная, — белое: на красном
          // оно читается в обеих темах (4,8:1 по светлой, 6,1:1 по тёмной).
          const hot = step >= 4;
          const dayTone = outside
            ? "text-muted/40"
            : future
              ? "text-muted/50"
              : hot
                ? "text-on-tone font-medium"
                : step > 0
                  ? "text-text"
                  : "text-muted";
          // Первый день периода внутри сетки отмечен кантом: видно, откуда
          // месяц считается, когда он начинается не 1-го числа.
          const startsHere = iso === period.from;
          return (
            <button
              key={c.key}
              type="button"
              disabled={outside || future || value <= 0}
              onClick={() => onDay?.(iso)}
              title={
                outside
                  ? m.monthStartDay === 1
                    ? undefined
                    : "Другой отчётный период"
                  : startsHere
                    ? "Начало отчётного периода"
                    : undefined
              }
              className={`aspect-square rounded-md flex items-center justify-center text-[13px] tabular-nums
                          transition-shadow duration-150
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                          ${dayTone}
                          ${startsHere ? "ring-1 ring-accent/60" : ""}
                          ${
                            !future && !outside && value > 0
                              ? "cursor-pointer hover:ring-2 hover:ring-accent/40"
                              : "cursor-default"
                          }`}
              style={{
                background: outside
                  ? "color-mix(in srgb, rgb(var(--c-panel2)) 40%, transparent)"
                  : future
                    ? "transparent"
                    : shade(step),
                border: future && !outside ? "1px dashed rgb(var(--c-border))" : undefined,
              }}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      {/* Отчётный период лёг на два календарных месяца: сетка показывает тот, где
          бо́льшая его часть, а числа под календарём считают весь отрезок —
          строкой говорим, какой именно. */}
      {m.monthStartDay !== 1 && (
        <div className="text-[11.5px] text-muted max-w-[26rem]">
          Отчётный период: {formatDate(period.from, "short")} — {formatDate(period.to, "short")}
        </div>
      )}

      </div>

      {/* Пустое поле справа от календаря забирают самые дорогие дни: месяц —
          это семь колонок, шире он не становится, а карточка широкая. */}
      {topDays.length > 0 && (
        <div className="flex-1 min-w-0 xl:border-l xl:border-border xl:pl-5">
          <div className="label mb-2">Самые дорогие дни</div>
          <div className="flex flex-col">
            {topDays.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDay?.(d)}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0
                           text-left rounded-lg px-2 -mx-2 transition-colors duration-200
                           hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-accent/40 group"
              >
                <span className="text-[13.5px] whitespace-nowrap">
                  {Number(d.slice(8))} {MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}
                  <span className="text-muted text-[12px]">
                    {" · "}
                    {WEEKDAYS[(new Date(d + "T00:00:00").getDay() + 6) % 7]}
                  </span>
                </span>
                <span className="font-mono tabular-nums font-semibold text-[13.5px] text-expense shrink-0">
                  {formatMoney(spendOn(d), m.base)}
                </span>
              </button>
            ))}
          </div>

          {/* Итоги месяца стоят здесь, а не полосой во всю карточку: там они
              добавляли карточке лишнюю высоту, а рядом со списком дней читаются
              как его продолжение. Строкой на каждый показатель — в две колонки
              подписи переносились. */}
          <div className="mt-4 pt-3 border-t border-border flex flex-col text-[12.5px]">
            {[
              {
                label: "Дней без трат",
                value: (
                  <>
                    {quiet}{" "}
                    <span className="text-muted font-normal text-[12px]">из {past.length}</span>
                  </>
                ),
              },
              { label: "Операций за месяц", value: opsCount },
              { label: "В среднем в день", value: formatMoney(avgDay, m.base) },
              { label: "Обычный день", value: formatMoney(medianDay, m.base) },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/60 last:border-0"
              >
                <span className="text-muted">{row.label}</span>
                <span className="font-mono tabular-nums font-semibold text-[15px] shrink-0">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Трат в периоде ещё нет — правая половина не остаётся пустой: говорим,
          почему пусто и что здесь появится. Чаще всего это первые дни месяца. */}
      {topDays.length === 0 && (
        <div className="flex-1 min-w-0 self-stretch flex items-center justify-center xl:border-l xl:border-border xl:pl-5">
          <SectionEmpty
            variant="compact"
            icon={CalendarDays}
            title={past.length <= 1 ? "Месяц только начался" : "Трат пока нет"}
          >
            {past.length <= 1 ? (
              <>
                Отчётный период начался {dayTitle(period.from)}, и трат в нём ещё
                нет. Как только они появятся, здесь будут самые дорогие дни и
                итоги месяца.
              </>
            ) : (
              <>
                За {past.length} {pluralRu(past.length, ["день", "дня", "дней"])} этого
                периода трат не было. Как только они появятся, здесь будут самые
                дорогие дни и итоги месяца.
              </>
            )}
          </SectionEmpty>
        </div>
      )}
      </div>


    </div>
  );
}
