import { useEffect } from "react";

/** Сколько слоёв сейчас держат страницу: шторка поверх открытого меню не должна её отпустить. */
let holders = 0;
let restore: (() => void) | null = null;

/**
 * Страница под открытым слоем (шторка операций, панель «Ещё») не прокручивается.
 *
 * Страница прокручивается на `<html>` (у него `overflow-y: scroll`), поэтому
 * запирать один `<body>` мало: полоса оставалась видна и двигала фон. Запираем
 * настоящую прокрутку и оставляем место под её полосу, чтобы фон не прыгал
 * вбок при открытии и закрытии.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (holders++ === 0) {
      const html = document.documentElement;
      const scrollbarW = window.innerWidth - html.clientWidth;
      const prev = {
        htmlOverflow: html.style.overflow,
        htmlPad: html.style.paddingRight,
        bodyOverflow: document.body.style.overflow,
      };
      html.style.overflow = "hidden";
      if (scrollbarW > 0) html.style.paddingRight = `${scrollbarW}px`;
      document.body.style.overflow = "hidden";
      restore = () => {
        html.style.overflow = prev.htmlOverflow;
        html.style.paddingRight = prev.htmlPad;
        document.body.style.overflow = prev.bodyOverflow;
      };
    }
    return () => {
      if (--holders === 0) {
        restore?.();
        restore = null;
      }
    };
  }, [active]);
}
