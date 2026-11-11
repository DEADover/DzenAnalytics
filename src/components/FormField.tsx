import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { Badge } from "./Badge";
import { Tooltip } from "./Tooltip";

/**
 * Поле формы: ярлык над полем и само поле. Одно на все окна — раньше в окне
 * операции, в строке импорта и в «Целях» было по своей копии, и ярлыки стояли
 * на разном расстоянии от полей.
 *
 * Ярлык в одну строку: поля одного ряда начинаются на одной высоте.
 */
export function FormField({
  label,
  after,
  hint,
  attention,
  className,
  children,
}: {
  label: string;
  /** Рядом с ярлыком: значок, пометка о состоянии поля. Не меняет высоту строки. */
  after?: ReactNode;
  /** Пояснение по наведению на «ⓘ» после ярлыка. */
  hint?: string;
  /** Поле стоит заполнить (например, после смены типа операции): пилюля в
   *  строке ярлыка — высота поля не меняется. Обязательное (`required`) —
   *  ещё и рамка акцентом, а пилюля сплошная: светлая слилась бы с рамкой.
   *  Необязательное — только светлая пилюля, поле как обычно. */
  attention?: { text: string; title?: string; required?: boolean };
  /** Классы обёртки — например, `flex-1 flex flex-col`, чтобы поле тянулось. */
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  // Ярлык — имя поля для экранного чтеца. Поля внутри бывают любые (поле
  // даты, список, текст), поэтому связываем по готовой разметке: первое
  // поле без своего имени получает ярлык.
  useLayoutEffect(() => {
    const control = boxRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [role="combobox"]'
    );
    if (!control || control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
    control.setAttribute("aria-labelledby", labelId);
  });
  return (
    <div ref={boxRef} className={clsx("min-w-0", className, attention?.required && "field-attention")}>
      <div className="flex items-center gap-1.5 mb-1 min-w-0 whitespace-nowrap">
        {/* «ⓘ» — внутри ярлыка, его шрифтом: отдельным значком он был выше
            строки ярлыка, и поле съезжало ниже соседних. */}
        <span className="label flex items-center gap-1">
          {/* Имя поля — только сам ярлык, без «ⓘ». */}
          <span id={labelId}>{label}</span>
          {hint && (
            <Tooltip content={hint}>
              <span className="text-muted/70 cursor-help normal-case tracking-normal">ⓘ</span>
            </Tooltip>
          )}
        </span>
        {/* Значок в ярлыке — кнопка 24 px, выше самой строки: без
            отрицательного отступа она раздувала строку, и поле уезжало ниже
            соседних в том же ряду. */}
        {after && <span className="flex items-center -my-1 min-w-0">{after}</span>}
        {attention && (
          <Badge size="xs" tone="accent" solid={attention.required} title={attention.title}>
            {attention.text}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}
