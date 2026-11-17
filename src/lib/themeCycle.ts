/**
 * Три режима темы по кругу — для кнопки в шапке и пункта в меню узкой шапки:
 * светлая → тёмная → авто (вид следует за ОС) → снова светлая.
 */
import type { ResolvedTheme, ThemeMode } from "../store/useThemeStore";

export const NEXT_THEME_MODE: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "auto", auto: "light" };
export const THEME_MODE_LABEL: Record<ThemeMode, string> = { light: "Светлая", dark: "Тёмная", auto: "Авто" };

/** «Светлая», «Тёмная» или «Авто, сейчас тёмная». */
export function themeModeNow(mode: ThemeMode, resolved: ResolvedTheme): string {
  return mode === "auto" ? `Авто, сейчас ${resolved === "dark" ? "тёмная" : "светлая"}` : THEME_MODE_LABEL[mode];
}
