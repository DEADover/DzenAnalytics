import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Global keyboard shortcuts: ⌘/Ctrl+K and `/` open the palette; `g` followed
 * by a single key (within 1.5s) navigates to a known route.
 *
 * Lives in its own file (not in CommandPalette.tsx) so the component file
 * exports only React components — required for Vite/React fast-refresh.
 */
/** Куда ведёт `g` + клавиша. Снаружи обработчика — таблица неизменна, и
 *  пересобирать её на каждое нажатие незачем. */
const GOTO: Record<string, string> = {
  d: "/",
  o: "/transactions",
  a: "/accounts",
  k: "/categories",
  c: "/cashflow",
  t: "/trends",
  b: "/budgets",
  g: "/goals",
  l: "/calendar",
  r: "/recurring",
  s: "/search",
  i: "/settings",
  h: "/help",
};

export function useGlobalShortcuts(onOpenPalette: () => void) {
  const nav = useNavigate();

  useEffect(() => {
    let lastG = 0;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCtrlK) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      const now = Date.now();
      const armed = lastG !== 0 && now - lastG < 1500;

      // Ждущую приставку проверяем ДО ветки «нажали g».
      //
      // Раньше порядок был обратный, и `g g` («Цели») не работало вовсе: второе
      // `g` попадало в ветку «начать комбинацию» и просто перезаводило таймер,
      // так что до таблицы дело не доходило. Пункт `g: "/goals"` в ней лежал
      // недостижимым.
      if (armed) {
        const dest = GOTO[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          nav(dest);
          lastG = 0;
          return;
        }
      }

      if (e.key === "g") {
        lastG = now;
        return;
      }
      // Любая другая клавиша снимает приставку: иначе `g`, потом что-то
      // постороннее — и следующая клавиша в пределах полутора секунд всё ещё
      // считалась бы второй половиной комбинации.
      lastG = 0;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, onOpenPalette]);
}
