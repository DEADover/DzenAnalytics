import { create } from "zustand";
import {
  DEFAULT_DARK_SCHEME,
  DEFAULT_LIGHT_SCHEME,
  isDarkChoice,
  isLightChoice,
  type DarkChoice,
  type LightChoice,
  type SchemeChoice,
  type ThemeKind,
} from "../lib/themeSchemes";
import {
  customSchemeId,
  injectCustomThemes,
  parseCustomTheme,
  readSchemeColors,
  sameCustomTheme,
  type CustomTheme,
} from "../lib/customTheme";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dzen.theme";
const LIGHT_SCHEME_KEY = "dzen.lightScheme";
const DARK_SCHEME_KEY = "dzen.darkScheme";
const CUSTOM_LIGHT_KEY = "dzen.customLight";
const CUSTOM_DARK_KEY = "dzen.customDark";

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "light";
}

function loadCustom(kind: ThemeKind): CustomTheme | null {
  try {
    return parseCustomTheme(localStorage.getItem(kind === "dark" ? CUSTOM_DARK_KEY : CUSTOM_LIGHT_KEY));
  } catch {
    return null;
  }
}

/** Своя тема без своих цветов (не сохранились) — тогда готовая по умолчанию. */
function loadLightScheme(): LightChoice {
  try {
    const v = localStorage.getItem(LIGHT_SCHEME_KEY);
    if (v === "custom-light" && !loadCustom("light")) return DEFAULT_LIGHT_SCHEME;
    if (isLightChoice(v)) return v;
  } catch {
    // ignore
  }
  return DEFAULT_LIGHT_SCHEME;
}

function loadDarkScheme(): DarkChoice {
  try {
    const v = localStorage.getItem(DARK_SCHEME_KEY);
    if (v === "custom-dark" && !loadCustom("dark")) return DEFAULT_DARK_SCHEME;
    if (isDarkChoice(v)) return v;
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
function applyTheme(resolved: ResolvedTheme, scheme: SchemeChoice) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-scheme", scheme);
  root.style.colorScheme = resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  lightScheme: LightChoice;
  darkScheme: DarkChoice;
  /** Своя светлая и своя тёмная — `null`, пока не созданы. */
  customLight: CustomTheme | null;
  customDark: CustomTheme | null;
  setMode: (m: ThemeMode) => void;
  /**
   * Отметить тему для её вида. Вид не переключает: светлую тему можно выбрать
   * и сидя в тёмном — она включится, когда включится светлый вид. Показать
   * тему сразу — вызвать ещё и `setMode` с её видом (так делает палитра).
   */
  setScheme: (id: SchemeChoice) => void;
  /**
   * Сохранить цвета своей темы (`null` — убрать её). Применяется сразу: блок
   * в `<head>` переписывается, и всё, что надето её пометкой, перекрашивается.
   */
  setCustom: (kind: ThemeKind, theme: CustomTheme | null) => void;
  /**
   * Своя тема копией готовой: по умолчанию — выбранной сейчас для этого вида
   * (или той, с которой скопирована прежняя своя). Своя тема при этом
   * отмечается для вида.
   */
  createCustom: (kind: ThemeKind, fromId?: string) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const schemeFor = (resolved: ResolvedTheme): SchemeChoice =>
    resolved === "dark" ? get().darkScheme : get().lightScheme;
  const injectAll = () => injectCustomThemes({ light: get().customLight, dark: get().customDark });
  const resolveMode = (mode: ThemeMode): ResolvedTheme => (mode === "auto" ? resolveAuto() : mode);

  return {
    mode: loadMode(),
    resolved: "light",
    lightScheme: loadLightScheme(),
    darkScheme: loadDarkScheme(),
    customLight: loadCustom("light"),
    customDark: loadCustom("dark"),
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
      // Своя тема, которой ещё нет, — сначала копия текущей.
      if (id === "custom-light" && !get().customLight) return get().createCustom("light");
      if (id === "custom-dark" && !get().customDark) return get().createCustom("dark");
      if (isLightChoice(id)) {
        try {
          localStorage.setItem(LIGHT_SCHEME_KEY, id);
        } catch {
          // ignore
        }
        set({ lightScheme: id });
      } else if (isDarkChoice(id)) {
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
    setCustom: (kind, theme) => {
      const prev = kind === "dark" ? get().customDark : get().customLight;
      if (sameCustomTheme(prev, theme)) return;
      // Ключи — прямо в вызове: сторож полноты бэкапа ищет именно его.
      try {
        if (!theme) localStorage.removeItem(kind === "dark" ? CUSTOM_DARK_KEY : CUSTOM_LIGHT_KEY);
        else if (kind === "dark") localStorage.setItem(CUSTOM_DARK_KEY, JSON.stringify(theme));
        else localStorage.setItem(CUSTOM_LIGHT_KEY, JSON.stringify(theme));
      } catch {
        // ignore
      }
      set(kind === "dark" ? { customDark: theme } : { customLight: theme });
      injectAll();
      // Убрали свою тему, а она отмечена, — назад к готовой, с которой начинали.
      const id = customSchemeId(kind);
      if (!theme && (kind === "dark" ? get().darkScheme : get().lightScheme) === id) {
        const fallback = prev?.base;
        get().setScheme(
          kind === "dark"
            ? isDarkChoice(fallback) && fallback !== id ? fallback : DEFAULT_DARK_SCHEME
            : isLightChoice(fallback) && fallback !== id ? fallback : DEFAULT_LIGHT_SCHEME
        );
      }
    },
    createCustom: (kind, fromId) => {
      const current = kind === "dark" ? get().darkScheme : get().lightScheme;
      const own = kind === "dark" ? get().customDark : get().customLight;
      const base = fromId ?? (current === customSchemeId(kind) ? own?.base : current) ??
        (kind === "dark" ? DEFAULT_DARK_SCHEME : DEFAULT_LIGHT_SCHEME);
      const colors = readSchemeColors(base);
      if (!colors) return;
      get().setCustom(kind, { base, colors });
      get().setScheme(customSchemeId(kind));
    },
    init: () => {
      injectAll();
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
