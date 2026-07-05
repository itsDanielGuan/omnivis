import {
  distance,
  interpolateRoute,
  pointInPolygon,
  polygonApproxRadius,
  polygonCentroid,
  routeAtOrBefore,
  routeHeadingDeg,
  routeProgressPct,
  segmentDistanceToPoint,
  segmentIntersectsPolygon,
} from "@/lib/geometry";
import { computeMissionMetrics } from "@/lib/metrics";
import { UAV_COLORS } from "@/lib/presets";
import {
  buildRouteFromStart,
  contingencyInfillPattern,
  generateRecoveryStrips,
  initialInfillPattern,
  generateMissionPlanFromArea,
} from "@/lib/planner";
import {
  buildReturnRouteViaBaseWaypoint,
  normalizeHomeBase,
  pointInsideNfz,
  routeIntersectsAnyNfz,
  safePathLength,
} from "@/lib/routing";
import type {
  CoverageStrip,
  HomeBase,
  LossResponseMode,
  MissionEvent,
  MissionMessage,
  MissionPlan,
  Nfz,
  InfillPattern,
  Point,
  RouteWaypoint,
  UavPlan,
  UavSnapshot,
} from "@/lib/types";

function clonePlan(plan: MissionPlan): MissionPlan {
  return JSON.parse(JSON.stringify(plan)) as MissionPlan;
}

function eventId(plan: MissionPlan, suffix: string) {
  return `EVT_${String(plan.events.length + 1).padStart(3, "0")}_${suffix}`;
}

function messageId(plan: MissionPlan, suffix: string) {
  return `MSG_${String(plan.messages.length + 1).padStart(3, "0")}_${suffix}`;
}

function isFullSignal(plan: MissionPlan): boolean {
  return plan.config.commsPolicy === "full_signal";
}

const COMMUNICATION_LOSS_PERIOD_S = 90;

function rebuildPreflightNfzPlan(sourcePlan: MissionPlan, nfzs: Nfz[]): MissionPlan {
  const plan = generateMissionPlanFromArea(
    sourcePlan.config,
    sourcePlan.aoo,
    sourcePlan.homeBase,
    nfzs,
  );
  plan.lossResponseMode = sourcePlan.lossResponseMode;
  return plan;
}

function addEvent(
  plan: MissionPlan,
  timeS: number,
  severity: MissionEvent["severity"],
  text: string,
  uavId?: string,
) {
  plan.events.push({
    id: eventId(plan, severity.toUpperCase()),
    timeS,
    severity,
    text,
    uavId,
  });
}

function addMessage(
  plan: MissionPlan,
  timeS: number,
  type: MissionMessage["type"],
  sourceId: string,
  text: string,
  targetId?: string,
  targetIds?: string[],
) {
  const countInMission = type !== "MISSION_LOAD";
  plan.messages.push({
    id: messageId(plan, type),
    timeS,
    type,
    sourceId,
    targetId,
    targetIds,
    countInMission,
    text,
  });
}

function stripCompletionTime(route: RouteWaypoint[], stripId: string): number {
  return Math.max(
    -1,
    ...route
      .filter((point) => point.stripId === stripId && point.phase === "covering")
      .map((point) => point.t),
  );
}

function pendingAssignedStrips(
  plan: MissionPlan,
  uav: UavPlan,
  timeS: number,
): CoverageStrip[] {
  return plan.strips.filter((strip) => {
    if (strip.assignedUavId !== uav.id) return false;
    if (strip.status === "blocked_by_nfz" || strip.status === "completed") return false;
    return stripCompletionTime(uav.route, strip.id) > timeS;
  });
}

function hasFutureNfzDetour(route: RouteWaypoint[], timeS: number): boolean {
  return route.some(
    (point) =>
      point.t > timeS &&
      (point.phase === "detour" || point.label?.toLowerCase().includes("nfz")),
  );
}

function nearestPointOnSegment(a: Point, b: Point, point: Point): Point {
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSq === 0) return a;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSq),
  );
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function nearestPolygonEgressPoint(point: Point, nfz: Nfz, clearanceM: number): Point | undefined {
  const polygon = nfz.polygon;
  if (!polygon || polygon.length < 3) return undefined;
  const boundary = polygon.reduce((nearest, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const candidate = nearestPointOnSegment(vertex, next, point);
    return distance(candidate, point) < distance(nearest, point) ? candidate : nearest;
  }, nearestPointOnSegment(polygon[0], polygon[1], point));
  const dx = boundary.x - nfz.center.x;
  const dy = boundary.y - nfz.center.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: boundary.x + (dx / length) * clearanceM,
    y: boundary.y + (dy / length) * clearanceM,
  };
}

function egressPointOutsideNfzs(point: Point, nfzs: Nfz[], clearanceM: number): Point | undefined {
  let cursor = { x: point.x, y: point.y };
  let moved = false;
  for (let guard = 0; guard < 5; guard += 1) {
    const containingNfz = nfzs.find((nfz) => pointInsideNfz(cursor, nfz));
    if (!containingNfz) return moved ? cursor : undefined;
    const polygonEgress = nearestPolygonEgressPoint(cursor, containingNfz, clearanceM);
    if (polygonEgress) {
      cursor = polygonEgress;
      moved = true;
      continue;
    }
    const dx = cursor.x - containingNfz.center.x;
    const dy = cursor.y - containingNfz.center.y;
    const length = Math.hypot(dx, dy) || 1;
    const radius = Math.max(containingNfz.radiusM, 1) + clearanceM;
    cursor = {
      x: containingNfz.center.x + (dx / length) * radius,
      y: containingNfz.center.y + (dy / length) * radius,
    };
    moved = true;
  }
  return moved ? cursor : undefined;
}

function recomputeUavUtilization(uav: UavPlan) {
  const routeEnd = uav.route[uav.route.length - 1]?.t ?? 1;
  uav.utilizationPct = Math.min(100, (uav.coverageTimeS / routeEnd) * 100);
  uav.rtbSlotS = uav.route[uav.route.length - 1]?.t ?? uav.rtbSlotS;
}

function buildContinuationForUav(
  plan: MissionPlan,
  uav: UavPlan,
  strips: CoverageStrip[],
  startTimeS: number,
  uavIndex: number,
  pattern: InfillPattern = contingencyInfillPattern(plan.config),
) {
  const current = interpolateRoute(uav.route, startTimeS);
  const prefix = [
    ...routeAtOrBefore(uav.route, startTimeS).filter((point) => point.t < startTimeS - 0.1),
    {
      ...current,
      t: startTimeS,
      label: current.label ?? "live replan handoff",
    },
  ];
  const egressPoint = egressPointOutsideNfzs(
    current,
    plan.nfzs,
    Math.max(35, Math.min(85, plan.config.sensorSwathM * 0.25)),
  );
  const egressRoute: RouteWaypoint[] = [];
  let buildStart: Point = current;
  let buildStartTimeS = startTimeS;
  if (egressPoint) {
    buildStartTimeS += distance(current, egressPoint) / plan.config.speedMps;
    egressRoute.push({
      ...egressPoint,
      t: buildStartTimeS,
      phase: "detour",
      label: "NFZ egress",
    });
    buildStart = egressPoint;
  }
  const build = buildRouteFromStart(
    buildStart,
    buildStartTimeS,
    strips,
    plan.config,
    plan.homeBase,
    uavIndex,
    false,
    plan.nfzs,
    pattern,
  );
  uav.originalRoute = uav.originalRoute ?? uav.route;
  uav.route = [...prefix, ...egressRoute, ...build.route.slice(1)];
  uav.coverageTimeS = build.coverageTimeS;
  uav.rechargeCount = build.rechargeCount;
  uav.forcedRtbCount = build.forcedRtbCount;
  uav.enduranceWarning = build.enduranceWarning;
  build.skippedStripIds.forEach((stripId) => {
    const strip = plan.strips.find((candidate) => candidate.id === stripId);
    if (strip) strip.status = "coverage_debt";
  });
  uav.assignedStripIds = plan.strips
    .filter(
      (strip) =>
        strip.assignedUavId === uav.id &&
        strip.status !== "coverage_debt" &&
        strip.status !== "blocked_by_nfz" &&
        strip.status !== "completed",
    )
    .map((strip) => strip.id);
  recomputeUavUtilization(uav);
}

function buildCommunicationRecoveryRoute(
  plan: MissionPlan,
  uav: UavPlan,
  start: Point,
  startTimeS: number,
  lossDetectedAtS: number,
  uavIndex: number,
): { route: RouteWaypoint[]; lossPoint: RouteWaypoint } {
  const returnRoute = buildReturnRouteViaBaseWaypoint({
    start,
    startTimeS,
    base: plan.homeBase,
    config: plan.config,
    nfzs: plan.nfzs,
    uavIndex,
  }).map((point, index) => ({
    ...point,
    phase: index === 0 ? ("return" as const) : point.phase,
    label:
      index === 0
        ? "communication lost; returning toward launch base"
        : point.label,
  }));
  const prefix = routeAtOrBefore(uav.route, startTimeS);
  const returnUntilLoss = routeAtOrBefore(returnRoute, lossDetectedAtS);
  const prefixLast = prefix[prefix.length - 1];
  const stitchedReturn =
    prefixLast &&
    returnUntilLoss[0] &&
    distance(prefixLast, returnUntilLoss[0]) < 1 &&
    Math.abs(prefixLast.t - returnUntilLoss[0].t) < 0.1
      ? returnUntilLoss.slice(1)
      : returnUntilLoss;
  const lossPoint = {
    ...interpolateRoute(returnRoute, lossDetectedAtS),
    t: lossDetectedAtS,
    phase: "lost" as const,
    label: "lost contact after communication recovery window",
  };

  return {
    route: [
      ...prefix,
      ...stitchedReturn,
      {
        ...lossPoint,
        t: lossDetectedAtS + 1,
      },
    ],
    lossPoint,
  };
}

function stripTraverseFrom(cursor: Point, strip: CoverageStrip, plan: MissionPlan, uavIndex: number) {
  const enterStartCost = safePathLength(cursor, strip.start, plan.nfzs, uavIndex);
  const enterEndCost = safePathLength(cursor, strip.end, plan.nfzs, uavIndex);
  const startsAtA = enterStartCost <= enterEndCost;
  const entry = startsAtA ? strip.start : strip.end;
  const exit = startsAtA ? strip.end : strip.start;
  return {
    entry,
    exit,
    cost: Math.min(enterStartCost, enterEndCost) + distance(entry, exit),
  };
}

function unfinishedRedistributionStrips(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  timeS: number,
): CoverageStrip[] {
  return plan.strips
    .filter((strip) => {
      if (strip.status === "blocked_by_nfz" || strip.status === "completed") return false;
      const sourceOwner = sourcePlan.uavs.find((uav) => uav.id === strip.assignedUavId);
      if (!sourceOwner) return strip.status === "coverage_debt";
      return stripCompletionTime(sourceOwner.originalRoute ?? sourceOwner.route, strip.id) > timeS;
    })
    .sort((a, b) => a.order - b.order);
}

function stripIntersectsNfz(strip: CoverageStrip, nfz: Nfz, swathM: number): boolean {
  if (nfz.polygon?.length) {
    return (
      pointInPolygon(strip.center, nfz.polygon) ||
      segmentIntersectsPolygon(strip.start, strip.end, nfz.polygon)
    );
  }
  return segmentDistanceToPoint(strip.start, strip.end, nfz.center) <= nfz.radiusM + swathM * 0.5;
}

function remarkNfzBlockedStrips(plan: MissionPlan): CoverageStrip[] {
  const blocked: CoverageStrip[] = [];
  plan.strips.forEach((strip) => {
    if (strip.status === "coverage_debt" || strip.status === "completed") return;
    const isBlocked = plan.nfzs.some((nfz) =>
      stripIntersectsNfz(strip, nfz, plan.config.sensorSwathM),
    );
    strip.status = isBlocked ? "blocked_by_nfz" : "planned";
    if (isBlocked) blocked.push(strip);
  });
  return blocked;
}

function redistributeRemainingStripsGreedy(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  timeS: number,
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();
  const activeIds = new Set(activeUavs.map((uav) => uav.id));
  const remaining = unfinishedRedistributionStrips(plan, sourcePlan, timeS);

  const buckets = activeUavs.map((uav, index) => ({
    uav,
    index,
    cursor: interpolateRoute(uav.route, timeS) as Point,
    workloadM: 0,
    strips: [] as CoverageStrip[],
  }));

  remaining.forEach((strip) => {
    const best = buckets.reduce((winner, bucket) => {
      const candidate = stripTraverseFrom(bucket.cursor, strip, plan, bucket.index);
      const candidateScore =
        bucket.workloadM + candidate.cost + bucket.strips.length * plan.config.sensorSwathM * 4;
      const winnerCandidate = stripTraverseFrom(winner.cursor, strip, plan, winner.index);
      const winnerScore =
        winner.workloadM +
        winnerCandidate.cost +
        winner.strips.length * plan.config.sensorSwathM * 4;
      return candidateScore < winnerScore ? bucket : winner;
    }, buckets[0]);
    if (!best) return;

    const traversal = stripTraverseFrom(best.cursor, strip, plan, best.index);
    const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
    if (mutableStrip && activeIds.has(best.uav.id)) {
      mutableStrip.status = "planned";
      mutableStrip.assignedUavId = best.uav.id;
      best.strips.push(mutableStrip);
      best.cursor = traversal.exit;
      best.workloadM += traversal.cost;
    }
  });

  return new Map(buckets.map((bucket) => [bucket.uav.id, bucket.strips]));
}

function redistributeRemainingStripsBySector(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  timeS: number,
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();

  const remaining = unfinishedRedistributionStrips(plan, sourcePlan, timeS);
  const sectorSize = Math.max(1, Math.ceil(remaining.length / activeUavs.length));
  const buckets = new Map<string, CoverageStrip[]>(
    activeUavs.map((uav) => [uav.id, []]),
  );

  remaining.forEach((strip, index) => {
    const owner = activeUavs[Math.min(activeUavs.length - 1, Math.floor(index / sectorSize))];
    const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
    if (!owner || !mutableStrip) return;
    mutableStrip.status = "planned";
    mutableStrip.assignedUavId = owner.id;
    buckets.get(owner.id)?.push(mutableStrip);
  });

  return buckets;
}

function redistributeRemainingStripsInterleaved(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  timeS: number,
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();

  const remaining = unfinishedRedistributionStrips(plan, sourcePlan, timeS);
  const buckets = new Map<string, CoverageStrip[]>(
    activeUavs.map((uav) => [uav.id, []]),
  );

  remaining.forEach((strip, index) => {
    const owner = activeUavs[index % activeUavs.length];
    const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
    if (!owner || !mutableStrip) return;
    mutableStrip.status = "planned";
    mutableStrip.assignedUavId = owner.id;
    buckets.get(owner.id)?.push(mutableStrip);
  });

  return buckets;
}

function assignRemainingStripsToActiveUavs(
  plan: MissionPlan,
  activeUavs: UavPlan[],
  pattern: InfillPattern,
  remaining: CoverageStrip[],
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();

  const activeIds = new Set(activeUavs.map((uav) => uav.id));
  const ordered = [...remaining].sort((a, b) => a.order - b.order);

  if (pattern === "lightning" || pattern === "triangles" || pattern === "tri_hex") {
    const buckets = activeUavs.map((uav, index) => ({
      uav,
      index,
      cursor: uav.route.at(-1) ?? plan.homeBase.point,
      workloadM: 0,
      strips: [] as CoverageStrip[],
    }));

    ordered.forEach((strip) => {
      const best = buckets.reduce((winner, bucket) => {
        const candidate = stripTraverseFrom(bucket.cursor, strip, plan, bucket.index);
        const candidateScore =
          bucket.workloadM + candidate.cost + bucket.strips.length * plan.config.sensorSwathM * 4;
        const winnerCandidate = stripTraverseFrom(winner.cursor, strip, plan, winner.index);
        const winnerScore =
          winner.workloadM +
          winnerCandidate.cost +
          winner.strips.length * plan.config.sensorSwathM * 4;
        return candidateScore < winnerScore ? bucket : winner;
      }, buckets[0]);
      if (!best) return;

      const traversal = stripTraverseFrom(best.cursor, strip, plan, best.index);
      const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
      if (mutableStrip && activeIds.has(best.uav.id)) {
        mutableStrip.status = "planned";
        mutableStrip.assignedUavId = best.uav.id;
        best.strips.push(mutableStrip);
        best.cursor = traversal.exit;
        best.workloadM += traversal.cost;
      }
    });

    return new Map(buckets.map((bucket) => [bucket.uav.id, bucket.strips]));
  }

  if (pattern === "grid" || pattern === "crosshatch" || pattern === "lattice") {
    const buckets = new Map<string, CoverageStrip[]>(
      activeUavs.map((uav) => [uav.id, []]),
    );
    ordered.forEach((strip, index) => {
      const owner = activeUavs[index % activeUavs.length];
      const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
      if (!owner || !mutableStrip) return;
      mutableStrip.status = "planned";
      mutableStrip.assignedUavId = owner.id;
      buckets.get(owner.id)?.push(mutableStrip);
    });
    return buckets;
  }

  const sectorSize = Math.max(1, Math.ceil(ordered.length / activeUavs.length));
  const buckets = new Map<string, CoverageStrip[]>(
    activeUavs.map((uav) => [uav.id, []]),
  );
  ordered.forEach((strip, index) => {
    const owner = activeUavs[Math.min(activeUavs.length - 1, Math.floor(index / sectorSize))];
    const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
    if (!owner || !mutableStrip) return;
    mutableStrip.status = "planned";
    mutableStrip.assignedUavId = owner.id;
    buckets.get(owner.id)?.push(mutableStrip);
  });
  return buckets;
}

function redistributeLostDebtOnly(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  failedUavId: string,
  timeS: number,
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();

  const buckets = new Map<string, CoverageStrip[]>(
    activeUavs.map((uav) => [uav.id, pendingAssignedStrips(plan, uav, timeS)]),
  );
  const lostDebt = unfinishedRedistributionStrips(plan, sourcePlan, timeS).filter(
    (strip) => strip.assignedUavId === failedUavId,
  );
  const sectorSize = Math.max(1, Math.ceil(lostDebt.length / activeUavs.length));

  lostDebt.forEach((strip, index) => {
    const owner = activeUavs[Math.min(activeUavs.length - 1, Math.floor(index / sectorSize))];
    const mutableStrip = plan.strips.find((candidate) => candidate.id === strip.id);
    if (!owner || !mutableStrip) return;
    mutableStrip.status = "planned";
    mutableStrip.assignedUavId = owner.id;
    buckets.get(owner.id)?.push(mutableStrip);
  });

  return buckets;
}

function rebuildStripsForContingencyRecovery(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  timeS: number,
  pattern: InfillPattern,
): CoverageStrip[] {
  const coveredCenters: Point[] = [];
  sourcePlan.strips.forEach((strip) => {
    const owner = sourcePlan.uavs.find((uav) => uav.id === strip.assignedUavId);
    if (!owner) return;
    if (stripCompletionTime(owner.originalRoute ?? owner.route, strip.id) <= timeS) {
      coveredCenters.push(strip.center);
    }
  });

  const recoveryStrips = generateRecoveryStrips(
    plan.aoo,
    plan.config,
    pattern,
    coveredCenters,
  ).map((strip) => {
    const blocked = plan.nfzs.some((nfz) =>
      stripIntersectsNfz(strip, nfz, plan.config.sensorSwathM),
    );
    return blocked ? { ...strip, status: "blocked_by_nfz" as const } : strip;
  });

  const preserved = plan.strips.filter((strip) =>
    coveredCenters.some((center) => distance(center, strip.center) < plan.config.sensorSwathM * 0.55),
  );

  return [...preserved, ...recoveryStrips];
}

function redistributeRemainingStripsForPattern(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  timeS: number,
  pattern: InfillPattern,
): Map<string, CoverageStrip[]> {
  if (pattern === "lightning" || pattern === "triangles" || pattern === "tri_hex") {
    return redistributeRemainingStripsGreedy(plan, sourcePlan, activeUavs, timeS);
  }
  if (pattern === "grid" || pattern === "crosshatch" || pattern === "lattice") {
    return redistributeRemainingStripsInterleaved(plan, sourcePlan, activeUavs, timeS);
  }
  return redistributeRemainingStripsBySector(plan, sourcePlan, activeUavs, timeS);
}

function infillPatternSummary(pattern: InfillPattern) {
  if (pattern === "zigzag") return "zigzag infill";
  if (pattern === "spiral") return "outside-in spiral infill";
  if (pattern === "grid") return "grid infill";
  if (pattern === "triangles") return "triangle infill";
  if (pattern === "tri_hex") return "tri-hex infill";
  if (pattern === "diamond") return "diamond infill";
  if (pattern === "chevron") return "chevron infill";
  if (pattern === "crosshatch") return "crosshatch infill";
  if (pattern === "lattice") return "lattice infill";
  if (pattern === "lightning") return "lightning infill";
  return "rectilinear infill";
}

export function getUavSnapshot(
  uav: UavPlan,
  timeS: number,
): UavSnapshot {
  const point = interpolateRoute(uav.route, timeS);
  const lossDetectedAtS = uav.lossDetectedAtS ?? uav.lostAtS;
  return {
    id: uav.id,
    label: uav.label,
    color: uav.color,
    x: point.x,
    y: point.y,
    headingDeg: routeHeadingDeg(uav.route, timeS),
    phase: uav.status === "lost" && lossDetectedAtS !== undefined && timeS >= lossDetectedAtS
      ? "lost"
      : point.phase,
    altitudeM: uav.altitudeM,
    progressPct: routeProgressPct(uav.route, timeS),
  };
}

export function getCurrentTask(uav: UavPlan, timeS: number): string {
  const point = interpolateRoute(uav.route, timeS);
  if (uav.status === "lost") {
    const communicationLostAtS = uav.communicationLostAtS;
    const lossDetectedAtS = uav.lossDetectedAtS ?? uav.lostAtS;
    if (
      communicationLostAtS !== undefined &&
      lossDetectedAtS !== undefined &&
      timeS >= communicationLostAtS &&
      timeS < lossDetectedAtS
    ) {
      return "Communication lost; returning toward launch base";
    }
    if (lossDetectedAtS === undefined || timeS >= lossDetectedAtS) return "Lost contact";
  }
  if (uav.status === "regained") return "Signal regained; returning to base";
  if (point.stripId) return `Working ${point.stripId}`;
  if (point.phase === "loiter") return "Holding for RTB slot";
  if (point.phase === "return") return "Return-to-base corridor";
  if (point.phase === "detour") return "NFZ detour";
  if (point.phase === "replacement") return "Replacement insertion";
  if (point.phase === "recharge") return point.label ?? "Battery recharge at base";
  return point.label ?? point.phase;
}

export function applyVehicleLoss(
  sourcePlan: MissionPlan,
  failedUavId: string,
  mode: LossResponseMode,
  requestedTimeS: number,
): MissionPlan {
  const sourceFailed =
    sourcePlan.uavs.find((uav) => uav.id === failedUavId) ??
    sourcePlan.uavs[2] ??
    sourcePlan.uavs[0];
  if (
    !sourceFailed ||
    sourceFailed.reserve ||
    sourceFailed.status === "lost" ||
    sourceFailed.status === "regained" ||
    sourceFailed.communicationLostAtS !== undefined ||
    sourceFailed.lossDetectedAtS !== undefined ||
    sourceFailed.lostAtS !== undefined
  ) {
    return sourcePlan;
  }

  const plan = clonePlan(sourcePlan);
  const fullSignal = isFullSignal(plan);
  const effectiveMode: LossResponseMode = fullSignal ? mode : "dispatch_replacement";
  plan.metrics.before = {
    coveragePct: sourcePlan.metrics.coveragePct,
    missionCompletionTimeS: sourcePlan.metrics.missionCompletionTimeS,
    messagesUsed: sourcePlan.metrics.messagesUsed,
    coverageDebtStripCount: sourcePlan.metrics.coverageDebtStripCount,
  };
  plan.lossResponseMode = effectiveMode;
  plan.activeContingency = "vehicle_loss";

  const failed = plan.uavs.find((uav) => uav.id === sourceFailed.id) ?? plan.uavs[0];
  const routeEndS = failed.route.at(-1)?.t ?? 900;
  const communicationLostAtS = Math.max(90, Math.min(requestedTimeS, routeEndS * 0.72));
  const lossDetectedAtS = Math.min(
    Math.max(communicationLostAtS + 1, routeEndS - 1),
    communicationLostAtS + COMMUNICATION_LOSS_PERIOD_S,
  );
  const failedIndex = plan.uavs.findIndex((uav) => uav.id === failed.id);
  const communicationLossPoint = interpolateRoute(failed.route, communicationLostAtS);
  const recoveryRoute = buildCommunicationRecoveryRoute(
    plan,
    failed,
    communicationLossPoint,
    communicationLostAtS,
    lossDetectedAtS,
    Math.max(0, failedIndex),
  );
  failed.originalRoute = failed.originalRoute ?? failed.route;
  failed.route = recoveryRoute.route;
  failed.status = "lost";
  failed.communicationLostAtS = communicationLostAtS;
  failed.lossDetectedAtS = lossDetectedAtS;
  failed.lostAtS = lossDetectedAtS;
  failed.lossPoint = recoveryRoute.lossPoint;
  failed.assignedStripIds = [];
  failed.utilizationPct = 0;
  failed.coverageTimeS = 0;

  const debtStrips = sourcePlan.strips.filter((strip) => {
    if (strip.assignedUavId !== failed.id) return false;
    if (strip.status === "blocked_by_nfz" || strip.status === "completed") return false;
    if (!fullSignal) return true;
    if (!sourceFailed) return true;
    return stripCompletionTime(sourceFailed.originalRoute ?? sourceFailed.route, strip.id) > lossDetectedAtS;
  });

  debtStrips.forEach((debt) => {
    const strip = plan.strips.find((candidate) => candidate.id === debt.id);
    if (strip) {
      strip.status = "coverage_debt";
      strip.assignedUavId = failed.id;
    }
  });

  addEvent(
    plan,
    communicationLostAtS,
    "warning",
    `${failed.label} communication lost; aircraft turns back toward ${plan.homeBase.label} for ${COMMUNICATION_LOSS_PERIOD_S}s`,
    failed.id,
  );
  addEvent(
    plan,
    lossDetectedAtS,
    "danger",
    fullSignal
      ? `${failed.label} missed health epoch; last GPS point marks the stopped loss location`
      : `${failed.label} missed alive signal; full assigned sector queued for redo from base`,
    failed.id,
  );
  addMessage(
    plan,
    lossDetectedAtS + 4,
    "HEALTH_MISS",
    failed.id,
    `${failed.label} health epoch missed`,
    "BASE",
  );

  const activeUavs = plan.uavs.filter((uav) => uav.status !== "lost" && !uav.reserve);
  const initialPattern = initialInfillPattern(plan.config);
  const contingencyPattern = contingencyInfillPattern(plan.config);
  const patternsMatch = initialPattern === contingencyPattern;
  const contingencySummary = infillPatternSummary(contingencyPattern);
  const initialSummary = infillPatternSummary(initialPattern);
  if (!fullSignal && mode === "spread_remaining_swarm") {
    addEvent(
      plan,
      lossDetectedAtS + 7,
      "warning",
      "Silent operation has no usable GPS trail; replacement redo overrides spread mode",
    );
  }

  if (effectiveMode === "dispatch_replacement") {
    const replacementId = `UAV_R${plan.uavs.filter((uav) => uav.id.startsWith("UAV_R")).length + 1}`;
    const replacementColor = UAV_COLORS[5];
    debtStrips.forEach((debt) => {
      const strip = plan.strips.find((candidate) => candidate.id === debt.id);
      if (strip) {
        strip.status = "planned";
        strip.assignedUavId = replacementId;
      }
    });
    const replacementStrips = plan.strips.filter(
      (strip) => strip.assignedUavId === replacementId,
    );
    const replacementBase = normalizeHomeBase(plan.homeBase);
    const replacementStart = replacementBase.point;
    const build = buildRouteFromStart(
      replacementStart,
      lossDetectedAtS + 20,
      replacementStrips,
      plan.config,
      replacementBase,
      failedIndex >= 0 ? failedIndex : plan.uavs.length,
      true,
      plan.nfzs,
      contingencyPattern,
    );
    const replacementRoute = build.route.map((point) => ({
      ...point,
      phase: point.phase === "transit" ? ("replacement" as const) : point.phase,
      label:
        point.phase === "preflight"
          ? `replacement standby at ${replacementBase.label}`
          : point.label,
    }));
    const replacement: UavPlan = {
      id: replacementId,
      label: replacementId.replace("_", "-"),
      color: replacementColor.color,
      colorSoft: replacementColor.soft,
      altitudeM:
        plan.config.altitudeLayerStartM +
        (plan.uavs.length + 1) * plan.config.altitudeLayerSpacingM,
      status: "replanned",
      reserve: true,
      assignedStripIds: replacementStrips.map((strip) => strip.id),
      route: replacementRoute,
      rtbSlotS: build.route.at(-1)?.t ?? 0,
      coverageTimeS: build.coverageTimeS,
      utilizationPct: 0,
      rechargeCount: build.rechargeCount,
      forcedRtbCount: build.forcedRtbCount,
      enduranceWarning: build.enduranceWarning,
    };
    build.skippedStripIds.forEach((stripId) => {
      const strip = plan.strips.find((candidate) => candidate.id === stripId);
      if (strip) strip.status = "coverage_debt";
    });
    replacement.assignedStripIds = plan.strips
      .filter(
        (strip) =>
          strip.assignedUavId === replacementId &&
          strip.status !== "coverage_debt" &&
          strip.status !== "blocked_by_nfz" &&
          strip.status !== "completed",
      )
      .map((strip) => strip.id);
    recomputeUavUtilization(replacement);
    plan.uavs.push(replacement);
    addMessage(
      plan,
      lossDetectedAtS + 12,
      "REPLACEMENT_DISPATCH",
      "BASE",
      fullSignal
        ? `Full-signal loss: replacement launches from ${replacementBase.label} using ${contingencySummary}`
        : `Silent loss: replacement launches from ${replacementBase.label} to redo the lost sector using ${contingencySummary}`,
      replacementId,
    );
    addEvent(
      plan,
      lossDetectedAtS + 18,
      "warning",
      fullSignal
        ? `${replacement.label} launched from ${replacementBase.label} for ${replacementStrips.length} remaining strips with ${contingencySummary}`
        : `${replacement.label} launched from ${replacementBase.label} to redo ${replacementStrips.length} strips without using loss GPS`,
      replacementId,
    );
  } else {
    let workByUav: Map<string, CoverageStrip[]>;
    let routePattern = contingencyPattern;

    if (patternsMatch) {
      workByUav = redistributeLostDebtOnly(
        plan,
        sourcePlan,
        activeUavs,
        failed.id,
        lossDetectedAtS,
      );
      routePattern = initialPattern;
    } else {
      plan.strips = rebuildStripsForContingencyRecovery(
        plan,
        sourcePlan,
        lossDetectedAtS,
        contingencyPattern,
      );
      const recoveryRemaining = plan.strips.filter(
        (strip) =>
          strip.status !== "blocked_by_nfz" &&
          strip.status !== "completed" &&
          strip.status !== "coverage_debt",
      );
      workByUav = assignRemainingStripsToActiveUavs(
        plan,
        activeUavs,
        contingencyPattern,
        recoveryRemaining,
      );
    }

    activeUavs.forEach((uav, index) => {
      const future = workByUav.get(uav.id) ?? pendingAssignedStrips(plan, uav, lossDetectedAtS);
      uav.status = "replanned";
      uav.assignedStripIds = plan.strips
        .filter(
          (strip) =>
            strip.assignedUavId === uav.id &&
            strip.status !== "coverage_debt" &&
            strip.status !== "blocked_by_nfz" &&
            strip.status !== "completed",
        )
        .map((strip) => strip.id);
      buildContinuationForUav(
        plan,
        uav,
        future,
        lossDetectedAtS + index * 8,
        index,
        routePattern,
      );
    });
    addMessage(
      plan,
      lossDetectedAtS + 10,
      "SWARM_REDISTRIBUTE",
      "BASE",
      patternsMatch
        ? `Full-signal loss: ${initialSummary} continues unfinished paths; lost-sector debt absorbed`
        : `Full-signal loss: ${contingencySummary} replans remaining area to recover coverage and vary approach`,
      undefined,
      activeUavs.map((uav) => uav.id),
    );
    addEvent(
      plan,
      lossDetectedAtS + 15,
      "warning",
      patternsMatch
        ? `${activeUavs.map((uav) => uav.label).join(", ")} continue uncompleted ${initialSummary} paths and absorb lost-sector debt`
        : `${contingencySummary} rebalanced across ${activeUavs.map((uav) => uav.label).join(", ")} to recover the full remaining area`,
    );
  }

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

function isRechargingAt(uav: UavPlan, timeS: number): boolean {
  return uav.route.some((point, index) => {
    const previous = uav.route[index - 1];
    return point.phase === "recharge" && previous && timeS >= previous.t && timeS < point.t;
  });
}

function batteryPctAt(plan: MissionPlan, uav: UavPlan, timeS: number): number {
  const boundedTimeS = Math.max(uav.route[0]?.t ?? 0, timeS);
  const enduranceS = Math.max(60, plan.config.enduranceMin * 60);
  const sortieStart =
    uav.route
      .filter(
        (point) =>
          point.t <= boundedTimeS && (point.phase === "preflight" || point.phase === "recharge"),
      )
      .at(-1)?.t ?? uav.route[0]?.t ?? 0;
  return Math.max(0, Math.min(100, 100 - ((boundedTimeS - sortieStart) / enduranceS) * 100));
}

export function applyBatteryLowReplacement(
  sourcePlan: MissionPlan,
  timeS: number,
): MissionPlan {
  const reservePct = Math.max(
    0,
    Math.min(100, (sourcePlan.config.batteryReserveMin / sourcePlan.config.enduranceMin) * 100),
  );
  const candidate = sourcePlan.uavs.find((uav) => {
    if (uav.reserve || uav.combat || uav.status === "lost" || uav.batteryReliefAtS !== undefined) {
      return false;
    }
    if (isRechargingAt(uav, timeS)) return false;
    if (batteryPctAt(sourcePlan, uav, timeS) > reservePct + 5) return false;
    return pendingAssignedStrips(sourcePlan, uav, timeS).length > 0;
  });
  if (!candidate) return sourcePlan;

  const plan = clonePlan(sourcePlan);
  const uav = plan.uavs.find((item) => item.id === candidate.id);
  if (!uav) return sourcePlan;
  const uavIndex = Math.max(0, plan.uavs.findIndex((item) => item.id === uav.id));
  const reliefS = Math.max(timeS, uav.route[0]?.t ?? 0);
  const futureStrips = pendingAssignedStrips(plan, uav, reliefS);
  if (futureStrips.length === 0) return sourcePlan;

  const replacementId = `UAV_B${plan.uavs.filter((item) => item.id.startsWith("UAV_B")).length + 1}`;
  futureStrips.forEach((future) => {
    const strip = plan.strips.find((candidateStrip) => candidateStrip.id === future.id);
    if (strip) {
      strip.status = "planned";
      strip.assignedUavId = replacementId;
    }
  });

  const current = interpolateRoute(uav.route, reliefS);
  const prefix = [
    ...routeAtOrBefore(uav.route, reliefS).filter((point) => point.t < reliefS - 0.1),
    {
      ...current,
      t: reliefS,
      phase: "return" as const,
      label: "battery reserve reached; handing coverage to replacement",
    },
  ];
  const returnRoute = buildReturnRouteViaBaseWaypoint({
    start: current,
    startTimeS: reliefS,
    base: plan.homeBase,
    config: plan.config,
    nfzs: plan.nfzs,
    uavIndex,
  });
  const rtb = returnRoute.slice(1).map((point) => ({ ...point, phase: "return" as const }));
  const rtbEnd = rtb.at(-1) ?? prefix.at(-1);
  const rechargeEndS = (rtbEnd?.t ?? reliefS) + Math.max(60, plan.config.rechargeDurationMin * 60);
  uav.originalRoute = uav.originalRoute ?? uav.route;
  uav.route = [
    ...prefix,
    ...rtb,
    {
      ...plan.homeBase.point,
      t: rechargeEndS,
      phase: "recharge",
      label: `battery relief recharge ${plan.config.rechargeDurationMin} min`,
    },
  ];
  uav.status = "replanned";
  uav.batteryReliefAtS = reliefS;
  uav.batteryReliefReplacementId = replacementId;
  uav.forcedRtbCount = (uav.forcedRtbCount ?? 0) + 1;
  uav.rechargeCount = (uav.rechargeCount ?? 0) + 1;
  uav.assignedStripIds = plan.strips
    .filter((strip) => strip.assignedUavId === uav.id && strip.status === "planned")
    .map((strip) => strip.id);
  recomputeUavUtilization(uav);

  const replacementBase = normalizeHomeBase(plan.homeBase);
  const replacementStrips = plan.strips.filter((strip) => strip.assignedUavId === replacementId);
  const replacementIndex = plan.uavs.length;
  const build = buildRouteFromStart(
    replacementBase.point,
    reliefS + 30,
    replacementStrips,
    plan.config,
    replacementBase,
    replacementIndex,
    true,
    plan.nfzs,
    contingencyInfillPattern(plan.config),
  );
  const replacementColor = UAV_COLORS[replacementIndex % UAV_COLORS.length] ?? UAV_COLORS[0];
  const replacement: UavPlan = {
    id: replacementId,
    label: replacementId.replace("_", "-"),
    color: replacementColor.color,
    colorSoft: replacementColor.soft,
    altitudeM:
      plan.config.altitudeLayerStartM +
      (replacementIndex + 1) * plan.config.altitudeLayerSpacingM,
    status: "replanned",
    reserve: true,
    assignedStripIds: replacementStrips.map((strip) => strip.id),
    route: build.route.map((point) => ({
      ...point,
      phase: point.phase === "transit" ? ("replacement" as const) : point.phase,
      label: point.phase === "preflight" ? `battery relief launch from ${replacementBase.label}` : point.label,
    })),
    rtbSlotS: build.route.at(-1)?.t ?? reliefS,
    utilizationPct: 0,
    coverageTimeS: build.coverageTimeS,
    rechargeCount: build.rechargeCount,
    forcedRtbCount: build.forcedRtbCount,
    enduranceWarning: build.enduranceWarning,
  };
  build.skippedStripIds.forEach((stripId) => {
    const strip = plan.strips.find((candidateStrip) => candidateStrip.id === stripId);
    if (strip) strip.status = "coverage_debt";
  });
  replacement.assignedStripIds = plan.strips
    .filter(
      (strip) =>
        strip.assignedUavId === replacementId &&
        strip.status !== "coverage_debt" &&
        strip.status !== "blocked_by_nfz" &&
        strip.status !== "completed",
    )
    .map((strip) => strip.id);
  recomputeUavUtilization(replacement);
  plan.uavs.push(replacement);
  addMessage(
    plan,
    reliefS + 4,
    "REPLACEMENT_DISPATCH",
    "BASE",
    `${uav.label} reached battery reserve; ${replacement.label} dispatched to absorb future strips`,
    replacementId,
  );
  addEvent(
    plan,
    reliefS,
    "warning",
    `${uav.label} hit battery reserve; ${replacement.label} launches with ${replacement.assignedStripIds.length} reassigned strips`,
    uav.id,
  );
  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function applyNfz(
  sourcePlan: MissionPlan,
  geometry: Point | Point[],
  requestedTimeS: number,
  sourceUavId?: string,
): MissionPlan {
  const plan = clonePlan(sourcePlan);
  plan.metrics.before = {
    coveragePct: sourcePlan.metrics.coveragePct,
    missionCompletionTimeS: sourcePlan.metrics.missionCompletionTimeS,
    messagesUsed: sourcePlan.metrics.messagesUsed,
    coverageDebtStripCount: sourcePlan.metrics.coverageDebtStripCount,
  };
  plan.activeContingency = "nfz";

  const timeS = Math.max(0, requestedTimeS);
  const source =
    plan.uavs.find((uav) => uav.id === sourceUavId && uav.status !== "lost") ??
    plan.uavs.find((uav) => uav.status !== "lost");
  const polygon = Array.isArray(geometry) ? geometry : undefined;
  const center: Point = polygon ? polygonCentroid(polygon) : (geometry as Point);
  const nfz: Nfz = {
    id: `NFZ_${plan.nfzs.length + 1}`,
    center,
    radiusM: polygon ? polygonApproxRadius(polygon, center) : 430,
    createdAtS: timeS,
    sourceUavId: source?.id,
    polygon,
  };
  plan.nfzs.push(nfz);

  if (timeS <= 0) {
    return rebuildPreflightNfzPlan(sourcePlan, plan.nfzs);
  }

  const blocked = remarkNfzBlockedStrips(plan);

  plan.uavs
    .filter((uav) => uav.status !== "lost")
    .forEach((uav, index) => {
      const replanTimeS = timeS + index * 3;
      const futureRoute: RouteWaypoint[] = [
        interpolateRoute(uav.route, replanTimeS),
        ...uav.route.filter((point) => point.t > replanTimeS),
      ];
      const blockedFutureWork = uav.assignedStripIds.some((stripId) => {
        const strip = plan.strips.find((candidate) => candidate.id === stripId);
        if (!strip || strip.status !== "blocked_by_nfz") return false;
        return stripCompletionTime(uav.route, strip.id) > replanTimeS;
      });
      const routeBlocked = routeIntersectsAnyNfz(futureRoute, plan.nfzs);
      const shouldRefreshPath = routeBlocked || blockedFutureWork || hasFutureNfzDetour(uav.route, replanTimeS);
      if (!shouldRefreshPath) return;

      uav.status = "replanned";
      const future = pendingAssignedStrips(plan, uav, replanTimeS).sort(
        (a, b) => a.order - b.order,
      );
      buildContinuationForUav(plan, uav, future, replanTimeS, index);
    });

  addMessage(
    plan,
    timeS + 5,
    "NFZ_EXCEPTION_TOKEN",
    source?.id ?? "UAV_1",
    `${nfz.id} exception token emitted; all UAVs recompute the same safe branch`,
    undefined,
    plan.uavs.filter((uav) => uav.status !== "lost").map((uav) => uav.id),
  );
  addEvent(
    plan,
    timeS + 6,
    "danger",
    `${nfz.id} placed; ${blocked.length} strip envelopes blocked and affected routes detoured`,
    source?.id,
  );

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function applyNfzSetUpdate(
  sourcePlan: MissionPlan,
  nfzs: Nfz[],
  requestedTimeS: number,
  sourceUavId?: string,
  label = "NFZ geometry",
): MissionPlan {
  const plan = clonePlan(sourcePlan);
  plan.metrics.before = {
    coveragePct: sourcePlan.metrics.coveragePct,
    missionCompletionTimeS: sourcePlan.metrics.missionCompletionTimeS,
    messagesUsed: sourcePlan.metrics.messagesUsed,
    coverageDebtStripCount: sourcePlan.metrics.coverageDebtStripCount,
  };
  plan.activeContingency = "nfz";

  const timeS = Math.max(0, requestedTimeS);
  plan.nfzs = nfzs.map((nfz) => ({ ...nfz, createdAtS: timeS }));

  if (timeS <= 0) {
    return rebuildPreflightNfzPlan(sourcePlan, plan.nfzs);
  }

  const source =
    plan.uavs.find((uav) => uav.id === sourceUavId && uav.status !== "lost") ??
    plan.uavs.find((uav) => uav.status !== "lost");
  const blocked = remarkNfzBlockedStrips(plan);

  plan.uavs
    .filter((uav) => uav.status !== "lost" && !uav.reserve)
    .forEach((uav, index) => {
      const routeEndS = uav.route.at(-1)?.t ?? 0;
      if (timeS >= routeEndS - 1) return;
      const replanTimeS = Math.min(routeEndS - 1, timeS + index * 3);
      const futureRoute: RouteWaypoint[] = [
        interpolateRoute(uav.route, replanTimeS),
        ...uav.route.filter((point) => point.t > replanTimeS),
      ];
      const blockedFutureWork = uav.assignedStripIds.some((stripId) => {
        const strip = plan.strips.find((candidate) => candidate.id === stripId);
        if (!strip || strip.status !== "blocked_by_nfz") return false;
        return stripCompletionTime(uav.route, strip.id) > replanTimeS;
      });
      const routeBlocked = routeIntersectsAnyNfz(futureRoute, plan.nfzs);
      const shouldRefreshPath = routeBlocked || blockedFutureWork || hasFutureNfzDetour(uav.route, replanTimeS);
      if (!shouldRefreshPath) return;

      uav.status = "replanned";
      const future = pendingAssignedStrips(plan, uav, replanTimeS).sort(
        (a, b) => a.order - b.order,
      );
      buildContinuationForUav(plan, uav, future, replanTimeS, index);
    });

  addMessage(
    plan,
    timeS + 5,
    "NFZ_EXCEPTION_TOKEN",
    source?.id ?? "UAV_1",
    `${label} updated; all UAVs recompute safe future branches from current positions`,
    undefined,
    plan.uavs
      .filter((uav) => uav.status !== "lost" && !uav.reserve)
      .map((uav) => uav.id),
  );
  addEvent(
    plan,
    timeS + 6,
    "warning",
    `${label} updated; ${blocked.length} strip envelopes blocked and active UAVs continue from live positions`,
    source?.id,
  );

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function applyBaseOfflineFailover(
  sourcePlan: MissionPlan,
  offlineBaseId: string,
  backupBase: HomeBase,
  requestedTimeS: number,
): MissionPlan {
  const plan = clonePlan(sourcePlan);
  const previousBase = plan.homeBase;
  const nextBase = normalizeHomeBase(backupBase);
  const timeS = Math.max(0, requestedTimeS);

  if (previousBase.id !== offlineBaseId || nextBase.id === offlineBaseId) {
    return plan;
  }

  plan.metrics.before = {
    coveragePct: sourcePlan.metrics.coveragePct,
    missionCompletionTimeS: sourcePlan.metrics.missionCompletionTimeS,
    messagesUsed: sourcePlan.metrics.messagesUsed,
    coverageDebtStripCount: sourcePlan.metrics.coverageDebtStripCount,
  };
  plan.activeContingency = "base_offline";
  plan.homeBase = { ...nextBase, available: true };
  plan.base = nextBase.point;

  let replannedCount = 0;
  plan.uavs
    .filter((uav) => uav.status !== "lost")
    .forEach((uav, index) => {
      const routeEndS = uav.route.at(-1)?.t ?? 0;
      if (timeS >= routeEndS - 1) return;

      const replanTimeS = timeS + index * 3;
      if (replanTimeS >= routeEndS - 1) return;
      const future = pendingAssignedStrips(plan, uav, replanTimeS).sort(
        (a, b) => a.order - b.order,
      );
      uav.status = uav.status === "regained" ? "regained" : "replanned";
      buildContinuationForUav(plan, uav, future, replanTimeS, index);
      replannedCount += 1;
    });

  addEvent(
    plan,
    timeS,
    "warning",
    `${previousBase.label} went offline; ${nextBase.label} activated for all unfinished landings`,
  );
  addEvent(
    plan,
    timeS + 3,
    "info",
    `${replannedCount} airborne UAV${replannedCount === 1 ? "" : "s"} kept assigned work and rerouted RTB to ${nextBase.label}`,
  );

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function applySignalRegain(
  sourcePlan: MissionPlan,
  uavId: string,
  requestedTimeS: number,
): MissionPlan {
  const sourceUav = sourcePlan.uavs.find((candidate) => candidate.id === uavId);
  if (!sourceUav || sourceUav.status !== "lost") return sourcePlan;
  const sourceLossDetectedAtS = sourceUav.lossDetectedAtS ?? sourceUav.lostAtS;

  const plan = clonePlan(sourcePlan);
  const uav = plan.uavs.find((candidate) => candidate.id === uavId);
  if (!uav || uav.status !== "lost") return sourcePlan;

  const communicationLostAtS = uav.communicationLostAtS ?? requestedTimeS;
  const timeS = Math.max(communicationLostAtS, requestedTimeS);
  const originalRoute = uav.originalRoute ?? uav.route;

  const removedReserveIds = new Set(
    plan.uavs
      .filter((candidate) => candidate.reserve && candidate.id.startsWith("UAV_R"))
      .map((candidate) => candidate.id),
  );
  const reclaimedStripIds = new Set<string>();
  if (removedReserveIds.size > 0) {
    plan.uavs = plan.uavs.filter((candidate) => !removedReserveIds.has(candidate.id));
    plan.strips.forEach((strip) => {
      if (!removedReserveIds.has(strip.assignedUavId)) return;
      strip.assignedUavId = uav.id;
      strip.status = "planned";
      reclaimedStripIds.add(strip.id);
    });
  }

  plan.strips.forEach((strip) => {
    if (strip.status === "blocked_by_nfz" || strip.status === "completed") return;
    if (stripCompletionTime(originalRoute, strip.id) <= timeS) return;

    const currentOwner = plan.uavs.find((candidate) => candidate.id === strip.assignedUavId);
    const alreadyCovered =
      currentOwner &&
      currentOwner.id !== uav.id &&
      stripCompletionTime(currentOwner.route, strip.id) <= timeS;
    if (alreadyCovered) return;

    strip.assignedUavId = uav.id;
    strip.status = "planned";
    reclaimedStripIds.add(strip.id);
  });

  const future = plan.strips
    .filter((strip) => {
      if (strip.assignedUavId !== uav.id) return false;
      if (strip.status === "blocked_by_nfz" || strip.status === "coverage_debt") return false;
      return reclaimedStripIds.has(strip.id) || stripCompletionTime(originalRoute, strip.id) > timeS;
    })
    .sort((a, b) => a.order - b.order);

  buildContinuationForUav(
    plan,
    uav,
    future,
    timeS,
    Math.max(0, plan.uavs.findIndex((candidate) => candidate.id === uav.id)),
  );
  uav.status = "regained";
  uav.regainedAtS = timeS;
  uav.lossDetectedAtS = undefined;
  uav.lostAtS = undefined;
  uav.lossPoint = undefined;

  plan.messages = plan.messages.filter((message) => {
    return !["REPLACEMENT_DISPATCH", "SWARM_REDISTRIBUTE"].includes(message.type);
  });
  if (sourceLossDetectedAtS !== undefined) {
    plan.events = plan.events.filter((event) => {
      if (event.timeS < sourceLossDetectedAtS) return true;
      const lowerText = event.text.toLowerCase();
      return !(
        lowerText.includes("launched from") ||
        lowerText.includes("rebalanced unfinished") ||
        lowerText.includes("redivided unfinished")
      );
    });
  }
  plan.activeContingency = undefined;

  addMessage(
    plan,
    timeS,
    "SIGNAL_REGAINED",
    uav.id,
    `${uav.label} signal regained; aircraft resumes unfinished mission work`,
    "BASE",
  );
  addEvent(
    plan,
    timeS,
    "success",
    `${uav.label} regained signal and is continuing ${future.length} unfinished strip${future.length === 1 ? "" : "s"}`,
    uav.id,
  );

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function armRtbDemo(sourcePlan: MissionPlan, timeS: number): MissionPlan {
  const plan = clonePlan(sourcePlan);
  plan.activeContingency = "rtb";
  addEvent(
    plan,
    timeS,
    "info",
    "RTB deconfliction view armed; arrival slots remain staggered by precompiled timing",
  );
  addMessage(
    plan,
    timeS + 4,
    "RTB_SLOT_SYNC",
    "BASE",
    "RTB slot sync shown as pre-mission timing contract",
    undefined,
    plan.uavs.map((uav) => uav.id),
  );
  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function sendHealthPing(
  sourcePlan: MissionPlan,
  uavId: string,
  timeS: number,
): MissionPlan {
  const plan = clonePlan(sourcePlan);
  const uav = plan.uavs.find((candidate) => candidate.id === uavId);
  if (!uav || uav.status === "lost") return plan;
  addMessage(
    plan,
    timeS,
    "HEALTH_EPOCH",
    uav.id,
    `${uav.label} emitted sparse health token`,
    "BASE",
  );
  addEvent(plan, timeS, "info", `${uav.label} sparse health token observed`, uav.id);
  plan.metrics = computeMissionMetrics(plan);
  return plan;
}
