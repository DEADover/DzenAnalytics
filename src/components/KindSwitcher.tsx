type Kind = "expense" | "income";

/**
 * Размеры переключателя — по ступеням высоты дизайн-системы.
 *
 * `sm` — компактная ступень, 34 px: шапка карточки и правый слот шапки
 * раздела, рядом с выбором месяца и сегментами `sm`. Прежде он был 28 px и
 * рядом с ними стоял заметно ниже. `md` — крупная ступень, 42 px, ровно как
 * `Segmented` обычного размера: в «Топе» оба переключателя стоят в одной
 * строке.
 */
const SIZES = {
  sm: { track: "p-1 text-[12.5px] leading-4", button: "w-[76px] h-6", pill: "top-1 bottom-1 left-1 w-[76px]", shift: 76 },
  md: { track: "p-1 text-[13.5px] leading-5", button: "w-[96px] h-8", pill: "top-1 bottom-1 left-1 w-[96px]", shift: 96 },
} as const;

/**
 * Segmented pill slider for «Расходы» ⇄ «Доходы», styled like the theme
 * switcher: a neutral thumb slides under the active side, whose label takes the
 * kind's colour (red for expense, green for income). Replaces the old top-right
 * pill toggle AND the static kind badge in the Categories header.
 */
export function KindSwitcher({
  kind,
  onChange,
  size = "sm",
}: {
  kind: Kind;
  onChange: (k: Kind) => void;
  size?: keyof typeof SIZES;
}) {
  const isIncome = kind === "income";
  const dim = SIZES[size];
  return (
    <div
      className={`relative inline-flex items-center rounded-full bg-panel2 border border-border font-medium select-none shrink-0 ${dim.track}`}
    >
      <span
        aria-hidden
        className={`absolute rounded-full bg-bg shadow border border-border transition-transform duration-200 ease-out ${dim.pill}`}
        style={{ transform: isIncome ? `translateX(${dim.shift}px)` : "translateX(0)" }}
      />
      <button
        type="button"
        onClick={() => onChange("expense")}
        aria-pressed={!isIncome}
        className={`relative z-10 rounded-full transition-colors ${dim.button} ${
          !isIncome ? "text-expense" : "text-muted hover:text-text"
        }`}
      >
        Расходы
      </button>
      <button
        type="button"
        onClick={() => onChange("income")}
        aria-pressed={isIncome}
        className={`relative z-10 rounded-full transition-colors ${dim.button} ${
          isIncome ? "text-income" : "text-muted hover:text-text"
        }`}
      >
        Доходы
      </button>
    </div>
  );
}
