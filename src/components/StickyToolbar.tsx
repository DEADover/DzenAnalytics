import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Строка поиска и кнопок над длинным списком, которая не уезжает при
 * прокрутке: липнет под шапкой сервиса (`--app-header-h`).
 *
 * Свою высоту отдаёт родителю в `--toolbar-h` — шапка колонок списка липнет
 * сразу под ней (класс `sticky-under-toolbar`). Высота
 * меряется: на узком окне кнопки переносятся, и строка бывает в две строки.
 *
 * Фон — цвет карточки и поля во всю её внутреннюю ширину (`-mx-5 px-5`, как у
 * `card-pad`): строки списка уходят под строку поиска, а не просвечивают по
 * краям. Для липкости все рамки списка ниже обязаны резать содержимое через
 * `overflow-clip`, а не `overflow-hidden`: второе делает рамку своей
 * прокруткой, и прилипать становится не к чему.
 */
export function StickyToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const apply = () => host.style.setProperty("--toolbar-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty("--toolbar-h");
    };
  }, []);
  return (
    <div
      ref={ref}
      data-sticky-toolbar
      className="sticky z-20 bg-panel -mx-5 px-5 py-2 -my-2 flex items-center gap-2 flex-wrap"
      style={{ top: "var(--app-header-h)" }}
    >
      {children}
    </div>
  );
}
