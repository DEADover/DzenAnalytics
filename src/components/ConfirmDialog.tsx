import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import clsx from "clsx";
import { useConfirmStore } from "../store/useConfirmStore";
import { Modal, ModalFooter } from "./Modal";

/**
 * Application-wide replacement for `window.confirm`. Renders nothing
 * when the confirm store is closed; otherwise renders a centred
 * `Modal` over every other window.
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

  // Фокус — на кнопку подтверждения, чтобы Enter сразу срабатывал. Вернуть
  // его туда, откуда открыли (например, на кнопку удаления в строке), —
  // забота `Modal`.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  if (!isOpen || !options) return null;

  const tone = options.tone || "primary";
  const confirmClass =
    tone === "danger" ? "btn-danger" : tone === "warning" ? "btn-warn" : "btn-primary";

  return (
    <Modal
      onClose={() => close(false)}
      layer="confirm"
      tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "default"}
      // Шире обычной ступени: длинный текст в узкой колонке уходил вниз
      // простынёй, и окно переставало помещаться по высоте.
      width="xl"
      initialFocus={false}
      label={options.title || "Подтверждение"}
      describedBy="confirm-dialog-message"
    >
      {/* Вопрос заголовком, последствие строкой ниже — без черты между ними:
          это одна мысль, а не шапка и содержимое. */}
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
            <div className="font-semibold text-text mb-1 break-words">{options.title}</div>
          )}
          {/* Каждый абзац через \n — своей строкой. */}
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
          className="btn-icon shrink-0 -mr-1.5 -mt-1"
          aria-label="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Главное действие справа — как привыкли по macOS, iOS и вебу. */}
      <ModalFooter className="bg-panel2/40">
        <button type="button" onClick={() => close(false)} className="btn-ghost text-sm">
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
      </ModalFooter>
    </Modal>
  );
}
