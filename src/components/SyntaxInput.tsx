import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import clsx from "clsx";
import { awaitsValue, completePrefix, completeValue, queryPieces } from "../lib/textQuery";
import { queryHashtags, queryValueLists } from "../lib/queryValueLists";
import { hashFragment, insertHashtag, matchHashtags, type HashFragment } from "../lib/hashtagInput";
import { HashtagMenu } from "./HashtagMenu";

/**
 * Поле текстового поиска, которое понимает условия (#135): подсвечивает
 * «комм:» и минус перед словом, на набранное «комм» предлагает условие по
 * комментарию — Tab подставляет «комм:», — а после «счёт:» и «кат:» дописывает
 * название счёта или категории. На «#» открывает список хэштегов из
 * комментариев — тот же, что в окне операции.
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

  // Набираемый «#тег». Считается от каретки, поэтому хранится отдельно от текста.
  const [fragment, setFragment] = useState<HashFragment | null>(null);
  const [hashIndex, setHashIndex] = useState(0);
  const hashtags = useMemo(
    () => (focused && fragment ? matchHashtags(queryHashtags(), fragment.query) : []),
    [focused, fragment]
  );
  const menuOpen = hashtags.length > 0;
  const closeMenu = useCallback(() => setFragment(null), []);
  const syncFragment = (text: string, caret: number) => {
    const next = hashFragment(text, caret);
    if (next?.query !== fragment?.query) setHashIndex(0);
    setFragment(next);
  };
  const pickHashtag = (tag: string) => {
    if (!fragment) return;
    const { next, caret } = insertHashtag(value, fragment, tag);
    onChange(next);
    setFragment(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const pieces = queryPieces(value);
  // Сначала — условие («сумм» → «сумма:»), а после двоеточия — название счёта
  // или категории целиком. Списки названий нужны только в этот момент.
  const completion = focused ? (completePrefix(value) ?? completeValue(value, queryValueLists())) : null;
  const awaits = focused ? awaitsValue(value) : null;
  const overlay = completion !== null || awaits !== null || pieces.some((p) => p.op);

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
        onChange={(e) => {
          onChange(e.target.value);
          syncFragment(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => syncFragment(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          setFragment(null);
          rest.onBlur?.(e);
        }}
        onScroll={follow}
        onSelect={follow}
        onKeyUp={(e) => {
          follow();
          // Каретку двинули стрелками. Esc, Enter и Tab уже всё решили сами:
          // отпущенная клавиша не должна снова открыть закрытый список.
          if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
            syncFragment(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }
        }}
        onKeyDown={(e) => {
          if (menuOpen) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHashIndex((i) => (i + 1) % hashtags.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHashIndex((i) => (i - 1 + hashtags.length) % hashtags.length);
              return;
            }
            if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
              e.preventDefault();
              pickHashtag(hashtags[Math.min(hashIndex, hashtags.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              // Закрываем список, а не шторку или окно вокруг поля.
              e.preventDefault();
              e.stopPropagation();
              setFragment(null);
              return;
            }
          }
          // Tab дописывает условие, только когда каретка в конце запроса:
          // иначе это обычный переход к следующему полю.
          if (
            e.key === "Tab" &&
            !e.shiftKey &&
            completion !== null &&
            e.currentTarget.selectionStart === value.length
          ) {
            e.preventDefault();
            onChange(completion.next);
            return;
          }
          onKeyDown?.(e);
        }}
        className={clsx(className, overlay && box && "!text-transparent caret-text")}
      />
      {menuOpen && (
        <HashtagMenu
          anchorRef={input}
          items={hashtags}
          index={Math.min(hashIndex, hashtags.length - 1)}
          onPick={pickHashtag}
          onDismiss={closeMenu}
        />
      )}
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
                {completion.label}
              </span>
            </span>
          )}
          {awaits !== null && (
            <span className="text-muted/70" data-syntax-values>
              {awaits}
            </span>
          )}
        </div>
      )}
    </>
  );
}
