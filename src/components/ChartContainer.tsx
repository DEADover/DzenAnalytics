import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Контейнер графика на всё место родителя — единственный способ ставить
 * графики Recharts в панели (вместо ResponsiveContainer напрямую).
 *
 * ResponsiveContainer до первого замера считает размер −1×−1 и пишет в
 * консоль «The width(-1) and height(-1) of chart should be greater than 0» —
 * у каждого графика при каждом появлении. Здесь место меряется до первой
 * отрисовки (useLayoutEffect), и график сразу получает настоящий размер.
 * Скрытый родитель (0×0) — размер 1×1: график появится, как только родитель
 * станет видимым, — дальше размер ведёт ResizeObserver самого Recharts.
 */
export function ChartContainer({ children }: { children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [initial, setInitial] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    setInitial({ width: Math.max(1, r?.width ?? 0), height: Math.max(1, r?.height ?? 0) });
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {initial && <ResponsiveContainer initialDimension={initial}>{children}</ResponsiveContainer>}
    </div>
  );
}
