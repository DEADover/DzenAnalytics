import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useToastStore, type Toast } from "../store/useToastStore";
import { popSurfaceProps, usePresence } from "../hooks/usePresence";

/**
 * Плашка-отклик в левом нижнем углу колонки: «Операция удалена · Отменить».
 *
 * Ставится ОДИН раз в корне приложения. Левый угол — потому что правый занят
 * плашкой курсов и кнопкой «Наверх», а низ по центру — панелью выделения.
 *
 * Пока на плашку наведена мышь, она не уходит: человек тянется к «Отменить»,
 * и исчезнуть у него из-под курсора было бы нечестно. ⌘Z (Ctrl+Z) вне полей
 * ввода — то же «Отменить».
 */
export function Toaster() {
  const current = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  const runUndo = useToastStore((s) => s.runUndo);

  // Уходящая плашка дорисовывается со своим текстом, хотя в сторе её уже нет.
  const [shown, setShown] = useState<Toast | null>(current);
  // Таймер ухода; на наведении — пауза, после — снова целиком.
  const [hover, setHover] = useState(false);
  if (current && current !== shown) {
    setShown(current);
    // Прежняя плашка снята из-под курсора — «уход мыши» она уже не получит.
    setHover(false);
  }
  const { mounted, closing } = usePresence(!!current);

  useEffect(() => {
    if (!current || hover) return;
    const id = current.id;
    const t = window.setTimeout(() => dismiss(id), current.duration);
    return () => window.clearTimeout(t);
  }, [current, hover, dismiss]);

  // ⌘Z / Ctrl+Z — отменить, пока плашка с отменой на экране. В поле ввода
  // клавиша остаётся полю: там она отменяет набранный текст.
  const undoable = !!current?.undo;
  useEffect(() => {
    if (!undoable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" && e.code !== "KeyZ") return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      e.preventDefault();
      void runUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoable, runUndo]);

  if (!mounted || !shown) return null;
  return (
    // Ключ — номер плашки: новая сменяет прежнюю заметно, а не подменой текста.
    <div
      key={shown.id}
      {...popSurfaceProps(closing, "up")}
      data-toast
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ left: "calc(var(--column-inset) + 1rem)" }}
      className="fixed bottom-4 z-[70] flex items-center gap-3 rounded-lg border border-border bg-panel shadow-lg pl-3.5 pr-1.5 py-1.5 text-sm text-text max-w-[min(26rem,calc(100vw-2rem))]"
    >
      <span className="min-w-0 py-1">{shown.text}</span>
      {shown.undo && (
        <button
          type="button"
          className="btn-ghost text-sm shrink-0"
          onClick={() => void runUndo()}
          title="Отменить (⌘Z)"
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden />
          Отменить
        </button>
      )}
      <button
        type="button"
        className="btn-icon btn-icon-sm shrink-0"
        onClick={() => dismiss(shown.id)}
        aria-label="Закрыть"
      >
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );
}
