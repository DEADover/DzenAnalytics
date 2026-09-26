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
  disabled,
}: {
  value: number;
  onCommit: (next: number) => void;
  ariaLabel: string;
  disabled?: boolean;
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

  return (
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
      className="input !w-32 !py-1 h-[34px] text-sm text-right tabular-nums"
    />
  );
}
