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
import { buildRouteFromStart } from "@/lib/planner";
import {
  buildReturnRouteViaBaseWaypoint,
  routeIntersectsAnyNfz,
  safePathLength,
} from "@/lib/routing";
import type {
  CoverageStrip,
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
  if (plan.config.commsPolicy === "strict_silent" && countInMission) {
    addEvent(
      plan,
      timeS,
      "info",
      `${text}; precompiled branch activated locally without live transmission`,
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
    return stripCompletionTime(uav.originalRoute ?? uav.route, strip.id) > timeS;
  });
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
  rtbAnchorS: number,
) {
  const prefix = routeAtOrBefore(uav.route, startTimeS);
  const current = prefix[prefix.length - 1] ?? interpolateRoute(uav.route, startTimeS);
  const build = buildRouteFromStart(
    current,
    startTimeS,
    strips,
    plan.config,
    plan.homeBase,
    uavIndex,
    rtbAnchorS,
    false,
    plan.nfzs,
  );
  uav.originalRoute = uav.originalRoute ?? uav.route;
  uav.route = [...prefix, ...build.route.slice(1)];
  uav.coverageTimeS = build.coverageTimeS;
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

function redistributeRemainingStripsGreedy(
  plan: MissionPlan,
  sourcePlan: MissionPlan,
  activeUavs: UavPlan[],
  timeS: number,
): Map<string, CoverageStrip[]> {
  if (activeUavs.length === 0) return new Map();
  const activeIds = new Set(activeUavs.map((uav) => uav.id));
  const remaining = plan.strips
    .filter((strip) => {
      if (strip.status === "blocked_by_nfz") return false;
      const sourceOwner = sourcePlan.uavs.find((uav) => uav.id === strip.assignedUavId);
      if (!sourceOwner) return strip.status === "coverage_debt";
      return stripCompletionTime(sourceOwner.originalRoute ?? sourceOwner.route, strip.id) > timeS;
    })
    .sort((a, b) => a.order - b.order);

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

export function getUavSnapshot(
  uav: UavPlan,
  timeS: number,
): UavSnapshot {
  const point = interpolateRoute(uav.route, timeS);
  return {
    id: uav.id,
    label: uav.label,
    color: uav.color,
    x: point.x,
    y: point.y,
    headingDeg: routeHeadingDeg(uav.route, timeS),
    phase: uav.status === "lost" ? "lost" : point.phase,
    altitudeM: uav.altitudeM,
    progressPct: routeProgressPct(uav.route, timeS),
  };
}

export function getCurrentTask(uav: UavPlan, timeS: number): string {
  const point = interpolateRoute(uav.route, timeS);
  if (uav.status === "lost") return "Lost contact";
  if (uav.status === "regained") return "Signal regained; returning to base";
  if (point.stripId) return `Working ${point.stripId}`;
  if (point.phase === "loiter") return "Holding for RTB slot";
  if (point.phase === "return") return "Return-to-base corridor";
  if (point.phase === "detour") return "NFZ detour";
  if (point.phase === "replacement") return "Replacement insertion";
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
  const timeS = Math.max(90, Math.min(requestedTimeS, (failed.route.at(-1)?.t ?? 900) * 0.72));
  const failedIndex = plan.uavs.findIndex((uav) => uav.id === failed.id);
  const currentFailed = interpolateRoute(failed.route, timeS);
  failed.originalRoute = failed.originalRoute ?? failed.route;
  failed.route = [
    ...routeAtOrBefore(failed.route, timeS),
    { ...currentFailed, t: timeS + 1, phase: "lost", label: "lost contact" },
  ];
  failed.status = "lost";
  failed.lostAtS = timeS;
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
    return stripCompletionTime(sourceFailed.originalRoute ?? sourceFailed.route, strip.id) > timeS;
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
    timeS,
    "danger",
    fullSignal
      ? `${failed.label} missed health epoch; last GPS point retained for continuation`
      : `${failed.label} missed alive signal; full assigned sector queued for redo from base`,
    failed.id,
  );
  addMessage(
    plan,
    timeS + 4,
    "HEALTH_MISS",
    failed.id,
    `${failed.label} health epoch missed`,
    "BASE",
  );

  const activeUavs = plan.uavs.filter((uav) => uav.status !== "lost" && !uav.reserve);
  const rtbAnchorS = timeS + 420;

  if (!fullSignal && mode === "spread_remaining_swarm") {
    addEvent(
      plan,
      timeS + 7,
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
      timeS + 20,
      replacementStrips,
      plan.config,
      plan.homeBase,
      failedIndex >= 0 ? failedIndex : plan.uavs.length,
      rtbAnchorS,
      !fullSignal,
      plan.nfzs,
    );
    const replacementRoute = fullSignal
      ? [
          {
            ...replacementStart,
            t: timeS + 1,
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
    };
    recomputeUavUtilization(replacement);
    plan.uavs.push(replacement);
    addMessage(
      plan,
      timeS + 12,
      "REPLACEMENT_DISPATCH",
      "BASE",
      fullSignal
        ? "Full-signal loss: replacement continues from last GPS point"
        : "Silent loss: replacement redoes the full lost sector from base",
      replacementId,
    );
    addEvent(
      plan,
      timeS + 18,
      "warning",
      fullSignal
        ? `${replacement.label} continued from ${failed.label} loss point for ${replacementStrips.length} remaining strips`
        : `${replacement.label} launched from base to redo ${replacementStrips.length} strips without using loss GPS`,
      replacementId,
    );
  } else {
    const workByUav = redistributeRemainingStripsGreedy(plan, sourcePlan, activeUavs, timeS);

    activeUavs.forEach((uav, index) => {
      const future = workByUav.get(uav.id) ?? pendingAssignedStrips(plan, uav, timeS);
      uav.status = "replanned";
      uav.assignedStripIds = plan.strips
        .filter((strip) => strip.assignedUavId === uav.id)
        .map((strip) => strip.id);
      buildContinuationForUav(plan, uav, future, timeS + index * 8, index, rtbAnchorS);
    });
    addMessage(
      plan,
      timeS + 10,
      "SWARM_REDISTRIBUTE",
      "BASE",
      "Full-signal loss: remaining strips redistributed from current UAV positions",
      undefined,
      activeUavs.map((uav) => uav.id),
    );
    addEvent(
      plan,
      timeS + 15,
      "warning",
      `Greedy spread rebalanced unfinished strips across ${activeUavs.map((uav) => uav.label).join(", ")}`,
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

  const timeS = Math.max(60, requestedTimeS);
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

  const blocked = plan.strips.filter((strip) => {
    if (strip.status === "coverage_debt") return false;
    if (nfz.polygon?.length) {
      return (
        pointInPolygon(strip.center, nfz.polygon) ||
        segmentIntersectsPolygon(strip.start, strip.end, nfz.polygon)
      );
    }
    return (
      segmentDistanceToPoint(strip.start, strip.end, nfz.center) <=
      nfz.radiusM + plan.config.sensorSwathM * 0.5
    );
  });
  blocked.forEach((blockedStrip) => {
    const strip = plan.strips.find((candidate) => candidate.id === blockedStrip.id);
    if (strip) strip.status = "blocked_by_nfz";
  });

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
        return stripCompletionTime(uav.originalRoute ?? uav.route, strip.id) > replanTimeS;
      });
      if (!routeIntersectsAnyNfz(futureRoute, plan.nfzs) && !blockedFutureWork) return;

      const future = pendingAssignedStrips(plan, uav, replanTimeS).sort(
        (a, b) => a.order - b.order,
      );
      uav.status = "replanned";
      buildContinuationForUav(plan, uav, future, replanTimeS, index, timeS + 420);
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
