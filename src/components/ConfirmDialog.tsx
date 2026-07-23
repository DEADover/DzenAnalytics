import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import clsx from "clsx";
import { useConfirmStore } from "../store/useConfirmStore";

/**
 * Application-wide replacement for `window.confirm`. Renders nothing
 * when the confirm store is closed; otherwise renders a centred
 * modal over a frosted backdrop.
 *
 * Mount this ONCE in the root layout (App.tsx). All `confirm()` calls
 * from anywhere in the app re-use this single instance — no Provider
 * needed, no per-page boilerplate.
 *
 * Keyboard:
 *   • Escape → cancel
 *   • Enter  → confirm  (Cmd/Ctrl+Enter also)
 * Backdrop click → cancel.
 * Confirm button is autofocused, so Enter "just works".
 */
export function ConfirmDialog() {
  const isOpen = useConfirmStore((s) => s.isOpen);
  const options = useConfirmStore((s) => s.options);
  const close = useConfirmStore((s) => s.close);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Keyboard handlers (Escape, Enter) registered while the dialog is
  // mounted. Trap them at window level so they win over any other
  // handlers (e.g. EditTransactionModal's Escape).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        // Don't hijack Enter when the user is typing in an input/
        // textarea — they'd lose mid-edit context. Anywhere else,
        // Enter = confirm.
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, close]);

  // Autofocus the confirm button when the dialog opens so Enter just
  // works. On close, return focus to whatever was focused before the
  // dialog opened (e.g. the delete button in a table row) — important
  // for keyboard + screen-reader users who'd otherwise lose their place.
  useEffect(() => {
    if (!isOpen) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      // Only restore if the element is still in the DOM and focusable.
      if (prevFocused && document.contains(prevFocused)) {
        prevFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen || !options) return null;

  const tone = options.tone || "primary";
  const confirmClass =
    tone === "danger" ? "btn-danger" : tone === "warning" ? "btn-warn" : "btn-primary";

  return (
    <div
      // Backdrop: a plain dim scrim (no backdrop-filter — a
      // full-viewport blur over the chart page intermittently flashed
      // the white root background on open). Click dismisses as cancel.
      // `role="dialog"` + `aria-modal` for accessibility.
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 animate-fade"
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={options.title ? "confirm-dialog-title" : undefined}
      aria-describedby="confirm-dialog-message"
    >
      <div
        // Stop propagation so clicks inside the panel don't bubble
        // to the backdrop and close the modal.
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "w-full max-w-md rounded-xl border shadow-xl bg-panel",
          tone === "danger"
            ? "border-expense/40"
            : tone === "warning"
              ? "border-warn/40"
              : "border-border"
        )}
      >
        {/* Header — tone-coloured icon, title text, close X */}
        <div className="flex items-start gap-3 p-5 pb-3">
          <div
            className={clsx(
              "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
              tone === "danger"
                ? "bg-expense/10 text-expense"
                : tone === "warning"
                  ? "bg-warn/10 text-warn"
                  : "bg-accent/10 text-accent"
            )}
          >
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            {options.title && (
              <div
                id="confirm-dialog-title"
                className="font-semibold text-text mb-1 break-words"
              >
                {options.title}
              </div>
            )}
            {/* Render each \n-separated paragraph as its own line so
                longer prompts stay readable. */}
            <div
              id="confirm-dialog-message"
              className="text-sm text-muted whitespace-pre-line break-words"
            >
              {options.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => close(false)}
            className="shrink-0 text-muted hover:text-text"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Footer — buttons. Cancel on the left, Confirm on the right
            (Russian convention is opposite, but right-side primary
            actions are the standard the user is used to from
            macOS / iOS / web). */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-panel2/40 rounded-b-xl">
          <button
            type="button"
            onClick={() => close(false)}
            className="btn-ghost text-sm"
          >
            {options.cancelLabel || "Отмена"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => close(true)}
            className={confirmClass + " text-sm"}
          >
            {options.confirmLabel || "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}
