import clsx from "clsx";

export function Sparkline({
  data,
  change,
  width = 92,
  height = 34,
  detailed = false,
  period = "seven-day",
}: {
  data: Array<number | null>;
  change: number | null;
  width?: number;
  height?: number;
  detailed?: boolean;
  period?: "seven-day" | "seven-hour";
}) {
  const points = data
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value != null);

  if (points.length < 2) {
    return (
      <div
        className={clsx("sparkline-empty", detailed && "sparkline-empty--large")}
        style={{ width, height }}
      >
        <span>Not enough data</span>
      </div>
    );
  }

  const minimum = Math.min(...points.map((point) => point.value));
  const maximum = Math.max(...points.map((point) => point.value));
  const range = maximum - minimum || 1;
  const padding = detailed ? 8 : 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const coordinates = points.map((point) => ({
    x: padding + (point.index / Math.max(1, data.length - 1)) * plotWidth,
    y: padding + ((maximum - point.value) / range) * plotHeight,
  }));
  const line = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const area = `${line} L${coordinates.at(-1)?.x},${height - padding} L${coordinates[0].x},${height - padding} Z`;
  const tone = change == null ? "neutral" : change >= 0 ? "positive" : "negative";

  return (
    <svg
      className={clsx("sparkline", `sparkline--${tone}`)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${change == null ? "Unknown" : `${change.toFixed(1)} percent`} ${period} price change`}
    >
      {detailed && (
        <>
          <line className="sparkline-grid" x1={padding} x2={width - padding} y1={padding} y2={padding} />
          <line
            className="sparkline-grid"
            x1={padding}
            x2={width - padding}
            y1={height / 2}
            y2={height / 2}
          />
          <line
            className="sparkline-grid"
            x1={padding}
            x2={width - padding}
            y1={height - padding}
            y2={height - padding}
          />
        </>
      )}
      <path className="sparkline-area" d={area} />
      <path className="sparkline-line" d={line} />
      {detailed && coordinates.at(-1) && (
        <circle
          className="sparkline-dot"
          cx={coordinates.at(-1)!.x}
          cy={coordinates.at(-1)!.y}
          r="3"
        />
      )}
    </svg>
  );
}
