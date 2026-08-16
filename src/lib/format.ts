import type { CSSProperties } from "react";
import type { Currency, Transaction } from "../types";

/**
 * Primary display name for a transaction's counterparty. Prefers the
 * Zenmoney-curated brand (cleaner: "Wildberries" instead of
 * "WB-RU-MOSCOW-12345") and falls back to raw payee text. CSV-mode
 * transactions never have `brand`, so they always show `payee`.
 */
export function displayPayee(t: Pick<Transaction, "payee" | "brand">): string {
  return (t.brand && t.brand.trim()) || t.payee || "";
}

/**
 * Raw payee value to show as a secondary line / tooltip *when* it
 * differs from the brand. Returns null if there's no brand or the
 * payee is already the same string — avoids the noisy "Wildberries /
 * Wildberries" double-render.
 *
 * Сравниваем нормализованно: «AliExpress» и «Aliexpress» — это одно и то же
 * написание, и вторая строка под первой читалась как сбой, а не как полезная
 * подробность. Разными считаем только те, что действительно различаются.
 */
export function secondaryPayee(
  t: Pick<Transaction, "payee" | "brand" | "payeeRaw">,
  /** `statement` — показывать строку из банковской выписки (`payeeRaw`)
   *  вместо свободного текста получателя. Настройка «Оформления». */
  source: "payee" | "statement" = "payee"
): string | null {
  if (!t.brand) return null;
  const secondary = ((source === "statement" ? t.payeeRaw : t.payee) || "").trim();
  const brand = t.brand.trim();
  if (!secondary) return null;
  const norm = (v: string) => v.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  if (norm(secondary) === norm(brand)) return null;
  return secondary;
}

/**
 * Every counterparty spelling a text search must match: the name the row
 * DISPLAYS (`brand`, from the контрагенты dictionary) plus the raw bank text
 * underneath it (`payee`).
 *
 * Both are needed because they routinely differ — the dictionary says
 * «STOLICHKI» while the bank line says «Аптека Столички». Searching only
 * `payee` hid the majority of a counterparty's operations from a search for the
 * exact name shown in the column (on a real account, ~26% of all operations
 * with a counterparty). Shared by the global filter, the Операции table search
 * and the drawer search so the three can't drift apart again.
 */
export function payeeSearchText(t: Pick<Transaction, "payee" | "brand">): string {
  const brand = (t.brand || "").trim();
  const payee = (t.payee || "").trim();
  if (!brand) return payee;
  if (!payee || payee.toLowerCase() === brand.toLowerCase()) return brand;
  return `${brand} ${payee}`;
}

const symbolByCurrency: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CNY: "¥",
  JPY: "¥",
  KZT: "₸",
  BYN: "Br",
  GEL: "₾",
  AMD: "֏",
  AED: "د.إ",
  TRY: "₺",
  THB: "฿",
};

// Global fraction-digit preference for non-compact money. 0 = whole
// amounts (default), 2 = kopecks/cents. Kept as a module variable (synced
// from useDisplayStore) so every `formatMoney` call without an explicit
// `decimals` follows the user's toggle. Chart axes pass `compact` and are
// unaffected; a few precision spots pass `decimals` explicitly.
let _moneyFractionDigits = 0;
export function setMoneyFractionDigits(n: number): void {
  _moneyFractionDigits = n === 2 ? 2 : 0;
}
export function getMoneyFractionDigits(): number {
  return _moneyFractionDigits;
}

/**
 * Знак валюты для подписей, где сумма не выводится, а ожидается: «Сумма, ₽»,
 * переключатель «₽ / %». Раньше такие подписи были захардкожены рублём и
 * врали, если базовая валюта другая (issue #57).
 */
export function currencySymbol(currency: Currency): string {
  return symbolByCurrency[currency] || currency;
}

export function formatMoney(
  amount: number,
  currency: Currency = "RUB",
  opts?: { compact?: boolean; signed?: boolean; decimals?: number }
): string {
  const abs = Math.abs(amount);
  // Render the sign ourselves so a negative always uses the typographic
  // minus «−» (U+2212), matching the kind glyphs in lists, instead of the
  // ASCII hyphen «-» that Intl emits for ru-RU. «+» only when `signed`.
  const sign = amount < 0 ? "−" : opts?.signed && amount > 0 ? "+" : "";
  // Explicit `decimals` wins; otherwise compact caps at 1 and standard
  // follows the global kopecks toggle.
  const dec =
    opts?.decimals !== undefined
      ? opts.decimals
      : opts?.compact
        ? 1
        : _moneyFractionDigits;
  const fmt = new Intl.NumberFormat("ru-RU", {
    notation: opts?.compact ? "compact" : "standard",
    minimumFractionDigits:
      opts?.compact && opts?.decimals === undefined ? 0 : dec,
    maximumFractionDigits: dec,
  });
  const symbol = symbolByCurrency[currency] || currency;
  const value = fmt.format(abs);
  return `${sign}${value} ${symbol}`;
}

/**
 * For a cross-currency transfer the amount cell shows the SENT leg (e.g.
 * 50 000 ₽). This returns the RECEIVED leg formatted in its own currency
 * (e.g. 550 $) so callers can show the second currency alongside — or null
 * for same-currency transfers and non-transfers.
 */
export function crossCurrencyReceived(
  t: Pick<
    Transaction,
    "kind" | "incomeAmount" | "incomeCurrency" | "outcomeCurrency"
  >
): string | null {
  if (t.kind !== "transfer") return null;
  if (!t.incomeAmount || t.incomeCurrency === t.outcomeCurrency) return null;
  return formatMoney(t.incomeAmount, t.incomeCurrency);
}

export function formatNum(
  value: number,
  opts?: { compact?: boolean; fractionDigits?: number }
): string {
  return new Intl.NumberFormat("ru-RU", {
    notation: opts?.compact ? "compact" : "standard",
    // Округляем по МОДУЛЮ: сравнение самого значения отбрасывало копейки только
    // у положительных, и в колонке рядом стояли «20 010» и «−20 010,09». В
    // таблице с выравниванием по правому краю такой ряд выглядит рваным.
    maximumFractionDigits:
      opts?.fractionDigits ??
      (opts?.compact ? 1 : Math.abs(value) >= 1000 ? 0 : 2),
  }).format(value);
}

/**
 * Сколько знаков после запятой нужно подписям оси, чтобы соседние деления не
 * слились в одинаковые.
 *
 * Сокращённая запись («3,8 млн») округляет до одного знака — этого хватает,
 * пока ось идёт от нуля. Но если ось подстроена под данные и весь размах
 * укладывается в сотые доли миллиона, все деления превращаются в «3,8 млн»,
 * и читать ось нечем. Считаем от размаха: чем он у́же относительно самих
 * чисел, тем больше знаков нужно.
 */
export function axisFractionDigits(min: number, max: number): number {
  const span = Math.abs(max - min);
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (span === 0 || scale === 0) return 1;
  // Сокращённая запись делит на «тысячи/миллионы/миллиарды» — знаки считаем
  // относительно ЭТОЙ единицы, иначе легко ошибиться на порядок.
  const unit = Math.pow(1000, Math.floor(Math.log10(scale) / 3));
  const step = span / 5; // примерно столько между соседними делениями
  return Math.min(4, Math.max(1, Math.ceil(Math.log10(unit / step))));
}

export function formatDate(
  iso: string,
  fmt: "short" | "full" | "medium" | "month" = "medium"
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (fmt === "short")
    return d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  // «full» — numeric with the 4-digit year (DD.MM.YYYY); used for per-row
  // dates in operation tables where the 2-digit «short» year reads oddly.
  if (fmt === "full")
    return d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  if (fmt === "month") return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  // Через Intl, а не `toFixed`: тот всегда ставит ТОЧКУ, и в русском интерфейсе
  // рядом с «18 000 ₽» появлялось «18.0%». Остальные числа в приложении и так
  // идут через ru-RU — процент просто отстал.
  // Знак рисуем сами — типографским минусом «−», как в `formatMoney`: иначе в
  // одной строке соседствовали бы «−5 000 ₽» и «-5,5%».
  const pct = value * 100;
  const body = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(pct));
  // Округление может съесть знак: −0,04% при одном знаке — это «0,0%», и
  // минус перед нулём выглядел бы ошибкой.
  const signed = pct < 0 && Number(body.replace(/[^\d]/g, "")) !== 0;
  return `${signed ? "−" : ""}${body}%`;
}

export function ymKey(iso: string): string {
  return iso.slice(0, 7);
}

export function ymdKey(iso: string): string {
  return iso.slice(0, 10);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
  // Capitalise the month name (ru-RU renders it lowercase: «янв. 24 г.»).
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Like monthLabel but with the FULL month name («Февраль 26 г.») — for tables
 *  and places where the abbreviated «Февр.» reads poorly. */
export function monthLabelFull(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("ru-RU", { month: "long", year: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

export const chartTooltipStyle: CSSProperties = {
  // Opaque surface — a semi-transparent bg let the chart lines bleed through
  // and read as «полупрозрачный». Solid + shadow keeps it legible.
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  color: "rgb(var(--c-text))",
  boxShadow:
    "0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
};

export const chartTooltipProps = {
  contentStyle: chartTooltipStyle,
  cursor: false as const,
  // The tooltip wrapper otherwise sits under later-DOM siblings (legend, the
  // next card) and gets clipped/covered. A high z-index floats it on top.
  wrapperStyle: { zIndex: 50 },
};

export const chartGridStroke = "var(--grid)";
export const chartAxisStroke = "rgb(var(--c-muted))";
/** Линия итога поверх стопки. Цвет текста, а не палитры счетов: итог — не
 *  ещё одна доля, а сумма всех, и путать его с ними нельзя. */
export const chartTotalStroke = "rgb(var(--c-text))";

/**
 * Ближайший «круглый» шаг сетки: 1, 2 или 5 на своём порядке.
 *
 * Нужен там, где деления оси приходится считать самим, — например когда низ
 * оси задан точно (сумма минусов), и отдать округление автоматике нельзя:
 * она растянет домен до целого деления и отдаст под пустоту четверть высоты.
 */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const rel = raw / pow;
  const mult = rel <= 1 ? 1 : rel <= 2 ? 2 : rel <= 5 ? 5 : 10;
  return mult * pow;
}
