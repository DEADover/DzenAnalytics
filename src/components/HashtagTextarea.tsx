import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HashtagMenu } from "./HashtagMenu";
import { hashFragment, insertHashtag, matchHashtags } from "../lib/hashtagInput";
import { acceptSuggestion, type SuggestContext } from "../lib/commentSuggest";
import { useCommentSuggest } from "../hooks/useCommentSuggest";

/**
 * A <textarea> with inline hashtag autocomplete. Typing «#» opens a menu of
 * the supplied `tags`, filtered live by the text after «#». Pick with click,
 * Enter/Tab, or ↑/↓ + Enter; Esc closes it.
 *
 * The menu renders in a portal with `position: fixed`, so it floats above
 * everything (high z-index), never reflows the surrounding form, and flips
 * above the field when there isn't room below.
 *
 * Вне «#» поле подсказывает продолжение по прежним комментариям — серым
 * хвостом после курсора (`lib/commentSuggest`). Tab принимает, Esc прячет,
 * дальнейший набор просто идёт поверх. Хвост рисует слой-двойник под полем с
 * теми же отступами и шрифтом: текст в нём прозрачный, виден только хвост.
 */
interface Props {
  value: string;
  onChange: (next: string) => void;
  tags: string[];
  className?: string;
  rows?: number;
  placeholder?: string;
  /** Получатель и категория операции — подсказка учитывает, что пишут у них. */
  suggestContext?: SuggestContext;
  /** Классы обёртки — для раскладки родителя (например, `flex-1`). */
  boxClassName?: string;
}

export function HashtagTextarea({
  value,
  onChange,
  tags,
  className,
  rows = 1,
  placeholder,
  suggestContext,
  boxClassName,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const suggest = useCommentSuggest(suggestContext);
  const [focused, setFocused] = useState(false);
  /** Курсор в конце текста — подсказываем только там. */
  const [atEnd, setAtEnd] = useState(true);
  /** Текст, на котором подсказку спрятали Esc, — до следующей правки. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(0);
  const [index, setIndex] = useState(0);

  const suggestions = useMemo(() => (open ? matchHashtags(tags, query) : []), [open, query, tags]);
  const closeMenu = useCallback(() => setOpen(false), []);

  const ghost = useMemo(
    () => (focused && atEnd && !open && dismissed !== value ? suggest(value) : null),
    [focused, atEnd, open, dismissed, value, suggest]
  );

  // Слой-двойник повторяет у поля всё, что влияет на перенос строк: отступы,
  // рамку, шрифт. Классы поля приходят снаружи, поэтому берём вычисленное.
  const [ghostStyle, setGhostStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!ghost || !el) return;
    const cs = getComputedStyle(el);
    setGhostStyle({
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      borderTopWidth: cs.borderTopWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderLeftWidth: cs.borderLeftWidth,
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      textIndent: cs.textIndent,
    });
    if (ghostRef.current) ghostRef.current.scrollTop = el.scrollTop;
  }, [ghost]);

  function caretAt(el: HTMLTextAreaElement) {
    setAtEnd(el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
  }

  /** Recompute the active «#fragment» under the caret and open/close the menu. */
  function sync(next: string, caret: number) {
    const frag = hashFragment(next, caret);
    if (frag) {
      setStart(frag.start);
      if (frag.query !== query) setIndex(0); // keep highlight stable on arrow nav
      setQuery(frag.query);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  /** Replace the active «#fragment» with the chosen tag, re-place the caret. */
  function pick(tag: string) {
    const { next, caret } = insertHashtag(value, { start, query }, tag);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

  return (
    <div className={`relative flex flex-col ${boxClassName ?? ""}`}>
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          caretAt(e.target);
          sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => {
          caretAt(e.currentTarget);
          sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
        }}
        onKeyUp={(e) => {
          caretAt(e.currentTarget);
          // Отпущенный Esc не должен снова открыть только что закрытый список.
          if (e.key !== "Escape") sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
        }}
        onSelect={(e) => caretAt(e.currentTarget)}
        onScroll={(e) => {
          if (ghostRef.current) ghostRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onFocus={(e) => {
          setFocused(true);
          caretAt(e.currentTarget);
        }}
        onKeyDown={(e) => {
          // Подсказка комментария: Tab принимает, Esc прячет. Без подсказки
          // Tab, как обычно, ведёт к следующему полю.
          if (ghost && (!open || suggestions.length === 0)) {
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const next = acceptSuggestion(value, ghost);
              onChange(next);
              requestAnimationFrame(() => ref.current?.setSelectionRange(next.length, next.length));
              return;
            }
            if (e.key === "Escape") {
              // Не даём Esc закрыть окно: человек прятал подсказку, а не форму.
              e.preventDefault();
              e.stopPropagation();
              setDismissed(value);
              return;
            }
          }
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(suggestions[index]);
          } else if (e.key === "Escape") {
            // Закрываем список, а не окно вокруг поля.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => {
          setOpen(false);
          setFocused(false);
        }}
      />
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden
          data-comment-ghost
          className="absolute inset-0 overflow-hidden pointer-events-none whitespace-pre-wrap break-words border-solid border-transparent"
          style={ghostStyle}
        >
          <span className="text-transparent">{value}</span>
          <span className="text-muted">{ghost.ghost}</span>
        </div>
      )}
      {open && suggestions.length > 0 && (
        <HashtagMenu
          anchorRef={ref}
          items={suggestions}
          index={index}
          onPick={pick}
          onDismiss={closeMenu}
        />
      )}
    </div>
  );
}
