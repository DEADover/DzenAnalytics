import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { formatNum } from "../../../lib/format";

/**
 * «Разобрать» — что в данных ждёт внимания: новые операции, операции без
 * категории, неотправленные правки, просроченные платежи.
 *
 * Остальные виджеты главной отвечают на вопрос «что с деньгами». Этот — на
 * «что мне сделать»: каждая строка открывает ровно те операции, которые в ней
 * посчитаны. Пустая строка не исчезает, а отмечается галочкой: состав виджета
 * не прыгает от данных, и видно, что всё разобрано, а не «не посчиталось».
 */
export interface TriageItem {
  key: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  count: number;
  onOpen: () => void;
}

export function TriageBlock({ items }: { items: TriageItem[] }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="triage-block">
      {items.map((it) => {
        const Icon = it.icon;
        const empty = it.count === 0;
        const body = (
          <>
            <span
              className={`w-9 h-9 shrink-0 rounded-full grid place-items-center ${
                empty ? "bg-panel2 text-muted" : "bg-accent/10 text-accent"
              }`}
            >
              <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-[15px] font-medium truncate ${empty ? "text-muted" : ""}`}>
                {it.label}
              </span>
              <span className="block text-[12px] text-muted truncate">{it.hint}</span>
            </span>
            {empty ? (
              <Check className="w-5 h-5 shrink-0 text-income" aria-label="Ничего не осталось" />
            ) : (
              <>
                <span className="shrink-0 text-[24px] font-semibold tabular-nums tracking-[-0.025em] leading-none">
                  {formatNum(it.count)}
                </span>
                <ChevronRight
                  className="w-4 h-4 shrink-0 text-muted group-hover:text-accent"
                  aria-hidden="true"
                />
              </>
            )}
          </>
        );
        const tile =
          "flex-1 min-h-[60px] w-full flex items-center gap-3 rounded-[14px] border border-border px-4 py-2.5 text-left";
        return empty ? (
          <div key={it.key} className={tile} data-triage={it.key} data-count={0}>
            {body}
          </div>
        ) : (
          <button
            key={it.key}
            type="button"
            onClick={it.onOpen}
            data-triage={it.key}
            data-count={it.count}
            className={`${tile} group transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
