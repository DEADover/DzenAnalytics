/**
 * Настройка раскладки главной: обойма вокруг виджета с ручками, панель режима
 * и полка убранных виджетов.
 *
 * В обычном состоянии обойма не рисует ничего своего — только поддон с двойным
 * кантом и нужную ширину. Ручки появляются, когда включён режим настройки:
 * тогда содержимое приглушается и перестаёт ловить нажатия (иначе перетаскивание
 * то и дело проваливалось бы в график), а поверх встаёт дорожка: шаг влево-вправо
 * и «убрать». Ширина виджету не настраивается — она часть его самого.
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
  Trash2,
  X,
} from "lucide-react";
import {
  LINK_SLOTS,
  WIDGETS,
  isDefaultLayout,
  widgetMeta,
  widgetView,
  type WidgetMeta,
  type WidgetPlacement,
} from "../../lib/dashboardLayout";
import { navSection } from "../../lib/navSections";
import { useDashboardLayoutStore } from "../../store/useDashboardLayoutStore";
import { pluralRu } from "../../lib/plural";

/* ─────────────────────────────  обойма виджета  ───────────────────────────── */

export function WidgetShell({
  placement,
  meta,
  bare,
  sunken,
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
  placement: WidgetPlacement;
  meta: WidgetMeta;
  /** Этот вариант виджета рисует себя сам, без поддона. */
  bare: boolean;
  /** Утопленная плоскость вместо поддона: одна коробка с тенью, без канта. */
  sunken: boolean;
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
  const setHidden = useDashboardLayoutStore((s) => s.setHidden);
  const setView = useDashboardLayoutStore((s) => s.setView);

  const drag = editing
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          // Без данных перетаскивание не начинается в части браузеров, а сам
          // идентификатор мы держим в состоянии страницы: dataTransfer читается
          // только на drop, а подсветка нужна раньше.
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", placement.key);
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

  const bar = (
    <div className="pointer-events-auto flex items-center gap-1 max-w-full rounded-full bg-panel border border-border shadow-tray px-1.5 py-1.5">
      {/* Ручка — только знак того, что плитку можно взять: тащится вся плитка
          целиком, и отдельная кнопка для этого не нужна. */}
      <span
        className="px-0.5 text-muted shrink-0"
        title={`${meta.title}\nПеретащите плитку на место другой`}
      >
        <GripVertical className="w-4 h-4" aria-hidden="true" />
      </span>
      {/* Название есть у каждой плитки: без него дорожка ручек посреди чужого
          графика не говорит, чем именно ты сейчас двигаешь. */}
      <span className="text-[13px] font-semibold truncate min-w-0">{meta.title}</span>
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
      <button
        type="button"
        className="btn-icon-danger shrink-0"
        title="Убрать с главной"
        onClick={() => void setHidden(placement.key, true)}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );

  // Виджет, который настраивается изнутри, в режиме остаётся живым: приглушать
  // и глушить нажатия у него нечего — там и настраивают. Поэтому дорожка встаёт
  // НАД содержимым, а не поверх: посреди собственных кнопок она закрывала бы
  // ровно то, что человек пришёл менять.
  const inlineBar = editing && meta.live;

  /**
   * Варианты оформления — своей дорожкой в углу плитки, а не в общей.
   *
   * Цифрами, потому что названия («Открытый», «Разворот», «В рамке») занимали
   * половину дорожки ручек и вытесняли из неё название самого виджета. Что
   * значит цифра, говорит подсказка — а разницу всё равно видно на самой
   * плитке, стоит нажать.
   */
  const views = meta.views;
  const viewTrack = editing && views && views.length > 1 && (
    <span className="absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-full bg-panel border border-border shadow-tray p-1">
      {views.map((v, i) => {
        const on = v.id === (widgetView(meta, placement.view)?.id ?? v.id);
        return (
          <button
            key={v.id}
            type="button"
            title={`Вид ${i + 1} · ${v.title}\n${v.hint}`}
            aria-label={`Вид ${i + 1}: ${v.title}`}
            onClick={() => void setView(placement.key, v.id)}
            className={clsx(
              "w-6 h-6 rounded-full text-[12px] font-semibold leading-none tabular-nums",
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              on
                ? "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]"
                : "text-muted hover:text-text"
            )}
          >
            {i + 1}
          </button>
        );
      })}
    </span>
  );

  return (
    <div
      {...drag}
      className={clsx(
        "min-w-0 relative",
        meta.span === 2 && "lg:col-span-2",
        meta.span === 3 && "lg:col-span-3",
        // Высоту ряда задаёт сам виджет, а не сетка: полоска с кнопками ростом в
        // одну кнопку не должна вытягиваться до полутора экранов.
        meta.autoHeight ? "self-start" : "lg:h-[30rem]",
        inlineBar && "flex flex-col gap-3",
        // Кант в акценте — знак режима: пока он есть, плитку можно взять и
        // унести. Отодвинут от края, чтобы не сливаться с собственным кантом
        // поддона и не съедать просветы сетки.
        editing &&
          "rounded-[18px] ring-2 ring-accent/35 ring-offset-4 ring-offset-bg cursor-grab active:cursor-grabbing",
        dragging && "opacity-30",
        dropTarget && "ring-4 !ring-accent"
      )}
    >
      {viewTrack}
      {inlineBar && <div className="flex">{bar}</div>}

      <div
        className={clsx(
          inlineBar ? "flex-1 min-h-0" : "h-full",
          editing && !meta.live && "opacity-50 pointer-events-none select-none"
        )}
      >
        {bare ? (
          children
        ) : sunken ? (
          // Одна коробка вместо поддона: кант тут нечем нарисовать, обойма
          // залита тем же серым, что и подложка.
          //
          // Снизу поле больше верхнего — 36 против 20. Это не описка:
          // содержимое таких виджетов заканчивается таблицей итогов, у последней
          // строки нет нижней черты, и текст обрывается прямо у канта. Ровные
          // поля тут читаются как прижатый низ; неровные — как ровные.
          <div className="card-sunken h-full flex flex-col px-5 pt-5 pb-9">{children}</div>
        ) : (
          <div className="tray h-full flex flex-col">
            <div className="tray-core flex-1 min-h-0 flex flex-col p-5">{children}</div>
          </div>
        )}
      </div>

      {editing && !meta.live && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-2 pointer-events-none">
          {bar}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  пустое место  ───────────────────────────── */

/**
 * Дырка в ряду: место, оставшееся оттого, что следующий виджет в этот ряд не
 * влез и уехал ниже.
 *
 * В обычном виде её нет вовсе — пустая рамка посреди главной ничего не значит.
 * В режиме настройки она нужна: без неё в дырку некуда целиться, и виджет туда
 * не поставить.
 */
export function WidgetGap({
  span,
  dragging,
  highlight,
  onEnter,
  onDrop,
}: {
  span: number;
  /** Виджет сейчас везут — дырке пора звать. */
  dragging: boolean;
  highlight: boolean;
  onEnter: () => void;
  onDrop: (sourceKey: string) => void;
}) {
  return (
    <div
      onDragEnter={onEnter}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e.dataTransfer.getData("text/plain"));
      }}
      className={clsx(
        // Ниже большого экрана колонок нет вовсе: всё стоит в одну, и дырок не
        // бывает.
        "hidden lg:grid place-items-center rounded-[18px] border border-dashed",
        span === 2 && "lg:col-span-2",
        highlight
          ? "border-accent bg-accent/10 text-accent"
          : "border-border/70 text-muted"
      )}
    >
      {dragging && <span className="text-[13px] font-medium">Перенести сюда</span>}
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
        Перетащите виджет на место другого или сдвиньте стрелками. Убранные ждут
        внизу страницы.
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

/* ─────────────────────────────  полка  ───────────────────────────── */

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-panel " +
  "px-3 py-1.5 text-[13px] font-medium " +
  "transition-colors duration-200 hover:border-accent/50 hover:text-accent " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/** Чем подписать плитку на полке: полоски различаются кнопками, а не видом. */
function shelfLabel(p: WidgetPlacement): { text: string; title: string } {
  if (p.kind !== "links") {
    const meta = widgetMeta(p.kind);
    return { text: meta.title, title: meta.hint };
  }
  // Пустые места полоски в подписи не считаем: на полке важно, что на ней
  // стоит, а не сколько дырок между кнопками.
  const labels = (p.links ?? [])
    .filter((to): to is string => Boolean(to))
    .map((to) => navSection(to)?.label ?? to);
  return {
    text: `Полоска: ${labels.slice(0, 2).join(", ")}${labels.length > 2 ? "…" : ""}`,
    title: `Полоска с кнопками\n${labels.join(" · ")}`,
  };
}

function ShelfRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium w-full sm:w-[9.5rem] sm:shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Что можно поставить на главную: снятые виджеты и новая полоска с кнопками.
 *
 * Видна только в режиме настройки: в обычном она рассказывала бы про
 * отсутствующее — ровно то, от чего человек и избавился.
 */
export function HiddenWidgets({ layout }: { layout: readonly WidgetPlacement[] }) {
  const setHidden = useDashboardLayoutStore((s) => s.setHidden);
  const addLinks = useDashboardLayoutStore((s) => s.addLinks);
  const remove = useDashboardLayoutStore((s) => s.remove);
  const hidden = layout.filter((p) => p.hidden);

  return (
    <div className="rounded-[18px] border border-dashed border-border bg-panel2/50 px-4 py-3 flex flex-col gap-2.5">
      <ShelfRow label="Убранные">
        {hidden.length === 0 ? (
          <span className="text-[13px] text-muted">
            Ни одного — на главной сейчас всё, что есть.
          </span>
        ) : (
          hidden.map((p) => {
            const { text, title } = shelfLabel(p);
            const restore = (
              <button
                type="button"
                title={title}
                onClick={() => void setHidden(p.key, false)}
                className={clsx(
                  CHIP,
                  // У составной пилюли рамку и подложку рисует обойма.
                  widgetMeta(p.kind).multi && "border-0 bg-transparent px-0 py-0"
                )}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                {text}
              </button>
            );
            // Виджет, заведённый руками, с полки можно и стереть: иначе снятая
            // полоска осталась бы на ней навсегда.
            if (!widgetMeta(p.kind).multi) return <span key={p.key}>{restore}</span>;
            return (
              <span
                key={p.key}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-panel pl-3 pr-1 py-1"
              >
                {restore}
                <button
                  type="button"
                  className="btn-icon-danger p-1"
                  title="Удалить полоску насовсем"
                  aria-label="Удалить полоску насовсем"
                  onClick={() => void remove(p.key)}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            );
          })
        )}
      </ShelfRow>

      {/* Полосок можно поставить сколько угодно: в одну помещается шесть
          кнопок, а кому нужно больше — заводит вторую. */}
      <ShelfRow label="Новый виджет">
        <button
          type="button"
          title={`Полоска с кнопками\nБыстрые переходы в разделы, до ${LINK_SLOTS} кнопок в ряд`}
          onClick={() => void addLinks()}
          className={CHIP}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Полоска с кнопками
        </button>
      </ShelfRow>
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
