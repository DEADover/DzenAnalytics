import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../store/useThemeStore";

/**
 * Кнопка-значок: показывает тему, на которую переключит.
 *
 * Была пилюля-слайдер с бегунком на два положения — рудимент тех времён, когда
 * она стояла в шапке особняком. Теперь кнопки шапки собраны в дорожку, и
 * пилюля внутри пилюли читалась как чужая деталь; да и сам слайдер занимал
 * впятеро больше места, чем нужно одному действию с двумя состояниями.
 *
 * Значок показывает НАМЕРЕНИЕ, а не текущее состояние: в светлой теме на
 * кнопке луна («будет тёмная»), в тёмной — солнце. Так у кнопки один смысл —
 * «переключить», — а текущая тема и без того видна по всему экрану.
 *
 * Режим «авто» store по-прежнему умеет, но в двоичной кнопке ему места нет:
 * переключение всегда выбирает светлую или тёмную явно.
 */
export function ThemeSwitcher() {
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setMode(isDark ? "light" : "dark")}
      title={isDark ? "Тёмная → светлая" : "Светлая → тёмная"}
      aria-label={`Тема: ${isDark ? "тёмная" : "светлая"}`}
      className="group p-1.5 rounded-full shrink-0 text-muted transition-colors duration-200 hover:text-accent hover:bg-panel/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {isDark ? (
        <Sun className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-500 ease-out group-hover:-rotate-12" />
      )}
    </button>
  );
}
