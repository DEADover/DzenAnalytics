/**
 * Каркас ленты операций: поддон с панелью инструментов, липкая шапка колонок,
 * строка с выделением по клику и подвал постепенной подгрузки.
 *
 * Одна раскладка на ленту «Операций» и «Удалённые». Колонки у каждой ленты
 * свои, поэтому сетку (`grid-template-columns`) передаёт страница — одной
 * строкой и шапке, и строкам, чтобы ширины не разъезжались. Содержимое ячеек —
 * в `OperationCells`.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { Pin, PinOff } from "lucide-react";
import clsx from "clsx";
import { formatNum } from "../../lib/format";
import { useDisplayStore } from "../../store/useDisplayStore";

/**
 * Двойной кант вокруг ленты — как у карточек главной — и строка инструментов
 * сверху.
 *
 * Последняя кнопка строки — булавка: закрепляет строку инструментов и шапку
 * колонок под шапкой приложения, чтобы при прокрутке длинной ленты поиск,
 * «Добавить» и названия колонок оставались на виду. Настройка одна на все
 * ленты и запоминается.
 *
 * Закреплять мешал сам поддон: `overflow: hidden`, которым он скругляет углы,
 * делает его «прокручиваемым предком», и липкие строки липли к нему, а не к
 * окну, — то есть не липли вовсе. С закреплением поддон режет углы через
 * `overflow: clip`: скругление то же, а прокручиваемым предком он не
 * становится.
 */
export function OperationListTray({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const sticky = useDisplayStore((s) => s.feedHeadSticky);
  const setSticky = useDisplayStore((s) => s.setFeedHeadSticky);
  const coreRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Шапка колонок липнет сразу под строкой инструментов, а та бывает в одну
  // строку и в две (на узком окне кнопки переносятся) — высоту меряем.
  useLayoutEffect(() => {
    const core = coreRef.current;
    const bar = barRef.current;
    if (!core || !bar) return;
    if (!sticky) {
      core.style.removeProperty("--feed-toolbar-h");
      return;
    }
    const apply = () => core.style.setProperty("--feed-toolbar-h", `${bar.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [sticky]);

  return (
    <div className="tray">
      <div ref={coreRef} className={clsx("tray-core", sticky ? "overflow-clip" : "overflow-hidden")}>
        <div
          ref={barRef}
          className={clsx(
            "px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap",
            sticky && "sticky z-20 bg-panel"
          )}
          style={sticky ? { top: "var(--app-header-h)" } : undefined}
        >
          {toolbar}
          <button
            type="button"
            onClick={() => void setSticky(!sticky)}
            aria-pressed={sticky}
            aria-label={sticky ? "Открепить шапку ленты" : "Закрепить шапку ленты"}
            title={
              sticky
                ? "Открепить: поиск и названия колонок уедут вместе с лентой"
                : "Закрепить поиск и названия колонок вверху при прокрутке"
            }
            className={clsx("btn-ghost text-xs !px-2 shrink-0", sticky && "!text-accent !bg-accent/10")}
          >
            {sticky ? <Pin className="w-4 h-4" aria-hidden /> : <PinOff className="w-4 h-4" aria-hidden />}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Шапка колонок. Сетка та же, что у строк. С закреплённой шапкой ленты липнет
 * под строкой инструментов (см. `OperationListTray`).
 */
export function OperationListHead({ template, children }: { template: string; children: ReactNode }) {
  const sticky = useDisplayStore((s) => s.feedHeadSticky);
  return (
    <div
      className={clsx("list-head grid items-center gap-3 px-3 py-2 bg-panel", sticky && "sticky z-10")}
      style={{
        gridTemplateColumns: template,
        ...(sticky ? { top: "calc(var(--app-header-h) + var(--feed-toolbar-h, 0px))" } : {}),
      }}
    >
      {children}
    </div>
  );
}

/**
 * Ячейка шапки ленты. `col` — ключ колонки: по нему своя ширина столбца
 * находит ячейку; `resize` — граница справа (`useColumnResize().handle`).
 */
export function ListHeadCell({
  col,
  resize,
  className,
  children,
}: {
  col: string;
  resize?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-col={col} className={resize ? `relative ${className ?? ""}` : className}>
      {children}
      {resize}
    </div>
  );
}

/** Порог двойного клика: на столько откладывается выделение строки, чтобы
 *  двойной клик успел его отменить. Меньше — двойной клик начинает мигать
 *  выделением, больше — выделение ощущается вялым. */
const DOUBLE_CLICK_MS = 220;

/**
 * Строка ленты. Клик выделяет её, двойной клик открывает (`onOpen`).
 *
 * Клики по кнопкам и полям внутри строки не выделяют: у них своё действие, и
 * попутное выделение читалось бы как случайное.
 */
export function OperationListRow({
  template,
  selected,
  onToggleSelect,
  onOpen,
  className,
  children,
}: {
  template: string;
  /** Дополнительные классы строки — например, приглушить плановую. */
  className?: string;
  selected: boolean;
  /** Щелчок по строке. Нет — строка не откликается на щелчок (план в ленте). */
  onToggleSelect?: () => void;
  /** Двойной клик. Нет — открывать нечего, и выделение не ждёт второго клика. */
  onOpen?: () => void;
  children: ReactNode;
}) {
  // Двойной клик В ЛЮБОМ СЛУЧАЕ проходит через одиночные, и строка успевала
  // мигнуть выделением. Поэтому выделение откладываем на порог двойного
  // клика: пришёл второй клик — отменяем, не пришёл — выделяем.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSelect = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };
  useEffect(() => cancelPendingSelect, []);

  return (
    <div
      onClick={(e) => {
        if (!onToggleSelect) return;
        // Второй клик двойного — гасим отложенное выделение и уходим.
        if (e.detail > 1) {
          cancelPendingSelect();
          return;
        }
        const el = e.target as HTMLElement;
        if (el.closest("button, a, input, label, select, textarea")) return;
        // Клик с зажатым Shift/Ctrl — привычный системный жест; не трогаем.
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        // Выделение текста мышью тоже не должно переключать строку.
        if ((window.getSelection()?.toString() || "").length > 0) return;
        cancelPendingSelect();
        if (!onOpen) {
          onToggleSelect();
          return;
        }
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          onToggleSelect?.();
        }, DOUBLE_CLICK_MS);
      }}
      onDoubleClick={
        onOpen &&
        (() => {
          cancelPendingSelect();
          onOpen();
        })
      }
      className={clsx(
        "grid items-center gap-3 px-3 py-2 border-b border-border/40 group text-[length:var(--tbl-font)]",
        (onToggleSelect || onOpen) && "cursor-pointer",
        selected ? "bg-accent/5" : "hover:bg-panel2/40",
        className
      )}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

/**
 * Маячок подгрузки в конце ленты — пока показано не всё. Общее число строк
 * живёт в итогах над лентой, поэтому, когда показано всё, подвала нет.
 */
export function LazyListFooter({
  shown,
  total,
  sentinelRef,
}: {
  shown: number;
  total: number;
  sentinelRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={sentinelRef}
      className="px-4 py-3 text-center text-xs text-muted border-t border-border"
    >
      Показано {formatNum(shown)} из {formatNum(total)} — прокрутите дальше, чтобы загрузить ещё
    </div>
  );
}
