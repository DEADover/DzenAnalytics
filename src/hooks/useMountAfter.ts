import { useEffect, useState } from "react";
import { EXIT_MS } from "./usePresence";

/**
 * Показать тяжёлое содержимое чуть позже — после того, как доиграет
 * переключение, которое его открыло.
 *
 * Вкладку со списком в сотни строк браузер вставляет одним куском, и пока он
 * раскладывает строки, анимации на странице стоят: подсветка нажатой кнопки
 * застревала на полпути и доезжала рывком. Отложить вставку на время
 * переключения (`--motion-fast`) — и кнопка доигрывает плавно, а список
 * появляется следом.
 *
 * `key` — что открыто: при его смене ожидание начинается заново. При
 * «уменьшить движение» ждать нечего — сразу.
 */
export function useMountAfter(key: string, ms: number = EXIT_MS + 20): boolean {
  const [readyKey, setReadyKey] = useState<string | null>(() => (reducedMotion() ? key : null));
  useEffect(() => {
    if (reducedMotion()) return;
    const t = window.setTimeout(() => setReadyKey(key), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return reducedMotion() || readyKey === key;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
