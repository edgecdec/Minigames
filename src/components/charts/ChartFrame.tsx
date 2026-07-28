"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

/**
 * Charts draw into a fixed 640-wide coordinate system and scale to fit their
 * container. Text scales with it, which is fine at the sizes these run at and
 * saves every chart from needing a ResizeObserver.
 */
export const CHART_WIDTH = 640;

export const CHART_PADDING = { left: 50, right: 16, top: 14, bottom: 30 };

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function plotRect(height: number): PlotRect {
  return {
    x: CHART_PADDING.left,
    y: CHART_PADDING.top,
    w: CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right,
    h: height - CHART_PADDING.top - CHART_PADDING.bottom,
  };
}

/** Titled surface every chart sits on, so the stats page reads as one thing. */
export function ChartCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2, borderRadius: 3, bgcolor: "background.paper" }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: "0.72rem",
            }}
          >
            {title}
          </Typography>
          {hint ? (
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          ) : null}
        </Box>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/**
 * Axes, gridlines and labels. Positions arrive already converted to pixels —
 * the caller owns the scales, since only it knows its own domain.
 */
export default function ChartFrame({
  height,
  gridLines = [],
  xLabels = [],
  zeroLineY,
  children,
}: {
  height: number;
  gridLines?: { y: number; label: string }[];
  xLabels?: { x: number; label: string }[];
  /** Emphasised horizontal rule, e.g. "no error" on a signed-error chart. */
  zeroLineY?: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const plot = plotRect(height);

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      sx={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
      role="img"
    >
      {gridLines.map((g) => (
        <g key={`${g.label}-${g.y}`}>
          <line
            x1={plot.x}
            x2={plot.x + plot.w}
            y1={g.y}
            y2={g.y}
            stroke={theme.palette.divider}
            strokeWidth={1}
          />
          <text
            x={plot.x - 8}
            y={g.y + 3.5}
            textAnchor="end"
            fontSize={10}
            fill={theme.palette.text.secondary}
          >
            {g.label}
          </text>
        </g>
      ))}

      {zeroLineY !== undefined ? (
        <line
          x1={plot.x}
          x2={plot.x + plot.w}
          y1={zeroLineY}
          y2={zeroLineY}
          stroke={theme.palette.text.secondary}
          strokeWidth={1.25}
          strokeDasharray="4 4"
          opacity={0.8}
        />
      ) : null}

      {children}

      {xLabels.map((l) => (
        <text
          key={`${l.label}-${l.x}`}
          x={l.x}
          y={plot.y + plot.h + 18}
          textAnchor="middle"
          fontSize={10}
          fill={theme.palette.text.secondary}
        >
          {l.label}
        </text>
      ))}
    </Box>
  );
}
