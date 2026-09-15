import clsx from "clsx";
import { Check } from "lucide-react";
import { DARK_SCHEMES, LIGHT_SCHEMES, type ThemeKind } from "../lib/themeSchemes";
import { useThemeStore } from "../store/useThemeStore";

/**
 * Выбор темы одного вида — шесть плиток с превью и галочкой.
 *
 * Превью не нарисовано отдельными цветами: на коробку надета пометка
 * `data-scheme`, и внутри неё те же токены (`bg-panel`, `text-expense`…)
 * отдают цвета этой темы. Поэтому плитка всегда совпадает с тем, что
 * получится, а новая тема в `index.css` появляется здесь сама.
 *
 * Галочка только отмечает тему для вида и вид не переключает: включена ли
 * тёмная, решает переключатель вида над списком.
 */
export function ThemeSchemePicker({ kind, className }: { kind: ThemeKind; className?: string }) {
  const schemes = kind === "dark" ? DARK_SCHEMES : LIGHT_SCHEMES;
  const selected = useThemeStore((s) => (kind === "dark" ? s.darkScheme : s.lightScheme));
  const setScheme = useThemeStore((s) => s.setScheme);

  return (
    <div
      className={clsx("grid grid-cols-2 sm:grid-cols-3 gap-3", className)}
      role="radiogroup"
      aria-label={kind === "dark" ? "Тёмные темы" : "Светлые темы"}
    >
      {schemes.map((sc) => {
        const on = sc.id === selected;
        return (
          <button
            key={sc.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setScheme(sc.id)}
            className={clsx(
              "text-left rounded-[14px] border p-1.5 transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              on ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
            )}
          >
            <SchemePreview id={sc.id} kind={kind} />
            <div className="flex items-start justify-between gap-2 px-1.5 pt-2 pb-1">
              <div className="min-w-0">
                <div className={clsx("text-sm font-medium", on ? "text-accent" : "text-text")}>
                  {sc.name}
                </div>
                <div className="text-xs text-muted leading-snug mt-0.5">{sc.hint}</div>
              </div>
              <span
                className={clsx(
                  "shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full border transition-colors duration-200",
                  on ? "bg-accent border-accent text-accent-fg" : "border-border text-transparent"
                )}
                aria-hidden
              >
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Мини-страница: шапка с выбранным пунктом, карточка с суммами и полем. */
function SchemePreview({ id, kind }: { id: string; kind: ThemeKind }) {
  return (
    <div
      data-scheme={id}
      style={{ colorScheme: kind }}
      className="rounded-[10px] overflow-hidden bg-bg border border-border/70 text-text"
      aria-hidden
    >
      <div className="flex items-center gap-1 px-2 py-1.5 bg-panel/80 border-b border-border">
        <span className="w-2.5 h-2.5 rounded-[3px] bg-accent" />
        <span className="ml-1 h-3 w-7 rounded-full bg-accent" />
        <span className="h-1.5 w-5 rounded-full bg-muted/40" />
        <span className="h-1.5 w-5 rounded-full bg-muted/40" />
      </div>
      <div className="p-2">
        <div className="rounded-[8px] bg-panel border border-border/70 shadow-tray px-2 py-1.5 space-y-1">
          <div className="flex items-center justify-between gap-2 text-[10px] leading-3 tabular-nums">
            <span className="font-semibold">Операции</span>
            <span className="text-muted">146</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] leading-3 tabular-nums font-medium">
            <span className="text-income">+95 000</span>
            <span className="text-expense">−3 284</span>
          </div>
          <div className="h-3 rounded-[4px] bg-panel2 border border-border" />
        </div>
      </div>
    </div>
  );
}
