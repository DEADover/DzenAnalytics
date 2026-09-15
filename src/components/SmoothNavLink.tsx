import { NavLink, type NavLinkProps } from "react-router-dom";
import { useSmoothNavigate } from "../hooks/useSmoothNavigate";

/**
 * Ссылка на раздел с плавной сменой экрана — для шапки, панели «Ещё» и меню
 * телефона. Выглядит и подсвечивается как обычный `NavLink`.
 *
 * `onNavigate` — что сделать в том же кадре, что и переход (закрыть панель,
 * из которой перешли): так панель тает вместе со старым экраном.
 *
 * Клик с Ctrl/⌘/Shift/Alt и средней кнопкой не перехватывается — это
 * «открыть в новой вкладке или окне», и его делает браузер.
 */
export function SmoothNavLink({
  to,
  onNavigate,
  onClick,
  ...rest
}: Omit<NavLinkProps, "to"> & { to: string; onNavigate?: () => void }) {
  const smoothNavigate = useSmoothNavigate();
  return (
    <NavLink
      to={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        smoothNavigate(to, onNavigate);
      }}
    />
  );
}
