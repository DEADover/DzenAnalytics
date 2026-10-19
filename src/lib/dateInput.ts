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

/** Дней в месяце (1–12); без года — как в високосном, чтобы «29.02» не отсечь раньше времени. */
const daysIn = (m: number, y: number | null) =>
  m === 2 ? (y === null || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

/**
 * Может ли из набранного по маске получиться настоящая дата.
 *
 * Части проверяются по мере набора: день не больше 31 (первая цифра — 0–3),
 * месяц 01–12 (первая — 0 или 1), «00» — ни то, ни другое. День сверяется с
 * месяцем («31.04», «30.02» — нет), а 29 февраля — с годом, когда год набран.
 * Год — 2000-е: две цифры («26» = 2026) или четыре, начиная с «20» —
 * операций старше 2000 года не бывает, как и в `parseTypedDate`.
 */
export function isPlausibleDatePrefix(text: string): boolean {
  if (text === "") return true;
  const parts = text.split(/[./\-\s]/);
  if (parts.length > 3 || parts.some((p, i) => !/^\d*$/.test(p) || p.length > PART_LENGTHS[i]!)) return false;
  const [dd = "", mm = "", yy = ""] = parts;
  const okPart = (p: string, max: number) =>
    p.length === 0 || (p.length === 1 ? Number(p) <= Math.floor(max / 10) : Number(p) >= 1 && Number(p) <= max);
  if (!okPart(dd, 31) || !okPart(mm, 12)) return false;
  if (yy.length >= 1 && !/^[12]/.test(yy)) return false;
  if (yy.length >= 3 && !yy.startsWith("20")) return false;
  // Год известен целиком: «26» → 2026, «2026». «20» — ещё неясно: 2020 или 20xx.
  const year = yy.length === 4 ? Number(yy) : yy.length === 2 && yy !== "20" ? 2000 + Number(yy) : null;
  if (dd.length === 2 && mm.length === 2 && Number(dd) > daysIn(Number(mm), year)) return false;
  return true;
}

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
 *   • Backspace сразу за автоматической точкой стирает её вместе с цифрой;
 *   • невозможное не набирается (`isPlausibleDatePrefix`): «32», месяц
 *     «13», «31.04», «29.02.2025» — цифра просто не встаёт. Цифра, с которой
 *     двузначный день или месяц не начинается («5» дня, «3» месяца), сразу
 *     становится частью целиком: «05.», «03.».
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
  /** Отказ: текст и курсор как были. */
  const keep = { text, caret: selStart };

  if (/^\d$/.test(key)) {
    let pos = a;
    while (isSep(s[pos])) pos++;
    if (pos < s.length) {
      // Внутри набранного — замена цифры под курсором.
      let next = s.slice(0, pos) + key + s.slice(pos + 1);
      // Первая цифра части не сходится со второй («15» → «35»): вторую
      // обнуляем — «30», дальше её можно набрать.
      if (!isPlausibleDatePrefix(next) && /\d/.test(next[pos + 1] ?? "") && (pos === 0 || isSep(next[pos - 1]))) {
        next = next.slice(0, pos + 1) + "0" + next.slice(pos + 2);
      }
      if (!isPlausibleDatePrefix(next)) return keep;
      let caret = pos + 1;
      while (isSep(next[caret])) caret++;
      return { text: next, caret };
    }
    // В конце — дописываем в текущую часть; полная часть закрывается точкой.
    const parts = s.split(/[./\-\s]/);
    const idx = parts.length - 1;
    const part = parts[idx]!;
    if (idx >= PART_LENGTHS.length || part.length >= PART_LENGTHS[idx]!) return keep;
    const isLast = idx === PART_LENGTHS.length - 1;
    let next = s + key;
    if (!isLast && part.length === 0 && Number(key) > (idx === 0 ? 3 : 1)) {
      // «5» дня или «3» месяца двузначными не начинаются — это «05.», «03.».
      next = s + "0" + key + ".";
    } else if (!isLast && part.length + 1 === PART_LENGTHS[idx]) {
      next += ".";
    }
    if (!isPlausibleDatePrefix(next)) return keep;
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
    const part = parts[idx]!;
    if (part.length === 0 || idx >= PART_LENGTHS.length - 1) return { text: s, caret: s.length };
    const next = s.slice(0, s.length - part.length) + part.padStart(PART_LENGTHS[idx]!, "0") + ".";
    if (!isPlausibleDatePrefix(next)) return keep;
    return { text: next, caret: next.length };
  }

  if (key === "Backspace" && selStart === selEnd && a === s.length && a >= 2 && isSep(s[a - 1])) {
    const next = s.slice(0, a - 2);
    return { text: next, caret: next.length };
  }
  return null;
}
