interface Props {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  /** Шкала от нуля (по умолчанию). `false` — от наименьшего значения ряда:
   *  для показателей, которые ходят в узком коридоре далеко от нуля. */
  zeroBased?: boolean;
}

export function Sparkline({
  data,
  color = "rgb(var(--c-accent))",
  width = 80,
  height = 24,
  zeroBased = true,
}: Props) {
  if (data.length === 0) return <div style={{ width, height }} />;
  const min = zeroBased ? Math.min(...data, 0) : Math.min(...data);
  const max = zeroBased ? Math.max(...data, 0) : Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = data[data.length - 1];
  const lastX = (data.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * height;

  const zeroY = height - ((0 - min) / range) * height;
  const showZero = min < 0 && max > 0;

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      {showZero && (
        <line
          x1={0}
          x2={width}
          y1={zeroY}
          y2={zeroY}
          stroke="rgb(var(--c-border))"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}
