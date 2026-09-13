/**
 * Ячейки строки операции — одни для ленты «Операций» и для шторки.
 *
 * Строку операции рисовали две копии, и они разошлись: в ленте у долга свой
 * значок, у непросмотренной операции — отметка «новая», в шторке — нет. Здесь
 * содержимое ячеек; раскладку (сетка ленты или таблица шторки) и цвет суммы
 * задаёт место, где строка стоит.
 */
import { ArrowLeftRight, Copy, HandCoins, Pencil, Scissors, Trash2 } from "lucide-react";
import type { Transaction } from "../../types";
import { useDisplayStore } from "../../store/useDisplayStore";
import {
  crossCurrencyReceived,
  displayPayee,
  formatMoney,
  secondaryPayee,
  transferCounterparty,
} from "../../lib/format";
import { kindGlyphClass, kindSignGlyph } from "../../lib/txKindStyle";
import { CategoryDot } from "../CategoryDot";
import { ExtraCategoriesLine } from "../ExtraCategoriesLine";
import { Tooltip } from "../Tooltip";

/** Категория: значок 28 с отметками, название, подкатегория и вторые категории строками ниже. */
export function OperationCategory({
  tx,
  edited,
  draft = false,
}: {
  tx: Transaction;
  edited: boolean;
  draft?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="relative inline-flex shrink-0">
        {/* У операции в подкатегории — значок самой подкатегории, а не родителя. */}
        <CategoryDot
          category={tx.subcategory || tx.category}
          parent={tx.subcategory ? tx.category : undefined}
          size="w-7 h-7"
        />
        {draft && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-expense border-2 border-panel"
            aria-label="Новая операция — не синхронизирована"
          />
        )}
        {/* «Новая» — приехала из банка, и в Дзен-мани её ещё не открывали. С
            точкой черновика не сталкивается: у черновиков этой пометки нет. */}
        {tx.unseen && !draft && (
          <Tooltip content="Новая — вы ещё не открывали её в Дзен-мани">
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-panel"
              role="img"
              aria-label="Новая операция"
            />
          </Tooltip>
        )}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{tx.category}</span>
          {edited && !draft && (
            <Pencil className="w-3 h-3 text-accent2 shrink-0" aria-label="Отредактировано" />
          )}
        </div>
        {tx.subcategory && (
          <div className="text-[0.85em] text-muted truncate">{tx.subcategory}</div>
        )}
        {/* Вторые категории — своей строкой (#69). */}
        <ExtraCategoriesLine extras={tx.extraCategories} />
      </div>
    </div>
  );
}

/**
 * Контрагент: имя из справочника Дзен-мани первой строкой, под ним — строка из
 * выписки или свободный текст, если он отличается. Что именно второй строкой —
 * настройка «Оформления».
 */
export function OperationPayee({ tx }: { tx: Transaction }) {
  const statementLine = useDisplayStore((s) => s.statementLine);
  const primary = displayPayee(tx) || transferCounterparty(tx) || "";
  const secondary = statementLine ? secondaryPayee(tx, "statement") : null;
  const tooltip = secondary ? `${primary} — ${secondary}` : primary;
  return (
    <div className="min-w-0">
      <div className="truncate text-muted" title={tooltip}>
        {primary || "—"}
      </div>
      {secondary && (
        <div className="truncate text-[0.85em] text-text" title={secondary}>
          {secondary}
        </div>
      )}
    </div>
  );
}

/** Сумма: знак или значок вида, сумма в валюте операции, полученное в другой валюте — строкой ниже. */
export function OperationAmount({ tx }: { tx: Transaction }) {
  const received = crossCurrencyReceived(tx);
  return (
    <>
      {tx.category === "Долг" ? (
        <HandCoins className="inline-block w-3.5 h-3.5 align-[-2px] mr-0.5" aria-hidden />
      ) : tx.kind === "transfer" ? (
        <ArrowLeftRight className="inline-block w-3.5 h-3.5 align-[-2px] mr-0.5" aria-hidden />
      ) : (
        <span className={kindGlyphClass(tx.kind)}>{kindSignGlyph(tx.kind)}</span>
      )}
      {formatMoney(tx.amount, tx.currency)}
      {received && <div className="text-[0.85em] font-normal text-muted/80">({received})</div>}
    </>
  );
}

/** Действия с операцией: правка, копия, разделение, удаление. Нет обработчика — нет кнопки. */
export function OperationActions({
  onEdit,
  onCopy,
  onSplit,
  onDelete,
}: {
  onEdit: () => void;
  onCopy?: () => void;
  onSplit?: () => void;
  onDelete: () => void;
}) {
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="flex items-center justify-center gap-0.5">
      <button
        type="button"
        onClick={stop(onEdit)}
        className="btn-icon"
        title="Редактировать"
        aria-label="Редактировать операцию"
      >
        <Pencil className="w-4 h-4" />
      </button>
      {onCopy && (
        <button
          type="button"
          onClick={stop(onCopy)}
          className="btn-icon"
          title="Копировать — та же операция сегодняшним днём"
          aria-label="Копировать операцию"
        >
          <Copy className="w-4 h-4" />
        </button>
      )}
      {onSplit && (
        <button
          type="button"
          onClick={stop(onSplit)}
          className="btn-icon"
          title="Разделить — расписать операцию по нескольким статьям"
          aria-label="Разделить операцию"
        >
          <Scissors className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={stop(onDelete)}
        className="btn-icon-danger"
        title="Удалить"
        aria-label="Удалить операцию"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
