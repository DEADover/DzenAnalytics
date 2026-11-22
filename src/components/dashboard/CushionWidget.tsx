/**
 * «Подушка безопасности» — на сколько месяцев обычных расходов хватит денег.
 * Считает показатель «Финансового здоровья», поэтому числа здесь и в разделе
 * одни и те же. Хук читается здесь, а не на главной: он нужен только тем, кто
 * виджет поставил.
 */

import { useMemo } from "react";
import { BlockTitle } from "./blocks/shared";
import { ProgressBar } from "../ProgressBar";
import { SectionEmpty } from "../SectionEmpty";
import { useHealthScore } from "../../hooks/useHealthScore";
import { cushionView } from "../../lib/cushionWidget";
import { formatMoney } from "../../lib/format";
import { pluralRu } from "../../lib/plural";

/** «3,4 месяца», «3 месяца», «5 месяцев»: у дробного числа форма одна. */
function monthsLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const text = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  const word = Number.isInteger(rounded) ? pluralRu(rounded, ["месяц", "месяца", "месяцев"]) : "месяца";
  return `${text} ${word}`;
}

export function CushionWidget({ base }: { base: string }) {
  const health = useHealthScore();
  const view = useMemo(
    () => cushionView(health?.components.find((c) => c.id === "emergency_fund")),
    [health]
  );
  const tone = !view ? "accent" : view.ratio >= 1 ? "income" : view.months < 1 ? "expense" : view.ratio < 0.5 ? "warn" : "accent";

  return (
    <>
      <BlockTitle
        title="Подушка безопасности"
        info={
          <p>
            На сколько месяцев хватит денег, если доход пропадёт, а траты останутся
            прежними: остаток на счетах, делённый на средний расход за 6 полных
            месяцев. Цель задаётся в «Финансовом здоровье», числа те же, что там.
            Общие фильтры главной на виджет не действуют.
          </p>
        }
        to="/health"
        linkLabel="Здоровье"
      />
      {!view ? (
        <SectionEmpty variant="compact">Пока мало расходов, чтобы посчитать запас</SectionEmpty>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="cushion">
          <div>
            <div
              className="font-mono tabular-nums font-semibold text-3xl leading-none"
              style={{ wordSpacing: "-0.22em" }}
              data-testid="cushion-months"
            >
              {monthsLabel(view.months)}
            </div>
            <div className="mt-1.5 text-[13px] text-muted">Хватит при обычных расходах</div>
          </div>
          <div>
            <ProgressBar value={view.ratio} tone={tone} label="Доля цели по подушке" />
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px] text-muted tabular-nums">
              <span>Цель — {monthsLabel(view.target)}</span>
              <span>{Math.round(view.ratio * 100)}%</span>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm border-t border-border pt-3">
            <dt className="text-muted">Накопления</dt>
            <dd className="text-right tabular-nums">{formatMoney(view.liquid, base)}</dd>
            <dt className="text-muted">Расход в месяц</dt>
            <dd className="text-right tabular-nums">{formatMoney(view.avgExpense, base)}</dd>
            <dt className="text-muted">До цели</dt>
            <dd className={`text-right tabular-nums ${view.toTarget > 0 ? "" : "text-income font-medium"}`}>
              {view.toTarget > 0 ? formatMoney(view.toTarget, base) : "Цель достигнута"}
            </dd>
            {view.obligatoryMonths !== null && (
              <>
                <dt className="text-muted">Только обязательные</dt>
                <dd className="text-right tabular-nums">{monthsLabel(view.obligatoryMonths)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}
