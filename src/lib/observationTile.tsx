import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarRange, Receipt, ShoppingBag, SplitSquareHorizontal, Sun } from "lucide-react";
import type { DigestObservation } from "./digestObservations";
import type { DigestEntry } from "./digest";
import { formatMoney, formatPct } from "./format";
import { Pair, ShareBar, WeekBars } from "../components/ObservationViz";
import { pluralRu } from "./plural";

export type ObservationTone = "good" | "bad" | "neutral";

export interface ObservationTile {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: ObservationTone;
  text: string;
  viz?: ReactNode;
}

const WEEK_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

/** Во сколько раз — «в 1,8 раза», без лишних нулей. */
function times(x: number): string {
  return `×${x.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`;
}

/**
 * Плитка наблюдения: значок, подпись, крупное значение, фраза и полоса.
 * Общая для «Дайджеста» и «Отчёта за период» — там своя вёрстка, но слова те
 * же. `since` — с чем сравнивается средний чек, если не «неделей / месяцем
 * раньше» (у отчёта за год — «чем за прошлый такой же период»).
 */
export function describeObservation(
  o: DigestObservation,
  entry: Pick<DigestEntry, "period" | "running" | "days">,
  base: string,
  sinceOverride?: string
): ObservationTile {
  switch (o.id) {
    case "weekend": {
      const pair = (
        <Pair
          a={{ label: "Будни", value: o.weekdayPerDay }}
          b={{ label: "Выходные", value: o.weekendPerDay }}
          base={base}
        />
      );
      if (o.ratio >= 1.15)
        return {
          icon: Sun,
          label: "Будни и выходные",
          value: `Выходные ${times(o.ratio)}`,
          tone: "neutral",
          text: "Во столько раз день выходных в среднем дороже дня будней.",
          viz: pair,
        };
      if (o.ratio <= 1 / 1.15)
        return {
          icon: Sun,
          label: "Будни и выходные",
          value: `Будни ${times(1 / o.ratio)}`,
          tone: "neutral",
          text: "Во столько раз день будней в среднем дороже дня выходных.",
          viz: pair,
        };
      return {
        icon: Sun,
        label: "Будни и выходные",
        value: "Поровну",
        tone: "neutral",
        text: "День выходных и день будней обходятся примерно одинаково.",
        viz: pair,
      };
    }
    case "weekday":
      return {
        icon: CalendarRange,
        label: "Самый дорогой день недели",
        value: WEEK_FULL[o.weekday],
        tone: "neutral",
        text:
          o.ratio >= 1.1
            ? `В среднем ${formatMoney(o.perDay, base)} — ${times(o.ratio)} к обычному дню.`
            : `В среднем ${formatMoney(o.perDay, base)} — почти как в остальные дни.`,
        viz: <WeekBars byWeekday={o.byWeekday} best={o.weekday} />,
      };
    case "concentration":
      return {
        icon: ShoppingBag,
        label: "Пять крупных покупок",
        value: formatPct(o.share, 0),
        tone: "neutral",
        text: `Всех трат — пять покупок из ${o.purchases}.`,
        viz: <ShareBar share={o.share} />,
      };
    case "avgCheck": {
      const rel = o.prevAvg ? o.avg / o.prevAvg - 1 : null;
      const since = sinceOverride ?? (
        entry.period === "week"
          ? "чем неделей раньше"
          : entry.running
            ? `чем за ${entry.running.day} ${pluralRu(entry.running.day, ["день", "дня", "дней"])} до этого`
            : "чем месяцем раньше");
      const purchases = `${o.count} ${pluralRu(o.count, ["покупка", "покупки", "покупок"])}`;
      return {
        icon: Receipt,
        label: "Средний чек",
        value: formatMoney(o.avg, base),
        tone: rel === null || Math.abs(rel) < 0.1 ? "neutral" : rel > 0 ? "bad" : "good",
        text:
          rel === null
            ? `${purchases} за период.`
            : Math.abs(rel) < 0.03
              ? `${purchases} — как и ${since.replace(/^чем /, "")}.`
              : `${purchases} — ${rel > 0 ? "дороже" : "дешевле"} на ${formatPct(Math.abs(rel), 0)}, ${since}.`,
        viz:
          o.prevAvg !== null ? (
            <Pair a={{ label: "Раньше", value: o.prevAvg }} b={{ label: "Сейчас", value: o.avg }} base={base} />
          ) : undefined,
      };
    }
    case "halves": {
      const rel = o.second / o.first - 1;
      return {
        icon: SplitSquareHorizontal,
        label: "Половины месяца",
        value: `${rel >= 0 ? "+" : "−"}${formatPct(Math.abs(rel), 0)}`,
        tone: rel > 0.25 ? "bad" : rel < -0.25 ? "good" : "neutral",
        text:
          Math.abs(rel) < 0.1
            ? "Траты распределены по месяцу ровно."
            : rel > 0
              ? "Во второй половине месяца потратили больше, чем в первой."
              : "Во второй половине месяца потратили меньше, чем в первой.",
        viz: (
          <Pair
            a={{ label: "1-я", value: o.first }}
            b={{ label: "2-я", value: o.second }}
            base={base}
          />
        ),
      };
    }
  }
}
