import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";
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
    <div className="space-y-1.5">
      <div className="text-xs text-muted">Копировать на месяцы</div>
      {/* Плотные чипы в строку: месяцев до одиннадцати, и сеткой по четыре
          они растягивали окно на высоту самой суммы. */}
      <div className="flex flex-wrap gap-1">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={picked.has(m)}
            onClick={() => toggle(m)}
            className={`chip chip-sm !px-2 justify-center ${picked.has(m) ? "chip-on" : ""}`}
          >
            {monthName(m, true)}
          </button>
        ))}
      </div>
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
          {allFollowing ? "Снять выбор" : "До конца года"}
        </button>
      )}
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
    // Компактно: заголовок строкой, сумма и «Сохранить» в одном ряду. Отмены
    // нет — окно закрывается по Esc и щелчку мимо, как любое всплывающее.
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-64 card p-3 shadow-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-2.5"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted">{monthName(ym)}</div>
        </div>
        <div>
          <div className="flex gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              ref={inputRef}
              aria-label={`План на ${monthName(ym).toLowerCase()}, ${base}`}
              value={value}
              placeholder="0"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className="input !py-1.5 text-sm text-right tabular-nums min-w-0"
            />
            {/* Значком: слово «Сохранить» было шире самой суммы. Высота —
                с поле (34), квадратом. */}
            <Tooltip content="Сохранить · Enter">
              <button
                type="submit"
                aria-label="Сохранить"
                className="btn-primary !p-0 w-[34px] h-[34px] shrink-0"
              >
                <Check className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
          {subsPlan > 0 && (
            <p className="text-xs text-muted mt-1">
              Вместе с подкатегориями: у них{" "}
              <span className="whitespace-nowrap">{formatMoney(subsPlan, base)}</span>
            </p>
          )}
        </div>
        {targets.length > 0 && (
          <MonthTargets source={ym} months={targets} picked={picked} onChange={setPicked} />
        )}
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
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-64 card p-3 shadow-lg">
      <div className="space-y-2.5">
        <div className="text-sm">
          <span className="font-medium">План на {monthName(source).toLowerCase()}</span>
          <span className="text-muted"> — копия</span>
        </div>
        <MonthTargets source={source} months={targets} picked={picked} onChange={setPicked} />
        <p className="text-xs text-muted">
          Месяцы станут копией: где в исходном плана нет, он снимается.
          Назначенные операции не копируются.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={copyTo.length === 0}
            onClick={() => {
              onCopy(copyTo);
              onClose();
            }}
            className="btn-primary !px-3 !py-1.5 text-sm whitespace-nowrap"
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
