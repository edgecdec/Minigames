/**
 * Minimal scale helpers for the SVG charts in this folder.
 *
 * Deliberately not a charting library — the site has four dependencies and a
 * handful of `<path d="...">` builders is cheaper than a fifth.
 */

export type Scale = (value: number) => number;

/** Maps a value domain onto a pixel range. Flip the range to invert an axis. */
export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Rounded tick values covering [min, max], roughly `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }

  const rawStep = (max - min) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const step =
    (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) *
    magnitude;

  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) {
    // Kill floating-point crumbs like 0.30000000000000004.
    ticks.push(Math.round(t / step) * step);
  }
  return ticks;
}

/** Builds an SVG path through points, skipping gaps where y is not finite. */
export function linePath(points: { x: number; y: number }[]): string {
  let path = "";
  let penDown = false;

  for (const p of points) {
    if (!Number.isFinite(p.y)) {
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    penDown = true;
  }

  return path.trim();
}

/** Closed path for a ±band around a series (mean ± sd, min/max, ...). */
export function bandPath(
  points: { x: number; upper: number; lower: number }[],
): string {
  const usable = points.filter(
    (p) => Number.isFinite(p.upper) && Number.isFinite(p.lower),
  );
  if (usable.length < 2) return "";

  const top = usable.map((p) => `${p.x.toFixed(2)} ${p.upper.toFixed(2)}`);
  const bottom = [...usable]
    .reverse()
    .map((p) => `${p.x.toFixed(2)} ${p.lower.toFixed(2)}`);

  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

/** Trailing rolling mean — smooths a noisy per-run series into a trend. */
export function rollingMean(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}
