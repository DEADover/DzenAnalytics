import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { Combobox } from "./Combobox";
import { HashtagTextarea } from "./HashtagTextarea";
import { pluralOps } from "../lib/plural";
import { extractHashtags } from "../lib/aggregations";
import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";

/**
 * Bulk-edit modal. Lets the user change Категория (+подкатегория),
 * Получатель and/or Комментарий for many selected transactions at once.
 *
 * All fields are open inputs. A field is applied only if the user typed
 * something into it; empty fields are left untouched (their placeholder
 * reads "… без изменений"). So the user can change one, two, or all
 * three in one go.
 *
 * The patch mirrors the single-row modal: Получатель maps to `brand`
 * (Zenmoney's curated counterparty), category/subcategory feed the
 * pipeline which derives categoryFull. Portaled to <body> so it isn't
 * affected by ancestor layout (e.g. `space-y` margins).
 */
interface Props {
  count: number;
  allTransactions: Transaction[];
  /** Apply the patch to all selected. `commentAppend`, when set, means the
   *  comment must be *appended* to each row's existing comment (the caller
   *  computes it per-transaction) rather than replaced via `patch.comment`. */
  onApply: (
    patch: TransactionEdit,
    commentAppend?: string
  ) => void | Promise<void>;
  onClose: () => void;
}

export function BulkEditModal({ count, allTransactions, onApply, onClose }: Props) {
  // No enable-checkboxes: a field is "to be changed" iff the user typed
  // something into it. Empty = leave that field untouched.
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [payee, setPayee] = useState("");
  const [comment, setComment] = useState("");
  // «Заменить» overwrites the comment; «Дополнить» appends to the existing one.
  const [commentMode, setCommentMode] = useState<"replace" | "append">("replace");

  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog on open and return it to whatever was
  // focused before (e.g. the «Изменить» button) on close — keyboard and
  // screen-reader users keep their place.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (prevFocused && document.contains(prevFocused)) prevFocused.focus();
    };
  }, []);

  // Option lists from the current dataset.
  const { categoryOptions, subcatByCategory, payeeOptions, tagOptions } = useMemo(() => {
    const cats = new Set<string>();
    const subByCat = new Map<string, Set<string>>();
    const payees = new Set<string>();
    const tags = new Set<string>();
    for (const t of allTransactions) {
      if (t.category) cats.add(t.category);
      if (t.category && t.subcategory) {
        let bucket = subByCat.get(t.category);
        if (!bucket) {
          bucket = new Set<string>();
          subByCat.set(t.category, bucket);
        }
        bucket.add(t.subcategory);
      }
      const p = (t.brand || t.payee || "").trim();
      if (p) payees.add(p);
      for (const h of extractHashtags(t.comment)) tags.add(h);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, "ru");
    return {
      categoryOptions: Array.from(cats).sort(cmp),
      subcatByCategory: subByCat,
      payeeOptions: Array.from(payees).sort(cmp),
      tagOptions: Array.from(tags).sort(cmp),
    };
  }, [allTransactions]);

  const canApply =
    category.trim() !== "" || payee.trim() !== "" || comment.trim() !== "";

  async function apply() {
    const patch: TransactionEdit = {};
    if (category.trim()) {
      patch.category = category.trim();
      // Subcategory only travels with a category; empty → clear it.
      patch.subcategory = subcategory.trim() || null;
    }
    if (payee.trim()) {
      patch.brand = payee.trim();
    }
    // In «Заменить» the comment rides in the patch. In «Дополнить» it doesn't —
    // it's handed to the caller as `commentAppend` so each row keeps its own
    // existing comment and the new text is added on.
    const append = commentMode === "append" ? comment.trim() : "";
    if (comment.trim() && commentMode === "replace") {
      patch.comment = comment.trim();
    }
    if (Object.keys(patch).length === 0 && !append) return;
    setSaving(true);
    try {
      await onApply(patch, append || undefined);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-title"
        className="w-full max-w-lg rounded-xl border border-border bg-panel shadow-xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div id="bulk-edit-title" className="flex items-center gap-2 font-semibold">
            <Layers className="w-4 h-4 text-accent" />
            Массовое изменение
            <span className="text-muted font-normal text-sm">
              · выбрано {count} {pluralOps(count)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-muted">
            Изменения применятся ко всем выбранным операциям.
          </p>

          {/* Category + subcategory */}
          <div>
            <label className="label block mb-1">Категория</label>
            <div className="grid grid-cols-2 gap-2">
              <Combobox
                value={category}
                options={categoryOptions}
                allowCustom={false}
                onChange={(next) => {
                  setCategory(next);
                  if (
                    subcategory &&
                    !subcatByCategory.get(next)?.has(subcategory)
                  ) {
                    setSubcategory("");
                  }
                }}
                placeholder="Категория без изменений"
                maxHeight="200px"
              />
              <Combobox
                value={subcategory}
                options={Array.from(subcatByCategory.get(category) || []).sort(
                  (a, b) => a.localeCompare(b, "ru")
                )}
                allowCustom={false}
                clearable
                onChange={setSubcategory}
                placeholder="Подкатегория"
                maxHeight="200px"
              />
            </div>
          </div>

          {/* Payee */}
          <div>
            <label className="label block mb-1">Получатель</label>
            <Combobox
              value={payee}
              options={payeeOptions}
              onChange={setPayee}
              placeholder="Получатель без изменений"
              maxHeight="200px"
            />
          </div>

          {/* Comment */}
          <div>
            <div className="flex items-center justify-between mb-1 gap-2">
              <label className="label">Комментарий</label>
              <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setCommentMode("replace")}
                  className={`px-2.5 py-1 ${commentMode === "replace" ? "bg-accent text-accent-fg" : "text-muted hover:text-text"}`}
                >
                  Заменить
                </button>
                <button
                  type="button"
                  onClick={() => setCommentMode("append")}
                  className={`px-2.5 py-1 ${commentMode === "append" ? "bg-accent text-accent-fg" : "text-muted hover:text-text"}`}
                >
                  Дополнить
                </button>
              </div>
            </div>
            <HashtagTextarea
              value={comment}
              onChange={setComment}
              tags={tagOptions}
              rows={2}
              placeholder={
                commentMode === "append"
                  ? "Текст добавится к текущему комментарию"
                  : "Комментарий без изменений"
              }
              className="input text-sm w-full resize-y min-h-[2.5rem]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-panel2/40 rounded-b-xl">
          <button onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            onClick={apply}
            disabled={!canApply || saving}
            className="btn-primary text-sm"
          >
            Применить к выбранным ({count})
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
