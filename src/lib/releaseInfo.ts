/**
 * Сведения о выпуске из CHANGELOG.md — для блока «О сервисе» в справке.
 *
 * Заголовок записи о выпуске: `## vX.Y.Z — Название · ГГГГ-ММ-ДД` (его же
 * разбирает `scripts/release-notes.js`). Дату и название не заводим отдельно:
 * они уже есть в чейнджлоге, а второй источник разошёлся бы с ним при первом
 * же релизе.
 */

export interface ReleaseInfo {
  version: string;
  /** Название выпуска — «Темы и единый вид». */
  name?: string;
  /** Дата выпуска, ГГГГ-ММ-ДД. */
  date?: string;
}

/**
 * Запись о версии `version` (без «v»). Не нашлась — `null`: например, в
 * рабочей сборке, где версию уже подняли, а запись ещё не написана.
 */
export function parseRelease(md: string, version: string): ReleaseInfo | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+v${escaped}\\b(.*)$`, "m");
  const m = md.match(re);
  if (!m) return null;
  const rest = m[1];
  const date = rest.match(/(\d{4}-\d{2}-\d{2})\s*$/)?.[1];
  const name = rest
    .replace(/·\s*\d{4}-\d{2}-\d{2}\s*$/, "")
    .replace(/^\s*[—–-]\s*/, "")
    .trim();
  return { version, name: name || undefined, date };
}

/** «15 сентября 2026» — без «г.» и без сдвига дня из-за часового пояса. */
export function formatReleaseDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .replace(/\s*г\.$/, "");
}
