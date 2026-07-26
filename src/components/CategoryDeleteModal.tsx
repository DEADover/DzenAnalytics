// «Удалить категорию» — the destructive half of the categories directory.
// Deleting a category in Дзен-мани would leave its operations without one, so
// the dialog makes that an explicit choice: move them to another category, or
// knowingly leave them uncategorised.
//
// Deleting a ROOT cascades to its subcategories — Zenmoney would otherwise be
// left with orphans pointing at a parent that no longer exists, and the push
// builder refuses that batch outright.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import clsx from "clsx";
import type { CategoryTag } from "../store/useZenmoneyStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";

/** A category offered as the new home for the deleted one's operations. */
export interface ReplacementOption {
  id: string;
  title: string;
  /** Parent's title for a subcategory — shown as «Родитель / Подкатегория». */
  parentTitle?: string;
}

interface Props {
  /** The category being deleted. */
  target: CategoryTag;
  /** Its subcategories — deleted along with it. */
  subcategories: CategoryTag[];
  /** Where the operations may go. Must already exclude the doomed rows. */
  options: ReplacementOption[];
  /** Operations attached to the whole group (target + its subcategories). */
  affected: number;
  onClose: () => void;
}

export function CategoryDeleteModal({
  target,
  subcategories,
  options,
  affected,
  onClose,
}: Props) {
  const [replacement, setReplacement] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    const store = useTagDeletionsStore.getState();
    // Subcategories first, then the parent — order is irrelevant to the push
    // builder (it validates the whole batch), but it keeps the queue readable.
    for (const c of subcategories) await store.remove(c.id, replacement);
    await store.remove(target.id, replacement);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-del-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border rounded-t-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-expense/10 text-expense shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div id="cat-del-title" className="font-semibold truncate">
                Удалить категорию?
              </div>
              <div className="text-xs text-muted truncate">{target.title}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {subcategories.length > 0 && (
            <p className="text-sm text-warn">
              Вместе с ней удалятся{" "}
              <strong>
                {formatNum(subcategories.length)}{" "}
                {pluralRu(subcategories.length, [
                  "подкатегория",
                  "подкатегории",
                  "подкатегорий",
                ])}
              </strong>{" "}
              — в Дзен-мани подкатегория не может остаться без родителя.
            </p>
          )}

          <div>
            <label className="label block mb-1">
              {affected > 0 ? (
                <>
                  Куда перенести {formatNum(affected)}{" "}
                  {pluralRu(affected, ["операцию", "операции", "операций"])}
                </>
              ) : (
                "Куда переносить операции"
              )}
            </label>
            <ReplacementSelect
              value={replacement}
              options={options}
              onChange={setReplacement}
            />
            {affected === 0 && (
              <p className="text-xs text-muted mt-1">
                Операций в этой категории нет — переносить нечего.
              </p>
            )}
            {affected > 0 && replacement === null && (
              <p className="text-xs text-warn mt-1">
                Операции останутся без категории.
              </p>
            )}
          </div>

          <p className="text-xs text-muted">
            Удаление копится локально и уйдёт в Дзен-мани при отправке в облако —
            до этого момента его можно отменить.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy}
            className="btn-danger text-sm"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Category picker in the app's style, with «— без категории —» as the default.
 *  Subcategories are shown qualified by their parent so same-named ones
 *  («Прочее» under two different roots) stay distinguishable. */
function ReplacementSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: ReplacementOption[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = useMemo(
    () => (value ? options.find((o) => o.id === value) ?? null : null),
    [value, options]
  );

  const label = (o: ReplacementOption) =>
    o.parentTitle ? `${o.parentTitle} / ${o.title}` : o.title;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          {current && (
            <CategoryDot
              category={current.title}
              parent={current.parentTitle}
              size="w-5 h-5"
            />
          )}
          <span className={clsx("truncate text-sm", !current && "text-muted")}>
            {current ? label(current) : "— без категории —"}
          </span>
        </span>
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 border border-border rounded-lg bg-panel p-1 shadow-xl max-h-56 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={clsx(
              "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
              value === null ? "bg-accent/10 text-accent" : "text-muted hover:bg-panel2"
            )}
          >
            <span className="truncate">— без категории —</span>
            {value === null && <Check className="w-3.5 h-3.5 shrink-0" />}
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={clsx(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
                value === o.id ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <CategoryDot
                  category={o.title}
                  parent={o.parentTitle}
                  size="w-5 h-5"
                />
                <span className="truncate">{label(o)}</span>
              </span>
              {value === o.id && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
