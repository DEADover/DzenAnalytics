import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";
/**
 * Цветовая схема, общая для светлой и тёмной темы: `classic` — прежняя, серые
 * с синевой; `neutral` — чистые серые, тёмная тема по правилам Material.
 */
export type ColorScheme = "classic" | "neutral";

const STORAGE_KEY = "dzen.theme";
const PALETTE_KEY = "dzen.palette";

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "light";
}

function loadPalette(): ColorScheme {
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    if (v === "classic" || v === "neutral") return v;
  } catch {
    // ignore
  }
  return "classic";
}

function resolveAuto(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  const h = new Date().getHours();
  return h >= 20 || h < 7 ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

/** Пометка схемы на `<html>`; её цвета для каждой темы — в index.css. */
function applyPalette(palette: ColorScheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-palette", palette);
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  palette: ColorScheme;
  setMode: (m: ThemeMode) => void;
  setPalette: (p: ColorScheme) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  resolved: "light",
  palette: loadPalette(),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    const resolved: ResolvedTheme = mode === "auto" ? resolveAuto() : mode;
    applyTheme(resolved);
    set({ mode, resolved });
  },
  setPalette: (palette) => {
    try {
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      // ignore
    }
    applyPalette(palette);
    set({ palette });
  },
  init: () => {
    const { mode, palette } = get();
    const resolved: ResolvedTheme = mode === "auto" ? resolveAuto() : mode;
    applyTheme(resolved);
    applyPalette(palette);
    set({ resolved });

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().mode === "auto") {
        const r = resolveAuto();
        applyTheme(r);
        set({ resolved: r });
      }
    };
    mql?.addEventListener?.("change", onChange);

    const interval = window.setInterval(() => {
      if (get().mode === "auto") {
        const r = resolveAuto();
        if (r !== get().resolved) {
          applyTheme(r);
          set({ resolved: r });
        }
      }
    }, 60_000);

    return () => {
      mql?.removeEventListener?.("change", onChange);
      window.clearInterval(interval);
    };
  },
}));
