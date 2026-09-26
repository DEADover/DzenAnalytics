import { useMemo } from "react";
import { Plus, TrendingDown, X } from "lucide-react";
import type { CategoryAverage } from "../../lib/whatif";
import { formatMoney, formatPct } from "../../lib/format";
import { SectionCard } from "../SectionCard";
import { Slider } from "../Slider";
import { Combobox } from "../Combobox";
import { CategoryDot } from "../CategoryDot";
import { Tooltip } from "../Tooltip";

/** Сколько самых крупных категорий предлагать кнопками. */
const SUGGEST = 4;

const mulText = (v: number) => (v === 0 ? "−100%" : `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`);

/**
 * Изменения по категориям: «кафе вдвое меньше», «такси −30%».
 *
 * Раньше здесь стояли бегунки восьми самых крупных категорий — нужной могло
 * не оказаться, а восемь бегунков по нулям занимали пол-экрана. Теперь в
 * сценарии только те категории, которые вы в него добавили; самые крупные
 * предложены кнопками, остальные — поиском.
 */
export function WhatIfCategories({
  categories,
  categoryMul,
  base,
  onChange,
}: {
  categories: CategoryAverage[];
  categoryMul: Record<string, number>;
  base: string;
  onChange: (next: Record<string, number>) => void;
}) {
  const byName = useMemo(() => new Map(categories.map((c) => [c.category, c])), [categories]);
  const chosen = Object.keys(categoryMul);
  const free = categories.filter((c) => !(c.category in categoryMul));
  const suggest = free.slice(0, SUGGEST);

  const add = (name: string) => {
    if (!byName.has(name) || name in categoryMul) return;
    onChange({ ...categoryMul, [name]: 1 });
  };
  const remove = (name: string) => {
    const next = { ...categoryMul };
    delete next[name];
    onChange(next);
  };

  // Сумма изменения по всем категориям — чтобы было видно, сколько в месяц
  // даёт вся эта работа, а не складывать подписи в уме.
  const delta = chosen.reduce((s, name) => {
    const c = byName.get(name);
    return c ? s + c.monthly * (categoryMul[name] - 1) : s;
  }, 0);

  return (
    <SectionCard
      icon={TrendingDown}
      title="Категории расходов"
      info="Бегунок меняет ваш обычный расход в категории — среднее за те же месяцы, что и доход с расходом выше. Если одновременно сдвинуть общий «Расход в месяц», он применится поверх: кафе −50% и расход −10% вместе дадут по кафе −55%."
      right={
        Math.round(delta) !== 0 && (
          <span className={`text-sm tabular-nums ${delta < 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(delta, base, { signed: true })} / мес
          </span>
        )
      }
    >
      {chosen.length > 0 && (
        <div className="space-y-3 mb-3">
          {chosen.map((name) => {
            const c = byName.get(name);
            const mul = categoryMul[name];
            return (
              <div key={name} className="flex items-start gap-1.5">
                <Slider
                  className="flex-1 min-w-0"
                  layout="stacked"
                  label={name}
                  value={mul}
                  min={0}
                  max={2}
                  step={0.05}
                  format={mulText}
                  hint={
                    c
                      ? `Сейчас ${formatMoney(c.monthly, base)}/мес → ${formatMoney(c.monthly * mul, base)}/мес`
                      : "За последние месяцы трат в этой категории не было"
                  }
                  onChange={(v) => onChange({ ...categoryMul, [name]: v })}
                />
                <Tooltip content="Убрать из сценария">
                  <button
                    type="button"
                    className="btn-ghost !p-1 mt-0.5"
                    aria-label={`Убрать «${name}» из сценария`}
                    onClick={() => remove(name)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {free.length > 0 && (
        <div className="space-y-2">
          {suggest.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggest.map((c) => (
                <button
                  key={c.category}
                  type="button"
                  className="btn-ghost text-xs !py-1"
                  onClick={() => add(c.category)}
                >
                  <Plus className="w-3 h-3" />
                  {c.category}
                  <span className="text-muted tabular-nums">{formatMoney(c.monthly, base, { compact: true })}</span>
                </button>
              ))}
            </div>
          )}
          {free.length > SUGGEST && (
            <Combobox
              value=""
              options={free.map((c) => c.category)}
              onChange={add}
              placeholder="Другая категория…"
              allowCustom={false}
              searchable
              renderIcon={(name) => <CategoryDot category={name} />}
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}
