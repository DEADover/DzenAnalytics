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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        disabled && "opacity-40 cursor-not-allowed",
        trackClass(checked)
      )}
    >
      <span className={thumbClass(checked)} />
    </button>
  );
}

/**
 * Тот же тумблер без собственной кнопки — внутри строки, которая нажимается
 * целиком (признак счёта). Кнопка в кнопке недопустима в HTML: скринридер
 * объявлял два переключателя, а браузер мог разорвать вложенность при разборе.
 */
export function SwitchIndicator({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden="true" className={clsx("inline-block", trackClass(checked))}>
      <span className={thumbClass(checked)} />
    </span>
  );
}

function trackClass(checked: boolean): string {
  return clsx(
    "w-10 h-6 rounded-full relative transition-colors shrink-0",
    checked ? "bg-accent" : "bg-panel2 border border-border hover:border-accent/50"
  );
}

function thumbClass(checked: boolean): string {
  return clsx(
    "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
    checked ? "left-[18px]" : "left-0.5"
  );
}
