/**
 * Сколько месяцев прогноза показывать на графике «Cash-flow».
 *
 * Прогноз продолжает историю: он начинается сразу за последним месяцем с
 * операциями. Поэтому он уместен, только когда выбранный период до этого
 * месяца доходит. Выбрали прошлый год — прогноза нет: к прошлому он ничего не
 * добавляет, а ось растягивал до будущего.
 *
 * Длина — не больше половины показанной истории (и не больше `max`): на
 * квартале шесть прогнозных месяцев занимали бы две трети ширины, и смотреть
 * на сами данные было бы почти негде. Период, который заканчивается в
 * будущем, прогноз заполняет ровно до своего конца (но не дальше `max`):
 * на графике «2026 год» нет января следующего.
 *
 * `lastHistYm` — последний месяц истории, `periodEndYm` — месяц, в котором
 * заканчивается период (`null` — период без конца, «Всё время»), оба в виде
 * `YYYY-MM`. `shownMonths` — сколько месяцев истории на графике.
 */
export function forecastMonths(opts: {
  lastHistYm: string | null;
  periodEndYm: string | null;
  shownMonths: number;
  max?: number;
}): number {
  const { lastHistYm, periodEndYm, shownMonths } = opts;
  const max = opts.max ?? 6;
  if (!lastHistYm || shownMonths <= 0) return 0;
  if (periodEndYm && periodEndYm < lastHistYm) return 0;
  if (periodEndYm && periodEndYm > lastHistYm) return Math.min(max, ymIndex(periodEndYm) - ymIndex(lastHistYm));
  return Math.min(max, Math.max(1, Math.ceil(shownMonths / 2)));
}

function ymIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}
