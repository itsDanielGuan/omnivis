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

function detourPointsAroundNfz(
  a: Point,
  b: Point,
  nfz: Nfz,
  side: number,
  clearanceM: number,
): [Point, Point] {
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

function detourCandidate(
  a: Point,
  b: Point,
  nfz: Nfz,
  sideSeed: number,
): Point[] {
  const sides = sideSeed >= 0 ? [1, -1] : [-1, 1];
  const clearances = [420, 680, 980, 1320, 1800, 2400];

  for (const clearance of clearances) {
    for (const side of sides) {
      const [first, second] = detourPointsAroundNfz(a, b, nfz, side, clearance);
      const safe =
        !pointInsideNfz(first, nfz) &&
        !pointInsideNfz(second, nfz) &&
        !segmentIntersectsNfz(a, first, nfz) &&
        !segmentIntersectsNfz(first, second, nfz) &&
        !segmentIntersectsNfz(second, b, nfz);
      if (safe) return [first, second];
    }
  }

  return detourPointsAroundNfz(a, b, nfz, sides[0], clearances.at(-1) ?? 2400);
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
        (uavIndex + pass + index) % 2 === 0 ? 1 : -1,
      );
      points.splice(index, 0, ...detours);
      changed = true;
      break;
    }
    if (!changed) return points;
  }

  return points;
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
