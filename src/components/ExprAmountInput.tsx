import type { InputHTMLAttributes } from "react";
import { evalAmount } from "../lib/splitTransaction";

/** Есть ли в строке действие — отличает «1200+300» от просто «1200». */
const hasOperator = (s: string) => /[+\-*/()]/.test(s.replace(/^\s*[+-]/, ""));

/**
 * Поле суммы, которое считает: четыре действия и скобки, как в разделении
 * операции. Пока набирается выражение, справа в поле виден результат
 * («= 1 500»); на уходе из поля и по Enter выражение заменяется числом —
 * в поле остаётся то, что уйдёт в операцию.
 *
 * Подсказка — внутри поля, а не строкой под ним: поле стоит в одном ряду с
 * валютой, и лишняя строка под ним сдвинула бы ряд.
 */
export function ExprAmountInput({
  value,
  onChange,
  className = "",
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const isExpr = hasOperator(value);
  const result = isExpr ? evalAmount(value) : null;
  const preview = result !== null && result >= 0 ? result : null;

  const previewText =
    preview !== null ? `= ${preview.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}` : "";

  const commit = () => {
    if (preview !== null) onChange(String(preview));
  };

  return (
    <div className="relative">
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          commit();
          rest.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          // Enter сначала считает: сохраняют уже число, а не формулу.
          if (e.key === "Enter" && preview !== null) commit();
          rest.onKeyDown?.(e);
        }}
        inputMode="decimal"
        className={className}
        // Отступ справа — по длине результата, а не с запасом на миллионы:
        // иначе в узком поле под само выражение оставалось полполя.
        style={previewText ? { paddingRight: `calc(${previewText.length}ch + 1rem)` } : undefined}
      />
      {previewText && (
        <span className="absolute right-3 inset-y-0 grid place-items-center text-sm text-muted tabular-nums pointer-events-none">
          {previewText}
        </span>
      )}
    </div>
  );
}
