import { Sun, Moon, Monitor } from "lucide-react";
import { useThemeStore } from "../store/useThemeStore";
import { NEXT_THEME_MODE as NEXT, THEME_MODE_LABEL as LABEL, themeModeNow } from "../lib/themeCycle";

/**
 * Кнопка-значок темы в шапке: клик перебирает три режима — светлую, тёмную и
 * «Авто» (вид следует за настройкой ОС и меняется вместе с ней).
 *
 * Значок показывает ТЕКУЩИЙ режим, а не следующий. Пока режимов было два,
 * кнопка рисовала намерение («луна — будет тёмная»), но в цикле из трёх
 * «следующий» не угадать по значку, а «Авто» по экрану не отличить от
 * светлого или тёмного — его видно только на кнопке. Куда переключит клик —
 * в подсказке.
 */
export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode);
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const next = NEXT[mode];
  const now = themeModeNow(mode, resolved);

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={`Тема: ${now}\nКлик — ${LABEL[next].toLowerCase()}`}
      aria-label={`Тема: ${now}. Переключить на ${LABEL[next].toLowerCase()}`}
      data-theme-mode={mode}
      className="seg-icon seg-icon-md group shrink-0"
    >
      {mode === "auto" ? (
        <Monitor className="w-4 h-4 transition-transform duration-500 ease-out group-hover:scale-110" />
      ) : mode === "dark" ? (
        <Moon className="w-4 h-4 transition-transform duration-500 ease-out group-hover:-rotate-12" />
      ) : (
        <Sun className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-45" />
      )}
    </button>
  );
}
