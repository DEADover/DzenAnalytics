import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Layers, Check, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";

/**
 * Переключатель разреза данных в шапке (issue #14).
 *
 * Появляется, только когда разрезов больше одного: у большинства он один,
 * и постоянная плашка «Все данные» была бы шумом. Пока разрез один, всё
 * работает как раньше, и в шапке ничего не прибавляется.
 */
export function SliceSwitcher({ inline = false }: { inline?: boolean }) {
  const slices = useSlicesStore((s) => s.slices);
  const activeId = useSlicesStore((s) => s.activeId);
  const setActive = useSlicesStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Меню рисуем порталом: внутри общей панели шапки стоит `overflow-hidden`
  // (он же делает скруглённые края у сегментов), и выпадающий список просто
  // обрезался — кнопка нажималась, но выбирать было нечего.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = btnRef.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth || 320;
      const width = Math.min(256, vw - 16);
      setPos({ left: Math.min(Math.max(a.right - width, 8), vw - width - 8), top: a.bottom + 8 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (slices.length < 2) return null;
  const current = activeSlice({ slices, activeId });

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Разрез данных — что учитывается в аналитике"
        className={clsx(
          "flex items-center gap-1.5 text-xs max-w-[10rem]",
          // Внутри общей панели своя рамка не нужна — её даёт панель.
          inline
            ? clsx(
                "px-2.5 py-1.5",
                open ? "bg-accent/10 text-accent" : "text-muted hover:text-accent hover:bg-accent/10"
              )
            : clsx(
                "px-2 py-1.5 rounded-lg border",
                open
                  ? "bg-accent/10 border-accent/30 text-accent"
                  : "border-border bg-panel2 text-muted hover:text-accent hover:border-accent/50"
              )
        )}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{current.name}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[95] w-64 max-w-[calc(100vw-1rem)] border border-border rounded-xl bg-panel p-1.5 shadow-xl"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
          >
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted">
            Разрез данных
          </div>
          {slices.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                void setActive(s.id);
                setOpen(false);
              }}
              className={clsx(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
                s.id === activeId
                  ? "bg-accent/10 text-accent"
                  : "text-text hover:bg-panel2"
              )}
            >
              <span className="truncate">{s.name}</span>
              {s.id === activeId && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
          <div className="border-t border-border/60 mt-1 pt-1">
            <Link
              to="/settings?tab=processing"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted hover:bg-panel2 hover:text-text"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Настроить
            </Link>
          </div>
          </div>,
          document.body
        )}
    </div>
  );
}
