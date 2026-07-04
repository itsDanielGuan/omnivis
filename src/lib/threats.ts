import { distance, interpolateRoute } from "@/lib/geometry";
import { detectionRadiusM } from "@/lib/geometry";
import { computeMissionMetrics } from "@/lib/metrics";
import { buildRouteFromStart, contingencyInfillPattern } from "@/lib/planner";
import {
  appendSafeLeg,
  buildReturnRouteViaBaseWaypoint,
  normalizeHomeBase,
} from "@/lib/routing";
import type {
  CoverageStrip,
  MissionEvent,
  MissionPlan,
  Nfz,
  Point,
  RouteWaypoint,
  StrikeType,
  Threat,
  ThreatKind,
  UavPlan,
} from "@/lib/types";

// --- Tunable engagement constants -----------------------------------------

const CONFIRM_DELAY_S = 8; // delay before the 2nd drone peels off to confirm
const MERCHANT_DWELL_S = 24; // confirmation dwell before a merchant is cleared
const LOITER_HOLD_S = 120; // fixed loiter-hold before a medium/large is cleared
const STRIKE_LAUNCH_DELAY_S = 15; // ground time before the strike package launches
const CONTINUOUS_SPACING_S = 26; // gap between sequential impacts (continuous strike)
const SATURATION_CONVERGE_S = 28; // simultaneous-strike run-in once the ring is set

const STRIKE_COLOR = "#f43f5e";
const STRIKE_SOFT = "rgba(244, 63, 94, 0.22)";

export const STRIKE_DEFAULTS: Record<
  ThreatKind,
  { type: StrikeType; count: number; min: number; max: number }
> = {
  merchant: { type: "continuous", count: 1, min: 1, max: 3 },
  small: { type: "continuous", count: 3, min: 1, max: 6 },
  large: { type: "saturation", count: 12, min: 6, max: 20 },
};

// --- Small local geometry helpers -----------------------------------------

function clonePlan(plan: MissionPlan): MissionPlan {
  return JSON.parse(JSON.stringify(plan)) as MissionPlan;
}

function waypoint(
  point: Point,
  t: number,
  phase: RouteWaypoint["phase"],
  extra?: Partial<RouteWaypoint>,
): RouteWaypoint {
  return { x: point.x, y: point.y, t, phase, ...extra };
}

function pointOnCircle(center: Point, radius: number, angle: number): Point {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function ringEntryPoint(center: Point, from: Point, radius: number): Point {
  const angle = Math.atan2(from.y - center.y, from.x - center.x);
  return pointOnCircle(center, radius, Number.isFinite(angle) ? angle : 0);
}

function addEvent(
  plan: MissionPlan,
  timeS: number,
  severity: MissionEvent["severity"],
  text: string,
  uavId?: string,
) {
  plan.events.push({
    id: `EVT_${String(plan.events.length + 1).padStart(3, "0")}_THR`,
    timeS,
    severity,
    text,
    uavId,
  });
}

function loiterRadiusM(config: MissionPlan["config"], kind: ThreatKind): number {
  const base = Math.max(config.sensorSwathM * 0.9, 260);
  if (kind === "large") return base + 220;
  if (kind === "small") return base + 120;
  return base;
}

function keepOutRadiusM(kind: ThreatKind): number {
  if (kind === "large") return 340;
  if (kind === "small") return 230;
  return 160;
}

function threatKeepOut(threat: Threat): Nfz {
  return {
    id: `THR_KEEPOUT_${threat.id}`,
    center: threat.point,
    radiusM: keepOutRadiusM(threat.kind),
    createdAtS: threat.createdAtS,
  };
}

// How long the discoverer/confirm drones keep orbiting a hostile contact while
// waiting for the operator's decision (the sim pauses at the decision point, so
// this only needs to cover scrubbing a bit past it).
const AWAIT_ORBIT_S = 1200;

// --- Route splicing helpers -----------------------------------------------

function splicePrefix(route: RouteWaypoint[], timeS: number): RouteWaypoint[] {
  const current = { ...interpolateRoute(route, timeS), t: timeS };
  return [...route.filter((point) => point.t < timeS - 0.05), current];
}

function safeLegFrom(
  current: RouteWaypoint,
  to: Point,
  speedMps: number,
  phase: RouteWaypoint["phase"],
  nfzs: Nfz[],
  uavIndex: number,
  extra?: Partial<RouteWaypoint>,
): RouteWaypoint[] {
  const tmp: RouteWaypoint[] = [current];
  appendSafeLeg(tmp, to, speedMps, phase, nfzs, uavIndex, extra);
  return tmp.slice(1);
}

function straightLeg(
  from: RouteWaypoint,
  to: Point,
  speedMps: number,
  phase: RouteWaypoint["phase"],
  label: string,
): RouteWaypoint {
  const t = from.t + distance(from, to) / Math.max(1, speedMps);
  return waypoint(to, t, phase, { label });
}

function loiterOrbit(
  center: Point,
  radius: number,
  entry: Point,
  startS: number,
  speedMps: number,
  durationS: number,
  label: string,
): RouteWaypoint[] {
  if (durationS <= 0) return [];
  const steps = 16;
  const startAngle = Math.atan2(entry.y - center.y, entry.x - center.x);
  const circumference = 2 * Math.PI * radius;
  const legTimeS = circumference / steps / Math.max(1, speedMps);
  const points: RouteWaypoint[] = [];
  let t = startS;
  for (let i = 1; t - startS < durationS && i < steps * 200; i += 1) {
    const angle = startAngle + (2 * Math.PI * i) / steps;
    t += legTimeS;
    points.push(waypoint(pointOnCircle(center, radius, angle), t, "loiter", { label }));
  }
  return points;
}

// --- Strip helpers (local copies of the private simulator ones) -----------

function stripCompletionTime(route: RouteWaypoint[], stripId: string): number {
  return Math.max(
    -1,
    ...route
      .filter((point) => point.stripId === stripId && point.phase === "covering")
      .map((point) => point.t),
  );
}

function pendingStripsForUav(
  plan: MissionPlan,
  uav: UavPlan,
  timeS: number,
): CoverageStrip[] {
  const reference = uav.originalRoute ?? uav.route;
  return plan.strips
    .filter((strip) => {
      if (strip.assignedUavId !== uav.id) return false;
      if (strip.status === "blocked_by_nfz" || strip.status === "completed") return false;
      return stripCompletionTime(reference, strip.id) > timeS;
    })
    .sort((a, b) => a.order - b.order);
}

function recomputeUav(plan: MissionPlan, uav: UavPlan) {
  uav.assignedStripIds = plan.strips
    .filter((strip) => strip.assignedUavId === uav.id && strip.status === "planned")
    .map((strip) => strip.id);
  const end = uav.route.at(-1)?.t ?? 1;
  uav.utilizationPct = Math.min(100, (uav.coverageTimeS / Math.max(1, end)) * 100);
  uav.rtbSlotS = end;
}

// --- Tails: resume search / return to base --------------------------------

function resumeSearchTail(
  plan: MissionPlan,
  uav: UavPlan,
  fromPoint: RouteWaypoint,
  uavIndex: number,
): { tail: RouteWaypoint[]; coverageTimeS: number } {
  const pending = pendingStripsForUav(plan, uav, fromPoint.t);
  const build = buildRouteFromStart(
    { x: fromPoint.x, y: fromPoint.y },
    fromPoint.t,
    pending,
    plan.config,
    plan.homeBase,
    uavIndex,
    false,
    plan.nfzs,
    contingencyInfillPattern(plan.config),
  );
  return { tail: build.route.slice(1), coverageTimeS: build.coverageTimeS };
}

function returnTail(
  plan: MissionPlan,
  fromPoint: RouteWaypoint,
  uavIndex: number,
): RouteWaypoint[] {
  const route = buildReturnRouteViaBaseWaypoint({
    start: { x: fromPoint.x, y: fromPoint.y },
    startTimeS: fromPoint.t,
    base: plan.homeBase,
    config: plan.config,
    nfzs: plan.nfzs,
    uavIndex,
  });
  return route.slice(1).map((point) => ({ ...point, phase: "return" as const }));
}

// --- Stationing a drone on a loiter ring -----------------------------------

type Station = {
  prefix: RouteWaypoint[];
  approach: RouteWaypoint[];
  entry: Point;
  orbitStartS: number;
};

function stationDrone(
  plan: MissionPlan,
  uav: UavPlan,
  threat: Threat,
  startS: number,
  radius: number,
  avoidNfzs: Nfz[],
  uavIndex: number,
  label: string,
): Station {
  uav.originalRoute = uav.originalRoute ?? uav.route;
  const prefix = splicePrefix(uav.route, startS);
  const current = prefix.at(-1) as RouteWaypoint;
  const entry = ringEntryPoint(threat.point, current, radius);
  const approach = safeLegFrom(current, entry, plan.config.speedMps, "transit", avoidNfzs, uavIndex, {
    label,
  });
  const orbitStartS = approach.at(-1)?.t ?? startS;
  return { prefix, approach, entry, orbitStartS };
}

function orbitStation(
  plan: MissionPlan,
  threat: Threat,
  station: Station,
  radius: number,
  untilS: number,
  label: string,
): RouteWaypoint[] {
  return loiterOrbit(
    threat.point,
    radius,
    station.entry,
    station.orbitStartS,
    plan.config.speedMps,
    Math.max(0, untilS - station.orbitStartS),
    label,
  );
}

// --- Detection -------------------------------------------------------------

function isCoverageSearcher(uav: UavPlan): boolean {
  return (
    !uav.reserve &&
    !uav.combat &&
    uav.threatRole === undefined &&
    uav.status !== "lost" &&
    uav.status !== "regained"
  );
}

function earliestDetection(
  plan: MissionPlan,
  point: Point,
  fromTimeS: number,
): { uav: UavPlan; timeS: number } | undefined {
  let best: { uav: UavPlan; timeS: number } | undefined;
  let fallback: { uav: UavPlan; timeS: number; dist: number } | undefined;

  plan.uavs.filter(isCoverageSearcher).forEach((uav) => {
    const radius = detectionRadiusM(plan.config, uav.altitudeM);
    const end = uav.route.at(-1)?.t ?? 0;
    const start = Math.max(fromTimeS, uav.route[0]?.t ?? 0);
    for (let t = start; t <= end; t += 1) {
      const pos = interpolateRoute(uav.route, t);
      const d = distance(pos, point);
      if (!fallback || d < fallback.dist) fallback = { uav, timeS: t, dist: d };
      if (d <= radius) {
        if (!best || t < best.timeS) best = { uav, timeS: t };
        break;
      }
    }
  });

  if (best) return best;
  return fallback ? { uav: fallback.uav, timeS: fallback.timeS } : undefined;
}

function nearestOtherSearcher(
  plan: MissionPlan,
  exclude: UavPlan,
  point: Point,
  timeS: number,
): UavPlan | undefined {
  return plan.uavs
    .filter((uav) => uav.id !== exclude.id && isCoverageSearcher(uav))
    .map((uav) => ({ uav, d: distance(interpolateRoute(uav.route, timeS), point) }))
    .sort((a, b) => a.d - b.d)[0]?.uav;
}

function threatLabel(kind: ThreatKind): string {
  if (kind === "merchant") return "merchant / friendly contact";
  if (kind === "small") return "small enemy vehicle";
  return "large enemy threat";
}

// --- applyThreat -----------------------------------------------------------

export function applyThreat(
  sourcePlan: MissionPlan,
  kind: ThreatKind,
  point: Point,
  requestedTimeS: number,
): MissionPlan {
  const plan = clonePlan(sourcePlan);
  const timeS = Math.max(0, requestedTimeS);
  const threat: Threat = {
    id: `THR_${plan.threats.length + 1}`,
    kind,
    point,
    createdAtS: timeS,
    phase: "confirming",
  };
  plan.threats.push(threat);

  const detection = earliestDetection(plan, point, timeS);
  if (!detection) {
    addEvent(plan, timeS, "warning", `${threatLabel(kind)} placed but no searching UAV can reach it`);
    plan.metrics = computeMissionMetrics(plan);
    return plan;
  }

  const discoverer = plan.uavs.find((uav) => uav.id === detection.uav.id) as UavPlan;
  const detectedAtS = detection.timeS;
  threat.detectedByUavId = discoverer.id;
  threat.detectedAtS = detectedAtS;

  const keepOut = threatKeepOut(threat);
  const avoidNfzs = [...plan.nfzs, keepOut];
  const discovererIndex = plan.uavs.findIndex((uav) => uav.id === discoverer.id);
  const loiterR = loiterRadiusM(plan.config, kind);

  // Second drone (nearest other searcher) is dispatched to confirm.
  const second = nearestOtherSearcher(plan, discoverer, point, detectedAtS);
  const secondIndex = second
    ? plan.uavs.findIndex((uav) => uav.id === second.id)
    : -1;
  const secondStartS = detectedAtS + CONFIRM_DELAY_S;
  const secondStation = second
    ? stationDrone(plan, second, threat, secondStartS, loiterR + 90, avoidNfzs, secondIndex, "vectoring to confirm contact")
    : undefined;
  const confirmArrivalS = secondStation
    ? secondStation.orbitStartS
    : detectedAtS + 60;
  threat.confirmUavId = second?.id;
  threat.confirmArrivalS = confirmArrivalS;

  const isFriendly = kind === "merchant";
  const resolveS = isFriendly ? confirmArrivalS + MERCHANT_DWELL_S : undefined;
  const untilS = resolveS ?? confirmArrivalS + AWAIT_ORBIT_S;

  // Discoverer loiters the contact.
  const discovererStation = stationDrone(
    plan,
    discoverer,
    threat,
    detectedAtS,
    loiterR,
    avoidNfzs,
    discovererIndex,
    "loitering new contact",
  );
  const discovererOrbit = orbitStation(plan, threat, discovererStation, loiterR, untilS, "loitering contact");
  discoverer.status = "replanned";
  discoverer.threatId = threat.id;
  if (isFriendly) {
    const holdEnd = discovererOrbit.at(-1) ?? discovererStation.approach.at(-1) ?? discovererStation.prefix.at(-1);
    const resume = resumeSearchTail(plan, discoverer, holdEnd as RouteWaypoint, discovererIndex);
    discoverer.route = [
      ...discovererStation.prefix,
      ...discovererStation.approach,
      ...discovererOrbit,
      ...resume.tail,
    ];
    discoverer.coverageTimeS += resume.coverageTimeS;
    discoverer.threatId = undefined;
  } else {
    discoverer.route = [
      ...discovererStation.prefix,
      ...discovererStation.approach,
      ...discovererOrbit,
    ];
  }
  recomputeUav(plan, discoverer);

  // Second drone loiters then (for merchant) returns to base.
  if (second && secondStation) {
    const secondOrbit = orbitStation(plan, threat, secondStation, loiterR + 90, untilS, "confirming contact");
    second.status = "replanned";
    second.threatRole = "confirm";
    second.threatId = threat.id;
    if (isFriendly) {
      const holdEnd = secondOrbit.at(-1) ?? secondStation.approach.at(-1) ?? secondStation.prefix.at(-1);
      const rtb = returnTail(plan, holdEnd as RouteWaypoint, secondIndex);
      second.route = [
        ...secondStation.prefix,
        ...secondStation.approach,
        ...secondOrbit,
        ...rtb,
      ];
    } else {
      second.route = [
        ...secondStation.prefix,
        ...secondStation.approach,
        ...secondOrbit,
      ];
    }
    recomputeUav(plan, second);
  }

  addEvent(
    plan,
    detectedAtS,
    "warning",
    `${discoverer.label} detected a ${threatLabel(kind)} and is loitering the contact`,
    discoverer.id,
  );
  if (second) {
    addEvent(
      plan,
      secondStartS,
      "info",
      `${second.label} dispatched to confirm the contact; remaining swarm keeps searching`,
      second.id,
    );
  }

  if (isFriendly && resolveS !== undefined) {
    threat.phase = "friendly";
    threat.resolvedAtS = resolveS;
    addEvent(
      plan,
      resolveS,
      "success",
      `Contact confirmed friendly (merchant); ${discoverer.label} resumes search, ${second?.label ?? "escort"} returns to base`,
    );
  } else {
    threat.phase = "awaiting_decision";
    addEvent(
      plan,
      confirmArrivalS,
      "danger",
      `${threatLabel(kind)} confirmed hostile; operator decision required (loiter or strike)`,
    );
  }

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

// --- Decision (loiter or strike) ------------------------------------------

export type ThreatDecision =
  | { action: "loiter" }
  | { action: "strike"; strikeType: StrikeType; droneCount: number };

function currentRadius(prefix: RouteWaypoint[], center: Point, fallback: number): number {
  const last = prefix.at(-1);
  if (!last) return fallback;
  const d = distance(last, center);
  return d > 40 ? d : fallback;
}

function truncateAndHold(
  plan: MissionPlan,
  uav: UavPlan,
  threat: Threat,
  untilS: number,
  label: string,
): RouteWaypoint {
  const prefix = uav.route.filter((point) => point.t <= (threat.confirmArrivalS ?? 0) + 0.05);
  const anchor = (prefix.at(-1) ?? interpolateRoute(uav.route, threat.confirmArrivalS ?? 0)) as RouteWaypoint;
  const radius = currentRadius(prefix, threat.point, loiterRadiusM(plan.config, threat.kind));
  const orbit = loiterOrbit(
    threat.point,
    radius,
    anchor,
    anchor.t,
    plan.config.speedMps,
    Math.max(0, untilS - anchor.t),
    label,
  );
  uav.route = [...prefix, ...orbit];
  return (orbit.at(-1) ?? anchor) as RouteWaypoint;
}

function makeStrikeUav(
  plan: MissionPlan,
  threat: Threat,
  index: number,
  route: RouteWaypoint[],
): UavPlan {
  return {
    id: `STK-${plan.threats.length}-${index + 1}`,
    label: `STK-${index + 1}`,
    color: STRIKE_COLOR,
    colorSoft: STRIKE_SOFT,
    altitudeM: plan.config.altitudeLayerStartM,
    status: "replanned",
    combat: true,
    threatRole: "strike",
    threatId: threat.id,
    assignedStripIds: [],
    route,
    rtbSlotS: route.at(-1)?.t ?? 0,
    utilizationPct: 0,
    coverageTimeS: 0,
  };
}

function buildStrikePackage(
  plan: MissionPlan,
  threat: Threat,
  strikeType: StrikeType,
  droneCount: number,
  launchS: number,
): number {
  const base = normalizeHomeBase(plan.strikeBase ?? plan.homeBase);
  const keepOut = threatKeepOut(threat);
  const avoidNfzs = [...plan.nfzs, keepOut];
  const speed = plan.config.speedMps;
  const approachRadius = keepOut.radiusM + 60;
  const count = Math.max(1, Math.round(droneCount));
  let finalImpactS = launchS;

  if (strikeType === "saturation") {
    // Fan out to a surrounding ring, hold, then strike simultaneously.
    const ringRadius = keepOut.radiusM + 120;
    const stations = Array.from({ length: count }, (_, i) => {
      const angle = (2 * Math.PI * i) / count;
      const ringPoint = pointOnCircle(threat.point, ringRadius, angle);
      const startS = launchS + i * 2;
      const start = waypoint(base.point, startS, "preflight", { label: "strike standby" });
      const approach = safeLegFrom(start, ringPoint, speed, "transit", avoidNfzs, i, {
        label: "ingress to saturation ring",
      });
      const arriveS = approach.at(-1)?.t ?? startS;
      return { start, approach, ringPoint, arriveS };
    });
    const dashTimeS = ringRadius / Math.max(1, speed);
    const impactS = Math.max(...stations.map((s) => s.arriveS)) + Math.max(SATURATION_CONVERGE_S, dashTimeS + 6);
    finalImpactS = impactS;
    stations.forEach((station, i) => {
      const holdUntil = Math.max(station.arriveS, impactS - dashTimeS);
      const ringAnchor = waypoint(station.ringPoint, holdUntil, "loiter", { label: "saturation hold" });
      const impact = waypoint(threat.point, impactS, "strike", { label: "simultaneous strike" });
      const route = [station.start, ...station.approach, ringAnchor, impact];
      plan.uavs.push(makeStrikeUav(plan, threat, i, route));
    });
  } else {
    // Continuous: launch one at a time, impact sequentially.
    for (let i = 0; i < count; i += 1) {
      const startS = launchS + i * CONTINUOUS_SPACING_S;
      const start = waypoint(base.point, startS, "preflight", { label: "strike standby" });
      const approachPoint = ringEntryPoint(threat.point, base.point, approachRadius);
      const approach = safeLegFrom(start, approachPoint, speed, "transit", avoidNfzs, i, {
        label: "ingress corridor",
      });
      const runIn = approach.at(-1) ?? start;
      const impact = straightLeg(runIn as RouteWaypoint, threat.point, speed, "strike", "strike run");
      finalImpactS = Math.max(finalImpactS, impact.t);
      plan.uavs.push(makeStrikeUav(plan, threat, i, [start, ...approach, impact]));
    }
  }

  return finalImpactS;
}

export function applyThreatDecision(
  sourcePlan: MissionPlan,
  threatId: string,
  decision: ThreatDecision,
): MissionPlan {
  const source = sourcePlan.threats.find((threat) => threat.id === threatId);
  if (!source || source.phase !== "awaiting_decision") return sourcePlan;

  const plan = clonePlan(sourcePlan);
  const threat = plan.threats.find((candidate) => candidate.id === threatId) as Threat;
  const decisionS = threat.confirmArrivalS ?? 0;

  const discoverer = plan.uavs.find((uav) => uav.id === threat.detectedByUavId);
  const second = plan.uavs.find((uav) => uav.id === threat.confirmUavId);
  const discovererIndex = plan.uavs.findIndex((uav) => uav.id === discoverer?.id);
  const secondIndex = plan.uavs.findIndex((uav) => uav.id === second?.id);

  let resolveS: number;
  if (decision.action === "loiter") {
    threat.phase = "loiter_hold";
    resolveS = decisionS + LOITER_HOLD_S;
    addEvent(
      plan,
      decisionS,
      "info",
      `Operator ordered loiter-hold on the ${threatLabel(threat.kind)}; will clear as friendly after hold`,
    );
    addEvent(
      plan,
      resolveS,
      "success",
      `Loiter-hold elapsed; ${threatLabel(threat.kind)} treated as friendly`,
    );
    threat.phase = "friendly";
    threat.resolvedAtS = resolveS;
  } else {
    const launchS = decisionS + STRIKE_LAUNCH_DELAY_S;
    const impactS = buildStrikePackage(plan, threat, decision.strikeType, decision.droneCount, launchS);
    threat.strike = {
      type: decision.strikeType,
      droneCount: Math.max(1, Math.round(decision.droneCount)),
      baseId: (plan.strikeBase ?? plan.homeBase).id,
      launchS,
      impactS,
    };
    resolveS = impactS;
    threat.phase = "destroyed";
    threat.resolvedAtS = impactS;
    addEvent(
      plan,
      launchS,
      "danger",
      `${decision.strikeType === "saturation" ? "Saturation" : "Continuous"} strike launched (${Math.max(1, Math.round(decision.droneCount))} drones) from ${(plan.strikeBase ?? plan.homeBase).label}`,
    );
    addEvent(plan, impactS, "danger", `${threatLabel(threat.kind)} destroyed`);
  }

  // Discoverer holds until resolution, then resumes searching.
  if (discoverer) {
    const holdEnd = truncateAndHold(plan, discoverer, threat, resolveS, "observing target");
    const resume = resumeSearchTail(plan, discoverer, holdEnd, discovererIndex);
    discoverer.route = [...discoverer.route, ...resume.tail];
    discoverer.coverageTimeS += resume.coverageTimeS;
    discoverer.threatId = undefined;
    recomputeUav(plan, discoverer);
  }

  // Confirm drone holds until resolution, then returns to base.
  if (second) {
    const holdEnd = truncateAndHold(plan, second, threat, resolveS, "confirming target");
    const rtb = returnTail(plan, holdEnd, secondIndex);
    second.route = [...second.route, ...rtb];
    recomputeUav(plan, second);
  }

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function hasPendingThreatDecision(plan: MissionPlan | null): boolean {
  return Boolean(plan?.threats.some((threat) => threat.phase === "awaiting_decision"));
}

export function nextThreatDecisionTimeS(
  plan: MissionPlan | null,
  afterTimeS: number,
): number | undefined {
  if (!plan) return undefined;
  const times = plan.threats
    .filter((threat) => threat.phase === "awaiting_decision")
    .map((threat) => threat.confirmArrivalS ?? 0)
    .filter((t) => t > afterTimeS + 0.01);
  return times.length ? Math.min(...times) : undefined;
}

export function pendingThreatAt(
  plan: MissionPlan | null,
  timeS: number,
): Threat | undefined {
  return plan?.threats.find(
    (threat) =>
      threat.phase === "awaiting_decision" && (threat.confirmArrivalS ?? 0) <= timeS + 0.5,
  );
}

// Apply the default (loiter) resolution to any hostile contact whose 2nd drone
// has already arrived but the operator never chose — used when the operator
// simply presses play again.
export function defaultLoiterForArrivedThreats(
  plan: MissionPlan,
  timeS: number,
): MissionPlan {
  let next = plan;
  let guard = 0;
  while (guard < 12) {
    const pending = next.threats.find(
      (threat) =>
        threat.phase === "awaiting_decision" && (threat.confirmArrivalS ?? 0) <= timeS + 0.5,
    );
    if (!pending) break;
    next = applyThreatDecision(next, pending.id, { action: "loiter" });
    guard += 1;
  }
  return next;
}
