/**
 * Настройка раскладки главной: обойма вокруг виджета с ручками, панель режима
 * и полка убранных виджетов.
 *
 * В обычном состоянии обойма не рисует ничего своего — только поддон с двойным
 * кантом и нужную ширину. Ручки появляются, когда включён режим настройки:
 * тогда содержимое приглушается и перестаёт ловить нажатия (иначе перетаскивание
 * то и дело проваливалось бы в график), а поверх встаёт дорожка: шаг влево-вправо,
 * ширина и «убрать».
 *
 * Перетаскивание — на штатных событиях браузера, без сторонней библиотеки:
 * виджетов восемь, и целиться приходится в крупные плитки, а не в строки списка.
 * Порядок меняется в момент, когда плитку отпустили, а не пока её везут: так
 * раскладка не пляшет под курсором и на диск уходит одна запись, а не тридцать.
 */

import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import clsx from "clsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LayoutTemplate,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  WIDGETS,
  isDefaultLayout,
  widgetMeta,
  type WidgetMeta,
  type WidgetPlacement,
  type WidgetSpan,
} from "../../lib/dashboardLayout";
import { useDashboardLayoutStore } from "../../store/useDashboardLayoutStore";
import { pluralRu } from "../../lib/plural";

/** Подписи ширины. Дроби, а не «1/3», — рядом со значками они короче и ровнее. */
const SPAN_LABEL: Record<WidgetSpan, string> = { 1: "⅓", 2: "⅔", 3: "1" };
const SPAN_TITLE: Record<WidgetSpan, string> = {
  1: "Треть ширины",
  2: "Две трети ширины",
  3: "Вся ширина",
};

/* ─────────────────────────────  обойма виджета  ───────────────────────────── */

export function WidgetShell({
  meta,
  span,
  editing,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onShift,
  canBack,
  canForward,
  children,
}: {
  meta: WidgetMeta;
  span: WidgetSpan;
  editing: boolean;
  /** Эту плитку сейчас везут. */
  dragging: boolean;
  /** Над этой плиткой висит другая — сюда и встанет. */
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  /** Кого отпустили над этой плиткой — идентификатор приходит из самого жеста. */
  onDrop: (sourceId: string) => void;
  onShift: (dir: -1 | 1) => void;
  /** Есть ли куда шагнуть: на краю раскладки стрелки гаснут. */
  canBack: boolean;
  canForward: boolean;
  children: ReactNode;
}) {
  const setSpan = useDashboardLayoutStore((s) => s.setSpan);
  const setHidden = useDashboardLayoutStore((s) => s.setHidden);

  const drag = editing
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          // Без данных перетаскивание не начинается в части браузеров, а сам
          // идентификатор мы держим в состоянии страницы: dataTransfer читается
          // только на drop, а подсветка нужна раньше.
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", meta.id);
          onDragStart();
        },
        onDragEnter: onDragEnter,
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        },
        onDragEnd: onDragEnd,
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          // Кого везли, спрашиваем у самого жеста, а не у состояния страницы:
          // состояние — для подсветки, а решение о переносе не должно зависеть
          // от того, успел ли React перерисоваться между началом и концом.
          onDrop(e.dataTransfer.getData("text/plain"));
        },
      }
    : {};

  const onArrowKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Те же стрелки листают разделы приложения. Пока фокус на стрелке виджета,
    // они двигают виджет и до общего обработчика на окне не доходят — иначе
    // человек, шагнувший клавишей вместо клика, улетал бы с главной вовсе.
    e.preventDefault();
    e.stopPropagation();
    onShift(e.key === "ArrowRight" ? 1 : -1);
  };

  const arrow =
    "p-1 rounded-full text-muted transition-colors duration-200 " +
    "hover:text-accent hover:bg-panel2 " +
    "disabled:opacity-30 disabled:hover:text-muted disabled:hover:bg-transparent " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

  return (
    <div
      {...drag}
      className={clsx(
        "min-w-0 relative",
        span === 2 && "lg:col-span-2",
        span === 3 && "lg:col-span-3",
        // Высоту ряда задаёт сам виджет, а не сетка: дорожка быстрых переходов
        // ростом в одну кнопку не должна вытягиваться до полутора экранов.
        meta.autoHeight ? "self-start" : "lg:h-[30rem]",
        // Кант в акценте — знак режима: пока он есть, плитку можно взять и
        // унести. Отодвинут от края, чтобы не сливаться с собственным кантом
        // поддона и не съедать просветы сетки.
        editing &&
          "rounded-[18px] ring-2 ring-accent/35 ring-offset-4 ring-offset-bg cursor-grab active:cursor-grabbing",
        dragging && "opacity-30",
        dropTarget && "ring-4 !ring-accent"
      )}
    >
      <div
        className={clsx(
          "h-full",
          editing && "opacity-50 pointer-events-none select-none"
        )}
      >
        {meta.bare ? (
          children
        ) : (
          <div className="tray h-full flex flex-col">
            <div className="tray-core flex-1 min-h-0 flex flex-col p-5">{children}</div>
          </div>
        )}
      </div>

      {editing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-2 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1 max-w-full rounded-full bg-panel border border-border shadow-tray px-1.5 py-1.5">
            {/* Ручка — только знак того, что плитку можно взять: тащится вся
                плитка целиком, и отдельная кнопка для этого не нужна. */}
            <span
              className="px-0.5 text-muted shrink-0"
              title={`${meta.title}\nПеретащите плитку на место другой`}
            >
              <GripVertical className="w-4 h-4" aria-hidden="true" />
            </span>
            {/* Название — только у виджетов без поддона: у остальных оно и так
                написано в шапке карточки прямо над дорожкой, а на трети экрана
                обрезалось до «Балансы с…». */}
            {meta.bare && (
              <span className="text-[13px] font-semibold truncate min-w-0">{meta.title}</span>
            )}
            {/* Шаг влево-вправо кнопками: перетаскивание на сенсорном экране не
                работает вовсе, а с клавиатуры до него не добраться. */}
            <span className="flex items-center shrink-0">
              <button
                type="button"
                className={arrow}
                title="Сдвинуть назад"
                aria-label="Сдвинуть назад"
                disabled={!canBack}
                onKeyDown={onArrowKey}
                onClick={() => onShift(-1)}
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={arrow}
                title="Сдвинуть вперёд"
                aria-label="Сдвинуть вперёд"
                disabled={!canForward}
                onKeyDown={onArrowKey}
                onClick={() => onShift(1)}
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </span>
            {meta.spans.length > 1 && (
              <span className="flex items-center gap-0.5 rounded-full bg-panel2 border border-border p-0.5 shrink-0">
                {meta.spans.map((s) => (
                  <button
                    key={s}
                    type="button"
                    title={SPAN_TITLE[s]}
                    onClick={() => void setSpan(meta.id, s)}
                    className={clsx(
                      "w-7 h-6 rounded-full text-[12.5px] font-semibold leading-none transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                      s === span
                        ? "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]"
                        : "text-muted hover:text-text"
                    )}
                  >
                    {SPAN_LABEL[s]}
                  </button>
                ))}
              </span>
            )}
            <button
              type="button"
              className="btn-icon-danger shrink-0"
              title="Убрать с главной"
              onClick={() => void setHidden(meta.id, true)}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  панель режима  ───────────────────────────── */

/**
 * Панель режима настройки. В обычном состоянии её нет вовсе: вход в режим живёт
 * в шапке, рядом с темой и настройками, — а страница остаётся ровно такой,
 * какой была до всей этой затеи.
 */
export function LayoutToolbar({ layout }: { layout: readonly WidgetPlacement[] }) {
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setEditing = useDashboardLayoutStore((s) => s.setEditing);
  const reset = useDashboardLayoutStore((s) => s.reset);

  if (!editing) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-accent/40 bg-panel2 px-4 py-2.5">
      <p className="text-[13px] text-muted">
        Перетащите виджет на место другого или сдвиньте стрелками, задайте
        ширину — ⅓, ⅔ или во всю строку. Убранные ждут внизу страницы.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => void reset()}
          disabled={isDefaultLayout(layout)}
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          Сбросить
        </button>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={() => setEditing(false)}
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Готово
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  полка убранных  ───────────────────────────── */

/**
 * Что снято с главной. Видна только в режиме настройки: в обычном она
 * рассказывала бы про отсутствующее — ровно то, от чего человек и избавился.
 */
export function HiddenWidgets({ layout }: { layout: readonly WidgetPlacement[] }) {
  const setHidden = useDashboardLayoutStore((s) => s.setHidden);
  const hidden = layout.filter((p) => p.hidden);

  return (
    <div className="rounded-[18px] border border-dashed border-border bg-panel2/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium">
          Убранные виджеты
        </span>
        {hidden.length === 0 ? (
          <span className="text-[13px] text-muted">
            Ни одного — на главной сейчас всё, что есть.
          </span>
        ) : (
          hidden.map((p) => {
            const meta = widgetMeta(p.id);
            return (
              <button
                key={p.id}
                type="button"
                title={meta.hint}
                onClick={() => void setHidden(p.id, false)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel
                           px-3 py-1.5 text-[13px] font-medium
                           transition-colors duration-200 hover:border-accent/50 hover:text-accent
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                {meta.title}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────  пустая главная  ───────────────────────────── */

/** Когда с главной сняли всё: экран не должен выглядеть сломанным. */
export function EmptyDashboard() {
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setEditing = useDashboardLayoutStore((s) => s.setEditing);
  const reset = useDashboardLayoutStore((s) => s.reset);
  return (
    <div className="card card-pad text-center py-16">
      <h2 className="font-semibold text-[17px]">На главной ничего не осталось</h2>
      <p className="text-sm text-muted mt-1.5">
        Все {WIDGETS.length}{" "}
        {pluralRu(WIDGETS.length, ["виджет", "виджета", "виджетов"])} убраны.
        Верните нужные или соберите главную заново.
      </p>
      <div className="flex items-center justify-center gap-2 mt-5">
        {/* В самом режиме кнопка звала бы туда, где человек уже стоит. */}
        {!editing && (
          <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(true)}>
            <LayoutTemplate className="w-3.5 h-3.5" aria-hidden="true" />
            Настроить главную
          </button>
        )}
        <button type="button" className="btn-primary text-sm" onClick={() => void reset()}>
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          Вернуть стандартную
        </button>
      </div>
    </div>
  );
}
