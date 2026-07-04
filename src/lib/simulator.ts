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
import { buildRouteFromStart, generateMissionPlanFromArea } from "@/lib/planner";
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
  const silentAllowsMessage = type === "HEALTH_EPOCH" || type === "HEALTH_MISS";
  if (plan.config.commsPolicy === "silent_operation" && countInMission && !silentAllowsMessage) {
    addEvent(
      plan,
      timeS,
      "info",
      `${text}; silent operation kept GPS and command traffic off-net`,
      sourceId,
    );
    return;
  }

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
    if (strip.status === "blocked_by_nfz") return false;
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
    .filter((strip) => strip.assignedUavId === uav.id && strip.status !== "coverage_debt")
    .map((strip) => strip.id);
  recomputeUavUtilization(uav);
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
      if (strip.status === "blocked_by_nfz") return false;
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
      return "Communication lost; holding original path";
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

  const failed = plan.uavs.find((uav) => uav.id === failedUavId) ?? plan.uavs[2] ?? plan.uavs[0];
  const routeEndS = failed.route.at(-1)?.t ?? 900;
  const communicationLostAtS = Math.max(90, Math.min(requestedTimeS, routeEndS * 0.72));
  const lossDetectedAtS = Math.min(
    Math.max(communicationLostAtS + 1, routeEndS - 1),
    communicationLostAtS + COMMUNICATION_LOSS_PERIOD_S,
  );
  const failedIndex = plan.uavs.findIndex((uav) => uav.id === failed.id);
  const currentFailed = interpolateRoute(failed.route, lossDetectedAtS);
  failed.originalRoute = failed.originalRoute ?? failed.route;
  failed.route = [
    ...routeAtOrBefore(failed.route, lossDetectedAtS),
    { ...currentFailed, t: lossDetectedAtS + 1, phase: "lost", label: "lost contact" },
  ];
  failed.status = "lost";
  failed.communicationLostAtS = communicationLostAtS;
  failed.lossDetectedAtS = lossDetectedAtS;
  failed.lostAtS = lossDetectedAtS;
  failed.lossPoint = currentFailed;
  failed.assignedStripIds = [];
  failed.utilizationPct = 0;
  failed.coverageTimeS = 0;

  const sourceFailed = sourcePlan.uavs.find((uav) => uav.id === failed.id);
  const debtStrips = sourcePlan.strips.filter((strip) => {
    if (strip.assignedUavId !== failed.id) return false;
    if (strip.status === "blocked_by_nfz") return false;
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
    `${failed.label} communication lost; all UAVs continue original paths for ${COMMUNICATION_LOSS_PERIOD_S}s`,
    failed.id,
  );
  addEvent(
    plan,
    lossDetectedAtS,
    "danger",
    fullSignal
      ? `${failed.label} missed health epoch; last GPS point retained for continuation`
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
    const replacementStart = fullSignal ? currentFailed : plan.homeBase.point;
    const build = buildRouteFromStart(
      replacementStart,
      lossDetectedAtS + 20,
      replacementStrips,
      plan.config,
      plan.homeBase,
      failedIndex >= 0 ? failedIndex : plan.uavs.length,
      !fullSignal,
      plan.nfzs,
    );
    const replacementRoute = fullSignal
      ? [
          {
            ...replacementStart,
            t: lossDetectedAtS + 1,
            phase: "replacement" as const,
            label: "last GPS continuation point",
          },
          ...build.route.slice(1).map((point) => ({
            ...point,
            phase: point.phase === "transit" ? ("replacement" as const) : point.phase,
          })),
        ]
      : build.route.map((point) => ({
          ...point,
          phase: point.phase === "transit" ? ("replacement" as const) : point.phase,
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
      .filter((strip) => strip.assignedUavId === replacementId && strip.status !== "coverage_debt")
      .map((strip) => strip.id);
    recomputeUavUtilization(replacement);
    plan.uavs.push(replacement);
    addMessage(
      plan,
      lossDetectedAtS + 12,
      "REPLACEMENT_DISPATCH",
      "BASE",
      fullSignal
        ? "Full-signal loss: replacement continues from last GPS point"
        : "Silent loss: replacement redoes the full lost sector from base",
      replacementId,
    );
    addEvent(
      plan,
      lossDetectedAtS + 18,
      "warning",
      fullSignal
        ? `${replacement.label} continued from ${failed.label} loss point for ${replacementStrips.length} remaining strips`
        : `${replacement.label} launched from base to redo ${replacementStrips.length} strips without using loss GPS`,
      replacementId,
    );
  } else {
    const nearestInfill = plan.config.pathPattern === "nearest_infill";
    const workByUav = nearestInfill
      ? redistributeRemainingStripsGreedy(plan, sourcePlan, activeUavs, lossDetectedAtS)
      : redistributeRemainingStripsBySector(plan, sourcePlan, activeUavs, lossDetectedAtS);

    activeUavs.forEach((uav, index) => {
      const future = workByUav.get(uav.id) ?? pendingAssignedStrips(plan, uav, lossDetectedAtS);
      uav.status = "replanned";
      uav.assignedStripIds = plan.strips
        .filter((strip) => strip.assignedUavId === uav.id)
        .map((strip) => strip.id);
      buildContinuationForUav(plan, uav, future, lossDetectedAtS + index * 8, index);
    });
    addMessage(
      plan,
      lossDetectedAtS + 10,
      "SWARM_REDISTRIBUTE",
      "BASE",
      nearestInfill
        ? "Full-signal loss: nearest-infill spread redistributed strips from current UAV positions"
        : "Full-signal loss: sector-lane spread redistributed contiguous remaining zones",
      undefined,
      activeUavs.map((uav) => uav.id),
    );
    addEvent(
      plan,
      lossDetectedAtS + 15,
      "warning",
      nearestInfill
        ? `Nearest-infill spread rebalanced unfinished strips across ${activeUavs.map((uav) => uav.label).join(", ")}`
        : `Sector spread redivided unfinished coverage zones across ${activeUavs.map((uav) => uav.label).join(", ")}`,
    );
  }

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
  const plan = clonePlan(sourcePlan);
  const uav = plan.uavs.find((candidate) => candidate.id === uavId);
  if (!uav || uav.status !== "lost") return plan;

  const routeEndS = uav.route.at(-1)?.t ?? requestedTimeS;
  const timeS = Math.max(requestedTimeS, uav.lostAtS ?? routeEndS);
  const regainPoint = uav.lossPoint ?? interpolateRoute(uav.originalRoute ?? uav.route, timeS);
  const prefix = routeAtOrBefore(uav.route, Math.min(timeS, routeEndS));
  const returnRoute = buildReturnRouteViaBaseWaypoint({
    start: regainPoint,
    startTimeS: timeS,
    base: plan.homeBase,
    config: plan.config,
    nfzs: plan.nfzs,
    uavIndex: Math.max(0, plan.uavs.findIndex((candidate) => candidate.id === uav.id)),
  });
  const prefixLast = prefix[prefix.length - 1];
  const stitchedReturn =
    prefixLast && distance(prefixLast, returnRoute[0]) < 1 && prefixLast.t === returnRoute[0].t
      ? returnRoute.slice(1)
      : returnRoute;

  uav.originalRoute = uav.originalRoute ?? uav.route;
  uav.route = [...prefix, ...stitchedReturn];
  uav.status = "regained";
  uav.regainedAtS = timeS;
  uav.rtbSlotS = uav.route.at(-1)?.t ?? uav.rtbSlotS;
  uav.utilizationPct = 0;

  addMessage(
    plan,
    timeS,
    "SIGNAL_REGAINED",
    uav.id,
    `${uav.label} signal regained; aircraft returning through inbound waypoint`,
    "BASE",
  );
  addEvent(
    plan,
    timeS,
    "success",
    `${uav.label} regained signal and is routing back to ${plan.homeBase.label}`,
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
