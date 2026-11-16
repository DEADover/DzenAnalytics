import { useLayoutEffect, useRef, useState } from "react";
import { maskTime, parseTypedTime, shiftTime } from "../lib/timeInput";

/**
 * Поле времени — всегда 24 часа, «ЧЧ:ММ».
 *
 * Родное `<input type="time">` браузер рисует по языку системы, и на
 * английской в нём «AM/PM» (#137). Здесь поле текстовое, по маске: цифры,
 * двоеточие встаёт само. Стрелки вверх и вниз меняют часы или минуты — смотря
 * где курсор.
 *
 * Замена родному полю один в один: `value` — «ЧЧ:ММ», `onChange` получает
 * `{ target: { value } }`.
 */
export function TimeField({
  value = "",
  onChange,
  className = "",
  "aria-label": ariaLabel = "Время",
}: {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  "aria-label"?: string;
}) {
  /** Набираемый текст; `null` — не редактируется, в поле видно само время. */
  const [typed, setTyped] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Куда поставить курсор после того, как маска переписала текст. */
  const caretRef = useRef<number | null>(null);
  /** Поле только что получило фокус кликом — выделение не сбрасывать. */
  const focusClickRef = useRef(false);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && caretRef.current !== null) {
      el.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [typed]);

  const emit = (v: string) => {
    if (v !== value) onChange?.({ target: { value: v } });
  };
  const text = typed ?? value;

  return (
    <input
      ref={inputRef}
      value={text}
      placeholder="чч:мм"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      aria-label={ariaLabel}
      className={`${className} tabular-nums`}
      onMouseDown={(e) => {
        focusClickRef.current = document.activeElement !== e.currentTarget;
      }}
      onFocus={(e) => {
        setTyped(value);
        e.target.select();
      }}
      // Первый клик оставляет время выделенным: набранное заменяет его
      // целиком, а не встаёт в середину старого.
      onMouseUp={(e) => {
        if (focusClickRef.current) {
          e.preventDefault();
          focusClickRef.current = false;
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        const masked = maskTime(raw, raw.length < text.length);
        // Правят в середине и маска ничего не переписала — курсор на месте;
        // иначе — в конец, за дописанное двоеточие.
        caretRef.current = masked === raw ? caret : masked.length;
        setTyped(masked);
        if (/^\d{2}:\d{2}$/.test(masked)) emit(masked);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const el = e.currentTarget;
        const caret = el.selectionStart ?? 0;
        const hours = caret <= 2;
        const step = (e.key === "ArrowUp" ? 1 : -1) * (hours ? 60 : 1);
        const next = shiftTime(text, step);
        caretRef.current = hours ? 2 : 5;
        setTyped(next);
        emit(next);
      }}
      onBlur={() => {
        const parsed = typed === null ? null : parseTypedTime(typed);
        if (parsed) emit(parsed);
        setTyped(null);
      }}
    />
  );
}
