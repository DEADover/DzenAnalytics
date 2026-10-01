import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, Settings2, type LucideIcon } from "lucide-react";
import clsx from "clsx";

export interface HeaderSwitcherItem {
  id: string;
  label: string;
  /** Строка под названием — например, логин аккаунта. */
  hint?: string | null;
  /** Значок перед названием — например, аватар аккаунта. */
  leading?: ReactNode;
}

/**
 * Переключатель в дорожке данных шапки: кнопка с текущим значением и список
 * вариантов под ней. Один на разрезы данных и аккаунты — оба отвечают на
 * вопрос «какие данные сейчас на экране» и обязаны выглядеть одинаково.
 */
export function HeaderSwitcher({
  icon: Icon,
  current,
  title,
  ariaLabel,
  heading,
  items,
  activeId,
  onPick,
  settings,
  face,
}: {
  icon: LucideIcon;
  current: string;
  title: string;
  ariaLabel: string;
  heading: string;
  items: HeaderSwitcherItem[];
  activeId: string;
  onPick: (id: string) => void;
  /**
   * Где этим управляют — значком в строке заголовка. Отдельной строкой под
   * списком ссылка занимала место и читалась ещё одним вариантом выбора.
   */
  settings?: { to: string; label: string };
  /**
   * Своё лицо кнопки вместо значка и названия — у аккаунтов круглый аватар:
   * он узнаётся с одного взгляда и не занимает место под имя.
   */
  face?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Меню рисуем порталом: внутри общей панели шапки стоит `overflow-hidden`
  // (он же делает скруглённые края у сегментов), и выпадающий список просто
  // обрезался бы — кнопка нажималась, но выбирать было нечего.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = btnRef.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth || 320;
      // Ширина — по содержимому, поэтому меряем само меню (до показа оно уже
      // нарисовано невидимым).
      const width = Math.min(menuRef.current?.offsetWidth ?? 224, vw - 16);
      // Раскрывается вправо от кнопки — поверх свободной правой части шапки,
      // а не влево на фильтры и меню разделов. У края экрана прижимается внутрь.
      setPos({ left: Math.min(Math.max(a.left, 8), vw - width - 8), top: a.bottom + 8 });
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

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={title}
        aria-label={ariaLabel}
        // Живёт только внутри дорожки шапки: пункт той же высоты, что значки
        // рядом (32). На телефоне — один значок, без названия.
        className={clsx(
          face ? "seg-item !px-1 py-1" : "seg-item px-2.5 max-sm:px-2 py-2 text-xs leading-4 max-w-[10rem]",
          open && "!bg-accent/10 !text-accent"
        )}
      >
        {face ?? (
          <>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-sm:hidden">{current}</span>
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[95] w-max min-w-[11rem] max-w-[min(16rem,calc(100vw-1rem))] border border-border rounded-xl bg-panel p-1 shadow-xl"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            <div className="flex items-center justify-between gap-2 pl-2 pr-0.5 py-0.5">
              <span className="caps-label">{heading}</span>
              {settings && (
                <Link
                  to={settings.to}
                  onClick={close}
                  title={settings.label}
                  aria-label={settings.label}
                  className="btn-icon btn-icon-xs"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  close();
                  onPick(it.id);
                }}
                className={clsx(
                  "w-full flex items-center justify-between gap-3 px-2 py-1 rounded-md text-sm text-left",
                  it.id === activeId ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
                )}
              >
                <span className="min-w-0 flex items-center gap-2">
                  {it.leading}
                  <span className="min-w-0">
                    <span className="block truncate">{it.label}</span>
                    {it.hint && (
                      <span className="block truncate text-[11px] leading-4 text-muted">{it.hint}</span>
                    )}
                  </span>
                </span>
                {it.id === activeId && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
