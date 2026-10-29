import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useToastStore, type Toast } from "../store/useToastStore";
import { popSurfaceProps, usePresence } from "../hooks/usePresence";

/** Шаг отсчёта: кольцо и число секунд обновляются десять раз в секунду. */
const TICK_MS = 100;

/**
 * Плашка-отклик внизу по центру: «Операция удалена · Отменить».
 *
 * Ставится ОДИН раз в корне приложения. Центр — туда смотрят после действия,
 * и там же стоит панель выделения; пока она видна, плашка встаёт над ней
 * (`--selection-stack`, см. SelectionBar).
 *
 * У плашки с отменой — кольцо-отсчёт с числом секунд: видно, сколько ещё
 * можно передумать. Пока на плашку наведена мышь, отсчёт стоит: человек
 * тянется к «Отменить», и исчезнуть у него из-под курсора было бы нечестно.
 * ⌘Z (Ctrl+Z) вне полей ввода — то же «Отменить».
 */
export function Toaster() {
  const current = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  const runUndo = useToastStore((s) => s.runUndo);

  // Уходящая плашка дорисовывается со своим текстом, хотя в сторе её уже нет.
  const [shown, setShown] = useState<Toast | null>(current);
  const [hover, setHover] = useState(false);
  // Сколько осталось, мс. Свой счёт, а не таймер на весь срок: его надо
  // останавливать на наведении и показывать.
  const [left, setLeft] = useState(current?.duration ?? 0);
  if (current && current !== shown) {
    setShown(current);
    setLeft(current.duration);
    // Прежняя плашка снята из-под курсора — «уход мыши» она уже не получит.
    setHover(false);
  }
  const { mounted, closing } = usePresence(!!current);

  useEffect(() => {
    if (!current || hover) return;
    const t = window.setInterval(() => setLeft((l) => l - TICK_MS), TICK_MS);
    return () => window.clearInterval(t);
  }, [current, hover]);
  useEffect(() => {
    if (current && left <= 0) dismiss(current.id);
  }, [current, left, dismiss]);

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
    // Внешний слой только ставит плашку по центру: сдвиг на середину через
    // `transform` спорил бы с анимацией появления, которая тоже им двигает.
    <div
      className="fixed inset-x-0 z-[70] flex justify-center px-4 pointer-events-none"
      style={{ bottom: "calc(var(--selection-stack, 0px) + 1.25rem)" }}
    >
      <div
        // Ключ — номер плашки: новая сменяет прежнюю заметно, а не подменой текста.
        key={shown.id}
        {...popSurfaceProps(closing, "up")}
        data-toast
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-panel shadow-xl pl-3 pr-1.5 py-1.5 text-sm text-text max-w-[min(30rem,100%)]"
      >
        {shown.undo && <Countdown left={Math.max(0, left)} total={shown.duration} paused={hover} />}
        <span className={`min-w-0 py-1 ${shown.undo ? "" : "pl-0.5"}`}>{shown.text}</span>
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
    </div>
  );
}

/**
 * Кольцо, которое убывает к нулю, и число оставшихся секунд в нём. На паузе
 * (мышь на плашке) кольцо бледнеет: отсчёт стоит.
 */
function Countdown({ left, total, paused }: { left: number; total: number; paused: boolean }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? left / total : 0;
  const seconds = Math.ceil(left / 1000);
  return (
    <span
      className="relative w-6 h-6 shrink-0 grid place-items-center"
      data-countdown={seconds}
      aria-label={`Можно отменить ещё ${seconds} с`}
      role="timer"
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2" className="stroke-border" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          className={`stroke-accent transition-[stroke-dashoffset,opacity] duration-100 ease-linear ${paused ? "opacity-40" : ""}`}
        />
      </svg>
      <span className="relative text-[11px] font-semibold tabular-nums leading-none">{seconds}</span>
    </span>
  );
}
