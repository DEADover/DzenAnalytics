import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { StickyNote } from "lucide-react";
import { Popover } from "./Popover";
import { Tooltip } from "./Tooltip";
import {
  NOTE_MAX_LENGTH,
  useCounterpartyNote,
  useCounterpartyNotesStore,
} from "../store/useCounterpartyNotesStore";

/**
 * Заметки о контрагентах и должниках (#119): поле в карточке контрагента и
 * кнопка в строках таблиц. Одна заметка на имя — что написано в
 * «Контрагентах», то видно и у долга того же человека.
 */

const PLACEHOLDER = "Дополнительная информация о контрагенте";

/** Пауза в наборе, после которой заметка сохраняется сама. */
const SAVE_DELAY_MS = 600;

/**
 * Поле заметки: сохраняется само — после паузы в наборе и при уходе из поля.
 *
 * Высота постоянная (прокрутка внутри): карточка контрагента не должна
 * менять размер от длины заметки. Компонент ставят с `key={name}` — у
 * другого контрагента своё черновое состояние.
 */
export function CounterpartyNoteField({
  name,
  rows = 2,
  autoFocus,
  className,
}: {
  name: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const note = useCounterpartyNote(name);
  const setNote = useCounterpartyNotesStore((s) => s.setNote);
  const [draft, setDraft] = useState(note?.text ?? "");
  const [focused, setFocused] = useState(false);
  const timer = useRef<number | null>(null);
  /** Последний набранный текст — для сохранения из таймера и при уходе. */
  const latest = useRef(draft);

  // Заметка пришла с другого устройства, пока поле не трогали, — показать её.
  const stored = note?.text ?? "";
  const [seen, setSeen] = useState(stored);
  if (!focused && stored !== seen) {
    setSeen(stored);
    setDraft(stored);
  }

  /** Сохранить набранное, если с прошлого сохранения что-то правили. */
  const flush = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    void setNote(name, latest.current);
  };

  // Ушли со страницы, на другого контрагента или закрыли вкладку посреди
  // набора — дописанное не должно пропасть.
  useEffect(() => {
    const save = () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
      void useCounterpartyNotesStore.getState().setNote(name, latest.current);
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [name]);

  return (
    <textarea
      value={draft}
      rows={rows}
      maxLength={NOTE_MAX_LENGTH}
      placeholder={PLACEHOLDER}
      aria-label={`Заметка: ${name}`}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        latest.current = e.target.value;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
      }}
      onBlur={() => {
        setFocused(false);
        flush();
      }}
      className={clsx("input text-sm w-full resize-none leading-snug py-2", className)}
    />
  );
}

/**
 * Кнопка заметки для строки таблицы: значок закрашен акцентом, когда заметка
 * есть, её текст — в подсказке; щелчок открывает поле в окошке рядом.
 */
export function CounterpartyNoteButton({ name, className }: { name: string; className?: string }) {
  const note = useCounterpartyNote(name);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const label = note ? "Изменить заметку" : "Добавить заметку";
  return (
    <span ref={anchor} className={clsx("inline-flex", className)}>
      <Tooltip
        content={
          open ? null : note ? (
            <span className="block max-w-[18rem] whitespace-pre-line">{note.text}</span>
          ) : (
            label
          )
        }
      >
        <button
          type="button"
          onClick={(e) => {
            // Строка таблицы сама открывает операции — щелчок по заметке не она.
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={clsx("btn-icon", note ? "text-accent" : "text-muted")}
          aria-label={label}
          aria-expanded={open}
          data-note-button={note ? "filled" : "empty"}
        >
          <StickyNote className="w-4 h-4" fill={note ? "currentColor" : "none"} fillOpacity={note ? 0.15 : 0} />
        </button>
      </Tooltip>
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} align="right" className="card p-3 w-80">
        {/* Щелчки внутри окошка не доходят до строки под ним. */}
        <div onClick={(e) => e.stopPropagation()} className="space-y-2">
          <div className="text-xs text-muted truncate">Заметка · {name}</div>
          <CounterpartyNoteField key={name} name={name} rows={5} autoFocus />
          <div className="flex justify-end">
            <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(false)}>
              Готово
            </button>
          </div>
        </div>
      </Popover>
    </span>
  );
}

/**
 * Пометка в строке списка: заметка есть — значок, её текст в подсказке.
 * Без заметки ничего не рисует; правится заметка в карточке.
 */
export function CounterpartyNoteMark({ name }: { name: string }) {
  const note = useCounterpartyNote(name);
  if (!note) return null;
  return (
    <Tooltip content={<span className="block max-w-[18rem] whitespace-pre-line">{note.text}</span>}>
      <span className="shrink-0 inline-flex text-accent" aria-label="Есть заметка" data-note-mark>
        <StickyNote className="w-3.5 h-3.5" />
      </span>
    </Tooltip>
  );
}

/**
 * Имя контрагента со значком заметки — для списков в других разделах (#128):
 * «Регулярные», «Аномалии», «Топ», «Дайджест». Имя обрезается многоточием,
 * значок остаётся виден. `label` — что показать, если оно отличается от
 * имени, по которому ищется заметка (например, «—» у пустого).
 */
export function CounterpartyName({
  name,
  label,
  className,
}: {
  name: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={clsx("flex items-center gap-1 min-w-0 max-w-full", className)}>
      <span className="truncate">{label ?? name}</span>
      {name && <CounterpartyNoteMark name={name} />}
    </span>
  );
}
