import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Filter, Globe } from "lucide-react";
import { SearchInput } from "../SearchInput";
import { Popover } from "../Popover";
import { formatNum } from "../../lib/format";

export type SearchScope = "filter" | "all";

const OPTIONS: { value: SearchScope; label: string; icon: typeof Filter }[] = [
  {
    value: "filter",
    label: "В фильтре",
    icon: Filter,
  },
  {
    value: "all",
    label: "Везде",
    icon: Globe,
  },
];

/**
 * Быстрый поиск по ленте с выбором, где искать, — без кнопок сбоку.
 *
 * Пока набирается текст, под полем всплывает подсказка из двух пунктов с
 * числом найденного: «В фильтре» и «Везде». Выбрать — щелчком или стрелками и
 * Enter; Esc прячет подсказку. «Везде» видно меткой в самом поле, щелчок по
 * ней открывает подсказку снова.
 */
export function ScopedSearchInput({
  value,
  onChange,
  scope,
  onScopeChange,
  counts,
  placeholder,
  title,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  scope: SearchScope;
  onScopeChange: (next: SearchScope) => void;
  /** Сколько найдётся в каждом варианте — числа в подсказке. */
  counts: Record<SearchScope, number>;
  placeholder?: string;
  title?: string;
  className?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** Подсвеченный стрелками пункт. */
  const [active, setActive] = useState<SearchScope>(scope);
  /** Выбор уже сделан для этого поиска — дальше набор подсказку не дёргает,
   *  пока поле не очистят. Открыть снова — стрелкой вниз или меткой. */
  const [chosen, setChosen] = useState(false);
  const hasText = value.trim().length > 0;
  const shown = open && hasText;
  const close = useCallback(() => setOpen(false), []);

  const pick = (next: SearchScope) => {
    onScopeChange(next);
    setChosen(true);
    setOpen(false);
  };

  return (
    <div ref={anchor} className={className} data-search-scope-field>
      <SearchInput
        size="sm"
        value={value}
        onChange={(next) => {
          onChange(next);
          setActive(scope);
          const empty = next.trim().length === 0;
          if (empty) setChosen(false);
          setOpen(!empty && !chosen);
        }}
        placeholder={placeholder}
        title={shown ? undefined : title}
        badge={
          hasText && scope === "all" ? (
            <button
              type="button"
              onClick={() => {
                setActive(scope);
                setOpen((o) => !o);
              }}
              className="pill text-[11px] leading-none py-1 px-2 bg-accent/15 text-accent hover:bg-accent/25 inline-flex items-center gap-1"
              title="Ищется по всем операциям, без общего фильтра. Щёлкните, чтобы искать в фильтре"
              data-search-scope-badge
            >
              <Globe className="w-3 h-3" aria-hidden />
              Везде
            </button>
          ) : undefined
        }
        inputProps={{
          role: "combobox",
          "aria-expanded": shown,
          "aria-controls": "search-scope-list",
          onKeyDown: (e) => {
            if (!hasText) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) setOpen(true);
              else setActive((a) => (a === "filter" ? "all" : "filter"));
            } else if (e.key === "Enter" && shown) {
              e.preventDefault();
              pick(active);
            } else if (e.key === "Escape" && shown) {
              e.stopPropagation();
              setOpen(false);
            }
          },
        }}
      />
      <Popover
        open={shown}
        anchorRef={anchor}
        onClose={close}
        className="card p-1 w-56 shadow-xl"
      >
        <div id="search-scope-list" role="listbox" aria-label="Где искать" className="flex flex-col">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const selected = scope === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(o.value)}
                onClick={() => pick(o.value)}
                className={clsx(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                  active === o.value && "bg-panel2"
                )}
                data-search-scope={o.value}
              >
                <Icon className="w-4 h-4 shrink-0 text-muted" aria-hidden />
                <span className="flex-1 min-w-0 whitespace-nowrap">{o.label}</span>
                {/* Место под число отведено заранее и с запасом: окошко одной
                    ширины, найдено ли 1 или 100 000. */}
                <span className="w-[4.5rem] shrink-0 text-right tabular-nums text-muted" data-count>
                  {formatNum(counts[o.value])}
                </span>
                <Check
                  className={clsx("w-4 h-4 shrink-0 text-accent", !selected && "invisible")}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
