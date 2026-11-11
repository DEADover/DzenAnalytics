import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { withViewTransition } from "../lib/viewTransition";
import { lazyPageFor } from "../lazyPages";

/**
 * Перейти в раздел плавно: старый экран гаснет, новый проявляется
 * (`withViewTransition`), и новый раздел открывается с начала страницы.
 *
 * `after` выполняется в том же кадре, что и переход, — туда кладут закрытие
 * панели или меню, из которых перешли: тогда они тают вместе со старым экраном.
 */
export function useSmoothNavigate() {
  const { pathname } = useLocation();
  const go = useGo();
  return useCallback(
    (to: string, after?: () => void) => {
      // Код раздела ещё не пришёл — сначала дожидаемся его: внутри смены
      // кадров страница рисуется сразу, и вместо неё мелькнула бы заглушка.
      const page = to !== pathname ? lazyPageFor(to) : undefined;
      if (page && !page.loaded()) {
        void page.preload().then(
          () => go(to, after),
          () => {}
        );
        return;
      }
      go(to, after);
    },
    [go, pathname]
  );
}

function useGo() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (to: string, after?: () => void) => {
      withViewTransition(() => {
        if (to !== pathname) {
          navigate(to);
          // Без этого новый раздел открывался на той же высоте, до которой
          // пролистали прежний, — и часто где-то в середине.
          window.scrollTo(0, 0);
        }
        after?.();
      });
    },
    [navigate, pathname]
  );
}
