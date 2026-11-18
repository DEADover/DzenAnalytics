/**
 * «Категория под наблюдением» — одна категория крупным планом: сколько
 * набралось в этом месяце, сколько обычно набирается к этому дню и как было
 * раньше. Категория — расходная или доходная, целиком или одна подкатегория.
 *
 * Таких виджетов на главной может стоять несколько — по одному на категорию.
 * Какая категория, хранит место в раскладке; выбирают её прямо в виджете.
 */

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { BlockTitle } from "./blocks/shared";
import { WatchBars, WatchHead } from "./blocks/watch";
import { CategoryCascadePicker } from "../CategoryCascadePicker";
import { CategoryDot } from "../CategoryDot";
import { KindSwitcher } from "../KindSwitcher";
import { useCategoryNodes } from "../../hooks/useCategoryNodes";
import { buildCategoryWatch, inWatched, watchAmount, type WatchKind } from "../../lib/categoryWatch";
import { monthTitle } from "../../lib/format";
import { periodKey } from "../../lib/period";
import type { Transaction } from "../../types";

export function WatchWidget({
  category,
  subcategory,
  income,
  transactions,
  ym,
  monthStartDay,
  today,
  base,
  onPick,
  onOpen,
}: {
  /** Пусто — категория ещё не выбрана. */
  category: string | undefined;
  subcategory: string | undefined;
  /** Категория доходная: считаем доходы. */
  income: boolean;
  transactions: Transaction[];
  ym: string;
  monthStartDay: number;
  today: string;
  base: string;
  onPick: (category: string, subcategory: string, income: boolean) => void;
  onOpen: (title: string, txs: Transaction[], subtitle: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  // Какие категории предлагает поле выбора, пока оно открыто.
  const [pickKind, setPickKind] = useState<WatchKind>(income ? "income" : "expense");
  const kind: WatchKind = income ? "income" : "expense";
  const sub = subcategory || null;
  const name = sub ?? category ?? "";

  const watch = useMemo(
    () =>
      category
        ? buildCategoryWatch(transactions, category, sub, ym, monthStartDay, today, kind)
        : null,
    [transactions, category, sub, ym, monthStartDay, today, kind]
  );

  const openMonth = (month: string) => {
    if (!category) return;
    onOpen(
      `${name} · ${monthTitle(month)}`,
      transactions.filter(
        (t) =>
          watchAmount(t, kind) !== 0 &&
          inWatched(t, category, sub) &&
          periodKey(t.date, monthStartDay) === month
      ),
      kind === "income" ? "Доходы по категории" : "Расходы по категории"
    );
  };

  const showPicker = !category || picking;

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
            Одна категория расходов или доходов: сколько набралось с начала
            месяца и сколько обычно набирается к этому дню — в среднем за
            последние полные месяцы, не больше трёх. Ниже — то же по месяцам.
            Категорию с подкатегориями можно выбрать целиком («Вся категория»)
            или одну её подкатегорию. Возвраты уменьшают расход. Клик по числу
            или столбику открывает операции за месяц.
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
              onClick={() => {
                setPickKind(kind);
                setPicking((v) => !v);
              }}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : undefined
        }
        rightSmall
        // Раздел открывается той же стороной, что считает виджет: у доходной
        // категории — доходы.
        to={`/categories?kind=${kind}`}
        linkLabel="Категории"
      />
      {showPicker && (
        <div className="mb-3 flex flex-col gap-2" data-testid="watch-picker">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted min-w-0">
              {category ? "Другая категория" : "За какой категорией следить"}
            </span>
            <KindSwitcher kind={pickKind} onChange={setPickKind} />
          </div>
          <WatchPicker
            kind={pickKind}
            // Выбранное показываем только в «своём» списке: расходной категории
            // среди доходных нет, и поле не должно делать вид, что есть.
            category={pickKind === kind ? (category ?? "") : ""}
            subcategory={pickKind === kind ? (subcategory ?? "") : ""}
            onChange={(c, s) => {
              if (!c) return;
              onPick(c, s, pickKind === "income");
              setPicking(false);
            }}
          />
        </div>
      )}
      {watch && category && (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="watch-widget" data-watch-kind={kind}>
          <WatchHead
            watch={watch}
            kind={kind}
            ym={ym}
            today={today}
            base={base}
            onOpen={() => openMonth(ym)}
          />
          <WatchBars series={[{ kind, watch }]} base={base} onOpen={openMonth} />
        </div>
      )}
    </>
  );
}

/**
 * Поле выбора категории. Отдельным компонентом, чтобы дерево категорий (оно
 * читает кэш Дзен-мани) собиралось только пока поле открыто.
 */
function WatchPicker({
  kind,
  category,
  subcategory,
  onChange,
}: {
  kind: WatchKind;
  category: string;
  subcategory: string;
  onChange: (category: string, subcategory: string) => void;
}) {
  const nodes = useCategoryNodes(kind);
  return (
    <CategoryCascadePicker
      category={category}
      subcategory={subcategory}
      categories={nodes}
      onChange={onChange}
      placeholder="Выберите категорию"
      // Сама категория здесь — вся ветка вместе с подкатегориями, а не «операции
      // без подкатегории».
      parentLabel="Вся категория"
      portal
    />
  );
}
