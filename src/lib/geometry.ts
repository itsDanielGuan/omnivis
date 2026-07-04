import type { Point, RouteWaypoint } from "@/lib/types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function rotatePoint(p: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

export function polygonCentroid(poly: Point[]): Point {
  const area = polygonArea(poly);
  if (area === 0) return poly[0] ?? { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let factorSum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const factor = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * factor;
    cy += (a.y + b.y) * factor;
    factorSum += factor;
  }
  if (factorSum === 0) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * factorSum), y: cy / (3 * factorSum) };
}

export function pointInPolygon(point: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const pi = poly[i];
    const pj = poly[j];
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

export function segmentIntersectsPolygon(a: Point, b: Point, poly: Point[]): boolean {
  if (poly.length < 3) return false;
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    if (segmentsIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) {
      return true;
    }
  }
  return false;
}

export function polygonApproxRadius(poly: Point[], center = polygonCentroid(poly)): number {
  return Math.max(1, ...poly.map((point) => distance(point, center)));
}

export function translatePolygon(poly: Point[], delta: Point): Point[] {
  return poly.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));
}

export function bounds(points: Point[]) {
  return points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function segmentDistanceToPoint(a: Point, b: Point, p: Point): number {
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSq === 0) return distance(a, p);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSq,
    ),
  );
  return distance(p, lerpPoint(a, b, t));
}

export function segmentIntersectsCircle(
  a: Point,
  b: Point,
  center: Point,
  radius: number,
): boolean {
  return segmentDistanceToPoint(a, b, center) <= radius;
}

export function stripPolygon(start: Point, end: Point, halfWidth: number): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

export function horizontalLinePolygonIntersections(
  poly: Point[],
  y: number,
): number[] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y === b.y) continue;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (y < minY || y >= maxY) continue;
    const ratio = (y - a.y) / (b.y - a.y);
    xs.push(a.x + ratio * (b.x - a.x));
  }
  return xs.sort((a, b) => a - b);
}

export function routeLength(route: Point[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += distance(route[i - 1], route[i]);
  }
  return total;
}

export function interpolateRoute(
  route: RouteWaypoint[],
  timeS: number,
): RouteWaypoint {
  if (route.length === 0) {
    return { x: 0, y: 0, t: timeS, phase: "preflight" };
  }
  if (timeS <= route[0].t) return route[0];
  const last = route[route.length - 1];
  if (timeS >= last.t) return last;

  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    if (timeS <= b.t) {
      const span = Math.max(1, b.t - a.t);
      const ratio = (timeS - a.t) / span;
      const point = lerpPoint(a, b, ratio);
      return {
        ...point,
        t: timeS,
        phase: b.phase,
        stripId: b.stripId,
        label: b.label,
      };
    }
  }
  return last;
}

export function routeHeadingDeg(route: RouteWaypoint[], timeS: number): number {
  if (route.length < 2) return 0;
  const before = interpolateRoute(route, Math.max(0, timeS - 2));
  const after = interpolateRoute(route, timeS + 2);
  const heading = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
  return Number.isFinite(heading) ? heading + 90 : 0;
}

export function routeProgressPct(route: RouteWaypoint[], timeS: number): number {
  const last = route[route.length - 1];
  if (!last || last.t <= 0) return 0;
  return Math.max(0, Math.min(100, (timeS / last.t) * 100));
}

export function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

export function formatMissionClock(seconds: number): string {
  return `T+${formatClock(seconds)}`;
}

export function routeAtOrBefore(route: RouteWaypoint[], timeS: number): RouteWaypoint[] {
  const clipped = route.filter((point) => point.t <= timeS);
  const current = interpolateRoute(route, timeS);
  const last = clipped[clipped.length - 1];
  if (!last || distance(last, current) > 1 || last.t !== current.t) {
    clipped.push(current);
  }
  return clipped;
}
