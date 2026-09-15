import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";
/**
 * Палитра светлой темы: `cool` — основная, серые с синевой; `neutral` —
 * эксперимент на чистых серых. На тёмную тему не влияет.
 */
export type LightPalette = "cool" | "neutral";

const STORAGE_KEY = "dzen.theme";
const PALETTE_KEY = "dzen.lightPalette";

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "light";
}

function loadPalette(): LightPalette {
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    if (v === "cool" || v === "neutral") return v;
  } catch {
    // ignore
  }
  return "cool";
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

/** Пометка палитры стоит всегда, а действует только вместе со светлой темой (index.css). */
function applyPalette(palette: LightPalette) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-palette", palette);
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  lightPalette: LightPalette;
  setMode: (m: ThemeMode) => void;
  setLightPalette: (p: LightPalette) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  resolved: "light",
  lightPalette: loadPalette(),
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
  setLightPalette: (lightPalette) => {
    try {
      localStorage.setItem(PALETTE_KEY, lightPalette);
    } catch {
      // ignore
    }
    applyPalette(lightPalette);
    set({ lightPalette });
  },
  init: () => {
    const { mode, lightPalette } = get();
    const resolved: ResolvedTheme = mode === "auto" ? resolveAuto() : mode;
    applyTheme(resolved);
    applyPalette(lightPalette);
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
