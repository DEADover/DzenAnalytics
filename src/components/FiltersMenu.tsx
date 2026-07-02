import { useEffect, useState } from "react";
import {
  Filter,
  ChevronDown,
  Check,
  Pencil,
  Trash2,
  CalendarClock,
  Plus,
  Save,
} from "lucide-react";
import clsx from "clsx";
import { useFiltersStore } from "../store/useFiltersStore";
import {
  useSavedViewsStore,
  matchesView,
  hasWhatFilters,
  type SavedView,
} from "../store/useSavedViewsStore";
import { confirm } from "../store/useConfirmStore";

/**
 * Single «Фильтры» menu — replaces the old split «Виды» + «Сохранить» buttons.
 * The button shows the ACTIVE filter's name (or «Без фильтрации»), with a dot
 * when the live state has drifted from it. Inside: apply / rename / delete a
 * saved filter, «Обновить» the active one (edit-in-place), and «Сохранить как…»
 * (new name, or overwrite an existing one). A filter may or may not capture the
 * PERIOD — period-bearing filters are tagged with a clock/calendar icon.
 */
export function FiltersMenu() {
  const f = useFiltersStore();
  const views = useSavedViewsStore((s) => s.views);
  const activeId = useSavedViewsStore((s) => s.activeId);
  const loaded = useSavedViewsStore((s) => s.loaded);
  const hydrate = useSavedViewsStore((s) => s.hydrate);
  const add = useSavedViewsStore((s) => s.add);
  const update = useSavedViewsStore((s) => s.update);
  const remove = useSavedViewsStore((s) => s.remove);
  const rename = useSavedViewsStore((s) => s.rename);
  const setActiveId = useSavedViewsStore((s) => s.setActiveId);

  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [withPeriod, setWithPeriod] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Live snapshot for matching against saved filters.
  const live = {
    accounts: [...f.accounts],
    categories: [...f.categories],
    currencies: [...f.currencies],
    search: f.search,
    excludeTransfers: f.excludeTransfers,
    preset: f.preset,
    from: f.from,
    to: f.to,
    monthYM: f.monthYM,
  };

  const activeView = views.find((v) => v.id === activeId) ?? null;
  const dirty = activeView ? !matchesView(activeView, live) : hasWhatFilters(live);
  const label = activeView ? activeView.name : "Без фильтрации";

  /** Capture the current filter state (period included only when asked). */
  function capture(includePeriod: boolean) {
    return {
      preset: f.preset,
      from: f.from,
      to: f.to,
      monthYM: f.monthYM,
      accounts: [...f.accounts],
      categories: [...f.categories],
      currencies: [...f.currencies],
      search: f.search,
      excludeTransfers: f.excludeTransfers,
      includePeriod,
    };
  }

  function closeAll() {
    setOpen(false);
    setSaveOpen(false);
    setRenamingId(null);
  }

  function applyView(v: SavedView) {
    f.setSet("accounts", new Set(v.accounts));
    f.setSet("categories", new Set(v.categories));
    f.setSet("currencies", new Set(v.currencies));
    f.setSearch(v.search);
    f.setExcludeTransfers(v.excludeTransfers);
    if (v.includePeriod ?? true) {
      if (v.preset === "month" && v.monthYM) f.setMonth(v.monthYM);
      else if (v.preset === "custom") f.setRange(v.from, v.to);
      else f.setPreset(v.preset);
    }
    setActiveId(v.id);
    closeAll();
  }

  /** «Без фильтрации» — clear every «what» filter; leave the period as-is. */
  function applyDefault() {
    f.resetSet("accounts");
    f.resetSet("categories");
    f.resetSet("currencies");
    f.setSearch("");
    f.setExcludeTransfers(false);
    setActiveId(null);
    closeAll();
  }

  async function doSaveAs() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = views.find(
      (v) => v.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      const ok = await confirm({
        title: "Перезаписать фильтр?",
        message: `«${existing.name}» будет обновлён текущими настройками.`,
        confirmLabel: "Перезаписать",
      });
      if (!ok) return;
      await update(existing.id, { ...capture(withPeriod), name: existing.name });
      setActiveId(existing.id);
    } else {
      const id = await add({ ...capture(withPeriod), name: trimmed });
      setActiveId(id);
    }
    setName("");
    closeAll();
  }

  async function updateActive() {
    if (!activeView) return;
    await update(activeView.id, capture(activeView.includePeriod ?? true));
    closeAll();
  }

  async function del(v: SavedView) {
    const ok = await confirm({
      title: "Удалить фильтр?",
      message: `«${v.name}» будет удалён из списка.`,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) remove(v.id);
  }

  async function commitRename() {
    const t = renameVal.trim();
    if (renamingId && t) await rename(renamingId, t);
    setRenamingId(null);
  }

  function openSave() {
    setName("");
    setWithPeriod(false);
    setSaveOpen(true);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "relative btn-ghost text-xs py-1.5 h-[30px] w-52",
          activeView && "text-accent2"
        )}
        title="Фильтры"
      >
        <Filter className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 text-left truncate">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        {/* Unsaved-changes marker — ONLY for a modified saved filter (not for
            plain ad-hoc filtering on «Без фильтрации»). Absolutely positioned so
            it never shifts the toolbar. */}
        {activeView && dirty && (
          <span
            title="Есть несохранённые изменения в этом фильтре"
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-warn"
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={closeAll} />
          <div className="absolute z-[80] mt-1 w-80 max-h-[70vh] overflow-auto card p-2 left-0">
            {/* Без фильтрации */}
            <button
              onClick={applyDefault}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-panel2"
            >
              {!activeView ? (
                <Check className="w-3.5 h-3.5 text-accent2 shrink-0" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <span className="truncate">Без фильтрации</span>
            </button>

            {views.length > 0 && <div className="h-px bg-border my-1" />}

            {views.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-1 hover:bg-panel2 rounded group"
              >
                {renamingId === v.id ? (
                  <input
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={commitRename}
                    autoFocus
                    className="input text-xs flex-1 py-1 mx-1"
                  />
                ) : (
                  <button
                    onClick={() => applyView(v)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left text-xs px-2 py-1.5"
                    title={v.name}
                  >
                    {v.id === activeId ? (
                      <Check className="w-3.5 h-3.5 text-accent2 shrink-0" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{v.name}</span>
                    {(v.includePeriod ?? true) && (
                      <span
                        title="Фильтр включает период (месяц/диапазон)"
                        className="shrink-0"
                      >
                        <CalendarClock className="w-3 h-3 text-muted" />
                      </span>
                    )}
                  </button>
                )}
                {renamingId !== v.id && (
                  <>
                    <button
                      onClick={() => {
                        setRenamingId(v.id);
                        setRenameVal(v.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-text"
                      title="Переименовать"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => del(v)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-expense"
                      title="Удалить"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}

            <div className="h-px bg-border my-1" />

            {activeView && (
              <button
                onClick={updateActive}
                disabled={!dirty}
                className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-panel2 disabled:opacity-40 disabled:hover:bg-transparent"
                title={dirty ? "Сохранить текущие настройки в этот фильтр" : "Изменений нет"}
              >
                <Save className="w-3.5 h-3.5 text-accent2 shrink-0" />
                <span className="truncate">Обновить «{activeView.name}»</span>
              </button>
            )}

            {!saveOpen ? (
              <button
                onClick={openSave}
                className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-panel2"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                Сохранить как…
              </button>
            ) : (
              <div className="p-2 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSaveAs()}
                  placeholder="Имя фильтра"
                  className="input text-xs"
                  autoFocus
                />
                {views.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {views.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setName(v.name)}
                        className="text-xs px-2 py-0.5 rounded-full bg-panel2 text-muted hover:text-text"
                        title="Перезаписать этот фильтр"
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={withPeriod}
                    onChange={(e) => setWithPeriod(e.target.checked)}
                    className="accent-accent"
                  />
                  Включить период (месяц/диапазон)
                </label>
                <div className="flex gap-2">
                  <button onClick={doSaveAs} className="btn-primary text-xs flex-1">
                    Сохранить
                  </button>
                  <button
                    onClick={() => setSaveOpen(false)}
                    className="btn-ghost text-xs"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
