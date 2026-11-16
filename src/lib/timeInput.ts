/**
 * Время, набранное руками, — всегда в 24-часовом виде «ЧЧ:ММ».
 *
 * Родное поле времени браузер рисует по языку системы: на английской системе
 * в нём «02:30 PM», и от страницы это не зависит. Поэтому поле своё — текст
 * по маске, без «AM/PM» при любом языке.
 */

const SEPARATORS = /[:.,\-\s]/;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Привести набранное к маске «ЧЧ:ММ»: лишнее отбросить, двоеточие поставить.
 *
 *   • «9» — это уже «09:»: часа «9x» не бывает;
 *   • «25» — «02:5»: часа 25 нет, значит, пятёрка — минуты;
 *   • «127» — «12:07»: минут «7x» не бывает;
 *   • «9:3», «9.30», «9 30» — разделитель годится любой.
 *
 * `deleting` — текст стал короче (стирают): двоеточие в конце не дописываем,
 * иначе его нельзя было бы стереть.
 */
export function maskTime(raw: string, deleting = false): string {
  const sepAt = raw.search(SEPARATORS);
  const digits = (s: string) => s.replace(/\D/g, "");
  let h: string;
  let m: string;
  let sep = false;
  if (sepAt >= 0) {
    h = digits(raw.slice(0, sepAt)).slice(0, 2);
    m = digits(raw.slice(sepAt));
    sep = h.length > 0;
    if (h.length === 1) h = `0${h}`;
    else if (h.length === 2 && Number(h) > 23) h = "23";
  } else {
    const d = digits(raw);
    if (d.length === 0) return "";
    if (Number(d[0]) > 2) {
      h = `0${d[0]}`;
      m = d.slice(1);
    } else if (d.length >= 2 && Number(d.slice(0, 2)) > 23) {
      h = `0${d[0]}`;
      m = d.slice(1);
    } else {
      h = d.slice(0, 2);
      m = d.slice(2);
    }
  }
  if (h.length < 2) return h;
  if (m.length > 0 && Number(m[0]) > 5) m = `0${m[0]}`;
  m = m.slice(0, 2);
  if (m.length === 0) return sep || !deleting ? `${h}:` : h;
  return `${h}:${m}`;
}

/**
 * Готовое время «ЧЧ:ММ» из набранного — или `null`, если его не разобрать.
 * Недописанное понимаем по смыслу: «9» и «09:» — это 09:00, «12:3» — 12:03.
 */
export function parseTypedTime(input: string): string | null {
  const s = maskTime(input.trim());
  const x = /^(\d{1,2})(?::(\d{0,2}))?$/.exec(s);
  if (!x) return null;
  const h = Number(x[1]);
  const m = x[2] ? Number(x[2]) : 0;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** Сдвинуть время на `delta` минут по кругу суток: 23:59 + 1 → 00:00. */
export function shiftTime(time: string, delta: number): string {
  const t = parseTypedTime(time) ?? "00:00";
  const total = (((Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + delta) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
