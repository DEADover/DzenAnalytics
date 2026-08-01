import clsx from "clsx";

/**
 * Переключатель-пилюля — тот же вид, что у признаков счёта и категории.
 *
 * Голая галочка с подписью в ряду настроек выглядела случайной: рядом стоят
 * поле ввода и пикер, у каждого своя форма, а у булевой настройки формы не
 * было вовсе. Пилюля читается как контрол и сама показывает состояние, так
 * что подпись рядом уже не нужна — её несёт название строки.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Для скринридера: что именно включает переключатель. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "w-10 h-6 rounded-full relative transition-colors shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        disabled && "opacity-40 cursor-not-allowed",
        checked ? "bg-accent" : "bg-panel2 border border-border hover:border-accent/50"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
          checked ? "left-[18px]" : "left-0.5"
        )}
      />
    </button>
  );
}
