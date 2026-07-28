"use client";

import { useTheme } from "@mui/material/styles";
import ChartFrame, { plotRect } from "./ChartFrame";
import { bandPath, linePath, linearScale, niceTicks } from "./chartScale";

export interface Band {
  x: number;
  mean: number;
  /** Half-width of the shaded ribbon, typically one standard deviation. */
  sd: number;
  /** Sample count. Bands with none are drawn as gaps, not as zero. */
  n: number;
}

/**
 * A mean line with a ±sd ribbon, optionally over the raw points it came from.
 *
 * The shape that answers "is my error systematic here, or just noisy?" — a
 * bare mean line hides the difference and a bare scatter buries it.
 */
export default function BandChart({
  bands,
  scatter = [],
  xDomain,
  yDomain,
  xTicks,
  formatY = (v) => v.toFixed(0),
  height = 220,
}: {
  bands: Band[];
  scatter?: { x: number; y: number }[];
  xDomain: [number, number];
  /** Defaults to a symmetric domain fitted around the data. */
  yDomain?: [number, number];
  xTicks: { value: number; label: string }[];
  formatY?: (value: number) => string;
  height?: number;
}) {
  const theme = useTheme();
  const plot = plotRect(height);

  const populated = bands.filter((b) => b.n > 0);
  if (!populated.length) return null;

  const reach = Math.max(
    ...populated.map((b) => Math.abs(b.mean) + b.sd),
    ...scatter.map((p) => Math.abs(p.y)),
    25,
  );
  const domain = yDomain ?? ([-reach * 1.1, reach * 1.1] as [number, number]);

  const xScale = linearScale(xDomain, [plot.x, plot.x + plot.w]);
  const yScale = linearScale(domain, [plot.y + plot.h, plot.y]);
  const clampY = (v: number) =>
    Math.min(plot.y + plot.h, Math.max(plot.y, yScale(v)));

  const ribbon = bandPath(
    populated.map((b) => ({
      x: xScale(b.x),
      upper: clampY(b.mean + b.sd),
      lower: clampY(b.mean - b.sd),
    })),
  );

  const meanLine = linePath(
    populated.map((b) => ({ x: xScale(b.x), y: clampY(b.mean) })),
  );

  const maxN = Math.max(...populated.map((b) => b.n));

  const gridLines = niceTicks(domain[0], domain[1], 4)
    .filter((t) => Math.abs(t) > 1e-9)
    .map((t) => ({ y: yScale(t), label: formatY(t) }));

  return (
    <ChartFrame
      height={height}
      gridLines={gridLines}
      xLabels={xTicks.map((t) => ({ x: xScale(t.value), label: t.label }))}
      zeroLineY={yScale(0)}
    >
      {scatter.map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.x)}
          cy={clampY(p.y)}
          r={1.6}
          fill={theme.palette.text.secondary}
          opacity={0.28}
        />
      ))}

      {ribbon ? (
        <path d={ribbon} fill={theme.palette.secondary.main} opacity={0.16} />
      ) : null}

      <path
        d={meanLine}
        fill="none"
        stroke={theme.palette.secondary.main}
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dot size carries sample count, so a band built on two guesses doesn't
          read as confidently as one built on two hundred. */}
      {populated.map((b, i) => (
        <circle
          key={i}
          cx={xScale(b.x)}
          cy={clampY(b.mean)}
          r={2.5 + 2.5 * Math.sqrt(b.n / maxN)}
          fill={theme.palette.secondary.main}
          stroke={theme.palette.background.paper}
          strokeWidth={1.25}
        />
      ))}
    </ChartFrame>
  );
}
