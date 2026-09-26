import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Помещается ли блок в окно под шапкой целиком.
 *
 * Закреплённая (`sticky`) колонка выше окна прячет свой низ: он не виден, пока
 * не докрутишь страницу до самого конца. Такую колонку закрепляем, только
 * когда она влезает, — на высоком экране результат всегда на виду, на низком
 * колонка просто прокручивается вместе со страницей.
 */
export function useFitsViewport(ref: RefObject<HTMLElement | null>, gap = 24): boolean {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // Шапка пишет свою высоту в пикселях; до этого в переменной стоит
      // запасное значение из CSS в rem.
      const root = getComputedStyle(document.documentElement);
      const raw = root.getPropertyValue("--app-header-h").trim();
      const header = (parseFloat(raw) || 0) * (raw.endsWith("rem") ? parseFloat(root.fontSize) : 1);
      setFits(el.offsetHeight + header + gap <= window.innerHeight);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [ref, gap]);
  return fits;
}
