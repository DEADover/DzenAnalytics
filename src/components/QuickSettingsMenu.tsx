import { useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight, Loader2, Pencil, Settings, SlidersHorizontal } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Popover } from "./Popover";
import { Segmented } from "./Segmented";
import { RangeInput } from "./Slider";
import { useSmoothNavigate } from "../hooks/useSmoothNavigate";
import { quickSetting, type QuickSetting } from "../lib/quickSettings";
import { useQuickSettingsStore } from "../store/useQuickSettingsStore";
import { usePrivacyStore } from "../store/usePrivacyStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { TABLE_FONT_LABELS, useDisplayStore, type TableFontLevel } from "../store/useDisplayStore";
import { useFilterMemoryStore } from "../store/useFilterMemoryStore";
import { useMembersStore } from "../store/useMembersStore";
import { useZenmoneyStore, type PushMode } from "../store/useZenmoneyStore";

/**
 * Шестерёнка в шапке: по клику — панель быстрых настроек, внизу — переход во
 * все «Настройки». Набор и порядок пунктов человек собирает сам (карандаш в
 * углу панели → `QuickSettingsModal`).
 *
 * Пока включено «Скрыть суммы», на шестерёнке горит точка: забытый режим
 * иначе выглядел бы как пропавшие данные.
 */
export function QuickSettingsMenu({ className }: { className: (active: boolean) => string }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();
  const hidden = usePrivacyStore((s) => s.hideAmounts);
  const onSettings = pathname === "/settings";

  return (
    <span ref={anchorRef} className="inline-flex">
      <button
        type="button"
        data-tour="quick-settings"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Быстрые настройки"
        title={hidden ? "Быстрые настройки\nСуммы скрыты" : "Быстрые настройки"}
        className={className(open || onSettings)}
      >
        <Settings className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-90" />
        {hidden && (
          <span
            aria-hidden
            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent ring-2 ring-panel"
          />
        )}
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[22rem] card p-3 shadow-lg"
      >
        <QuickSettingsPanel onClose={() => setOpen(false)} />
      </Popover>
    </span>
  );
}

function QuickSettingsPanel({ onClose }: { onClose: () => void }) {
  const items = useQuickSettingsStore((s) => s.items);
  const openEditor = useQuickSettingsStore((s) => s.openEditor);
  const smoothNavigate = useSmoothNavigate();
  const available = useAvailableQuickSettings();
  const shown = items.map(quickSetting).filter((s): s is QuickSetting => !!s && available(s.id));

  // Плитки — сеткой в две колонки наверху, выбор из вариантов и бегунки —
  // строками под ними. Вперемешку плитка вставала между строками одна в
  // полупустом ряду. Внутри каждой части порядок — тот, что задал человек.
  const tiles = shown.filter((s) => s.kind === "toggle" || s.kind === "action");
  const rows = shown.filter((s) => s.kind === "choice" || s.kind === "range");
  const blocks: ReactNode[] = [];
  if (tiles.length > 0) {
    blocks.push(
      <div key="tiles" className="grid grid-cols-2 gap-2">
        {tiles.map((s) => (
          <QuickTile key={s.id} setting={s} />
        ))}
      </div>
    );
  }
  for (const s of rows) blocks.push(<QuickRow key={s.id} setting={s} />);

  return (
    <div role="dialog" aria-label="Быстрые настройки">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="label">Быстрые настройки</div>
        <button
          type="button"
          className="btn-icon"
          onClick={() => {
            onClose();
            openEditor();
          }}
          aria-label="Настроить быстрые настройки"
          title="Настроить панель"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>
      {blocks.length > 0 ? (
        <div className="space-y-3">{blocks}</div>
      ) : (
        <p className="text-sm text-muted py-2">
          Панель пуста. Карандаш справа вверху — выбрать, что в ней стоит.
        </p>
      )}
      <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          onClick={() => smoothNavigate("/settings", onClose)}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Все настройки
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs text-muted">
          <kbd className="kbd">g</kbd> <kbd className="kbd">i</kbd>
        </span>
      </div>
    </div>
  );
}

/**
 * Какие пункты сейчас имеют смысл. Остальные из панели не пропадают — просто
 * не показываются, пока не понадобятся (например, отправка — без Дзен-мани).
 */
export function useAvailableQuickSettings(): (id: string) => boolean {
  const token = useZenmoneyStore((s) => s.token);
  const ownerId = useMembersStore((s) => s.ownerId);
  return (id) => {
    if (id === "pushMode" || id === "sync") return !!token;
    if (id === "hideForeign") return ownerId != null;
    return true;
  };
}

/** Плитка-тумблер или действие: значок в круге, название и состояние словами. */
function QuickTile({ setting }: { setting: QuickSetting }) {
  const t = useToggle(setting.id);
  if (!t) return null;
  const Icon = setting.icon;
  const isAction = setting.kind === "action";
  return (
    <button
      type="button"
      role={isAction ? undefined : "switch"}
      aria-checked={isAction ? undefined : t.on}
      onClick={t.run}
      disabled={t.busy}
      className={clsx(
        "flex items-center gap-2.5 min-w-0 rounded-control border px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        t.on ? "border-accent/40 bg-accent/10" : "border-border bg-panel2/50 hover:border-accent/40"
      )}
    >
      <span
        className={clsx(
          "w-8 h-8 shrink-0 rounded-full flex items-center justify-center",
          t.on ? "bg-accent text-white" : "bg-panel text-muted"
        )}
      >
        {t.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      </span>
      <span className="min-w-0">
        <span className={clsx("block text-[13px] leading-4 font-medium", t.on && "text-accent")}>
          {setting.label}
        </span>
        <span className="block text-xs text-muted leading-4 mt-0.5 truncate">{t.state}</span>
      </span>
    </button>
  );
}

interface ToggleView {
  on: boolean;
  state: string;
  run: () => void;
  busy?: boolean;
}

/** Состояние и действие плитки — по её пункту. */
function useToggle(id: string): ToggleView | null {
  const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
  const toggleHide = usePrivacyStore((s) => s.toggle);
  const offBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const setOffBalance = useOffBalanceStore((s) => s.setIncludeOffBalance);
  const fractionDigits = useDisplayStore((s) => s.fractionDigits);
  const setFractionDigits = useDisplayStore((s) => s.setFractionDigits);
  const statementLine = useDisplayStore((s) => s.statementLine);
  const setStatementLine = useDisplayStore((s) => s.setStatementLine);
  const commentWrap = useDisplayStore((s) => s.commentWrap);
  const setCommentWrap = useDisplayStore((s) => s.setCommentWrap);
  const columnResize = useDisplayStore((s) => s.columnResize);
  const setColumnResize = useDisplayStore((s) => s.setColumnResize);
  const remember = useFilterMemoryStore((s) => s.enabled);
  const setRemember = useFilterMemoryStore((s) => s.setEnabled);
  const hideForeign = useMembersStore((s) => s.hideForeignPrivate);
  const setHideForeign = useMembersStore((s) => s.setHideForeignPrivate);
  const status = useZenmoneyStore((s) => s.status);
  const sync = useZenmoneyStore((s) => s.sync);

  const sw = (on: boolean, set: (v: boolean) => unknown, yes: string, no: string): ToggleView => ({
    on,
    state: on ? yes : no,
    run: () => void set(!on),
  });
  switch (id) {
    case "hideAmounts":
      return { on: hideAmounts, state: hideAmounts ? "Скрыты · H" : "Видны · H", run: () => void toggleHide() };
    case "offBalance":
      return sw(offBalance, setOffBalance, "Учитываются", "Не учитываются");
    case "kopecks":
      return sw(fractionDigits === 2, (v) => setFractionDigits(v ? 2 : 0), "Показаны", "Скрыты");
    case "statementLine":
      return sw(statementLine, setStatementLine, "Показана", "Скрыта");
    case "commentWrap":
      return sw(commentWrap, setCommentWrap, "Целиком", "Обрезаются");
    case "rememberFilters":
      return sw(remember, setRemember, "Включено", "Выключено");
    case "columnResize":
      return sw(columnResize, setColumnResize, "Включена", "Выключена");
    case "hideForeign":
      return sw(hideForeign, setHideForeign, "Скрыты", "Видны");
    case "sync": {
      const busy = status === "syncing" || status === "checking";
      return { on: false, state: busy ? "Идёт…" : "Забрать данные", run: () => void sync(), busy };
    }
    default:
      return null;
  }
}

/** Строка во всю ширину: название и переключатель вариантов или бегунок. */
function QuickRow({ setting }: { setting: QuickSetting }) {
  const Icon = setting.icon;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-xs text-muted">
        <Icon className="w-3.5 h-3.5" aria-hidden />
        {setting.label}
      </div>
      <QuickControl id={setting.id} />
    </div>
  );
}

function QuickControl({ id }: { id: string }) {
  const feedPlanned = useDisplayStore((s) => s.feedPlanned);
  const feedPlannedMode = useDisplayStore((s) => s.feedPlannedMode);
  const setFeedPlanned = useDisplayStore((s) => s.setFeedPlanned);
  const setFeedPlannedMode = useDisplayStore((s) => s.setFeedPlannedMode);
  const filtersMode = useDisplayStore((s) => s.filtersMode);
  const setFiltersMode = useDisplayStore((s) => s.setFiltersMode);
  const tableFontLevel = useDisplayStore((s) => s.tableFontLevel);
  const setTableFontLevel = useDisplayStore((s) => s.setTableFontLevel);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const setPushMode = useZenmoneyStore((s) => s.setPushMode);

  switch (id) {
    case "feedPlanned":
      return (
        <Segmented
          size="sm"
          block
          label="Запланированные в ленте"
          value={feedPlanned ? feedPlannedMode : "off"}
          onChange={(v) => {
            if (v === "off") void setFeedPlanned(false);
            else {
              void setFeedPlannedMode(v);
              if (!feedPlanned) void setFeedPlanned(true);
            }
          }}
          options={[
            { value: "off" as const, label: "Скрыть" },
            { value: "bar" as const, label: "Строкой" },
            { value: "inline" as const, label: "В ленте" },
          ]}
        />
      );
    case "filtersMode":
      return (
        <Segmented
          size="sm"
          block
          label="Панель фильтров"
          value={filtersMode}
          onChange={(m) => void setFiltersMode(m)}
          options={[
            { value: "page" as const, label: "На странице" },
            { value: "button" as const, label: "По кнопке" },
          ]}
        />
      );
    case "pushMode":
      return (
        <Segmented<PushMode>
          size="sm"
          block
          label="Отправка в Дзен-мани"
          value={pushMode}
          onChange={(m) => void setPushMode(m)}
          options={[
            { value: "off", label: "Выкл", title: "Отправка выключена" },
            { value: "manual", label: "Вручную" },
            { value: "auto", label: "Авто" },
            { value: "on-sync", label: "С синхр.", title: "При синхронизации" },
          ]}
        />
      );
    case "tableFont":
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted text-[12px]" aria-hidden>
            А
          </span>
          <RangeInput
            value={tableFontLevel}
            min={1}
            max={5}
            onChange={(v) => void setTableFontLevel(v as TableFontLevel)}
            ariaLabel="Размер текста в таблицах"
            valueText={TABLE_FONT_LABELS[tableFontLevel]}
            className="flex-1"
          />
          <span className="text-muted text-[18px]" aria-hidden>
            А
          </span>
          <span className="text-xs text-muted w-24 text-right">{TABLE_FONT_LABELS[tableFontLevel]}</span>
        </div>
      );
    default:
      return null;
  }
}
