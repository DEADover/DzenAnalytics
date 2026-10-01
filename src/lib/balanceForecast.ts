/**
 * Прогноз остатка по запланированным операциям — пунктир на графике
 * «Совокупно» в «Счетах» от сегодня до конца выбранного периода.
 *
 * Остаток сегодня — последняя точка настоящей кривой; дальше к нему
 * прибавляется каждая запланированная операция в свой день. Считаются только
 * выбранные счета: расход и доход — по своему счёту, перевод — по обеим
 * сторонам (между двумя выбранными он ничего не меняет).
 *
 * Просроченные планы в прогноз не идут: случится ли платёж, который уже не
 * случился в срок, неизвестно, а дату ему не угадать. Планы на сегодня ложатся
 * на ближайшую точку после сегодня: в сам день у графика уже есть настоящий
 * остаток, и вторую величину на ту же дату линия не нарисует.
 */

export interface ForecastOp {
  date: string;
  kind: "expense" | "income" | "transfer";
  /** Сумма в базовой валюте — списание у расхода и перевода, зачисление у дохода. */
  amountBase: number;
  /** Зачисление перевода в базовой валюте (`null` — как списание). */
  toAmountBase: number | null;
  account: string;
  toAccount: string | null;
  /** Подпись для подсказки: получатель, комментарий или категория. */
  title: string;
}

/** Как план меняет остаток выбранных счетов. */
export function planDelta(op: ForecastOp, picked: (account: string) => boolean): number {
  if (op.kind === "expense") return picked(op.account) ? -op.amountBase : 0;
  if (op.kind === "income") return picked(op.account) ? op.amountBase : 0;
  let d = 0;
  if (picked(op.account)) d -= op.amountBase;
  if (op.toAccount && picked(op.toAccount)) d += op.toAmountBase ?? op.amountBase;
  return d;
}

export interface ForecastPoint {
  date: string;
  forecast: number;
  /** Планы, легшие на эту точку, — для подсказки. */
  ops: { title: string; delta: number }[];
}

/**
 * Точки прогноза: первая — сегодня с настоящим остатком (чтобы пунктир
 * продолжал линию), затем по точке на каждый день с планами и последняя — на
 * конец периода. Пусто, если периода впереди нет или планов в нём нет.
 */
export function balanceForecast(
  todayBalance: number,
  ops: ForecastOp[],
  picked: (account: string) => boolean,
  today: string,
  until: string
): ForecastPoint[] {
  if (until <= today) return [];
  const byDay = new Map<string, { title: string; delta: number }[]>();
  for (const op of ops) {
    if (op.date < today || op.date > until) continue;
    const delta = planDelta(op, picked);
    if (delta === 0) continue;
    const day = op.date === today ? null : op.date;
    const key = day ?? "\u0000today";
    const list = byDay.get(key) ?? [];
    list.push({ title: op.title, delta });
    byDay.set(key, list);
  }
  if (byDay.size === 0) return [];

  const carried = byDay.get("\u0000today") ?? [];
  byDay.delete("\u0000today");
  const days = [...byDay.keys()].sort();
  // Все планы — на сегодня: им нужна своя точка, ближайшая — завтра.
  if (days.length === 0) days.push(nextDay(today));

  const out: ForecastPoint[] = [{ date: today, forecast: todayBalance, ops: [] }];
  let balance = todayBalance;
  for (const [i, day] of days.entries()) {
    const dayOps = [...(i === 0 ? carried : []), ...(byDay.get(day) ?? [])];
    for (const o of dayOps) balance += o.delta;
    out.push({ date: day, forecast: balance, ops: dayOps });
  }
  if (out[out.length - 1].date < until) out.push({ date: until, forecast: balance, ops: [] });
  return out;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
