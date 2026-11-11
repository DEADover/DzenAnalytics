import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Поле ввода, которое пишет в общее состояние не на каждую букву, а через
 * паузу: запись в общий фильтр пересчитывает все разделы, и на большом
 * аккаунте набор начинал запаздывать.
 *
 * Возвращает значение для поля и обработчик ввода. Пришло новое значение
 * снаружи (сброс фильтров, сохранённый вид) — поле берёт его сразу. `now` —
 * записать без паузы (кнопка очистки). Ушли со страницы, не дождавшись паузы,
 * — набранное всё равно записывается.
 */
export function useDebouncedField(
  value: string,
  commit: (v: string) => void,
  delayMs = 200
): [string, (v: string, now?: boolean) => void] {
  const [local, setLocal] = useState(value);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; v: string } | null>(null);
  /** Что поле записало само — его эхо снаружи не считается чужой правкой. */
  const sent = useRef(value);
  const commitTo = useRef(commit);
  useLayoutEffect(() => {
    commitTo.current = commit;
  });
  const commitRef = useRef((v: string) => {
    sent.current = v;
    commitTo.current(v);
  });

  // Значение поменяли снаружи — показываем его, отложенная запись отменяется.
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
    setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      commitRef.current(pending.current.v);
      pending.current = null;
    },
    []
  );

  const onChange = useCallback(
    (v: string, now = false) => {
      setLocal(v);
      if (pending.current) clearTimeout(pending.current.timer);
      if (now) {
        pending.current = null;
        commitRef.current(v);
        return;
      }
      const timer = setTimeout(() => {
        pending.current = null;
        commitRef.current(v);
      }, delayMs);
      pending.current = { timer, v };
    },
    [delayMs]
  );

  return [local, onChange];
}
