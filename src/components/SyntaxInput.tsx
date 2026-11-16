import { useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import clsx from "clsx";
import { awaitsCommentValue, completeCommentPrefix, queryPieces } from "../lib/textQuery";

/**
 * Поле текстового поиска, которое понимает условия (#135): подсвечивает
 * «комм:» и минус перед словом, а на набранное «комм» предлагает условие по
 * комментарию — Tab подставляет «комм:».
 *
 * В самом `<input>` раскрасить часть текста нельзя, поэтому поверх поля лежит
 * слой с тем же текстом по кускам, а текст поля на это время прозрачен (каретка
 * и выделение остаются). Слой включается, только когда в запросе есть что
 * подсветить или предложить, — обычный поиск идёт через обычное поле.
 *
 * Родитель должен быть `relative`, а поле — занимать его целиком.
 */
export function SyntaxInput({
  value,
  onChange,
  className,
  onKeyDown,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [box, setBox] = useState<CSSProperties | null>(null);

  const pieces = queryPieces(value);
  const completion = focused ? completeCommentPrefix(value) : null;
  const awaits = focused && awaitsCommentValue(value);
  const overlay = completion !== null || awaits || pieces.some((p) => p.op);

  // Слой повторяет отступы и шрифт поля — иначе буквы разъедутся.
  useLayoutEffect(() => {
    if (!overlay || !input.current) return;
    const cs = getComputedStyle(input.current);
    setBox({
      paddingLeft: `calc(${cs.paddingLeft} + ${cs.borderLeftWidth})`,
      paddingRight: `calc(${cs.paddingRight} + ${cs.borderRightWidth})`,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
    });
  }, [overlay]);

  /** Длинный запрос поле прокручивает само — слой едет следом. */
  const follow = () => {
    if (layer.current && input.current) layer.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(follow);

  return (
    <>
      <input
        {...rest}
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        onScroll={follow}
        onSelect={follow}
        onKeyUp={follow}
        onKeyDown={(e) => {
          // Tab дописывает условие, только когда каретка в конце запроса:
          // иначе это обычный переход к следующему полю.
          if (
            e.key === "Tab" &&
            !e.shiftKey &&
            completion !== null &&
            e.currentTarget.selectionStart === value.length
          ) {
            e.preventDefault();
            onChange(completion);
            return;
          }
          onKeyDown?.(e);
        }}
        className={clsx(className, overlay && box && "!text-transparent caret-text")}
      />
      {overlay && box && (
        <div
          ref={layer}
          aria-hidden="true"
          data-syntax-layer
          className="absolute inset-0 flex items-center overflow-hidden whitespace-pre pointer-events-none text-text"
          style={box}
        >
          {pieces.map((p, i) =>
            p.op ? (
              <span key={i} className="text-accent bg-accent/10 rounded-[3px]" data-syntax-op>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            )
          )}
          {completion !== null && (
            <span className="text-muted" data-syntax-suggest>
              <span className="ml-2 inline-flex items-center gap-1.5 text-[11px]">
                <kbd className="kbd">Tab</kbd>
                Искать в комментарии
              </span>
            </span>
          )}
          {awaits && (
            <span className="text-muted/70" data-syntax-values>
              слово, -слово, пусто или есть
            </span>
          )}
        </div>
      )}
    </>
  );
}
