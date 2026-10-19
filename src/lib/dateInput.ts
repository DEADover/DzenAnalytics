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
  // Маска поля ставит точку сама, сразу после дня или месяца: «28.» — это
  // ещё не мусор, а дата на полуслове.
  const s = input.trim().toLowerCase().replace(/[./\-\s]+$/, "");
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

/** Разделители, которые человек набирает между днём, месяцем и годом. */
const SEPARATOR_KEYS = new Set([".", ",", "/", "-", " "]);
/** Сколько цифр в каждой части: день, месяц, год. */
const PART_LENGTHS = [2, 2, 4];

/**
 * Нажатие клавиши в поле даты по маске «дд.мм.гггг» — новый текст и место
 * курсора, или `null`, если клавишу маска не трогает (её обработает браузер).
 *
 * Без маски цифры вставлялись между набранными: щёлкнули после «15» в
 * «15.10.2026», набрали «18» — получили «1518.10.2026» (#125). Теперь:
 *   • цифра ЗАМЕНЯЕТ цифру под курсором, а не раздвигает текст; точку
 *     курсор перешагивает сам;
 *   • в конце цифры дописываются, и после полного дня и месяца точка
 *     встаёт сама: «18» → «18.», дальше уже месяц;
 *   • точка (запятая, «/», «-», пробел) после одной цифры дописывает ноль:
 *     «5.» → «05.»;
 *   • Backspace сразу за автоматической точкой стирает её вместе с цифрой.
 * Слова («вчера») маска не трогает: в тексте с буквами — `null`.
 */
export function applyDateMaskKey(
  text: string,
  selStart: number,
  selEnd: number,
  key: string
): { text: string; caret: number } | null {
  if (/[^\d./\-\s]/.test(text)) return null;
  const isSep = (c: string | undefined) => c !== undefined && /[./\-\s]/.test(c);
  const allSelected = selStart === 0 && selEnd === text.length && text.length > 0;
  const s = allSelected ? "" : text;
  const a = allSelected ? 0 : selStart;

  if (/^\d$/.test(key)) {
    let pos = a;
    while (isSep(s[pos])) pos++;
    if (pos < s.length) {
      // Внутри набранного — замена цифры под курсором.
      const next = s.slice(0, pos) + key + s.slice(pos + 1);
      let caret = pos + 1;
      while (isSep(next[caret])) caret++;
      return { text: next, caret };
    }
    // В конце — дописываем в текущую часть; полная часть закрывается точкой.
    const parts = s.split(/[./\-\s]/);
    const idx = parts.length - 1;
    if (idx >= PART_LENGTHS.length || parts[idx].length >= PART_LENGTHS[idx]) return { text: s, caret: s.length };
    let next = s + key;
    if (parts[idx].length + 1 === PART_LENGTHS[idx] && idx < PART_LENGTHS.length - 1) next += ".";
    return { text: next, caret: next.length };
  }

  if (SEPARATOR_KEYS.has(key)) {
    if (a < s.length) {
      // В середине — просто перешагнуть к следующей части.
      let caret = a;
      while (caret < s.length && !isSep(s[caret])) caret++;
      if (caret < s.length) caret++;
      return { text: s, caret };
    }
    const parts = s.split(/[./\-\s]/);
    const idx = parts.length - 1;
    const part = parts[idx];
    if (part.length === 0 || idx >= PART_LENGTHS.length - 1) return { text: s, caret: s.length };
    const next = s.slice(0, s.length - part.length) + part.padStart(PART_LENGTHS[idx], "0") + ".";
    return { text: next, caret: next.length };
  }

  if (key === "Backspace" && selStart === selEnd && a === s.length && a >= 2 && isSep(s[a - 1])) {
    const next = s.slice(0, a - 2);
    return { text: next, caret: next.length };
  }
  return null;
}
