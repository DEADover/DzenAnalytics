/**
 * Дата, набранная руками, — в ISO «YYYY-MM-DD», или `null`, если её не
 * разобрать.
 *
 * Понимает то, как даты пишут на самом деле, а не только вид в поле:
 *   • «28.03.2026», «28.3.26», «28/03/2026», «28-03-2026», «2026-03-28»;
 *   • одни цифры: «280326», «28032026», «2803» (этот год), «28» (этот месяц);
 *   • «28.03» — этот год;
 *   • «сегодня», «вчера», «завтра» (и начала этих слов: «сег», «вч»).
 * Год двумя цифрами — всегда 2000-е: операций старше 2000 года не бывает.
 * Несуществующая дата («31.02») — `null`, а не тихий перенос на март.
 *
 * `today` — ISO сегодняшнего дня: от него берутся недостающие месяц и год.
 */
export function parseTypedDate(input: string, today: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const [ty, tm, td] = today.split("-").map(Number);

  const shift = (days: number) => {
    const d = new Date(Date.UTC(ty, tm - 1, td + days));
    return d.toISOString().slice(0, 10);
  };
  if ("сегодня".startsWith(s) && s.length >= 3) return shift(0);
  if ("вчера".startsWith(s) && s.length >= 2) return shift(-1);
  if ("завтра".startsWith(s) && s.length >= 3) return shift(1);

  let d: number;
  let m: number;
  let y: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (/^\d+$/.test(s)) {
    if (s.length <= 2) [d, m, y] = [Number(s), tm, ty];
    else if (s.length === 4) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2)), ty];
    else if (s.length === 6) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4))];
    else if (s.length === 8) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4))];
    else return null;
  } else {
    const parts = s.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    d = Number(parts[0]);
    m = Number(parts[1]);
    y = parts.length === 3 ? Number(parts[2]) : ty;
  }
  if (y < 100) y += 2000;
  if (y < 1000 || m < 1 || m > 12 || d < 1) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return probe.toISOString().slice(0, 10);
}
