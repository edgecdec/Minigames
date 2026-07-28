"use client";

import { useTheme } from "@mui/material/styles";
import ChartFrame, { plotRect } from "./ChartFrame";
import { linearScale, niceTicks } from "./chartScale";

export interface HistogramBar {
  lo: number;
  hi: number;
  center: number;
  n: number;
}

/**
 * Distribution over a numeric axis.
 *
 * When `divergeAt` is set, bars either side of it take different colours —
 * for signed error that turns "am I biased?" into something you can see at a
 * glance instead of something you have to read off the axis.
 */
export default function Histogram({
  bars,
  divergeAt,
  formatX = (v) => v.toFixed(0),
  height = 200,
  xTickCount = 5,
}: {
  bars: HistogramBar[];
  divergeAt?: number;
  formatX?: (value: number) => string;
  height?: number;
  xTickCount?: number;
}) {
  const theme = useTheme();
  const plot = plotRect(height);

  if (!bars.length) return null;
  const maxN = Math.max(...bars.map((b) => b.n));
  if (maxN === 0) return null;

  const xDomain: [number, number] = [bars[0].lo, bars[bars.length - 1].hi];
  const xScale = linearScale(xDomain, [plot.x, plot.x + plot.w]);
  const yScale = linearScale([0, maxN], [plot.y + plot.h, plot.y]);

  const barWidth = Math.max(
    1,
    xScale(bars[0].hi) - xScale(bars[0].lo) - 2,
  );

  const gridLines = niceTicks(0, maxN, 3)
    .filter((t) => t > 0)
    .map((t) => ({ y: yScale(t), label: `${Math.round(t)}` }));

  const xLabels = niceTicks(xDomain[0], xDomain[1], xTickCount).map((t) => ({
    x: xScale(t),
    label: formatX(t),
  }));

  const colourFor = (bar: HistogramBar) => {
    if (divergeAt === undefined) return theme.palette.primary.main;
    if (bar.hi <= divergeAt) return theme.palette.secondary.main;
    if (bar.lo >= divergeAt) return theme.palette.warning.main;
    return theme.palette.primary.main;
  };

  return (
    <ChartFrame height={height} gridLines={gridLines} xLabels={xLabels}>
      {bars.map((bar, i) => {
        const h = plot.y + plot.h - yScale(bar.n);
        return (
          <rect
            key={i}
            x={xScale(bar.lo) + 1}
            y={yScale(bar.n)}
            width={barWidth}
            height={Math.max(bar.n > 0 ? 1.5 : 0, h)}
            rx={2}
            fill={colourFor(bar)}
            opacity={0.85}
          />
        );
      })}

      {divergeAt !== undefined ? (
        <line
          x1={xScale(divergeAt)}
          x2={xScale(divergeAt)}
          y1={plot.y}
          y2={plot.y + plot.h}
          stroke={theme.palette.text.primary}
          strokeWidth={1.25}
          strokeDasharray="4 4"
          opacity={0.7}
        />
      ) : null}
    </ChartFrame>
  );
}
