/**
 * Полоса шагов мастера: отрезок на шаг, подпись под ним. Пройденные —
 * зелёные, текущий — акцентом, впереди — серые.
 *
 * Одна на все мастера (восстановление снимка, экспорт и импорт правил): свои
 * копии полосы разошлись бы в высоте и цветах с первой же правки.
 */
export function WizardSteps({
  steps,
  active,
  done = false,
  className = "px-5 pt-4",
}: {
  steps: readonly { id: string; title: string }[];
  /** Номер текущего шага с нуля. */
  active: number;
  /** Мастер завершён: все отрезки пройдены, последний подписан как текущий. */
  done?: boolean;
  className?: string;
}) {
  const last = steps.length - 1;
  return (
    <ol className={`flex items-start gap-1.5 ${className}`}>
      {steps.map((s, i) => {
        const passed = done || i < active;
        const current = i === active && !done;
        return (
          <li key={s.id} className="flex-1 min-w-0" aria-current={current ? "step" : undefined}>
            <div
              className={`h-1 rounded-full ${passed ? "bg-income" : current ? "bg-accent" : "bg-border"}`}
            />
            {/* По центру своей полоски: слева подпись «Справочники»
                прижималась к началу бара и казалась подписью к промежутку
                между ним и соседним. */}
            <div
              className={`text-[11px] mt-1 truncate text-center ${current || (passed && i === last) ? "text-text font-medium" : "text-muted"}`}
            >
              {s.title}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
