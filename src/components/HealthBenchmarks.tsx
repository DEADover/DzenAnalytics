import type { ReactNode } from "react";
import { CreditCard, Gem, Home, TrendingUp, type LucideIcon } from "lucide-react";
import type { BenchmarksModel } from "../hooks/useBenchmarks";
import type { BenchmarkStatus } from "../lib/benchmarks";
import { useBenchmarksStore } from "../store/useBenchmarksStore";
import { formatFixed, formatMoney, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { Badge, type BadgeTone } from "./Badge";
import { ProgressBar } from "./ProgressBar";
import { Slider } from "./Slider";

const STATUS_TONE: Record<BenchmarkStatus, BadgeTone> = {
  good: "income",
  warn: "warn",
  bad: "expense",
  na: "neutral",
};
const STATUS_FILL: Record<BenchmarkStatus, string> = {
  good: "bg-income",
  warn: "bg-warn",
  bad: "bg-expense",
  na: "bg-muted",
};

const years = (n: number) => pluralRu(Math.round(n), ["год", "года", "лет"]);
const monthsOf = (n: number) => `${n} ${pluralRu(n, ["месяц", "месяца", "месяцев"])}`;

/**
 * Карточка ориентира: название и статус, число, строка «из чего оно», шкала
 * с отметкой нормы и примечание. Одна на все ориентиры — они отличаются
 * только числами.
 */
function BenchmarkCard({
  id,
  icon: Icon,
  title,
  badge,
  tone = "neutral",
  value,
  sub,
  meter,
  note,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  badge?: string;
  tone?: BadgeTone;
  value?: ReactNode;
  sub?: ReactNode;
  /** Заливка и отметка нормы, доли от 0 до 1. */
  meter?: { fill: number; mark: number; status: BenchmarkStatus };
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card card-pad flex flex-col min-w-0" data-benchmark={id}>
      <div className="flex items-center justify-between gap-2 min-h-6">
        <div className="flex items-center gap-1.5 min-w-0 font-semibold text-sm">
          <Icon className="w-4 h-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{title}</span>
        </div>
        {badge && (
          <Badge tone={tone} className="shrink-0">
            {badge}
          </Badge>
        )}
      </div>
      {value != null && (
        <div className="stat-num text-2xl font-bold tabular-nums leading-tight mt-2">{value}</div>
      )}
      {sub && <div className="text-xs text-muted mt-0.5 tabular-nums">{sub}</div>}
      {meter && (
        <div className="relative mt-3">
          <ProgressBar value={meter.fill} fillClassName={STATUS_FILL[meter.status]} />
          <span
            aria-hidden
            className="absolute -top-[3px] h-3 w-0.5 rounded-full bg-text/70"
            style={{ left: `calc(${Math.min(1, meter.mark) * 100}% - 1px)` }}
          />
        </div>
      )}
      {children}
      {note && <div className="text-[11px] text-muted mt-2 leading-snug">{note}</div>}
    </div>
  );
}

/** Ориентир ещё не настроен: чем его наполнить и кнопка в настройки. */
function SetupCard({
  id,
  icon,
  title,
  text,
  onSetup,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
  onSetup: () => void;
}) {
  return (
    <BenchmarkCard id={id} icon={icon} title={title}>
      <p className="text-xs text-muted mt-2 leading-snug flex-1">{text}</p>
      <button type="button" className="btn-ghost text-xs mt-3 self-start" onClick={onSetup}>
        Настроить
      </button>
    </BenchmarkCard>
  );
}

/** Доля в доходе против порога — «Жильё» и «Платежи по кредитам». */
function ShareCard({
  id,
  icon,
  title,
  model,
  base,
  empty,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  model: NonNullable<BenchmarksModel["housing"]>;
  base: string;
  /** Что написать, когда расхода нет вовсе. */
  empty: string;
}) {
  const r = model.result;
  if (r.share === null) {
    return (
      <BenchmarkCard id={id} icon={icon} title={title} badge="Нет данных" value="—" note="В расчётных месяцах нет дохода." />
    );
  }
  const badge = r.status === "good" ? "В норме" : r.status === "warn" ? "Выше нормы" : "Высоко";
  // Шкала — до полутора порогов: отметка нормы стоит на двух третях.
  const scale = r.limit * 1.5;
  return (
    <BenchmarkCard
      id={id}
      icon={icon}
      title={title}
      badge={badge}
      tone={STATUS_TONE[r.status]}
      value={formatPct(r.share, 0)}
      sub={
        <>
          {formatMoney(r.amount, base)} из {formatMoney(r.income, base)} в месяц · норма до{" "}
          {formatPct(r.limit, 0)}
        </>
      }
      meter={{ fill: r.share / scale, mark: r.limit / scale, status: r.status }}
      note={
        r.amount <= 0
          ? empty
          : r.monthsOver === 0
            ? `Ни разу не выше нормы за ${monthsOf(r.months)}`
            : `Выше нормы ${r.monthsOver} из ${monthsOf(r.months)}`
      }
    />
  );
}

/**
 * «Ориентиры» (#134): правила, с которыми сверяют бюджет. В общую оценку не
 * входят — это справка, а не балл.
 */
export function HealthBenchmarks({ model, onSetup }: { model: BenchmarksModel; onSetup: () => void }) {
  const { base, housing, debt, luxury, doubling } = model;
  const update = useBenchmarksStore((s) => s.update);
  if (!housing && !debt && !luxury && !doubling) {
    return (
      <div className="card card-pad text-sm text-muted flex items-center justify-between gap-3">
        <span>Все ориентиры выключены.</span>
        <button type="button" className="btn-ghost text-xs" onClick={onSetup}>
          Настроить
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      {housing &&
        (housing.configured ? (
          <ShareCard
            id="housing"
            icon={Home}
            title="Жильё в доходе"
            model={housing}
            base={base}
            empty="По выбранным категориям трат нет."
          />
        ) : (
          <SetupCard
            id="housing"
            icon={Home}
            title="Жильё в доходе"
            text="Отметьте категории жилья — аренду, ипотеку, коммунальные услуги. Обычно советуют тратить на него не больше трети дохода."
            onSetup={onSetup}
          />
        ))}

      {debt &&
        (debt.configured ? (
          <ShareCard
            id="debt"
            icon={CreditCard}
            title="Платежи по кредитам"
            model={debt}
            base={base}
            empty="Платежей по кредитам нет."
          />
        ) : (
          <SetupCard
            id="debt"
            icon={CreditCard}
            title="Платежи по кредитам"
            text="Счетов-кредитов нет. Если платежи записаны расходом или идут на кредитку — отметьте категории или счета."
            onSetup={onSetup}
          />
        ))}

      {luxury &&
        (luxury.configured ? (
          <LuxuryCard model={luxury} base={base} />
        ) : (
          <SetupCard
            id="luxury"
            icon={Gem}
            title="Инвестиции к роскоши"
            text="Отметьте категории роскоши и счета инвестиций. Совет — вкладывать вдвое больше, чем уходит на роскошь."
            onSetup={onSetup}
          />
        ))}

      {doubling &&
        (doubling.configured && doubling.years !== null ? (
          <BenchmarkCard
            id="doubling"
            icon={TrendingUp}
            title="Удвоение вложений"
            badge="Правило 72"
            value={`${formatFixed(doubling.years, doubling.years % 1 === 0 ? 0 : 1)} ${years(doubling.years)}`}
            sub={
              <>
                {formatMoney(doubling.capital, base)} станут {formatMoney(doubling.capital * 2, base)} к{" "}
                {new Date().getFullYear() + Math.ceil(doubling.years)} году
              </>
            }
            note={`Без пополнений · ${doubling.accounts} ${pluralRu(doubling.accounts, ["счёт", "счёта", "счетов"])} инвестиций`}
          >
            <Slider
              className="mt-3"
              layout="stacked"
              label="Доходность"
              min={2}
              max={30}
              step={1}
              value={doubling.rate}
              format={(v) => `${v}% годовых`}
              onChange={(v) => void update({ investRate: v })}
            />
          </BenchmarkCard>
        ) : (
          <SetupCard
            id="doubling"
            icon={TrendingUp}
            title="Удвоение вложений"
            text="Отметьте счета инвестиций — покажем, за сколько лет сумма на них удвоится при выбранной доходности."
            onSetup={onSetup}
          />
        ))}
    </div>
  );
}

function LuxuryCard({ model, base }: { model: NonNullable<BenchmarksModel["luxury"]>; base: string }) {
  const r = model.result;
  const target = `×${formatFixed(r.target, r.target % 1 === 0 ? 0 : 1)}`;
  if (r.ratio === null) {
    return (
      <BenchmarkCard
        id="luxury"
        icon={Gem}
        title="Инвестиции к роскоши"
        badge={r.status === "good" ? "В норме" : "Нет данных"}
        tone={STATUS_TONE[r.status]}
        value="—"
        sub={<>Вложено {formatMoney(r.invested, base)} в месяц</>}
        note="На роскошь за расчётные месяцы не тратили."
      />
    );
  }
  // Шкала — до 1,25 цели: отметка цели стоит на четырёх пятых.
  const scale = r.target * 1.25;
  return (
    <BenchmarkCard
      id="luxury"
      icon={Gem}
      title="Инвестиции к роскоши"
      badge={r.status === "good" ? "В норме" : r.status === "warn" ? "Маловато" : "Не хватает"}
      tone={STATUS_TONE[r.status]}
      value={`×${formatFixed(Math.max(0, r.ratio), 1)}`}
      sub={
        <>
          Вложено {formatMoney(r.invested, base)} при {formatMoney(r.luxury, base)} на роскошь в месяц ·
          цель {target}
        </>
      }
      meter={{ fill: Math.max(0, r.ratio) / scale, mark: r.target / scale, status: r.status }}
      note={
        r.gap > 0
          ? `До цели — ещё ${formatMoney(r.gap, base)} в месяц`
          : `Цель выполнена: вложений в ${formatFixed(r.ratio, 1)} раза больше`
      }
    />
  );
}
