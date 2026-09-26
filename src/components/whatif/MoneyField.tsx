import { useRef, useState } from "react";
import { formatNum } from "../../lib/format";
import { parseAmountInput } from "../../lib/splitTransaction";
import { ExprAmountInput } from "../ExprAmountInput";

/**
 * Сумма, которую можно вписать рядом с бегунком.
 *
 * Бегунок хорош, чтобы прикинуть «+10%», но «доход станет 700 000» им не
 * выставить — приходится ловить процент мышкой. Здесь сумма вписывается
 * сама (можно выражением: «650000+50000»), а бегунок встаёт на нужное место.
 *
 * Пока поле не в фокусе, в нём итог сценария с разрядами; правка применяется
 * по Enter или при уходе из поля, Escape — отменяет.
 */
export function MoneyField({
  value,
  onCommit,
  ariaLabel,
  suffix,
  disabled,
  wide,
}: {
  value: number;
  onCommit: (next: number) => void;
  ariaLabel: string;
  /** Знак валюты внутри поля, справа. */
  suffix: string;
  disabled?: boolean;
  /** Во всю ширину — отдельным полем формы, а не рядом с бегунком. */
  wide?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  /** Escape: уход из поля ничего не применяет. */
  const cancelled = useRef(false);
  const shown = draft ?? formatNum(Math.round(value));

  function commit(raw: string | null) {
    if (cancelled.current) cancelled.current = false;
    else if (raw !== null) {
      const n = parseAmountInput(raw);
      if (Number.isFinite(n)) onCommit(n);
    }
    setDraft(null);
  }

  // Пока набирается выражение, справа в поле его итог («= 450 000») — знак
  // валюты на это время уступает ему место.
  const typingExpr = draft !== null && /[+\-*/()]/.test(draft.replace(/^\s*[+-]/, ""));

  return (
    <div className={wide ? "relative w-full" : "relative w-36 shrink-0"}>
      <ExprAmountInput
        aria-label={ariaLabel}
        disabled={disabled}
        value={shown}
        onChange={setDraft}
        onFocus={(e) => {
          // Текст при фокусе НЕ меняем: смена значения сбрасывает выделение, а
          // отложенное выделение срабатывало посреди набора и склеивало цифры.
          // Разряды разбору не мешают — пробелы он пропускает.
          setDraft(shown);
          e.target.select();
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`input text-sm tabular-nums ${wide ? "" : "!py-1 h-[34px] text-right"} ${typingExpr ? "" : "!pr-7"}`}
      />
      {!typingExpr && (
        <span className="absolute right-3 inset-y-0 grid place-items-center text-sm text-muted pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}
