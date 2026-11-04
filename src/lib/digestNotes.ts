/**
 * Подписи под итогами «Дайджеста» — общие для страницы и отчёта: в отчёте
 * за период стоят ровно те же слова и цвета, что на экране.
 */
import { formatPct } from "./format";

export type NoteTone = "good" | "bad" | "muted";

/** «+12% к прошлому периоду» — или «как в прошлый раз», если изменение в пределах процента. */
export function deltaNote(delta: number, running = false): string {
  if (Math.abs(delta) <= 0.01) return running ? "Как в прошлом месяце на этот день" : "≈ как в прошлый раз";
  return `${delta > 0 ? "+" : ""}${formatPct(delta, 0)} к ${running ? "прошлому месяцу на этот день" : "прошлому периоду"}`;
}

/** Сравнение с обычным периодом, а без него — с прошлым. */
export function compareNote(value: number, typical: number | undefined, prevDelta: number, running = false): string | undefined {
  if (typical == null) return deltaNote(prevDelta, running);
  if (Math.abs(typical) < 0.01) return undefined;
  const rel = (value - typical) / Math.abs(typical);
  if (Math.abs(rel) <= 0.03) return running ? "Как обычно на этот день" : "Как обычно";
  return `${rel > 0 ? "+" : ""}${formatPct(rel, 0)} к обычному${running ? " на этот день" : ""}`;
}

/** Цвет подписи по изменению к прошлому периоду: `upIsGood` — рост к лучшему. */
export function deltaTone(delta: number, upIsGood: boolean): NoteTone {
  if (Math.abs(delta) <= 0.05) return "muted";
  return delta > 0 === upIsGood ? "good" : "bad";
}

/** Цвет чистого потока: заметно лучше или хуже прошлого периода. */
export function netTone(net: number, prevNet: number): NoteTone {
  return net > prevNet + 100 ? "good" : net < prevNet - 100 ? "bad" : "muted";
}
