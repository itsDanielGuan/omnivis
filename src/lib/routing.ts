import {
  distance,
  pointInPolygon,
  routeLength,
  segmentIntersectsCircle,
  segmentIntersectsPolygon,
} from "@/lib/geometry";
import type {
  BaseWaypoint,
  BaseWaypointMode,
  HomeBase,
  MissionConfig,
  Nfz,
  Point,
  RouteWaypoint,
} from "@/lib/types";

type WaypointDirection = "outbound" | "inbound";

export function normalizeHomeBase(base: HomeBase): HomeBase {
  const outboundWaypoints = Array.isArray(base.outboundWaypoints)
    ? base.outboundWaypoints
    : [];
  const inboundWaypoints = Array.isArray(base.inboundWaypoints)
    ? base.inboundWaypoints
    : [];
  const waypointMode: BaseWaypointMode =
    base.waypointMode === "round_robin" || base.waypointMode === "specific"
      ? base.waypointMode
      : "nearest_safe";

  return {
    ...base,
    available: base.available !== false,
    outboundWaypoints,
    inboundWaypoints,
    waypointMode,
    specificOutboundWaypointId: outboundWaypoints.some(
      (waypoint) => waypoint.id === base.specificOutboundWaypointId,
    )
      ? base.specificOutboundWaypointId
      : undefined,
    specificInboundWaypointId: inboundWaypoints.some(
      (waypoint) => waypoint.id === base.specificInboundWaypointId,
    )
      ? base.specificInboundWaypointId
      : undefined,
  };
}

export function homeBaseFromPoint(point: Point, label = "Base"): HomeBase {
  return {
    id: "base-default",
    label,
    point,
    available: true,
    outboundWaypoints: [],
    inboundWaypoints: [],
    waypointMode: "nearest_safe",
  };
}

export function segmentIntersectsNfz(a: Point, b: Point, nfz: Nfz): boolean {
  if (nfz.polygon?.length) {
    return segmentIntersectsPolygon(a, b, nfz.polygon);
  }
  return segmentIntersectsCircle(a, b, nfz.center, nfz.radiusM);
}

export function pointInsideNfz(point: Point, nfz: Nfz): boolean {
  if (nfz.polygon?.length) return pointInPolygon(point, nfz.polygon);
  return distance(point, nfz.center) <= nfz.radiusM;
}

function routeWaypoint(
  point: Point,
  t: number,
  phase: RouteWaypoint["phase"],
  extra?: Partial<RouteWaypoint>,
): RouteWaypoint {
  return { ...point, t, phase, ...extra };
}

function firstBlockingNfz(a: Point, b: Point, nfzs: Nfz[]): Nfz | undefined {
  return nfzs.find((nfz) => segmentIntersectsNfz(a, b, nfz));
}

function fallbackDetourPoints(
  a: Point,
  b: Point,
  nfz: Nfz,
  side: number,
  clearanceM: number,
): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * side;
  const py = ux * side;
  const radius = Math.max(nfz.radiusM, 1);
  const offset = radius + clearanceM;

  return [
    {
      x: nfz.center.x - ux * offset + px * offset,
      y: nfz.center.y - uy * offset + py * offset,
    },
    {
      x: nfz.center.x + ux * offset + px * offset,
      y: nfz.center.y + uy * offset + py * offset,
    },
  ];
}

function pathLengthWithEndpoints(a: Point, b: Point, points: Point[]): number {
  return routeLength([a, ...points, b]);
}

function candidateIsSafe(
  a: Point,
  b: Point,
  detours: Point[],
  nfzs: Nfz[],
): boolean {
  if (detours.some((point) => nfzs.some((nfz) => pointInsideNfz(point, nfz)))) {
    return false;
  }

  const points = [a, ...detours, b];
  for (let index = 1; index < points.length; index += 1) {
    if (firstBlockingNfz(points[index - 1], points[index], nfzs)) return false;
  }
  return true;
}

function pointOnCircle(center: Point, radius: number, angle: number): Point {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function arcSweep(from: number, to: number, side: number): number {
  const full = Math.PI * 2;
  const positive = ((to - from) % full + full) % full;
  return side >= 0 ? positive : positive - full;
}

function circleDetourCandidate(
  a: Point,
  b: Point,
  nfz: Nfz,
  side: number,
  clearanceM: number,
): Point[] {
  const radius = Math.max(nfz.radiusM + clearanceM, nfz.radiusM + 25);
  const startAngle = Math.atan2(a.y - nfz.center.y, a.x - nfz.center.x);
  const endAngle = Math.atan2(b.y - nfz.center.y, b.x - nfz.center.x);
  const sweep = arcSweep(startAngle, endAngle, side);
  const segmentCount = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 5)));

  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    pointOnCircle(nfz.center, radius, startAngle + (sweep * index) / segmentCount),
  );
}

function expandedPolygon(nfz: Nfz, clearanceM: number): Point[] {
  const polygon = nfz.polygon ?? [];
  return polygon.map((point) => {
    const dx = point.x - nfz.center.x;
    const dy = point.y - nfz.center.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * clearanceM,
      y: point.y + (dy / length) * clearanceM,
    };
  });
}

function sampledCircleEnvelope(nfz: Nfz, clearanceM: number): Point[] {
  const radius = Math.max(nfz.radiusM + clearanceM, nfz.radiusM + 25);
  return Array.from({ length: 16 }, (_, index) =>
    pointOnCircle(nfz.center, radius, (Math.PI * 2 * index) / 16),
  );
}

function nfzEnvelopePoints(nfz: Nfz, clearanceM: number): Point[] {
  if (nfz.polygon?.length) return expandedPolygon(nfz, clearanceM);
  return sampledCircleEnvelope(nfz, clearanceM);
}

function nfzEnvelopesTouch(a: Nfz, b: Nfz, clearanceM: number): boolean {
  const clusterBufferM = Math.max(180, clearanceM * 2.5);
  return distance(a.center, b.center) <= a.radiusM + b.radiusM + clusterBufferM;
}

function nfzCluster(seed: Nfz, nfzs: Nfz[], clearanceM: number): Nfz[] {
  const cluster: Nfz[] = [];
  const queue: Nfz[] = [seed];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    cluster.push(current);

    nfzs.forEach((candidate) => {
      if (seen.has(candidate.id)) return;
      const touchesCluster = cluster.some((member) =>
        nfzEnvelopesTouch(member, candidate, clearanceM),
      );
      if (touchesCluster) queue.push(candidate);
    });
  }

  return cluster;
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points]
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    .filter(
      (point, index, all) =>
        index === 0 || distance(point, all[index - 1]) > 0.5,
    );
  if (sorted.length <= 3) return sorted;

  const lower: Point[] = [];
  sorted.forEach((point) => {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });

  const upper: Point[] = [];
  [...sorted].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function pointsCenter(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

function closestVertexIndex(points: Point[], target: Point): number {
  return points.reduce((bestIndex, point, index) => {
    const best = points[bestIndex];
    return distance(point, target) < distance(best, target) ? index : bestIndex;
  }, 0);
}

function polygonVertexChain(
  points: Point[],
  startIndex: number,
  endIndex: number,
  step: 1 | -1,
): Point[] {
  const chain: Point[] = [];
  let index = startIndex;
  for (let guard = 0; guard <= points.length; guard += 1) {
    chain.push(points[index]);
    if (index === endIndex) break;
    index = (index + step + points.length) % points.length;
  }
  return chain;
}

function polygonPathCandidate(
  a: Point,
  b: Point,
  polygon: Point[],
  side: number,
): Point[] {
  if (polygon.length < 3) return [];
  const startIndex = closestVertexIndex(polygon, a);
  const endIndex = closestVertexIndex(polygon, b);
  return polygonVertexChain(polygon, startIndex, endIndex, side >= 0 ? 1 : -1);
}

function polygonDetourCandidate(
  a: Point,
  b: Point,
  nfz: Nfz,
  side: number,
  clearanceM: number,
): Point[] {
  const expanded = expandedPolygon(nfz, clearanceM);
  if (expanded.length < 3) return circleDetourCandidate(a, b, nfz, side, clearanceM);

  return polygonPathCandidate(a, b, expanded, side);
}

function clusterFallbackDetourPoints(
  a: Point,
  b: Point,
  seed: Nfz,
  hull: Point[],
  side: number,
  clearanceM: number,
): Point[] {
  const center = hull.length > 0 ? pointsCenter(hull) : seed.center;
  const radiusM = Math.max(seed.radiusM, ...hull.map((point) => distance(center, point)));
  return fallbackDetourPoints(a, b, { ...seed, center, radiusM }, side, clearanceM);
}

function clusterDetourCandidate(
  a: Point,
  b: Point,
  seed: Nfz,
  nfzs: Nfz[],
  side: number,
  clearanceM: number,
): Point[] {
  const cluster = nfzCluster(seed, nfzs, clearanceM);
  if (cluster.length === 1) {
    return seed.polygon?.length
      ? polygonDetourCandidate(a, b, seed, side, clearanceM)
      : circleDetourCandidate(a, b, seed, side, clearanceM);
  }

  const hull = convexHull(cluster.flatMap((nfz) => nfzEnvelopePoints(nfz, clearanceM)));
  const candidate = polygonPathCandidate(a, b, hull, side);
  return candidate.length > 0
    ? candidate
    : clusterFallbackDetourPoints(a, b, seed, hull, side, clearanceM);
}

function detourCandidate(
  a: Point,
  b: Point,
  nfz: Nfz,
  nfzs: Nfz[],
  sideSeed: number,
): Point[] {
  const sides = sideSeed >= 0 ? [1, -1] : [-1, 1];
  const clearances = nfz.polygon?.length
    ? [45, 70, 110, 170, 260, 380]
    : [60, 95, 150, 230, 340, 500];
  const safeCandidates: Point[][] = [];

  for (const clearance of clearances) {
    for (const side of sides) {
      const candidate = clusterDetourCandidate(a, b, nfz, nfzs, side, clearance);
      if (candidateIsSafe(a, b, candidate, nfzs)) safeCandidates.push(candidate);
    }
  }

  if (safeCandidates.length > 0) {
    return safeCandidates.reduce((best, candidate) =>
      pathLengthWithEndpoints(a, b, candidate) < pathLengthWithEndpoints(a, b, best)
        ? candidate
        : best,
    );
  }

  return clusterDetourCandidate(
    a,
    b,
    nfz,
    nfzs,
    sides[0],
    clearances.at(-1) ?? 980,
  );
}

function dedupePath(points: Point[]): Point[] {
  return points.filter(
    (point, index) => index === 0 || distance(point, points[index - 1]) > 0.5,
  );
}

function compactSafePath(points: Point[], nfzs: Nfz[]): Point[] {
  const compacted = dedupePath(points);
  let index = 1;
  while (index < compacted.length - 1) {
    const previous = compacted[index - 1];
    const next = compacted[index + 1];
    if (!firstBlockingNfz(previous, next, nfzs)) {
      compacted.splice(index, 1);
      index = Math.max(1, index - 1);
    } else {
      index += 1;
    }
  }
  return compacted;
}

export function safePathPoints(
  start: Point,
  target: Point,
  nfzs: Nfz[],
  uavIndex = 0,
): Point[] {
  if (nfzs.length === 0 || distance(start, target) < 0.1) return [start, target];

  const points: Point[] = [start, target];
  for (let pass = 0; pass < 24; pass += 1) {
    let changed = false;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      const nfz = firstBlockingNfz(previous, next, nfzs);
      if (!nfz) continue;
      const detours = detourCandidate(
        previous,
        next,
        nfz,
        nfzs,
        (uavIndex + pass + index) % 2 === 0 ? 1 : -1,
      );
      points.splice(index, 0, ...detours);
      changed = true;
      break;
    }
    if (!changed) return compactSafePath(points, nfzs);
  }

  return compactSafePath(points, nfzs);
}

export function safePathLength(
  start: Point,
  target: Point,
  nfzs: Nfz[],
  uavIndex = 0,
): number {
  return routeLength(safePathPoints(start, target, nfzs, uavIndex));
}

export function appendSafeLeg(
  route: RouteWaypoint[],
  target: Point,
  speedMps: number,
  phase: RouteWaypoint["phase"],
  nfzs: Nfz[],
  uavIndex = 0,
  extra?: Partial<RouteWaypoint>,
): boolean {
  const start = route[route.length - 1];
  if (!start) return false;
  const path = safePathPoints(start, target, nfzs, uavIndex);
  let blocked = false;

  path.slice(1).forEach((point, index, points) => {
    const previous = route[route.length - 1];
    const isFinal = index === points.length - 1;
    const t = previous.t + distance(previous, point) / speedMps;
    const nextPhase = isFinal ? phase : "detour";
    const nextExtra = isFinal
      ? extra
      : {
          label: "NFZ avoidance corridor",
        };
    if (firstBlockingNfz(previous, point, nfzs)) blocked = true;
    route.push(routeWaypoint(point, t, nextPhase, nextExtra));
  });

  return !blocked;
}

export function rebuildRouteSafely(
  route: RouteWaypoint[],
  nfzs: Nfz[],
  speedMps: number,
  uavIndex = 0,
): { route: RouteWaypoint[]; blocked: boolean; changed: boolean } {
  if (route.length < 2) return { route, blocked: false, changed: false };

  const nextRoute: RouteWaypoint[] = [{ ...route[0] }];
  let blocked = false;
  route.slice(1).forEach((target) => {
    const beforeLength = nextRoute.length;
    const safe = appendSafeLeg(
      nextRoute,
      target,
      speedMps,
      target.phase,
      nfzs,
      uavIndex,
      {
        stripId: target.stripId,
        label: target.label,
      },
    );
    blocked = blocked || !safe;
    if (nextRoute.length === beforeLength && distance(nextRoute[nextRoute.length - 1], target) > 0.1) {
      blocked = true;
    }
  });

  const changed =
    nextRoute.length !== route.length ||
    nextRoute.some((point, index) => {
      const original = route[index];
      return !original || distance(point, original) > 0.1 || point.phase !== original.phase;
    });
  return { route: nextRoute, blocked: blocked || routeIntersectsAnyNfz(nextRoute, nfzs), changed };
}

export function routeIntersectsAnyNfz(route: Point[], nfzs: Nfz[]): boolean {
  if (route.length < 2 || nfzs.length === 0) return false;
  for (let index = 1; index < route.length; index += 1) {
    if (firstBlockingNfz(route[index - 1], route[index], nfzs)) return true;
  }
  return false;
}

function waypointList(base: HomeBase, direction: WaypointDirection): BaseWaypoint[] {
  return direction === "outbound" ? base.outboundWaypoints : base.inboundWaypoints;
}

function specificWaypointId(base: HomeBase, direction: WaypointDirection): string | undefined {
  return direction === "outbound"
    ? base.specificOutboundWaypointId
    : base.specificInboundWaypointId;
}

export function selectBaseWaypoint({
  base,
  direction,
  from,
  to,
  nfzs,
  uavIndex,
}: {
  base: HomeBase;
  direction: WaypointDirection;
  from: Point;
  to: Point;
  nfzs: Nfz[];
  uavIndex: number;
}): BaseWaypoint | undefined {
  const normalized = normalizeHomeBase(base);
  const waypoints = waypointList(normalized, direction);
  if (waypoints.length === 0) return undefined;

  if (normalized.waypointMode === "specific") {
    const selected = waypoints.find(
      (waypoint) => waypoint.id === specificWaypointId(normalized, direction),
    );
    if (selected) return selected;
  }

  if (normalized.waypointMode === "round_robin") {
    return waypoints[Math.abs(uavIndex) % waypoints.length];
  }

  return waypoints.reduce((best, waypoint) => {
    const waypointCost =
      safePathLength(from, waypoint.point, nfzs, uavIndex) +
      safePathLength(waypoint.point, to, nfzs, uavIndex);
    const bestCost =
      safePathLength(from, best.point, nfzs, uavIndex) +
      safePathLength(best.point, to, nfzs, uavIndex);
    return waypointCost < bestCost ? waypoint : best;
  }, waypoints[0]);
}

export function buildReturnRouteViaBaseWaypoint({
  start,
  startTimeS,
  base,
  config,
  nfzs,
  uavIndex,
}: {
  start: Point;
  startTimeS: number;
  base: HomeBase;
  config: MissionConfig;
  nfzs: Nfz[];
  uavIndex: number;
}): RouteWaypoint[] {
  const route: RouteWaypoint[] = [
    routeWaypoint(start, startTimeS, "regained", {
      label: "signal regained",
    }),
  ];
  const inbound = selectBaseWaypoint({
    base,
    direction: "inbound",
    from: start,
    to: base.point,
    nfzs,
    uavIndex,
  });
  if (inbound) {
    appendSafeLeg(route, inbound.point, config.speedMps, "transit", nfzs, uavIndex, {
      label: `inbound waypoint ${inbound.label}`,
    });
  }
  appendSafeLeg(route, base.point, config.speedMps, "return", nfzs, uavIndex, {
    label: "RTB via inbound waypoint",
  });
  return route;
}
