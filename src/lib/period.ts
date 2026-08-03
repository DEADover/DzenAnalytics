/**
 * Reporting-period helpers.
 *
 * Many people don't think of a "month" as 1st–31st but as a billing
 * window — e.g. salary on the 11th, so 11th → 10th of the next month
 * is their reporting period. These helpers let aggregations and filters
 * speak in terms of a configurable `startDay` (1–28).
 *
 * Convention: a period is identified by the `YYYY-MM` string of its
 * START month. So period `2026-05` with `startDay=11` spans
 * `11/05/2026 → 10/06/2026`. Period `2026-05` with `startDay=1` (the
 * default) collapses to plain calendar May — every helper here returns
 * the same result as the old calendar-month code path, so callers that
 * don't pass `startDay` keep working unchanged.
 *
 * Reasoning behind 28-day max: 29/30/31 don't exist in every month and
 * would make some periods ambiguous. The UI also caps the picker at 28
 * for the same reason.
 */

/**
 * Which billing period does this date fall into?
 *
 * Returns the period identifier as `YYYY-MM` of the period's START month.
 * If the date's day-of-month is ≥ `startDay`, the period started this
 * calendar month. Otherwise it started last calendar month.
 *
 * @example
 *   periodKey("2026-05-15", 11) // "2026-05"  (within 11/05 → 10/06)
 *   periodKey("2026-05-05", 11) // "2026-04"  (still within 11/04 → 10/05)
 *   periodKey("2026-05-15", 1)  // "2026-05"  (plain calendar month)
 */
export function periodKey(isoDate: string, startDay: number = 1): string {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (d >= startDay) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Calendar-date range of the billing period identified by `ym`.
 *
 * @example
 *   periodRange("2026-05", 11) // { from: "2026-05-11", to: "2026-06-10" }
 *   periodRange("2026-05", 1)  // { from: "2026-05-01", to: "2026-05-31" }
 */
export function periodRange(
  ym: string,
  startDay: number = 1
): { from: string; to: string } {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = new Date(y, m - 1, startDay);
  // Day before the next period starts = last day of this period.
  const end = new Date(y, m, startDay - 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

/**
 * The billing period that today's date falls into.
 *
 * Accepts an optional `today` for tests / deterministic snapshots.
 */
export function currentPeriod(
  startDay: number = 1,
  today: Date = new Date()
): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  if (d >= startDay) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Shift a period identifier by N billing months. Internally the same as
 * shifting the start-month index — billing-period strings stay sortable
 * lexicographically and step by exactly one calendar month at a time.
 */
export function shiftPeriod(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Отрезок дат, обе границы включительно. */
export interface DayRange {
  from: string;
  to: string;
}

/** Сколько дней в отрезке, считая обе границы. 0 у пустого или вывернутого. */
export function spanDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Идёт ли период прямо сейчас — то есть кончаются ли данные внутри него, не
 * доходя до его календарного конца.
 *
 * Это НЕ то же самое, что «период обрезан». Выравнивание равных отрезков режет
 * и вполне законченный месяц: январь против идущего марта даёт обоим по 30 дн.,
 * и январь оказывается обрезан, хотя давно закончился. Назвать его «идущим»
 * значит соврать пользователю о том, почему суммы неполные.
 */
export function isRunningPeriod(
  full: { from: string; to: string } | null | undefined,
  maxDate: string | null | undefined
): boolean {
  if (!full || !maxDate) return false;
  return maxDate >= full.from && maxDate < full.to;
}

/** Последний день отрезка, который начинается в `from` и длится `days` дней. */
export function endAfterDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Разобрать «ГГГГ-ММ-ДД» как ЛОКАЛЬНУЮ полночь.
 *
 * `new Date("2026-08-02")` — это полночь UTC, а не местная. В поясе западнее
 * Гринвича у такой даты `getDate()` вернёт первое августа, а не второе. Поэтому
 * везде, где дальше идут локальные `getFullYear` / `setDate`, разбирать надо так.
 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Обратно в «ГГГГ-ММ-ДД» по ЛОКАЛЬНЫМ полям.
 *
 * Парная к {@link parseIsoDate}. Смешивать её с `toISOString()` нельзя: тот
 * переводит в UTC, и дата, собранная локальным конструктором, уезжает на сутки.
 * Ровно так «с начала года» затягивало 31 декабря прошлого года в поясе UTC+3.
 */
export function toIsoDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Сдвинуть дату на `delta` дней (отрицательный — назад). */
export function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * `count` периодов, идущих ПЕРЕД `current`, — основа для «среднего за N месяцев».
 *
 * Считаются по-разному, и это важно:
 *
 *  • если период — отчётный месяц (`monthYM` задан), шагаем МЕСЯЦАМИ, уважая
 *    свой первый день отчётного месяца. Иначе на месяцах разной длины окна
 *    поехали бы: три «31-дневных шага» назад от марта не попадают в декабрь;
 *  • иначе берём равные отрезки той же длины в днях — для «30 дней», «90 дней»
 *    и произвольного диапазона это единственное осмысленное толкование.
 *
 * Сам `current` в результат не входит: среднее считается по тому, что БЫЛО
 * раньше, — с ним и сравнивают текущий период.
 */
export function previousWindows(
  current: DayRange,
  count: number,
  monthYM: string | null,
  monthStartDay: number = 1
): DayRange[] {
  const out: DayRange[] = [];
  if (count <= 0) return out;
  if (monthYM) {
    for (let k = 1; k <= count; k++) {
      out.push(periodRange(shiftPeriod(monthYM, -k), monthStartDay));
    }
    return out;
  }
  const len = spanDays(current.from, current.to);
  if (len <= 0) return out;
  for (let k = 1; k <= count; k++) {
    const from = shiftDays(current.from, -len * k);
    out.push({ from, to: endAfterDays(from, len) });
  }
  return out;
}

/**
 * Подрезать каждое окно до `days` дней — тот же смысл, что у
 * {@link comparableRanges}, но для набора окон сразу: идущий месяц сравнивается
 * не с целыми предыдущими, а с их такими же началами.
 *
 * Окно короче `days` (февраль против 31-дневного марта) остаётся как есть —
 * дальше своего конца оно не тянется.
 */
export function alignWindows(windows: DayRange[], days: number): DayRange[] {
  if (days <= 0) return windows;
  return windows.map((w) => {
    const end = endAfterDays(w.from, days);
    return end < w.to ? { from: w.from, to: end } : w;
  });
}

/**
 * Привести два периода к сопоставимому виду для сравнения (issue #37).
 *
 * Делает две вещи:
 *
 *  1. Обрезает оба по `maxDate` — дальше последней операции данных всё равно
 *     нет, и «01.08 → 31.08» на третье августа вводит в заблуждение.
 *  2. Если после обрезки хотя бы один период оказался НЕПОЛНЫМ (то есть он ещё
 *     идёт), укорачивает оба до длины короткого. Это и есть «1–3 августа против
 *     1–3 июля» из мобильного приложения: три дня против тридцати одного не
 *     говорят ни о чём, а вот три против трёх показывают импульсивные траты.
 *
 * Ключевое условие — «хотя бы один неполный». Два ЗАКОНЧЕННЫХ месяца
 * сравниваются целиком, даже когда в них разное число дней: молча выкинуть
 * 29–31 января ради равенства с февралём — это потерять данные, о которых
 * пользователь не просил.
 */
export function comparableRanges(
  a: DayRange,
  b: DayRange,
  maxDate: string,
  align: boolean
): { a: DayRange; b: DayRange } {
  if (!a.from || !a.to || !b.from || !b.to) return { a, b };
  const clamp = (r: DayRange): DayRange =>
    maxDate && maxDate < r.to && maxDate >= r.from ? { from: r.from, to: maxDate } : r;
  const ca = clamp(a);
  const cb = clamp(b);
  if (!align) return { a: ca, b: cb };
  // Период, который не дотянул до своего конца, — это текущий, ещё идущий.
  const partial = ca.to !== a.to || cb.to !== b.to;
  if (!partial) return { a: ca, b: cb };
  const n = Math.min(spanDays(ca.from, ca.to), spanDays(cb.from, cb.to));
  if (n <= 0) return { a: ca, b: cb };
  return {
    a: { from: ca.from, to: endAfterDays(ca.from, n) },
    b: { from: cb.from, to: endAfterDays(cb.from, n) },
  };
}
