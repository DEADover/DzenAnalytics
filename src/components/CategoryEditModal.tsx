import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowDown, ArrowUp, ChevronDown, Check } from "lucide-react";
import clsx from "clsx";
import type { CategoryTag } from "../store/useZenmoneyStore";
import { useTagEditsStore, type TagEdit } from "../store/useTagEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useNewCategoriesStore, type NewCategory } from "../store/useNewCategoriesStore";
import {
  hexToColorInt,
  colorIntToHex,
  fallbackColorForName,
} from "../lib/categoryColor";
import { zenIconToLucide, FALLBACK_CATEGORY_ICON } from "../lib/zenIconLucide";
import { IconPicker } from "./IconPicker";
import { ColorPicker } from "./ColorPicker";
import { CategoryDot } from "./CategoryDot";

interface Props {
  /** Root categories eligible as a parent. */
  roots: CategoryTag[];
  onClose: () => void;
  // ── Edit an existing (cached) category ──
  /** The tag being edited, straight from the Zenmoney cache. */
  tag?: CategoryTag;
  /** Its current pending overlay (may already hold edits). */
  pending?: TagEdit;
  /** True when the tag has sub-categories → it can't itself become a sub. */
  hasChildren?: boolean;
  // ── Create a new category / edit an unpushed new one ──
  /** Fresh create. */
  create?: boolean;
  /** An unpushed new category being edited. */
  draft?: NewCategory;
  /** Preset parent id for a new sub-category («+ подкатегория»). */
  initialParent?: string | null;
}

/** «Обязательная» if `required` is not explicitly `false` (null/true → true). */
const isObligatory = (r: boolean | null) => r !== false;

/**
 * Category editor — rename, icon, colour, type (расходная/доходная),
 * обязательность and hierarchy in one compact card. Handles three modes:
 * editing a cached tag (→ tag-edit overlay), creating a new category/sub, and
 * editing an unpushed new one (→ new-categories store). All paths push to
 * Zenmoney via the normal Push flow; an optimistic `categoryMeta` write keeps
 * dots/charts in sync. Portaled to <body>.
 */
export function CategoryEditModal({
  roots,
  onClose,
  tag,
  pending,
  hasChildren: hasChildrenProp,
  create,
  draft,
  initialParent,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isNew = create || !!draft; // works against the new-categories store
  const hasChildren = !isNew && !!hasChildrenProp;

  // Effective seed values by mode: cached tag (+ overlay), existing new draft,
  // or fresh-create defaults (расходная, обязательная).
  const eff = tag
    ? {
        title: pending?.title ?? tag.title,
        parent: pending?.parent !== undefined ? pending.parent : tag.parent,
        showIncome: pending?.showIncome ?? tag.showIncome,
        showOutcome: pending?.showOutcome ?? tag.showOutcome,
        icon: pending?.icon !== undefined ? pending.icon : tag.icon,
        color: pending?.color !== undefined ? pending.color : tag.color,
        required: pending?.required !== undefined ? pending.required : tag.required,
      }
    : draft
      ? { ...draft }
      : {
          title: "",
          parent: initialParent ?? null,
          showIncome: false,
          showOutcome: true,
          icon: null as string | null,
          color: null as number | null,
          required: null as boolean | null,
        };

  const [title, setTitle] = useState(eff.title);
  const [parent, setParent] = useState<string | null>(eff.parent);
  const [showIncome, setShowIncome] = useState(eff.showIncome);
  const [showOutcome, setShowOutcome] = useState(eff.showOutcome);
  const [icon, setIcon] = useState<string | null>(eff.icon);
  const [colorHex, setColorHex] = useState<string | null>(colorIntToHex(eff.color));
  const [obligatory, setObligatory] = useState(isObligatory(eff.required ?? null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  const selfId = tag?.id ?? draft?.id;
  const parentOptions = useMemo(
    () =>
      roots
        .filter((r) => r.id !== selfId)
        .sort((a, b) => a.title.localeCompare(b.title, "ru")),
    [roots, selfId]
  );

  const previewColor = colorHex || fallbackColorForName(title || "?");
  const PreviewGlyph = zenIconToLucide(icon) || FALLBACK_CATEGORY_ICON;

  const nameValid = title.trim().length > 0;
  const typeValid = showIncome || showOutcome;
  const canSave = nameValid && typeValid;

  const kindLabel = isNew
    ? parent
      ? "Новая подкатегория"
      : "Новая категория"
    : tag?.parent
      ? "Подкатегория"
      : hasChildren
        ? "Категория с подкатегориями"
        : "Категория";
  const saveLabel = isNew && !draft ? "Создать" : "Сохранить";

  /** Optimistic categoryMeta write so dots/charts reflect the choice instantly.
   *  `metaTitle`/`parentTitle` identify the meta key. */
  async function patchMetaFor(metaTitle: string, parentTitle: string | undefined) {
    const metaKey = parentTitle ? `${parentTitle} / ${metaTitle}` : metaTitle;
    await useCategoryMetaStore.getState().patchMeta(metaKey, {
      color: colorHex,
      icon,
      showIncome,
      showOutcome,
      required: obligatory ? true : false,
    });
  }

  async function save() {
    if (!canSave) return;
    const newColor = colorHex ? hexToColorInt(colorHex) : null;
    const parentTitle = parent ? roots.find((r) => r.id === parent)?.title : undefined;

    if (isNew) {
      // Create / edit an unpushed new category (new-categories store).
      const cat: NewCategory = {
        id: draft?.id ?? crypto.randomUUID(),
        title: title.trim(),
        parent: parent ?? null,
        showIncome,
        showOutcome,
        icon,
        color: newColor,
        // null = «обязательная» (Zenmoney default); only «необязательная» is explicit.
        required: obligatory ? null : false,
      };
      const store = useNewCategoriesStore.getState();
      if (draft) await store.update(cat.id, cat);
      else await store.add(cat);
      await patchMetaFor(cat.title, parentTitle);
      onClose();
      return;
    }

    // Edit an existing cached tag (tag-edit overlay).
    const t = tag!;
    // Obligation is a 2-state; store an explicit true/false only when it crosses
    // the cached bucket, otherwise clear it (no-op push, and null stays null).
    const cacheObl = isObligatory(t.required ?? null);
    const requiredPatch: boolean | null | undefined =
      obligatory === cacheObl ? undefined : obligatory ? true : false;

    const patch: TagEdit = {
      title: title.trim() !== t.title ? title.trim() : undefined,
      parent: (parent ?? null) !== (t.parent ?? null) ? (parent ?? null) : undefined,
      showIncome: showIncome !== t.showIncome ? showIncome : undefined,
      showOutcome: showOutcome !== t.showOutcome ? showOutcome : undefined,
      icon: (icon ?? null) !== (t.icon ?? null) ? (icon ?? null) : undefined,
      color: (newColor ?? null) !== (t.color ?? null) ? newColor : undefined,
      required: requiredPatch,
    };
    await useTagEditsStore.getState().patch(t.id, patch);

    // Optimistic meta uses the CACHE identity (a rename remaps on the next sync).
    const cacheParentTitle = t.parent
      ? roots.find((r) => r.id === t.parent)?.title
      : undefined;
    if (t.parent ? !!cacheParentTitle : true) {
      await patchMetaFor(t.title, cacheParentTitle);
    }
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-edit-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        {/* Live-preview header — a big dot with the chosen glyph + name. */}
        <div className="flex items-center gap-3 px-5 py-4 bg-panel2/50 border-b border-border rounded-t-2xl">
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{ background: previewColor }}
          >
            <PreviewGlyph className="w-5 h-5 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted" id="cat-edit-title">
              {kindLabel}
            </div>
            <div className="font-semibold truncate">{title || "Без названия"}</div>
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

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="cat-name" className="label block mb-1">
              Название
            </label>
            <input
              id="cat-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input w-full text-sm"
              placeholder="Название категории"
              autoComplete="off"
            />
          </div>

          {/* Icon + colour on one row, tops aligned (both controls 40px). */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <label className="label block mb-1 h-4">Иконка</label>
              <IconPicker value={icon} color={previewColor} onChange={setIcon} />
            </div>
            <div className="relative">
              <label className="label block mb-1 h-4">Цвет</label>
              <ColorPicker value={colorHex} onChange={setColorHex} />
            </div>
          </div>

          {/* Type — two independent pills (a tag can be both). */}
          <div>
            <div className="label mb-1">Тип</div>
            <div className="flex gap-2">
              <TypePill
                label="Расходная"
                icon={<ArrowDown className="w-3.5 h-3.5" />}
                on={showOutcome}
                onToggle={() => setShowOutcome((v) => !v)}
              />
              <TypePill
                label="Доходная"
                icon={<ArrowUp className="w-3.5 h-3.5" />}
                on={showIncome}
                onToggle={() => setShowIncome((v) => !v)}
              />
            </div>
            {!typeValid && (
              <p className="text-xs text-warn mt-1">Выберите хотя бы один тип.</p>
            )}
          </div>

          {/* Obligation — 2-state segmented. */}
          <div>
            <div className="label mb-1">Обязательность</div>
            <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm w-full">
              <button
                type="button"
                onClick={() => setObligatory(true)}
                aria-pressed={obligatory}
                className={clsx(
                  "flex-1 px-3 py-1.5",
                  obligatory ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
                )}
              >
                Обязательная
              </button>
              <button
                type="button"
                onClick={() => setObligatory(false)}
                aria-pressed={!obligatory}
                className={clsx(
                  "flex-1 px-3 py-1.5 border-l border-border",
                  !obligatory ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
                )}
              >
                Необязательная
              </button>
            </div>
          </div>

          {/* Hierarchy */}
          <div>
            <div className="label mb-1">Родительская категория</div>
            {hasChildren ? (
              <p className="text-xs text-muted">
                У категории есть подкатегории — она может быть только верхнего уровня.
              </p>
            ) : (
              <ParentSelect value={parent} options={parentOptions} onChange={setParent} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          {draft && (
            <button
              type="button"
              onClick={async () => {
                await useNewCategoriesStore.getState().remove(draft.id);
                onClose();
              }}
              className="btn-ghost text-sm text-expense mr-auto"
            >
              Удалить
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="btn-primary text-sm"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TypePill({
  label,
  icon,
  on,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={clsx(
        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
        on
          ? "border-accent bg-accent/10 text-text"
          : "border-border text-muted hover:text-text hover:bg-panel2/60"
      )}
    >
      <span className={on ? "text-accent" : ""}>{icon}</span>
      {label}
    </button>
  );
}

/** Parent-category dropdown in the app's own style (matches the icon/colour
 *  pickers): a `.input` trigger with the current parent's dot + name, opening a
 *  popover list of root categories (+ a «верхний уровень» option). */
function ParentSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: CategoryTag[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentTitle = value ? options.find((o) => o.id === value)?.title ?? null : null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          {currentTitle && <CategoryDot category={currentTitle} size="w-5 h-5" />}
          <span className={clsx("truncate text-sm", !currentTitle && "text-muted")}>
            {currentTitle ?? "— нет (верхний уровень) —"}
          </span>
        </span>
        <ChevronDown
          className={clsx("w-4 h-4 text-muted shrink-0 transition-transform", open && "rotate-180")}
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
            <span className="truncate">— нет (верхний уровень) —</span>
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
                <CategoryDot category={o.title} size="w-5 h-5" />
                <span className="truncate">{o.title}</span>
              </span>
              {value === o.id && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
