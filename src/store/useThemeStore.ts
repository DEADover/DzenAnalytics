import { create } from "zustand";
import {
  DEFAULT_DARK_SCHEME,
  DEFAULT_LIGHT_SCHEME,
  isDarkSchemeId,
  isLightSchemeId,
  type DarkSchemeId,
  type LightSchemeId,
  type SchemeId,
} from "../lib/themeSchemes";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dzen.theme";
const LIGHT_SCHEME_KEY = "dzen.lightScheme";
const DARK_SCHEME_KEY = "dzen.darkScheme";

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "light";
}

function loadLightScheme(): LightSchemeId {
  try {
    const v = localStorage.getItem(LIGHT_SCHEME_KEY);
    if (isLightSchemeId(v)) return v;
  } catch {
    // ignore
  }
  return DEFAULT_LIGHT_SCHEME;
}

function loadDarkScheme(): DarkSchemeId {
  try {
    const v = localStorage.getItem(DARK_SCHEME_KEY);
    if (isDarkSchemeId(v)) return v;
  } catch {
    // ignore
  }
  return DEFAULT_DARK_SCHEME;
}

function resolveAuto(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  const h = new Date().getHours();
  return h >= 20 || h < 7 ? "dark" : "light";
}

/** Вид и тема этого вида — на `<html>`; цвета темы берутся из index.css. */
function applyTheme(resolved: ResolvedTheme, scheme: SchemeId) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-scheme", scheme);
  root.style.colorScheme = resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  lightScheme: LightSchemeId;
  darkScheme: DarkSchemeId;
  setMode: (m: ThemeMode) => void;
  /**
   * Отметить тему для её вида. Вид не переключает: светлую тему можно выбрать
   * и сидя в тёмном — она включится, когда включится светлый вид. Показать
   * тему сразу — вызвать ещё и `setMode` с её видом (так делает палитра).
   */
  setScheme: (id: SchemeId) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const schemeFor = (resolved: ResolvedTheme): SchemeId =>
    resolved === "dark" ? get().darkScheme : get().lightScheme;
  const resolveMode = (mode: ThemeMode): ResolvedTheme => (mode === "auto" ? resolveAuto() : mode);

  return {
    mode: loadMode(),
    resolved: "light",
    lightScheme: loadLightScheme(),
    darkScheme: loadDarkScheme(),
    setMode: (mode) => {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // ignore
      }
      const resolved = resolveMode(mode);
      applyTheme(resolved, schemeFor(resolved));
      set({ mode, resolved });
    },
    setScheme: (id) => {
      if (isLightSchemeId(id)) {
        try {
          localStorage.setItem(LIGHT_SCHEME_KEY, id);
        } catch {
          // ignore
        }
        set({ lightScheme: id });
      } else if (isDarkSchemeId(id)) {
        try {
          localStorage.setItem(DARK_SCHEME_KEY, id);
        } catch {
          // ignore
        }
        set({ darkScheme: id });
      }
      const { resolved } = get();
      applyTheme(resolved, schemeFor(resolved));
    },
    init: () => {
      const resolved = resolveMode(get().mode);
      applyTheme(resolved, schemeFor(resolved));
      set({ resolved });

      const follow = () => {
        if (get().mode !== "auto") return;
        const r = resolveAuto();
        if (r === get().resolved) return;
        applyTheme(r, schemeFor(r));
        set({ resolved: r });
      };
      const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
      mql?.addEventListener?.("change", follow);
      const interval = window.setInterval(follow, 60_000);

      return () => {
        mql?.removeEventListener?.("change", follow);
        window.clearInterval(interval);
      };
    },
  };
});
