/**
 * «Категория под наблюдением» — одна статья расходов крупным планом: сколько
 * ушло в этом месяце, сколько обычно уходит к этому дню и как было раньше.
 *
 * Таких виджетов на главной может стоять несколько — по одному на статью.
 * Какая статья, хранит место в раскладке; выбирают её прямо в виджете.
 */

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { BlockTitle } from "./blocks/shared";
import { CategoryCascadePicker } from "../CategoryCascadePicker";
import { CategoryDot } from "../CategoryDot";
import { DeviationPill } from "../DeviationPill";
import { Tooltip } from "../Tooltip";
import { useCategoryNodes } from "../../hooks/useCategoryNodes";
import { buildCategoryWatch, inWatched } from "../../lib/categoryWatch";
import { dayAndMonth } from "../../lib/dayLabel";
import { formatMoney, formatNum, monthTitle } from "../../lib/format";
import { MONTHS, MONTHS_SHORT } from "../../lib/months";
import { periodKey } from "../../lib/period";
import { pluralRu } from "../../lib/plural";
import type { Transaction } from "../../types";

const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? "";
const monthShort = (ym: string) => MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] ?? "";

export function WatchWidget({
  category,
  subcategory,
  transactions,
  ym,
  monthStartDay,
  today,
  base,
  onPick,
  onOpen,
}: {
  /** Пусто — статья ещё не выбрана. */
  category: string | undefined;
  subcategory: string | undefined;
  transactions: Transaction[];
  ym: string;
  monthStartDay: number;
  today: string;
  base: string;
  onPick: (category: string, subcategory: string) => void;
  onOpen: (title: string, txs: Transaction[], subtitle: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const sub = subcategory || null;
  const name = sub ?? category ?? "";

  const watch = useMemo(
    () =>
      category ? buildCategoryWatch(transactions, category, sub, ym, monthStartDay, today) : null,
    [transactions, category, sub, ym, monthStartDay, today]
  );

  const openMonth = (month: string) => {
    if (!category) return;
    onOpen(
      `${name} · ${monthTitle(month)}`,
      transactions.filter(
        (t) =>
          (t.kind === "expense" || t.kind === "refund") &&
          inWatched(t, category, sub) &&
          periodKey(t.date, monthStartDay) === month
      ),
      "Расходы по категории"
    );
  };

  const showPicker = !category || picking;
  const top = watch ? Math.max(1, ...watch.bars.map((b) => b.total)) : 1;
  const sameDay = watch?.running ? " к этому дню" : " за месяц";

  return (
    <>
      <BlockTitle
        title={
          category ? (
            <span className="inline-flex items-center gap-2 min-w-0 align-middle">
              <CategoryDot category={name} parent={sub ? category : undefined} size="w-6 h-6" />
              <span className="truncate">{name}</span>
            </span>
          ) : (
            "Категория под наблюдением"
          )
        }
        info={
          <p>
            Расходы одной статьи: сколько ушло с начала месяца и сколько обычно
            уходит к этому дню — в среднем за последние полные месяцы, не больше
            трёх. Ниже — те же расходы по месяцам. Возвраты уменьшают расход.
            Клик по числу или столбику открывает операции статьи за месяц.
          </p>
        }
        right={
          category ? (
            <button
              type="button"
              className="btn-icon p-1 ml-auto"
              title="Сменить категорию"
              aria-label="Сменить категорию"
              aria-pressed={picking}
              onClick={() => setPicking((v) => !v)}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : undefined
        }
      />
      {showPicker && (
        <div className="mb-3" data-testid="watch-picker">
          {!category && (
            <div className="text-[13px] text-muted mb-2">
              Выберите статью расходов — виджет будет следить за ней
            </div>
          )}
          <WatchPicker
            category={category ?? ""}
            subcategory={subcategory ?? ""}
            onChange={(c, s) => {
              if (!c) return;
              onPick(c, s);
              setPicking(false);
            }}
          />
        </div>
      )}
      {watch && category && (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="watch-widget">
          <button
            type="button"
            onClick={() => openMonth(ym)}
            className="text-left rounded-lg -mx-2 px-2 py-1 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted">
              {watch.running ? `Потрачено к ${dayAndMonth(today)}` : `Потрачено за ${monthName(ym).toLowerCase()}`}
            </div>
            <div className="mt-1 flex items-center gap-2.5 flex-wrap">
              <span
                className="text-[28px] font-bold tracking-[-0.03em] tabular-nums leading-[1.1] whitespace-nowrap"
                data-testid="watch-total"
              >
                {formatMoney(watch.nowAt, base)}
              </span>
              {watch.avgAt !== null && (
                <span className="text-[13px]">
                  <DeviationPill
                    current={watch.nowAt}
                    baseline={watch.avgAt}
                    base={base}
                    mode="both"
                    kind="expense"
                    upTitle={`Больше, чем обычно${sameDay}`}
                    downTitle={`Меньше, чем обычно${sameDay}`}
                  />
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[12px] text-muted tabular-nums">
              {watch.avgAt !== null
                ? `Обычно${sameDay} — ${formatMoney(watch.avgAt, base)}`
                : "Сравнить пока не с чем"}
              {" · "}
              {watch.count === 0
                ? "Операций нет"
                : `${formatNum(watch.count)} ${pluralRu(watch.count, ["операция", "операции", "операций"])}`}
            </div>
          </button>

          <div className="flex-1 min-h-[96px] flex items-end gap-2" data-testid="watch-bars">
            {watch.bars.map((b) => {
              const h = Math.max(0, b.total) / top;
              return (
                <Tooltip
                  key={b.ym}
                  data
                  content={
                    <div className="space-y-0.5">
                      <div className="font-medium">{monthTitle(b.ym)}</div>
                      <div className="tabular-nums">{formatMoney(b.total, base)}</div>
                    </div>
                  }
                >
                  <button
                    type="button"
                    onClick={() => openMonth(b.ym)}
                    aria-label={`${monthTitle(b.ym)}: ${formatMoney(b.total, base)}`}
                    className="group flex-1 min-w-0 h-full flex flex-col justify-end items-stretch gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span className="flex-1 min-h-0 flex items-end">
                      <span
                        className={`block w-full rounded-md transition-opacity duration-200 group-hover:opacity-100 ${
                          b.current ? "bg-expense" : "bg-muted/30 opacity-90"
                        }`}
                        style={{ height: `max(3px, ${h * 100}%)` }}
                      />
                    </span>
                    <span className={`text-[11px] text-center ${b.current ? "text-text font-medium" : "text-muted"}`}>
                      {monthShort(b.ym)}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Поле выбора статьи. Отдельным компонентом, чтобы дерево категорий (оно
 * читает кэш Дзен-мани) собиралось только пока поле открыто.
 */
function WatchPicker({
  category,
  subcategory,
  onChange,
}: {
  category: string;
  subcategory: string;
  onChange: (category: string, subcategory: string) => void;
}) {
  const nodes = useCategoryNodes("expense");
  return (
    <CategoryCascadePicker
      category={category}
      subcategory={subcategory}
      categories={nodes}
      onChange={onChange}
      placeholder="Выберите категорию"
      portal
    />
  );
}
