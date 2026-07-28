"use client";

import { useId } from "react";
import { useTheme } from "@mui/material/styles";
import ChartFrame, { plotRect } from "./ChartFrame";
import { linePath, linearScale, niceTicks, rollingMean } from "./chartScale";

/**
 * A value per event, in order, with an optional trend line over it.
 *
 * Built for "how am I doing over time" series where the x axis is just an
 * index — run 1, run 2, run 3 — rather than real time.
 */
export default function LineChart({
  points,
  yMin,
  yMax,
  formatY = (v) => v.toFixed(0),
  trendWindow = 5,
  height = 200,
  xUnit = "run",
}: {
  points: number[];
  yMin?: number;
  yMax?: number;
  formatY?: (value: number) => string;
  /** Rolling-mean width. 0 hides the trend line. */
  trendWindow?: number;
  height?: number;
  xUnit?: string;
}) {
  const theme = useTheme();
  const gradientId = useId();
  const plot = plotRect(height);

  if (points.length === 0) return null;

  const lo = yMin ?? Math.min(...points);
  const hi = yMax ?? Math.max(...points);
  // A flat series would otherwise collapse to a zero-height domain.
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.1) : (hi - lo) * 0.08;
  const domain: [number, number] = [
    yMin ?? lo - pad,
    yMax ?? hi + pad,
  ];

  const xScale = linearScale(
    [0, Math.max(1, points.length - 1)],
    [plot.x, plot.x + plot.w],
  );
  const yScale = linearScale(domain, [plot.y + plot.h, plot.y]);

  const coords = points.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
  const trend =
    trendWindow > 1 && points.length > 2
      ? rollingMean(points, trendWindow).map((v, i) => ({
          x: xScale(i),
          y: yScale(v),
        }))
      : [];

  const area = `${linePath(coords)} L${(plot.x + plot.w).toFixed(2)} ${(
    plot.y + plot.h
  ).toFixed(2)} L${plot.x.toFixed(2)} ${(plot.y + plot.h).toFixed(2)} Z`;

  const gridLines = niceTicks(domain[0], domain[1], 4).map((t) => ({
    y: yScale(t),
    label: formatY(t),
  }));

  // Only a handful of x labels, however long the history gets.
  const xLabels = (
    points.length <= 6
      ? points.map((_, i) => i)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  ).map((i) => ({ x: xScale(i), label: `${i + 1}` }));

  return (
    <ChartFrame height={height} gridLines={gridLines} xLabels={xLabels}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.35} />
          <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={linePath(coords)}
        fill="none"
        stroke={theme.palette.primary.main}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {trend.length ? (
        <path
          d={linePath(trend)}
          fill="none"
          stroke={theme.palette.secondary.main}
          strokeWidth={1.75}
          strokeDasharray="5 4"
          opacity={0.9}
        />
      ) : null}

      {/* Individual markers become noise past a few dozen points. */}
      {coords.length <= 40
        ? coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={2.75}
              fill={theme.palette.background.paper}
              stroke={theme.palette.primary.main}
              strokeWidth={1.75}
            />
          ))
        : null}

      <text
        x={plot.x + plot.w}
        y={plot.y + plot.h + 18}
        textAnchor="end"
        fontSize={9}
        fill={theme.palette.text.secondary}
        opacity={0.75}
      >
        {xUnit} →
      </text>
    </ChartFrame>
  );
}
