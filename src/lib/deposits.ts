/**
 * Планируемая доходность вкладов (issue #81).
 *
 * Дзен-мани хранит у вклада всё, что нужно для расчёта: дату открытия, срок,
 * ставку, периодичность начисления и капитализацию. Мы их и раньше выгружали —
 * они приезжают в том же обмене, что и остатки, и правятся в карточке счёта, —
 * но нигде не считали. Здесь считаем.
 *
 * Что считаем и чего НЕ считаем. Проценты берутся от ТЕКУЩЕГО остатка: это
 * прогноз «сколько набежит, если ничего не трогать», а не выписка банка.
 * Пополнения и снятия внутри срока не учитываются — их никто не обещал, и
 * притворяться, что мы знаем будущие взносы, нечестно. Налог с процентов тоже
 * не считаем: он зависит от ключевой ставки и всех вкладов человека сразу,
 * включая те, которых в Дзен-мани нет.
 */

import type { ZenTermUnit } from "./zenmoney";

/** Параметры вклада — ровно те поля, что приезжают из Дзен-мани. */
export interface DepositTerms {
  /** Годовая ставка, %. */
  percent: number | null;
  /** Дата открытия, ISO. */
  startDate: string | null;
  /** Срок: сколько единиц и каких. */
  endDateOffset: number | null;
  endDateOffsetInterval: ZenTermUnit | null;
  /** Периодичность начисления процентов. */
  payoffStep: number | null;
  payoffInterval: ZenTermUnit | null;
  /** Капитализация: проценты остаются на вкладе и сами начинают работать. */
  capitalization: boolean | null;
}

export interface DepositProjection {
  /** Годовая ставка, % — та же, что задана у счёта. */
  percent: number;
  /** Конец срока, ISO. */
  endDate: string;
  /** Сколько дней осталось. Ноль — срок вышел. */
  daysLeft: number;
  /** Весь срок в днях. */
  daysTotal: number;
  /** Сколько раз в год начисляются проценты. `null` — периодичность не задана. */
  payoutsPerYear: number | null;
  /** Проценты за ВЕСЬ срок от текущего остатка. */
  interestTotal: number;
  /** Сколько ещё набежит с сегодняшнего дня до конца срока. */
  interestLeft: number;
  /** Остаток на конец срока: текущий плюс то, что ещё набежит. */
  atMaturity: number;
  /** Капитализация учтена в расчёте. */
  compounded: boolean;
}

/** Сколько дней в одной единице срока. Месяц и год — средние: банк считает по
 *  календарю, но для прогноза «сколько набежит» этой точности достаточно. */
const DAYS: Record<ZenTermUnit, number> = {
  day: 1,
  week: 7,
  month: 30.4375,
  year: 365.25,
};

/**
 * Срок в годах — из самих единиц договора, а не через дни.
 *
 * Через дни годичный вклад давал 0,9993 года: год округляется до 365 дней, а
 * делится на 365,25 — и ставка 12 % превращалась в 11,99 %. Договор оперирует
 * годами и месяцами, ими и считаем: год это год, двенадцать месяцев — тоже.
 * Дни нужны только для даты окончания и для остатка срока.
 */
function termYears(offset: number, unit: ZenTermUnit): number {
  if (unit === "year") return offset;
  if (unit === "month") return offset / 12;
  return (offset * DAYS[unit]) / 365.25;
}

/** Дата плюс столько-то дней, ISO. Локальная арифметика, как везде в проекте. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Math.round(days));
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Разница в днях между двумя ISO-датами. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Прогноз по одному вкладу. `null` — считать не из чего: нет ставки, даты
 * открытия или срока. Молчать в таком случае честнее, чем показать ноль:
 * ноль означал бы «вклад ничего не принесёт».
 */
export function projectDeposit(
  balance: number,
  terms: DepositTerms,
  todayIso: string
): DepositProjection | null {
  const { percent, startDate, endDateOffset, endDateOffsetInterval } = terms;
  if (!percent || percent <= 0) return null;
  if (!startDate || !endDateOffset || !endDateOffsetInterval) return null;
  if (!(balance > 0)) return null;

  const daysTotal = Math.round(endDateOffset * DAYS[endDateOffsetInterval]);
  if (daysTotal <= 0) return null;
  const endDate = addDays(startDate, daysTotal);
  const daysLeft = Math.max(0, daysBetween(todayIso, endDate));

  const rate = percent / 100;
  const yearsTotal = termYears(endDateOffset, endDateOffsetInterval);
  // Остаток срока — величина календарная, её честно мерить днями.
  const yearsLeft = daysLeft / 365.25;

  // Периодичность начисления: сколько раз в год проценты падают на вклад.
  const payoutsPerYear =
    terms.payoffStep && terms.payoffStep > 0 && terms.payoffInterval
      ? 365.25 / (terms.payoffStep * DAYS[terms.payoffInterval])
      : null;
  // Капитализация имеет смысл только когда известно, КАК ЧАСТО начисляют:
  // без периодичности сложный процент не от чего считать, и берём простой.
  const compounded = terms.capitalization === true && payoutsPerYear !== null;

  const grow = (years: number) =>
    compounded && payoutsPerYear
      ? Math.pow(1 + rate / payoutsPerYear, payoutsPerYear * years) - 1
      : rate * years;

  const interestTotal = balance * grow(yearsTotal);
  const interestLeft = balance * grow(yearsLeft);
  return {
    percent,
    endDate,
    daysLeft,
    daysTotal,
    payoutsPerYear,
    interestTotal,
    interestLeft,
    atMaturity: balance + interestLeft,
    compounded,
  };
}

/** Строка свода: счёт вместе со своим прогнозом. */
export interface DepositRow<T> {
  account: T;
  balance: number;
  projection: DepositProjection;
}

/** Итог по всем вкладам — то, ради чего свод и собирают. */
export interface DepositTotals {
  balance: number;
  interestLeft: number;
  atMaturity: number;
  /** Средняя ставка, взвешенная по остатку: у вклада на миллион под 20 % и
   *  вклада на тысячу под 5 % средняя «12,5 %» была бы бессмыслицей. */
  avgPercent: number;
}

export function depositTotals<T>(rows: DepositRow<T>[]): DepositTotals {
  let balance = 0;
  let interestLeft = 0;
  let weighted = 0;
  for (const r of rows) {
    balance += r.balance;
    interestLeft += r.projection.interestLeft;
  }
  // Взвешиваем СТАВКОЙ, а не набежавшими процентами: у вкладов разный срок, и
  // сравнивать сумму процентов вместо годовой ставки значило бы называть более
  // длинный вклад более выгодным.
  for (const r of rows) weighted += r.balance * r.projection.percent;
  return {
    balance,
    interestLeft,
    atMaturity: balance + interestLeft,
    avgPercent: balance > 0 ? weighted / balance : 0,
  };
}
