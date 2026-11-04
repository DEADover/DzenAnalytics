import { Lightbulb } from "lucide-react";
import clsx from "clsx";
import type { DigestObservation } from "../lib/digestObservations";
import type { DigestEntry } from "../lib/digest";
import { SectionCard } from "./SectionCard";
import { describeObservation, type ObservationTile, type ObservationTone } from "../lib/observationTile";

const TONE_TEXT: Record<ObservationTone, string> = {
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
          <Tile key={o.id} span={spanOf(i, items.length)} {...describeObservation(o, entry, base)} />
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

function Tile({ icon: Icon, label, value, tone, text, viz, span }: ObservationTile & { span: number }) {
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

