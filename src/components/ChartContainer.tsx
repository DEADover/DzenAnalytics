import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactElement } from "react";
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
 *
 * Смена данных — мягкая: когда у графика сменился сам набор точек (другой
 * период, другой разрез), новый график проявляется из лёгкого размытия, а
 * не подменяет старый рывком. Собственная анимация Recharts выключена во всех
 * графиках — она рисовала их заново с нуля при каждом обновлении. Если
 * поменялись только суммы (подгрузились курсы, правка операции), график не
 * мигает: сравниваются подписи точек, а не числа.
 */
export function ChartContainer({ children }: { children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [initial, setInitial] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    setInitial({ width: Math.max(1, r?.width ?? 0), height: Math.max(1, r?.height ?? 0) });
  }, []);

  const shape = chartShape(children);
  const lastShape = useRef(shape);
  useLayoutEffect(() => {
    if (shape === lastShape.current) return;
    lastShape.current = shape;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Длительность и кривая — общие для движения (index.css).
    const root = getComputedStyle(document.documentElement);
    el.animate(
      [
        { opacity: 0.35, filter: "blur(2px)" },
        { opacity: 1, filter: "blur(0)" },
      ],
      {
        duration: parseFloat(root.getPropertyValue("--motion-base")) || 250,
        easing: root.getPropertyValue("--ease-soft").trim() || "ease-out",
      }
    );
  }, [shape]);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {initial && <ResponsiveContainer initialDimension={initial}>{children}</ResponsiveContainer>}
    </div>
  );
}

/**
 * Данные графика: у линий и столбцов — `data` самого графика, у кольца — у
 * его секторов (`<Pie data>`), у потоков — узлы.
 */
function chartShape(chart: ReactElement): string {
  const props = chart.props as { data?: unknown; children?: unknown };
  if (props.data !== undefined) return dataShape(props.data);
  let out = "";
  Children.forEach(props.children as ReactElement[], (c) => {
    if (isValidElement(c)) out += dataShape((c.props as { data?: unknown }).data);
  });
  return out;
}

/**
 * «Форма» набора точек: их число и подписи (текстовые поля — месяц, дата,
 * название), без чисел. Меняется при смене периода или разреза и не
 * меняется, когда пересчитались суммы.
 */
function dataShape(data: unknown): string {
  if (data && typeof data === "object" && Array.isArray((data as { nodes?: unknown }).nodes))
    return dataShape((data as { nodes: unknown[] }).nodes);
  if (!Array.isArray(data)) return "";
  let out = String(data.length);
  for (const d of data) {
    if (!d || typeof d !== "object") continue;
    for (const v of Object.values(d)) if (typeof v === "string") out += "|" + v;
    out += ";";
  }
  return out;
}
