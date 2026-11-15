import type { ReactNode } from "react";
import { CreditCard, Gem, Home, Repeat, Scale, TrendingUp, type LucideIcon } from "lucide-react";
import type { BenchmarksModel } from "../hooks/useBenchmarks";
import type { BenchmarkStatus, GrowthResult, ShareResult } from "../lib/benchmarks";
import { SmoothNavLink } from "./SmoothNavLink";
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
  note,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  model: { result: ShareResult };
  base: string;
  /** Что написать, когда расхода нет вовсе. */
  empty: string;
  /** Своё примечание вместо «выше нормы N из 12 месяцев». */
  note?: ReactNode;
}) {
  const r = model.result;
  if (r.share === null) {
    return (
      <BenchmarkCard id={id} icon={icon} title={title} badge="Нет данных" value="—" note="За эти месяцы нет доходов — долю считать не от чего." />
    );
  }
  const badge = r.status === "good" ? "В норме" : r.status === "warn" ? "Выше нормы" : "Намного выше нормы";
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
          {formatMoney(r.amount, base)} в месяц при доходе {formatMoney(r.income, base)} · норма — до{" "}
          {formatPct(r.limit, 0)}
        </>
      }
      meter={{ fill: r.share / scale, mark: r.limit / scale, status: r.status }}
      note={
        r.amount <= 0
          ? empty
          : note !== undefined
            ? note
            : r.monthsOver === 0
            ? `За ${monthsOf(r.months)} норма ни разу не превышена`
            : `Норма превышена в ${r.monthsOver} ${pluralRu(r.monthsOver, ["месяце", "месяцах", "месяцах"])} из ${r.months}`
      }
    />
  );
}

/**
 * «Ориентиры» (#134): правила, с которыми сверяют бюджет. В общую оценку не
 * входят — это справка, а не балл.
 */
export function HealthBenchmarks({ model, onSetup }: { model: BenchmarksModel; onSetup: () => void }) {
  const { base, housing, debt, luxury, doubling, growth, recurring } = model;
  const update = useBenchmarksStore((s) => s.update);
  if (!housing && !debt && !luxury && !doubling && !growth && !recurring) {
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
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {housing &&
        (housing.configured ? (
          <ShareCard
            id="housing"
            icon={Home}
            title="Расходы на жильё"
            model={housing}
            base={base}
            empty="В отмеченных категориях за эти месяцы трат нет."
          />
        ) : (
          <SetupCard
            id="housing"
            icon={Home}
            title="Расходы на жильё"
            text="Отметьте категории, в которых у вас жильё: аренда, ипотека, коммунальные платежи. Считается, что на жильё должно уходить не больше трети дохода."
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
            empty="Платежей по кредитам за эти месяцы нет."
          />
        ) : (
          <SetupCard
            id="debt"
            icon={CreditCard}
            title="Платежи по кредитам"
            text="Кредитных счетов не нашлось. Если вы записываете платежи расходом или гасите кредитную карту, отметьте нужные категории или счета."
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
            title="Вложения и роскошь"
            text="Отметьте, какие траты вы считаете роскошью и на какие счета откладываете. Есть правило: вкладывать вдвое больше, чем тратишь на роскошь."
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
                {formatMoney(doubling.capital, base)} вырастут до {formatMoney(doubling.capital * 2, base)} к{" "}
                {new Date().getFullYear() + Math.ceil(doubling.years)} году
              </>
            }
            note={`Если не пополнять · ${doubling.accounts} ${pluralRu(doubling.accounts, ["инвестиционный счёт", "инвестиционных счёта", "инвестиционных счетов"])}`}
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
            text="Отметьте инвестиционные счета — увидите, за сколько лет деньги на них удвоятся при заданной доходности."
            onSetup={onSetup}
          />
        ))}

      {growth && <GrowthCard r={growth} base={base} />}

      {recurring && (
        <ShareCard
          id="recurring"
          icon={Repeat}
          title="Расходы на подписки"
          model={recurring}
          base={base}
          empty="Действующих подписок не найдено."
          note={
            <>
              {recurring.count} {pluralRu(recurring.count, ["подписка", "подписки", "подписок"])}: платежи одной и
              той же суммой раз в месяц или реже. Жильё и кредиты не считаются.{" "}
              <SmoothNavLink to="/recurring" className="text-accent hover:underline">
                Регулярные
              </SmoothNavLink>
            </>
          }
        />
      )}
    </div>
  );
}

/** «в 2 раза», «в 5 раз», «в 1,4 раза». */
function timesWord(v: number, digits: number): string {
  return digits === 0 && (v === 1 || v >= 5) ? "раз" : "раза";
}

/** «выросли на 8%», «упали на 3%» — словами, для строки под числом. */
function growthWords(v: number | null): string {
  if (v === null) return "сравнить не с чем";
  const pct = formatPct(Math.abs(v), 0);
  return Math.round(v * 100) === 0 ? "не изменились" : v > 0 ? `выросли на ${pct}` : `упали на ${pct}`;
}

/** «+15%», «−3%» — рост к предыдущему отрезку. */
const growthPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${formatPct(v, 0)}`);

function GrowthCard({ r, base }: { r: GrowthResult; base: string }) {
  const title = "Рост расходов и доходов";
  if (r.status === "na" || r.gap === null) {
    return (
      <BenchmarkCard
        id="growth"
        icon={Scale}
        title={title}
        badge="Мало данных"
        value="—"
        note="Нужно хотя бы полгода истории: сравниваются две её равные половины."
      />
    );
  }
  return (
    <BenchmarkCard
      id="growth"
      icon={Scale}
      title={title}
      badge={
        r.status === "good"
          ? "Доходы не отстают"
          : r.status === "warn"
            ? "Расходы чуть быстрее"
            : "Расходы растут быстрее"
      }
      tone={STATUS_TONE[r.status]}
      value={growthPct(r.expenseGrowth)}
      sub={
        <>
          Расходы {growthWords(r.expenseGrowth)}, доходы {growthWords(r.incomeGrowth)} · последние{" "}
          {monthsOf(r.months)} к предыдущим {r.months}
        </>
      }
      note={
        <>
          В среднем за месяц: расходы {formatMoney(r.expense.prev, base)} → {formatMoney(r.expense.now, base)},
          доходы {formatMoney(r.income.prev, base)} → {formatMoney(r.income.now, base)}.
        </>
      }
    />
  );
}

function LuxuryCard({ model, base }: { model: NonNullable<BenchmarksModel["luxury"]>; base: string }) {
  const r = model.result;
  const times = (v: number, digits = v % 1 === 0 ? 0 : 1) => `в ${formatFixed(v, digits)} ${timesWord(v, digits)}`;
  if (r.ratio === null) {
    return (
      <BenchmarkCard
        id="luxury"
        icon={Gem}
        title="Вложения и роскошь"
        badge={r.status === "good" ? "В норме" : "Нет данных"}
        tone={STATUS_TONE[r.status]}
        value="—"
        sub={<>Вкладываете {formatMoney(r.invested, base)} в месяц</>}
        note="На роскошь за эти месяцы вы не тратили."
      />
    );
  }
  // Шкала — до 1,25 цели: отметка цели стоит на четырёх пятых.
  const scale = r.target * 1.25;
  return (
    <BenchmarkCard
      id="luxury"
      icon={Gem}
      title="Вложения и роскошь"
      badge={r.status === "good" ? "Цель выполнена" : r.status === "warn" ? "Меньше цели" : "Намного меньше цели"}
      tone={STATUS_TONE[r.status]}
      value={times(Math.max(0, r.ratio), 1)}
      sub={
        <>
          Вкладываете {formatMoney(r.invested, base)} в месяц, на роскошь уходит{" "}
          {formatMoney(r.luxury, base)} · цель — вкладывать {times(r.target)} больше
        </>
      }
      meter={{ fill: Math.max(0, r.ratio) / scale, mark: r.target / scale, status: r.status }}
      note={
        r.gap > 0
          ? `До цели не хватает ${formatMoney(r.gap, base)} в месяц`
          : "Вкладываете больше, чем требует правило"
      }
    />
  );
}
