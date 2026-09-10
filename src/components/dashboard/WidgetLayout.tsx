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

import { useEffect, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import {
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
  appearing,
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
  /** Виджет только что поставили — проявляем его, а не выкидываем на экран. */
  appearing: boolean;
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
        appearing && "animate-widget-in",
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
  fits,
  highlight,
  layout,
  beforeKey,
  onEnter,
  onDrop,
  onAdded,
}: {
  span: number;
  /** Виджет сейчас везут — дырке пора звать. */
  dragging: boolean;
  /**
   * Влезает ли то, что везут. Виджет в две трети в дырку на треть не встанет:
   * раскладка перенесла бы его на новый ряд и наделала дыр там, где их не было.
   * Раньше дырка звала «Перенести сюда» и в этом случае — человек целился в
   * неё, виджет уезжал в конец страницы, и это читалось как «ничего не
   * произошло». Двигать такой виджет по клеткам умеют стрелки.
   */
  fits: boolean;
  highlight: boolean;
  layout: readonly WidgetPlacement[];
  /** Перед кем стоит эта клетка; `null` — она в конце раскладки. */
  beforeKey: string | null;
  onEnter: () => void;
  onDrop: (sourceKey: string) => void;
  /** Виджет поставлен отсюда — странице пора его подсветить появлением. */
  onAdded: (key: string) => void;
}) {
  const open = dragging && fits;
  const [picking, setPicking] = useState(false);
  return (
    <div
      // Пока не влезает — дырка не принимает бросок вовсе, и курсор честно
      // показывает «сюда нельзя».
      onDragEnter={open ? onEnter : undefined}
      onDragOver={
        open
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          : undefined
      }
      onDrop={
        open
          ? (e) => {
              e.preventDefault();
              onDrop(e.dataTransfer.getData("text/plain"));
            }
          : undefined
      }
      className={clsx(
        // Ниже большого экрана колонок нет вовсе: всё стоит в одну, и дырок не
        // бывает.
        "hidden lg:grid place-items-center rounded-[18px] border border-dashed relative",
        span === 2 && "lg:col-span-2",
        highlight
          ? "border-accent bg-accent/10 text-accent"
          : "border-border/70 text-muted"
      )}
    >
      {open && <span className="text-[13px] font-medium">Перенести сюда</span>}
      {dragging && !fits && (
        <span className="text-[13px] font-medium text-muted/70 px-3 text-center">
          Не поместится — двигайте стрелками
        </span>
      )}
      {/* Пока ничего не везут, пустая клетка — это место, куда ставят. Список
          открывается здесь же: раньше он лежал полкой в самом низу страницы, и
          виджет оттуда приходилось тащить через весь экран. */}
      {!dragging && (
        <WidgetPicker
          layout={layout}
          beforeKey={beforeKey}
          open={picking}
          onOpen={() => setPicking(true)}
          onClose={() => setPicking(false)}
          onAdded={onAdded}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────  список виджетов  ───────────────────────────── */

/** Что можно поставить в эту клетку: снятые виджеты и те, которых можно много. */
function available(layout: readonly WidgetPlacement[]) {
  const hidden = layout.filter((p) => p.hidden);
  const fresh = WIDGETS.filter((w) => w.multi);
  return { hidden, fresh, total: hidden.length + fresh.length };
}

/**
 * Список виджетов прямо в пустой клетке.
 *
 * Открывается по «плюсу» и ставит выбранное СЮДА ЖЕ, а не в конец раскладки:
 * человек уже показал пальцем, куда хочет, и заставлять его после этого тащить
 * плитку через всю страницу незачем.
 */
function WidgetPicker({
  layout,
  beforeKey,
  open,
  onOpen,
  onClose,
  onAdded,
}: {
  layout: readonly WidgetPlacement[];
  beforeKey: string | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdded: (key: string) => void;
}) {
  const setHidden = useDashboardLayoutStore((s) => s.setHidden);
  const addLinks = useDashboardLayoutStore((s) => s.addLinks);
  const remove = useDashboardLayoutStore((s) => s.remove);
  const { hidden, fresh, total } = available(layout);

  // Escape закрывает список — по всему сервису он закрывает любой слой поверх.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={
          total > 0
            ? "Поставить сюда виджет"
            : "Ставить нечего: на главной уже всё, что есть"
        }
        aria-label="Поставить сюда виджет"
        disabled={total === 0}
        className={clsx(
          "w-10 h-10 rounded-full grid place-items-center",
          "border border-dashed border-border text-muted bg-panel/60",
          "transition-[color,border-color,background-color,transform] duration-200",
          "hover:text-accent hover:border-accent/60 hover:bg-accent/5 hover:scale-105",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          "disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-muted",
          "disabled:hover:border-border disabled:hover:bg-panel/60"
        )}
      >
        <Plus className="w-5 h-5" aria-hidden="true" />
      </button>
    );
  }

  const place = (run: () => Promise<void>, key: string) => {
    onClose();
    void run().then(() => onAdded(key));
  };

  /** Одна плитка списка: значок, название и зачем этот виджет нужен. */
  const tile = (
    key: string,
    icon: LucideIcon,
    title: string,
    hint: string,
    onPick: () => void,
    onDelete?: () => void
  ) => {
    const Icon = icon;
    return (
      <div key={key} className="relative">
        <button
          type="button"
          onClick={onPick}
          className={clsx(
            "group w-full h-full text-left rounded-[14px] border border-border bg-panel2/60 p-3",
            "flex items-start gap-2.5",
            "transition-[border-color,background-color,transform,box-shadow] duration-200",
            "hover:-translate-y-0.5 hover:border-accent/50 hover:bg-panel hover:shadow-tray",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          )}
        >
          <span
            className={clsx(
              "shrink-0 w-8 h-8 rounded-[10px] grid place-items-center",
              "bg-accent/10 text-accent transition-colors duration-200",
              "group-hover:bg-accent group-hover:text-accent-fg"
            )}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold truncate">{title}</span>
            {/* Подпись в две строки: она объясняет, зачем виджет, и одной
                строки на это почти никогда не хватает. */}
            <span className="block text-[12px] text-muted leading-snug line-clamp-2 mt-0.5">
              {hint}
            </span>
          </span>
        </button>
        {/* Заведённое руками можно и стереть — иначе снятая полоска висела бы
            в списке навсегда. Крестик поверх плитки, а не рядом: в ряду он
            ломал бы сетку. */}
        {onDelete && (
          <button
            type="button"
            className="btn-icon-danger absolute top-1.5 right-1.5 p-1"
            title="Удалить насовсем"
            aria-label="Удалить насовсем"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Клик мимо закрывает: список живёт внутри клетки, и уводить его в
          портал незачем — но перекрыть остальную страницу надо. */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Поставить виджет"
        className={clsx(
          "animate-picker-in absolute left-2 right-2 top-1/2 -translate-y-1/2 z-30",
          // По содержимому, а не во всю клетку: полотно в пол-экрана с тремя
          // строчками в углу выглядело сломанным.
          "max-h-[calc(100%-1rem)] overflow-y-auto scroll-soft",
          "rounded-[16px] border border-border bg-panel shadow-xl p-3"
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium">
            Поставить сюда
          </span>
          <button
            type="button"
            className="btn-icon p-1 -mr-1"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {/* Две колонки, пока клетка их вмещает: список из одного столбца в
            широкой клетке оставлял справа пустое поле. */}
        <div className="picker-items grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {hidden.map((p) => {
            const meta = widgetMeta(p.kind);
            const { text, title } = shelfLabel(p);
            return tile(
              p.key,
              meta.icon,
              text,
              meta.multi ? title.split("\n").slice(1).join(" · ") || meta.hint : meta.hint,
              () => place(() => setHidden(p.key, false, beforeKey), p.key),
              meta.multi ? () => void remove(p.key) : undefined
            );
          })}
          {fresh.map((w) =>
            tile(
              `new:${w.kind}`,
              w.icon,
              `Новая ${w.title.toLowerCase()}`,
              w.hint,
              () => place(() => addLinks(beforeKey), w.kind)
            )
          )}
        </div>
      </div>
    </>
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

/** Чем подписать снятый виджет в списке: полоски различаются кнопками. */
function shelfLabel(p: WidgetPlacement): { text: string; title: string } {
  if (p.kind !== "links") {
    const meta = widgetMeta(p.kind);
    return { text: meta.title, title: meta.hint };
  }
  // Пустые места полоски в подписи не считаем: в списке важно, что на ней
  // стоит, а не сколько дырок между кнопками.
  const labels = (p.links ?? [])
    .filter((to): to is string => Boolean(to))
    .map((to) => navSection(to)?.label ?? to);
  return {
    text: `Полоска: ${labels.slice(0, 2).join(", ")}${labels.length > 2 ? "…" : ""}`,
    title: `Полоска с кнопками\n${labels.join(" · ")}`,
  };
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
