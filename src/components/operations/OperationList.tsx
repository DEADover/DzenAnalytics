/**
 * Каркас ленты операций: поддон с панелью инструментов, липкая шапка колонок,
 * строка с выделением по клику и подвал постепенной подгрузки.
 *
 * Одна раскладка на ленту «Операций» и «Удалённые». Колонки у каждой ленты
 * свои, поэтому сетку (`grid-template-columns`) передаёт страница — одной
 * строкой и шапке, и строкам, чтобы ширины не разъезжались. Содержимое ячеек —
 * в `OperationCells`.
 */
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { formatNum } from "../../lib/format";

/** Двойной кант вокруг ленты — как у карточек главной — и строка инструментов сверху. */
export function OperationListTray({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tray">
      <div className="tray-core overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          {toolbar}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Шапка колонок. Сетка та же, что у строк. */
export function OperationListHead({ template, children }: { template: string; children: ReactNode }) {
  return (
    <div
      className="list-head grid items-center gap-3 px-3 py-2 bg-panel sticky top-0 z-20"
      style={{ gridTemplateColumns: template }}
    >
      {children}
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
  children,
}: {
  template: string;
  selected: boolean;
  onToggleSelect: () => void;
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
          onToggleSelect();
        }, DOUBLE_CLICK_MS);
      }}
      onDoubleClick={
        onOpen &&
        (() => {
          cancelPendingSelect();
          onOpen();
        })
      }
      className={`grid items-center gap-3 px-3 py-2 border-b border-border/40 cursor-pointer group text-[length:var(--tbl-font)] ${
        selected ? "bg-accent/5" : "hover:bg-panel2/40"
      }`}
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
