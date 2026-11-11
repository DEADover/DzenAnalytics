import { BlockTitle, SectionLabel } from "./shared";
import { dayAndMonth } from "../../../lib/dayLabel";
import { type ReactNode } from "react";
import { pluralRu } from "../../../lib/plural";
import { Segmented } from "../../Segmented";
import { useFreeMoneyStore } from "../../../store/useFreeMoneyStore";
import { InfoTerm } from "../../InfoPopover";
import { formatMoney, formatNum } from "../../../lib/format";
import type { FreeMoneyModel } from "../../../hooks/useFreeMoney";
import type { BalanceMode, PlanLeft } from "../../../lib/freeMoney";
import type { Currency } from "../../../types";
import { ProgressBar } from "../../ProgressBar";


/* ────────────────────────  Свободные деньги (#96)  ──────────────────────── */

/**
 * Кольцо дневного лимита.
 *
 * Показывает ОДИН день, а не весь период: вопрос кольца — «много ли осталось
 * на сегодня». Дуга пустеет ровно на то, что сегодняшний день съел из свободных
 * денег; за остаток месяца отвечает полоска ниже, у неё своя шкала.
 */
function AllowanceRing({ ratio, tone }: { ratio: number; tone: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0" aria-hidden>
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="rgb(var(--c-border))"
        strokeWidth="7"
      />
      {ratio > 0 && (
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          // Начало дуги — вверху, а не справа: круг читается как циферблат.
          transform="rotate(-90 40 40)"
        />
      )}
    </svg>
  );
}

/**
 * Полоска «сколько свободных денег периода ещё цело».
 *
 * Шкала у неё своя: полная полоска — свободные деньги, какими они были бы без
 * единого перебора по статьям. Пустеет она только от перерасхода, потому что
 * трата внутри плана свободных денег не трогает.
 */
function FreeBar({ ratio }: { ratio: number }) {
  return (
    <ProgressBar value={ratio} tone="income" />
  );
}

/** Строка разбивки: подпись слева, сумма справа. */
function FreeRow({
  label,
  value,
  base,
  sign,
  muted,
  strong,
}: {
  label: ReactNode;
  value: number;
  base: Currency;
  /** Знак перед суммой — слагаемые без него читались как набор не связанных чисел. */
  sign?: "+" | "−";
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "pt-2 mt-1 border-t border-border" : ""
      }`}
    >
      <span className={`text-[13px] truncate ${muted ? "text-muted" : ""}`}>{label}</span>
      <span
        className={`font-mono tabular-nums shrink-0 ${
          strong ? "text-[15px] font-semibold" : "text-[13px]"
        } ${muted ? "text-muted" : ""} ${value < 0 && strong ? "text-expense" : ""}`}
      >
        {sign}
        {sign ? " " : ""}
        {formatMoney(Math.abs(value), base)}
      </span>
    </div>
  );
}

/** Строка списка плана: сама статья, её глубина и что рисовать вокруг. */
interface PlanLine {
  row: PlanLeft;
  depth: number;
  /** Ветка продолжается ниже — вертикаль уголка идёт насквозь. */
  more: boolean;
  /** Строка закрывает категорию — под ней волосок. */
  divider: boolean;
}

/**
 * Разворачивает дерево плана в строки: подстатьи идут сразу под своей
 * категорией, как в списке у Дзен-мани.
 *
 * Заодно размечает, где ветка продолжается и где кончается категория:
 * рисовать уголок и волосок по соседям в JSX было бы втрое многословнее.
 */
function planLines(rows: readonly PlanLeft[]): PlanLine[] {
  const flat: { row: PlanLeft; depth: number }[] = [];
  const walk = (list: readonly PlanLeft[], depth: number) => {
    for (const r of list) {
      flat.push({ row: r, depth });
      walk(r.children ?? [], depth + 1);
    }
  };
  walk(rows, 0);
  return flat.map((item, i) => {
    const next = flat[i + 1];
    return {
      ...item,
      more: next !== undefined && next.depth >= item.depth && item.depth > 0,
      // Волосок — только между категориями: внутри ветки он рвал бы вертикаль
      // уголка на отрезки, а последний в списке обходится без черты.
      divider: next !== undefined && next.depth === 0,
    };
  });
}

/**
 * Подсказка виджета. `withPlan` — стоит ли рядом список статей: у узкого
 * варианта его нет, и объяснять там вложенность подстатей не на чем.
 *
 * Термины — ровно те подписи, что стоят в самом виджете (issue #100): раньше
 * подсказка объясняла «Деньги», а такой строки в виджете нет.
 */
function freeMoneyInfo(withPlan: boolean, balanceMode: BalanceMode) {
  const opening = balanceMode === "includeOpeningBalance";
  return (
    <>
      <p>
        <InfoTerm>Свободно до…</InfoTerm> — сколько можно потратить до конца
        периода, не залезая в запланированное. Считаем как Дзен-мани:{" "}
        {opening ? "«На счетах»" : "«Баланс периода»"} плюс «Ещё поступит»
        минус «План на месяц».
      </p>
      <p>
        {opening ? (
          <>
            <InfoTerm>На счетах</InfoTerm> — сколько сейчас лежит на счетах из
            расчёта, вместе с тем, что было к началу периода.
          </>
        ) : (
          <>
            <InfoTerm>Баланс периода</InfoTerm> — приход минус расход с начала
            периода. Остаток на счетах к его началу не считается.
          </>
        )}{" "}
        Так настроен ваш Дзен-мани, и эту настройку мы берём у него, а не
        заводим свою.
      </p>
      <p>
        <InfoTerm>Ещё поступит</InfoTerm> — доход, который ждёт бюджет и
        назначенные поступления, за вычетом того, что уже пришло. Пришедшая
        зарплата отсюда уходит: она уже в балансе.
      </p>
      <p>
        <InfoTerm>План на месяц</InfoTerm> — сколько ещё предстоит потратить по
        бюджету. У каждой статьи это её бюджет плюс назначенные на месяц платежи
        минус уже потраченное. Исполненный платёж из плана не уходит: он был
        обещан и остаётся обещанным, просто теперь его место заняла трата. Сумма
        под замком — ровно та, что вы задали: назначенные платежи к ней не
        прибавляются.
      </p>
      <p>
        Каждая статья считается отдельно, и перебор по одной не гасится остатком
        соседней. Отсюда «из»: полная сумма — сколько свободных денег было бы без
        единого перебора, а разница между ними и есть перерасход.
      </p>
      {withPlan ? (
        <p>
          <InfoTerm>Подстатьи</InfoTerm> стоят под своей категорией, и у
          категории показана вся ветка целиком, вместе с ними. Трата по
          подстатье, у которой своего бюджета нет, уходит в ближайшую статью
          выше. А если замок стоит на категории, её подстатьи — только
          разбивка: их суммы уже внутри неё и к итогу не прибавляются.
        </p>
      ) : (
        <p>
          Из чего этот план сложился — по статьям и подстатьям — показывает
          виджет «Свободные деньги» пошире.
        </p>
      )}
      <p>
        <InfoTerm>На сегодня</InfoTerm> — кольцо: сколько из положенного на
        сегодня ещё цело. Оно пустеет только от трат сверх плана, поэтому
        обычный день его не трогает. Лимит дня считается от свободных денег на
        утро: сегодняшняя трата сегодняшний же лимит не урезает.
      </p>
      <p>
        Метод деления по дням и неснижаемый остаток задаются в «Настройках →
        Расчёты».
      </p>
    </>
  );
}

/** Без Дзен-мани считать нечего: ни бюджета, ни назначенных платежей. */
function FreeMoneyEmpty() {
  return (
    <>
      <BlockTitle title="Свободные деньги" />
      <div className="text-sm text-muted">
        Свободные деньги считаются по остаткам, планам и бюджету из Дзен-мани.
        Подключите синхронизацию — и виджет заработает.
      </div>
    </>
  );
}

/**
 * Ответ виджета: сколько можно сегодня и сколько до конца периода.
 *
 * Живёт отдельно от списка статей: в широком виджете это левая колонка, в
 * узком — всё его содержимое.
 */
/**
 * Как делить свободные деньги по дням — прямо в виджете. Та же настройка, что
 * в «Настройках → Расчёты → Виджет «Свободные деньги»»: переключить метод
 * хочется, глядя на число дня, а не уходя за ним в настройки.
 */
function FreeMethodSwitch() {
  const method = useFreeMoneyStore((s) => s.method);
  const setMethod = useFreeMoneyStore((s) => s.setMethod);
  return (
    <Segmented
      size="sm"
      tight
      label="Как делить свободные деньги по дням"
      value={method}
      onChange={(v) => void setMethod(v)}
      options={[
        {
          value: "cumulative",
          label: "Накопительный",
          title: "Лимит на день один на весь период, непотраченное копится",
        },
        {
          value: "daily",
          label: "Ежедневный",
          title: "Остаток делится на оставшиеся дни заново каждое утро",
        },
      ]}
    />
  );
}

function FreeMoneySummary({ f, base }: { f: FreeMoneyModel; base: Currency }) {
  const { allowance, money } = f;
  // Свободных денег нет вовсе — план съел всё, что будет. Дневного лимита в
  // этом случае не существует, и придумывать его нельзя.
  const noBudget = f.free <= 0;
  // День уже перебрали: кольцо замыкается красным, как у Дзен-мани, — пустая
  // серая дуга в этом случае читалась бы как «ещё ничего не потрачено».
  const over = !noBudget && f.todayLeft < 0;
  const tone = noBudget || over ? "rgb(var(--c-expense))" : "rgb(var(--c-income))";

  return (
    <div className="flex-1 flex flex-col min-h-0 divide-y divide-border">
      <div className="flex-1 flex flex-col pb-5">
        <SectionLabel right={<FreeMethodSwitch />}>На сегодня</SectionLabel>
        <div className="flex-1 flex items-center gap-4 mt-2.5">
          <AllowanceRing ratio={noBudget ? 0 : over ? 1 : f.ratio} tone={tone} />
          <div className="min-w-0">
            <div
              className={`font-mono tabular-nums font-semibold text-3xl 3xl:text-4xl leading-none ${
                noBudget || f.todayLeft <= 0 ? "text-expense" : ""
              }`}
              style={{ wordSpacing: "-0.22em" }}
            >
              {noBudget ? "—" : formatMoney(Math.abs(f.todayLeft), base)}
            </div>
            {noBudget ? (
              <div className="text-[13px] text-muted mt-1.5">
                тратить нечего: план больше, чем будет денег
              </div>
            ) : (
              <div className="text-[13px] text-muted mt-1.5 space-y-0.5">
                <div>
                  {f.todayLeft < 0 ? (
                    <>
                      Сверх лимита{" "}
                      <span className="font-mono tabular-nums text-text">
                        {formatMoney(f.today, base)}
                      </span>{" "}
                      на сегодня
                    </>
                  ) : f.method === "cumulative" &&
                    allowance.saved !== null &&
                    allowance.saved >= 1 ? (
                    <>
                      Лимит{" "}
                      <span className="font-mono tabular-nums text-text">
                        {formatMoney(allowance.perDay, base)}
                      </span>{" "}
                      плюс{" "}
                      <span className="font-mono tabular-nums text-income">
                        {formatMoney(allowance.saved, base)}
                      </span>{" "}
                      накопленных
                    </>
                  ) : (
                    <>
                      Лимит{" "}
                      <span className="font-mono tabular-nums text-text">
                        {formatMoney(allowance.perDay, base)}
                      </span>{" "}
                      в день до {dayAndMonth(f.periodEnd)}
                    </>
                  )}
                </div>
                <div>
                  {f.spentToday > 0.5 ? (
                    <>
                      Сегодня из свободных ушло{" "}
                      <span className="font-mono tabular-nums text-expense">
                        {formatMoney(f.spentToday, base)}
                      </span>
                    </>
                  ) : f.spentToday < -0.5 ? (
                    <>
                      Сегодня свободных прибавилось{" "}
                      <span className="font-mono tabular-nums text-income">
                        {formatMoney(-f.spentToday, base)}
                      </span>
                    </>
                  ) : (
                    "Сегодня всё по плану — свободные целы"
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="flex-1 flex flex-col justify-center pt-5">
        <SectionLabel>
          Свободно до {dayAndMonth(f.periodEnd)} · {formatNum(f.daysLeft)}{" "}
          {pluralRu(f.daysLeft, ["день", "дня", "дней"])}
        </SectionLabel>
        <div className="flex items-baseline gap-2 mt-2 mb-2.5">
          <span
            className={`font-mono tabular-nums font-semibold text-2xl leading-none ${
              f.free < 0 ? "text-expense" : ""
            }`}
            style={{ wordSpacing: "-0.22em" }}
          >
            {f.free < 0 && "−"}
            {formatMoney(Math.abs(f.free), base)}
          </span>
          {f.overspent >= 1 && (
            <span className="text-[13px] text-muted font-mono tabular-nums">
              из {formatMoney(f.freeTotal, base)}
            </span>
          )}
        </div>
        <FreeBar ratio={f.freeTotal > 0 ? f.free / f.freeTotal : 0} />
        {f.overspent >= 1 && (
          <div className="text-[13px] text-muted mt-2">
            Перебор по статьям съел{" "}
            <span className="font-mono tabular-nums text-expense">
              {formatMoney(f.overspent, base)}
            </span>
          </div>
        )}
        <div className="space-y-1.5 mt-3.5 pt-3.5 border-t border-border">
          <FreeRow
            label={
              f.balanceMode === "includeOpeningBalance"
                ? "На счетах"
                : "Баланс периода"
            }
            value={money.balance}
            base={base}
          />
          {money.stillToCome > 0 && (
            <FreeRow
              label="Ещё поступит"
              value={money.stillToCome}
              base={base}
              sign="+"
              muted
            />
          )}
          {money.excluded > 0 && (
            <FreeRow
              label="Не учитывать"
              value={money.excluded}
              base={base}
              sign="−"
              muted
            />
          )}
          <FreeRow
            label="План на месяц"
            value={f.planLeft}
            base={base}
            sign="−"
            muted
          />
        </div>
      </div>
        </div>
  );
    }

export function FreeMoneyBlock({ f, base }: { f: FreeMoneyModel; base: Currency }) {
  if (!f.ready) return <FreeMoneyEmpty />;
  const lines = planLines(f.planRows);

  return (
    <>
      <BlockTitle
        title="Свободные деньги"
        to="/budgets"
        linkLabel="Бюджет"
        info={freeMoneyInfo(true, f.balanceMode)}
      />

      {/* Две колонки: слева ответ на «сколько можно сегодня» и из чего он
          сложился, справа — сам план, который эти деньги и съедает. Правая
          листается: категорий бывает три десятка, а высота у виджета общая. */}
      <div className="grid gap-6 md:grid-cols-2 flex-1 min-h-0">
        <FreeMoneySummary f={f} base={base} />

        <div className="flex flex-col min-h-0">
          <SectionLabel>План на месяц</SectionLabel>
          {f.planRows.length === 0 ? (
            <p className="text-[13px] text-muted mt-2">
              Бюджет на этот период не задан, поэтому вычитать из денег нечего.
              Задайте его в «Бюджете» — и свободные деньги станут честнее.
            </p>
          ) : (
            <div className="scroll-soft flex-1 min-h-0 mt-2 -mx-2 px-2">
              {lines.map(({ row, depth, more, divider }) => (
                <div
                  key={row.tagId}
                  // Содержимое по центру строки, а не по базовой линии: при
                  // выравнивании по базовой текст прижимается к верху строки
                  // высотой 36 px, и уголок подстатьи оказывался на восемь
                  // пикселей ниже её названия.
                  className={`relative flex items-center justify-between gap-3 h-9 ${
                    divider ? "border-b border-border/60" : ""
                  } ${depth > 0 ? "text-muted" : ""}`}
                  style={depth > 0 ? { paddingLeft: `${depth}rem` } : undefined}
                >
                  {/* Уголок к родительской статье — тот же, что в «Бюджеты →
                      Дашборд»: вертикаль идёт насквозь, пока ветка
                      продолжается, и обрывается на середине последней
                      подстатьи. */}
                  {depth > 0 && (
                    <>
                      <span
                        className={`absolute top-0 w-px bg-border ${
                          more ? "bottom-0" : "bottom-1/2"
                        }`}
                        style={{ left: `${depth - 0.75}rem` }}
                      />
                      <span
                        className="absolute top-1/2 w-2 h-px bg-border"
                        style={{ left: `${depth - 0.75}rem` }}
                      />
                    </>
                  )}
                  <span className="text-[13.5px] truncate">{row.title}</span>
                  <span className="font-mono tabular-nums text-[13.5px] text-muted shrink-0">
                    {formatMoney(row.left, base)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Тот же виджет в треть ширины — без списка статей.
 *
 * Список в узкую колонку не встаёт: суммы жмутся к названиям, а подстатьи с
 * уголком остаются без места под отступ. Всё остальное — кольцо дня, свободные
 * до конца периода и разбивка — читается в трети ничуть не хуже.
 */
export function FreeMoneyCompactBlock({ f, base }: { f: FreeMoneyModel; base: Currency }) {
  if (!f.ready) return <FreeMoneyEmpty />;

  return (
    <>
      <BlockTitle
        title="Свободные деньги"
        to="/budgets"
        linkLabel="Бюджет"
        info={freeMoneyInfo(false, f.balanceMode)}
      />
      <FreeMoneySummary f={f} base={base} />
    </>
  );
}

