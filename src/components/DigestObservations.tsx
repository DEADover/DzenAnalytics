import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarRange, Lightbulb, Receipt, ShoppingBag, SplitSquareHorizontal, Sun } from "lucide-react";
import clsx from "clsx";
import type { DigestObservation } from "../lib/digestObservations";
import type { DigestEntry } from "../lib/digest";
import { formatMoney, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { SectionCard } from "./SectionCard";

type Tone = "good" | "bad" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-income",
  bad: "text-expense",
  neutral: "text-text",
};

/**
 * «Наблюдения» в «Дайджесте»: плитки с крупным числом, фразой и маленькой
 * наглядной полосой — сразу видно, на что смотреть. Цвет числа — только когда
 * есть смысл «лучше / хуже» (чек подорожал, половина месяца разогналась);
 * просто факты — обычным цветом, без тревожной раскраски.
 */
export function DigestObservations({
  items,
  entry,
  base,
}: {
  items: DigestObservation[];
  entry: Pick<DigestEntry, "period" | "running" | "days">;
  base: string;
}) {
  if (items.length === 0) return null;
  return (
    <SectionCard
      icon={Lightbulb}
      title="Наблюдения"
      info={
        <p>
          То, что не видно в итогах: как расходятся будни и выходные, какой день
          недели самый дорогой, сколько дают несколько крупных покупок, как
          меняется средний чек и к какой половине месяца траты разгоняются. У
          идущего месяца — только по прожитым дням. Возвраты уменьшают траты дня,
          в средний чек не входят.
        </p>
      }
    >
      {/* Ряды без «сирот»: пять плиток — три и две пошире, четыре — в ряд. */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-12" data-observations>
        {items.map((o, i) => (
          <Tile key={o.id} span={spanOf(i, items.length)} {...describe(o, entry, base)} />
        ))}
      </div>
    </SectionCard>
  );
}

/** Сколько из 12 колонок занимает плитка на широком экране. */
function spanOf(i: number, n: number): number {
  if (n <= 4) return 12 / n;
  if (n === 5) return i < 3 ? 4 : 6;
  return 4;
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
  text: string;
  viz?: ReactNode;
}

function Tile({ icon: Icon, label, value, tone, text, viz, span }: TileProps & { span: number }) {
  return (
    <div
      className="rounded-xl bg-panel2/60 px-4 py-3 flex flex-col gap-1.5 min-w-0 lg:[grid-column:span_var(--span)/span_var(--span)]"
      style={{ ["--span" as string]: span }}
      data-observation={label}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx("text-2xl font-semibold tabular-nums leading-tight", TONE_TEXT[tone])}>{value}</div>
      {viz}
      <p className="text-xs text-muted leading-snug">{text}</p>
    </div>
  );
}

/** Две полосы друг под другом: длина — доля от большей, большая — акцентом. */
function Pair({ a, b, base }: { a: { label: string; value: number }; b: { label: string; value: number }; base: string }) {
  const max = Math.max(a.value, b.value, 1);
  return (
    <div className="space-y-1 my-0.5">
      {[a, b].map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-muted">{r.label}</span>
          <span className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
            <span
              className={clsx("block h-full rounded-full", r.value >= max ? "bg-accent" : "bg-muted/50")}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-muted">{formatMoney(r.value, base, { compact: true })}</span>
        </div>
      ))}
    </div>
  );
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEK_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

function WeekBars({ byWeekday, best }: { byWeekday: number[]; best: number }) {
  const max = Math.max(...byWeekday, 1);
  return (
    <div className="flex items-end gap-1 h-10 my-0.5" aria-hidden>
      {WEEK_ORDER.map((w) => (
        <div key={w} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
          <span
            className={clsx("w-full rounded-sm", w === best ? "bg-accent" : "bg-muted/40")}
            style={{ height: `${Math.max(6, (byWeekday[w] / max) * 100)}%` }}
          />
          <span className={clsx("text-[10px] leading-none", w === best ? "text-accent font-medium" : "text-muted")}>
            {WEEK_SHORT[w]}
          </span>
        </div>
      ))}
    </div>
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <span className="block h-1.5 rounded-full bg-border/60 overflow-hidden my-1" aria-hidden>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share * 100)}%` }} />
    </span>
  );
}

/** Во сколько раз — «в 1,8 раза», без лишних нулей. */
function times(x: number): string {
  return `×${x.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`;
}

function describe(
  o: DigestObservation,
  entry: Pick<DigestEntry, "period" | "running" | "days">,
  base: string
): TileProps {
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
      const since =
        entry.period === "week"
          ? "чем неделей раньше"
          : entry.running
            ? `чем за ${entry.running.day} ${pluralRu(entry.running.day, ["день", "дня", "дней"])} до этого`
            : "чем месяцем раньше";
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
