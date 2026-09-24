import { useEffect, useRef, useState, type RefObject } from "react";
import { Copy } from "lucide-react";
import { Popover } from "./Popover";
import { MONTHS, MONTHS_SHORT } from "../lib/months";
import { formatMoney } from "../lib/format";
import { pluralRu } from "../lib/plural";

/** Название месяца по ключу `YYYY-MM`: полное или короткое. */
const monthName = (ym: string, short = false) =>
  (short ? MONTHS_SHORT : MONTHS)[Number(ym.slice(5, 7)) - 1];

const monthsWord = (n: number) => pluralRu(n, ["месяц", "месяца", "месяцев"]);

/**
 * Выбор месяцев, на которые копируется план: чип на каждый месяц, куда план
 * можно записать, и «Все следующие» — самый частый случай («с октября и до
 * конца года»).
 */
function MonthTargets({
  source,
  months,
  picked,
  onChange,
}: {
  source: string;
  /** Месяцы, куда можно копировать, — без исходного. */
  months: string[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const following = months.filter((m) => m > source);
  const allFollowing = following.length > 0 && following.every((m) => picked.has(m));
  const toggle = (m: string) => {
    const next = new Set(picked);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="label whitespace-nowrap">Копировать на месяцы</span>
        {following.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const next = new Set(picked);
              for (const m of following) {
                if (allFollowing) next.delete(m);
                else next.add(m);
              }
              onChange(next);
            }}
            className="text-xs text-accent hover:underline whitespace-nowrap"
          >
            {allFollowing ? "Снять следующие" : "Все следующие"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={picked.has(m)}
            onClick={() => toggle(m)}
            className={`chip chip-sm justify-center ${picked.has(m) ? "chip-on" : ""}`}
          >
            {monthName(m, true)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Правка плана одной статьи за месяц в режиме «Год» (issue #106).
 *
 * Окно, а не поле прямо в ячейке: к сумме тут же прилагается копирование на
 * другие месяцы — так это было и в старом Дзен-мани, — а в ячейку шириной в
 * пять знаков выбор месяцев не помещается.
 */
export function PlanCellPopover({
  anchorRef,
  title,
  ym,
  initial,
  subsPlan,
  base,
  targets,
  onSave,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** Статья — как в строке таблицы. */
  title: string;
  ym: string;
  /** Сумма, которая сейчас в ячейке. */
  initial: number;
  /** Сколько в этой сумме дают под-категории — только у строки категории. */
  subsPlan: number;
  base: string;
  /** Месяцы, куда можно скопировать сумму, — без этого. */
  targets: string[];
  onSave: (amount: number, copyTo: string[]) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial > 0 ? String(Math.round(initial)) : "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Фокус — кадром позже, а не `autoFocus`: окно сначала рисуется невидимым,
  // чтобы измерить себя, и скрытое поле фокус не принимает.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const amount = Number(value || 0);
  const copyTo = targets.filter((m) => picked.has(m));
  const unchanged = amount === Math.round(initial) && copyTo.length === 0;

  const save = () => {
    if (unchanged) return onClose();
    onSave(amount, copyTo);
    onClose();
  };

  return (
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-80 card p-3.5 shadow-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-3"
      >
        <div>
          <div className="label">План · {monthName(ym)}</div>
          <div className="text-sm font-medium truncate mt-0.5">{title}</div>
        </div>
        <div>
          <input
            type="text"
            inputMode="numeric"
            ref={inputRef}
            aria-label={`План на ${monthName(ym).toLowerCase()}, ${base}`}
            value={value}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            className="input text-right tabular-nums"
          />
          {subsPlan > 0 && (
            <p className="text-xs text-muted mt-1.5">
              Сумма на всю категорию, вместе с подкатегориями: у них в этом месяце{" "}
              {formatMoney(subsPlan, base)}.
            </p>
          )}
        </div>
        {targets.length > 0 && (
          <MonthTargets source={ym} months={targets} picked={picked} onChange={setPicked} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button type="submit" className="btn-primary text-sm whitespace-nowrap">
            {copyTo.length > 0
              ? // От двух до двенадцати — всегда «месяцах».
                `Сохранить в ${copyTo.length + 1} месяцах`
              : "Сохранить"}
          </button>
        </div>
      </form>
    </Popover>
  );
}

/**
 * Копирование плана целого месяца на другие месяцы — из шапки месяца.
 *
 * Месяц-копия повторяет исходный полностью: у статей без плана в исходном
 * месяце план в выбранных снимается, иначе итог месяца не совпал бы.
 */
export function MonthCopyPopover({
  anchorRef,
  source,
  targets,
  onCopy,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  source: string;
  targets: string[];
  onCopy: (copyTo: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(targets.filter((m) => m > source))
  );
  const copyTo = targets.filter((m) => picked.has(m));
  return (
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-80 card p-3.5 shadow-lg">
      <div className="space-y-3">
        <div>
          <div className="label">Копировать план месяца</div>
          <div className="text-sm font-medium mt-0.5">{monthName(source)}</div>
        </div>
        <MonthTargets source={source} months={targets} picked={picked} onChange={setPicked} />
        <p className="text-xs text-muted">
          У каждой статьи в выбранных месяцах будет тот же план. Где в исходном
          месяце плана нет, он снимается. Суммы назначенных операций не
          копируются — у каждого месяца они свои.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            disabled={copyTo.length === 0}
            onClick={() => {
              onCopy(copyTo);
              onClose();
            }}
            className="btn-primary text-sm whitespace-nowrap"
          >
            <Copy className="w-4 h-4" aria-hidden />
            {copyTo.length > 0
              ? `Копировать на ${copyTo.length} ${monthsWord(copyTo.length)}`
              : "Копировать"}
          </button>
        </div>
      </div>
    </Popover>
  );
}
