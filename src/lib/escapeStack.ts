import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Escape закрывает только верхний слой — окно, список, календарь, панель.
 *
 * Раньше каждый слой слушал клавишу на `window` сам, и календарь в окне
 * операции закрывался вместе с окном: оба получали одно нажатие. Здесь слушатель
 * один, а слои стоят в порядке открытия; нажатие достаётся последнему.
 *
 * Обработчик слоя может вернуть `false` — «клавишу забрал, но не закрываюсь»
 * (окно занято работой): нижние слои её тоже не получают.
 *
 * Слушатель — на всплытии: поле, которое само отвечает на Escape (отменить
 * набор, спрятать подсказку) и гасит событие, до стека его не пускает.
 */
type Handler = () => void | boolean;

const layers: { handler: { current: Handler } }[] = [];
let listening = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  top.handler.current();
}

/** Сколько слоёв открыто — для тестов и проверок «что-то поверх страницы». */
export function escapeLayerCount(): number {
  return layers.length;
}

/** Слой открыт, пока `active`; Escape вызовет `onEscape`, если он верхний. */
export function useEscapeLayer(active: boolean, onEscape: Handler): void {
  const handler = useRef(onEscape);
  useLayoutEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const layer = { handler };
    layers.push(layer);
    if (!listening && typeof window !== "undefined") {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    return () => {
      const i = layers.lastIndexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active]);
}
