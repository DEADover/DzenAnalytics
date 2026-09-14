import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { Combobox } from "./Combobox";
import { HashtagTextarea } from "./HashtagTextarea";
import { pluralOps } from "../lib/plural";
import { extractHashtags } from "../lib/aggregations";
import { useCategoryDictionary } from "../hooks/useCategoryDictionary";
import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";
import { Segmented } from "./Segmented";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";

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

  // Categories come from the dictionary as well as the dataset, so a category
  // created in Справочники can be used before it has a single operation.
  const dict = useCategoryDictionary();

  const { categoryOptions, subcatByCategory, payeeOptions, tagOptions } = useMemo(() => {
    const cats = new Set<string>(dict.roots);
    const subByCat = new Map<string, Set<string>>();
    for (const [root, subs] of dict.subsByRoot) {
      subByCat.set(root, new Set(subs));
    }
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
  }, [allTransactions, dict]);

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

  return (
    <Modal onClose={onClose} width="lg">
      <ModalHeader
        icon={Layers}
        title="Массовое изменение"
        subtitle={`Выбрано ${count} ${pluralOps(count)}`}
      />

      <ModalBody>
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
            <Segmented
              size="sm"
              label="Как изменить комментарий"
              value={commentMode}
              onChange={setCommentMode}
              options={[
                { value: "replace", label: "Заменить" },
                { value: "append", label: "Дополнить" },
              ]}
            />
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
      </ModalBody>

      <ModalFooter>
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
      </ModalFooter>
    </Modal>
  );
}
