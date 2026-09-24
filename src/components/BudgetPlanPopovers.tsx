import { useEffect, useRef, useState, type RefObject } from "react";
import { Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { Popover } from "./Popover";
import { MONTHS, MONTHS_IN, MONTHS_SHORT } from "../lib/months";
import { formatMoney } from "../lib/format";

/** Название месяца по ключу `YYYY-MM`: полное или короткое. */
const monthName = (ym: string, short = false) =>
  (short ? MONTHS_SHORT : MONTHS)[Number(ym.slice(5, 7)) - 1];

const monthNameIn = (ym: string) => MONTHS_IN[Number(ym.slice(5, 7)) - 1];

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
  label = "Копировать на месяцы",
}: {
  source: string;
  /** Месяцы, куда можно копировать, — без исходного. */
  months: string[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  label?: string;
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
      <div className="text-xs text-muted">{label}</div>
      {/* Сеткой по три: все названия в три буквы, но разной ширины («Май» уже
          «Фев»), и переносом по ширине правый край выходил рваным. В сетке
          чипы одинаковые и вместе ровно в ширину поля — до четырёх рядов
          при одиннадцати месяцах. */}
      <div className="grid grid-cols-3 gap-1">
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
  const [copyOpen, setCopyOpen] = useState(false);
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
    // Сумма, под ней копия и «Сохранить» — всегда внизу окна. Месяцы для копии
    // раскрываются по значку между полем и кнопками, плавно раздвигая окно:
    // нужны они редко, и держать их открытыми значило растить окно ради
    // исключения. Ширина — по ряду кнопок: поле кончается там же, где
    // «Сохранить», без пустой полосы справа; девять знаков суммы влезают.
    // Отмены нет — окно закрывается по Esc и щелчку мимо.
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-40 card p-2.5 shadow-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {/* Месяц — своей строкой: название статьи бывает длинным, и в одну
            строку с ним месяц уезжал за край. */}
        <div className="mb-2 min-w-0">
          <div className="text-xs font-medium truncate">{title}</div>
          <div className="text-xs text-muted">{monthName(ym)}</div>
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
            className="input !py-1.5 text-sm tabular-nums"
          />
        </div>
        {subsPlan > 0 && (
          <p className="text-xs text-muted mt-1.5">
            Из них подкатегории:{" "}
            <span className="whitespace-nowrap">{formatMoney(subsPlan, base)}</span>
          </p>
        )}
        {targets.length > 0 && (
          // Раскрытие высотой строки сетки (0fr → 1fr) — тот же приём, что у
          // журнала синхронизаций: высоту заранее знать не нужно. Свёрнутые
          // чипы выключены из обхода с клавиатуры (`inert`).
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
              copyOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div
              inert={!copyOpen}
              className={`min-h-0 overflow-hidden transition-opacity duration-300 motion-reduce:transition-none ${
                copyOpen ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="pt-2.5">
                <MonthTargets source={ym} months={targets} picked={picked} onChange={setPicked} />
              </div>
            </div>
          </div>
        )}
        {/* Копия квадратом и «Сохранить» — рядом, вместе ровно в ширину поля. */}
        <div className="flex gap-1.5 mt-2.5">
          {targets.length > 0 && (
            <Tooltip content={copyOpen ? "Не копировать" : "Копировать на другие месяцы"}>
              <button
                type="button"
                aria-label="Копировать на другие месяцы"
                aria-expanded={copyOpen}
                onClick={() => {
                  if (copyOpen) setPicked(new Set());
                  setCopyOpen((o) => !o);
                }}
                className={`btn-ghost !p-0 w-[34px] h-[34px] shrink-0 ${
                  copyOpen ? "!border-accent/60 !bg-accent/10 text-accent" : ""
                }`}
              >
                <Copy className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          <button type="submit" className="btn-primary flex-1 min-w-0 !px-2 !py-1.5 text-sm whitespace-nowrap">
            {/* Без счётчика месяцев: какие получат сумму, видно по чипам, а
                «· 12 мес.» раздувал кнопку шире окна. */}
            Сохранить
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
    // Тем же видом, что окно плана ячейки: подпись и месяц двумя строками,
    // чипы сеткой по три, кнопка на всю ширину. Пояснение — одной фразой о
    // результате: что станет с планом, а не как это устроено.
    <Popover open anchorRef={anchorRef} onClose={onClose} className="w-40 card p-2.5 shadow-lg">
      <div className="mb-2">
        <div className="text-xs font-medium">Копировать план</div>
        <div className="text-xs text-muted">{monthName(source)}</div>
      </div>
      <MonthTargets
        source={source}
        months={targets}
        picked={picked}
        onChange={setPicked}
        label="На месяцы"
      />
      <p className="text-xs text-muted mt-2">
        План всех статей станет как в {monthNameIn(source)}.
      </p>
      <button
        type="button"
        disabled={copyTo.length === 0}
        onClick={() => {
          onCopy(copyTo);
          onClose();
        }}
        className="btn-primary w-full !px-2 !py-1.5 text-sm mt-2.5"
      >
        Копировать
      </button>
    </Popover>
  );
}
