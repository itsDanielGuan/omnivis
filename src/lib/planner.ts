import {
  bounds,
  distance,
  horizontalLinePolygonIntersections,
  midpoint,
  pointInPolygon,
  polygonApproxRadius,
  polygonCentroid,
  rotatePoint,
  routeLength,
  segmentIntersectsPolygon,
  stripPolygon,
} from "@/lib/geometry";
import { computeMissionMetrics } from "@/lib/metrics";
import { getMapPreset, UAV_COLORS } from "@/lib/presets";
import {
  appendSafeLeg,
  homeBaseFromPoint,
  normalizeHomeBase,
  routeIntersectsAnyNfz,
  safePathLength,
  segmentIntersectsNfz,
  selectBaseWaypoint,
} from "@/lib/routing";
import type {
  CoverageStrip,
  HomeBase,
  InfillPattern,
  MapPreset,
  MissionConfig,
  MissionEvent,
  MissionMessage,
  MissionPlan,
  Nfz,
  Point,
  RouteWaypoint,
  UavPlan,
} from "@/lib/types";

type RouteBuildResult = {
  route: RouteWaypoint[];
  coverageTimeS: number;
  coverageEndS: number;
  endPoint: Point;
  rechargeCount: number;
  forcedRtbCount: number;
  skippedStripIds: string[];
  enduranceWarning?: string;
};

function waypoint(
  point: Point,
  t: number,
  phase: RouteWaypoint["phase"],
  extra?: Partial<RouteWaypoint>,
): RouteWaypoint {
  return { ...point, t, phase, ...extra };
}

const INFILL_PATTERN_IDS: InfillPattern[] = [
  "rectilinear",
  "zigzag",
  "grid",
  "triangles",
  "tri_hex",
  "diamond",
  "chevron",
  "crosshatch",
  "lattice",
  "lightning",
];

type InfillPass = {
  angleOffsetDeg: number;
  spacingScale: number;
  phaseOffset?: number;
};

export function normalizeInfillPattern(value?: string): InfillPattern {
  if (INFILL_PATTERN_IDS.includes(value as InfillPattern)) return value as InfillPattern;
  if (value === "sector_lanes") return "rectilinear";
  if (value === "alternating_lanes") return "zigzag";
  if (value === "sector_edge_sweep") return "chevron";
  if (value === "center_out_sweep") return "diamond";
  if (value === "nearest_infill") return "lightning";
  if (value === "interleaved_mesh") return "lattice";
  return "rectilinear";
}

export function initialInfillPattern(config: MissionConfig): InfillPattern {
  return normalizeInfillPattern(config.initialInfillPattern ?? config.pathPattern);
}

export function contingencyInfillPattern(config: MissionConfig): InfillPattern {
  return normalizeInfillPattern(
    config.contingencyInfillPattern ?? config.initialInfillPattern ?? config.pathPattern,
  );
}

function infillPasses(pattern: InfillPattern): InfillPass[] {
  switch (pattern) {
    case "grid":
      return [
        { angleOffsetDeg: 0, spacingScale: 1.82 },
        { angleOffsetDeg: 90, spacingScale: 1.82, phaseOffset: 0.5 },
      ];
    case "triangles":
      return [
        { angleOffsetDeg: 0, spacingScale: 2.3 },
        { angleOffsetDeg: 60, spacingScale: 2.3, phaseOffset: 0.33 },
        { angleOffsetDeg: -60, spacingScale: 2.3, phaseOffset: 0.66 },
      ];
    case "tri_hex":
      return [
        { angleOffsetDeg: 0, spacingScale: 2.7 },
        { angleOffsetDeg: 60, spacingScale: 2.7, phaseOffset: 0.45 },
        { angleOffsetDeg: 120, spacingScale: 2.7, phaseOffset: 0.9 },
      ];
    case "diamond":
      return [
        { angleOffsetDeg: 45, spacingScale: 1.85 },
        { angleOffsetDeg: -45, spacingScale: 1.85, phaseOffset: 0.5 },
      ];
    case "chevron":
      return [
        { angleOffsetDeg: 32, spacingScale: 1.65 },
        { angleOffsetDeg: -32, spacingScale: 1.65, phaseOffset: 0.5 },
      ];
    case "crosshatch":
      return [
        { angleOffsetDeg: 0, spacingScale: 2.25 },
        { angleOffsetDeg: 90, spacingScale: 2.25, phaseOffset: 0.5 },
        { angleOffsetDeg: 45, spacingScale: 3.1, phaseOffset: 0.25 },
        { angleOffsetDeg: -45, spacingScale: 3.1, phaseOffset: 0.75 },
      ];
    case "lattice":
      return [
        { angleOffsetDeg: 0, spacingScale: 2.45 },
        { angleOffsetDeg: 60, spacingScale: 2.45, phaseOffset: 0.25 },
        { angleOffsetDeg: 120, spacingScale: 2.45, phaseOffset: 0.5 },
        { angleOffsetDeg: 90, spacingScale: 3.4, phaseOffset: 0.75 },
      ];
    case "lightning":
      return [
        { angleOffsetDeg: 18, spacingScale: 1.35 },
        { angleOffsetDeg: -48, spacingScale: 2.5, phaseOffset: 0.45 },
      ];
    case "zigzag":
    case "rectilinear":
    default:
      return [{ angleOffsetDeg: 0, spacingScale: 1 }];
  }
}

function generateCoverageStripsForPass(
  aoo: Point[],
  config: MissionConfig,
  pattern: InfillPattern,
  pass: InfillPass,
  passIndex: number,
  startOrder: number,
): CoverageStrip[] {
  const angle = ((config.stripAngleDeg + pass.angleOffsetDeg) * Math.PI) / 180;
  const rotated = aoo.map((point) => rotatePoint(point, -angle));
  const box = bounds(rotated);
  const baseSpacing = Math.max(40, config.sensorSwathM * (1 - config.overlapRatio));
  const spacing = Math.max(40, baseSpacing * pass.spacingScale);
  const phaseOffset = ((pass.phaseOffset ?? 0) % 1 + 1) % 1;
  const strips: CoverageStrip[] = [];
  let y = box.minY + spacing * (0.5 + phaseOffset);

  while (y - spacing >= box.minY + spacing * 0.35) y -= spacing;

  for (; y <= box.maxY - spacing / 4; y += spacing) {
    const xs = horizontalLinePolygonIntersections(rotated, y);
    for (let i = 0; i < xs.length - 1; i += 2) {
      const x1 = xs[i];
      const x2 = xs[i + 1];
      if (x2 - x1 < config.sensorSwathM * 0.45) continue;
      const start = rotatePoint({ x: x1, y }, angle);
      const end = rotatePoint({ x: x2, y }, angle);
      const order = startOrder + strips.length;
      strips.push({
        id: `S_${String(order + 1).padStart(2, "0")}`,
        order,
        start,
        end,
        center: midpoint(start, end),
        polygon: stripPolygon(start, end, config.sensorSwathM / 2),
        assignedUavId: "",
        status: "planned",
        infillPattern: pattern,
        infillPass: passIndex,
      });
    }
  }

  return strips;
}

export function generateCoverageStrips(
  aoo: Point[],
  config: MissionConfig,
  pattern: InfillPattern = initialInfillPattern(config),
): CoverageStrip[] {
  const strips: CoverageStrip[] = [];
  infillPasses(pattern).forEach((pass, passIndex) => {
    strips.push(
      ...generateCoverageStripsForPass(
        aoo,
        config,
        pattern,
        pass,
        passIndex,
        strips.length,
      ),
    );
  });

  return strips;
}

function assignStrips(strips: CoverageStrip[], config: MissionConfig): CoverageStrip[] {
  const ordered = [...strips].sort((a, b) => a.order - b.order);
  const pattern = initialInfillPattern(config);
  const interleavedPatterns: InfillPattern[] = [
    "grid",
    "triangles",
    "tri_hex",
    "crosshatch",
    "lattice",
    "lightning",
  ];
  if (interleavedPatterns.includes(pattern)) {
    return ordered.map((strip, index) => ({
      ...strip,
      assignedUavId: `UAV_${(index % config.uavCount) + 1}`,
    }));
  }

  const sectorSize = Math.ceil(ordered.length / config.uavCount);

  return ordered.map((strip, index) => {
    const contiguousSector = Math.min(config.uavCount - 1, Math.floor(index / sectorSize));
    return {
      ...strip,
      assignedUavId: `UAV_${contiguousSector + 1}`,
    };
  });
}

function stripTraverseCost(
  cursor: Point,
  strip: CoverageStrip,
  nfzs: Nfz[],
  uavIndex: number,
) {
  const traversal = bestStripTraversal(cursor, strip, nfzs, uavIndex);
  return {
    exit: traversal.exit,
    cost: traversal.totalCostM,
  };
}

function bestStripTraversal(
  cursor: Point,
  strip: CoverageStrip,
  nfzs: Nfz[],
  uavIndex: number,
  homeBase?: HomeBase,
) {
  const candidates = [
    { entry: strip.start, exit: strip.end },
    { entry: strip.end, exit: strip.start },
  ].map((candidate) => {
    const transitCostM = safePathLength(cursor, candidate.entry, nfzs, uavIndex);
    const coverageCostM = safePathLength(candidate.entry, candidate.exit, nfzs, uavIndex);
    const returnCostM = homeBase
      ? safePathLength(candidate.exit, homeBase.point, nfzs, uavIndex)
      : 0;
    return {
      ...candidate,
      transitCostM,
      coverageCostM,
      returnCostM,
      totalCostM: transitCostM + coverageCostM + returnCostM,
    };
  });

  return candidates.reduce((best, candidate) =>
    candidate.totalCostM < best.totalCostM ? candidate : best,
  );
}

function enduranceBudgetS(config: MissionConfig) {
  return Math.max(60, (config.enduranceMin - config.batteryReserveMin) * 60);
}

function rechargeDurationS(config: MissionConfig) {
  return Math.max(60, config.rechargeDurationMin * 60);
}

function appendLaunchSequence(
  route: RouteWaypoint[],
  config: MissionConfig,
  uavIndex: number,
  nfzs: Nfz[],
  homeBase: HomeBase | undefined,
  firstSectorTarget: Point,
) {
  const start = route[route.length - 1];
  if (!start) return;
  const launchPoint = {
    x: start.x + 180 + uavIndex * 45,
    y: start.y + 170 + uavIndex * 95,
  };
  appendSafeLeg(route, launchPoint, config.speedMps, "launch", nfzs, uavIndex, {
    label: "staggered launch corridor",
  });

  if (!homeBase) return;
  const outbound = selectBaseWaypoint({
    base: homeBase,
    direction: "outbound",
    from: launchPoint,
    to: firstSectorTarget,
    nfzs,
    uavIndex,
  });
  if (outbound) {
    appendSafeLeg(route, outbound.point, config.speedMps, "transit", nfzs, uavIndex, {
      label: `outbound waypoint ${outbound.label}`,
    });
  }
}

function edgeFirstOrder(strips: CoverageStrip[], uavIndex: number): CoverageStrip[] {
  const ordered = [...strips].sort((a, b) => a.order - b.order);
  const result: CoverageStrip[] = [];
  let left = 0;
  let right = ordered.length - 1;
  const startFromHighEdge = uavIndex % 2 === 1;

  while (left <= right) {
    if (startFromHighEdge) {
      result.push(ordered[right]);
      right -= 1;
      if (left <= right) {
        result.push(ordered[left]);
        left += 1;
      }
    } else {
      result.push(ordered[left]);
      left += 1;
      if (left <= right) {
        result.push(ordered[right]);
        right -= 1;
      }
    }
  }

  return result;
}

function centerOutOrder(strips: CoverageStrip[], uavIndex: number): CoverageStrip[] {
  const ordered = [...strips].sort((a, b) => a.order - b.order);
  const center = (ordered.length - 1) / 2;
  return ordered
    .map((strip, index) => ({ strip, index }))
    .sort((a, b) => {
      const aDistance = Math.abs(a.index - center);
      const bDistance = Math.abs(b.index - center);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return uavIndex % 2 === 0 ? a.index - b.index : b.index - a.index;
    })
    .map(({ strip }) => strip);
}

function interleavePassesOrder(strips: CoverageStrip[], uavIndex: number): CoverageStrip[] {
  const byPass = new Map<number, CoverageStrip[]>();
  [...strips]
    .sort((a, b) => a.order - b.order)
    .forEach((strip) => {
      const pass = strip.infillPass ?? 0;
      byPass.set(pass, [...(byPass.get(pass) ?? []), strip]);
    });

  const passIds = [...byPass.keys()].sort((a, b) => a - b);
  const longest = Math.max(0, ...[...byPass.values()].map((passStrips) => passStrips.length));
  const result: CoverageStrip[] = [];

  for (let row = 0; row < longest; row += 1) {
    const passOrder = uavIndex % 2 === 0 ? passIds : [...passIds].reverse();
    passOrder.forEach((passId) => {
      const passStrips = byPass.get(passId) ?? [];
      const strip = passStrips[row];
      if (strip) result.push(strip);
    });
  }

  return result;
}

function nearestTravelOrder(
  strips: CoverageStrip[],
  start: Point,
  uavIndex: number,
  nfzs: Nfz[],
): CoverageStrip[] {
  const pending = [...strips].sort((a, b) => a.order - b.order);
  const result: CoverageStrip[] = [];
  let cursor = start;

  while (pending.length > 0) {
    let bestIndex = 0;
    let best = stripTraverseCost(cursor, pending[0], nfzs, uavIndex);
    pending.forEach((strip, index) => {
      const candidate = stripTraverseCost(cursor, strip, nfzs, uavIndex);
      if (candidate.cost < best.cost) {
        best = candidate;
        bestIndex = index;
      }
    });
    const [next] = pending.splice(bestIndex, 1);
    result.push(next);
    cursor = best.exit;
  }

  return result;
}

export function orderCoverageStripsForInfillPattern(
  strips: CoverageStrip[],
  config: MissionConfig,
  start: Point,
  uavIndex: number,
  nfzs: Nfz[] = [],
  pattern: InfillPattern = initialInfillPattern(config),
): CoverageStrip[] {
  const ordered = [...strips].sort((a, b) => a.order - b.order);

  if (pattern === "zigzag") {
    return uavIndex % 2 === 0 ? ordered : ordered.reverse();
  }

  if (pattern === "chevron") return edgeFirstOrder(ordered, uavIndex);

  if (pattern === "diamond") return centerOutOrder(ordered, uavIndex);

  if (pattern === "grid") return interleavePassesOrder(ordered, uavIndex);

  if (
    pattern === "triangles" ||
    pattern === "tri_hex" ||
    pattern === "crosshatch" ||
    pattern === "lattice" ||
    pattern === "lightning"
  ) {
    return nearestTravelOrder(ordered, start, uavIndex, nfzs);
  }

  return ordered;
}

export function orderCoverageStripsForPathPattern(
  strips: CoverageStrip[],
  config: MissionConfig,
  start: Point,
  uavIndex: number,
  nfzs: Nfz[] = [],
): CoverageStrip[] {
  return orderCoverageStripsForInfillPattern(strips, config, start, uavIndex, nfzs);
}

function buildCoverageRoute(
  start: Point,
  startTimeS: number,
  strips: CoverageStrip[],
  config: MissionConfig,
  uavIndex: number,
  includeLaunch: boolean,
  nfzs: Nfz[] = [],
  homeBase?: HomeBase,
  pattern: InfillPattern = initialInfillPattern(config),
): RouteBuildResult {
  const orderedStrips = orderCoverageStripsForInfillPattern(
    strips,
    config,
    start,
    uavIndex,
    nfzs,
    pattern,
  );
  const route: RouteWaypoint[] = [waypoint(start, startTimeS, includeLaunch ? "preflight" : "transit")];
  let coverageTimeS = 0;
  let sortieStartS = startTimeS;
  let rechargeCount = 0;
  let forcedRtbCount = 0;
  const skippedStripIds: string[] = [];
  const firstSectorTarget = orderedStrips[0]?.center ?? start;

  if (includeLaunch) {
    appendLaunchSequence(route, config, uavIndex, nfzs, homeBase, firstSectorTarget);
  }

  orderedStrips.forEach((strip, idx) => {
    let current = route[route.length - 1];
    let traversal = bestStripTraversal(current, strip, nfzs, uavIndex, homeBase);
    let entry = traversal.entry;
    let exit = traversal.exit;
    if (homeBase) {
      const requiredS = traversal.totalCostM / config.speedMps;
      const elapsedS = current.t - sortieStartS;
      if (elapsedS + requiredS > enduranceBudgetS(config)) {
        forcedRtbCount += 1;
        appendRtb(
          route,
          homeBase,
          config,
          uavIndex,
          current.t + safePathLength(current, homeBase.point, nfzs, uavIndex) / config.speedMps + 60,
          nfzs,
        );
        const basePoint = route[route.length - 1] ?? homeBase.point;
        const rechargeEndS = basePoint.t + rechargeDurationS(config);
        route.push(waypoint(homeBase.point, rechargeEndS, "recharge", {
          label: `battery recharge ${config.rechargeDurationMin} min`,
        }));
        rechargeCount += 1;
        sortieStartS = rechargeEndS;
        appendLaunchSequence(route, config, uavIndex, nfzs, homeBase, strip.center);
        current = route[route.length - 1];
      }

      traversal = bestStripTraversal(current, strip, nfzs, uavIndex, homeBase);
      entry = traversal.entry;
      exit = traversal.exit;
      const freshRequiredS = traversal.totalCostM / config.speedMps;
      if (current.t - sortieStartS + freshRequiredS > enduranceBudgetS(config)) {
        skippedStripIds.push(strip.id);
        return;
      }
    }
    appendSafeLeg(route, entry, config.speedMps, "transit", nfzs, uavIndex, {
      stripId: strip.id,
      label: idx === 0 ? "sector entry" : "next strip",
    });
    const beforeCover = route[route.length - 1].t;
    appendSafeLeg(route, exit, config.speedMps, "covering", nfzs, uavIndex, {
      stripId: strip.id,
      label: `cover ${strip.id}`,
    });
    coverageTimeS += route[route.length - 1].t - beforeCover;
  });

  return {
    route,
    coverageTimeS,
    coverageEndS: route[route.length - 1]?.t ?? startTimeS,
    endPoint: route[route.length - 1] ?? start,
    rechargeCount,
    forcedRtbCount,
    skippedStripIds,
    enduranceWarning:
      skippedStripIds.length > 0
        ? `${skippedStripIds.length} strip${skippedStripIds.length === 1 ? "" : "s"} exceed one sortie with RTB reserve`
        : forcedRtbCount > 0
          ? `${forcedRtbCount} reserve-triggered RTB cycle${forcedRtbCount === 1 ? "" : "s"} inserted`
          : undefined,
  };
}

function appendRtb(
  route: RouteWaypoint[],
  homeBase: HomeBase,
  config: MissionConfig,
  uavIndex: number,
  desiredArrivalS: number,
  nfzs: Nfz[] = [],
) {
  const base = homeBase.point;
  const current = route[route.length - 1] ?? base;
  const hold = {
    x: base.x - 300 - uavIndex * 30,
    y: base.y + (uavIndex - 2) * 210,
  };
  const inbound = selectBaseWaypoint({
    base: homeBase,
    direction: "inbound",
    from: current,
    to: base,
    nfzs,
    uavIndex,
  });

  if (inbound) {
    appendSafeLeg(route, inbound.point, config.speedMps, "transit", nfzs, uavIndex, {
      label: `return via inbound waypoint ${inbound.label}`,
    });
  } else {
    appendSafeLeg(route, hold, config.speedMps, "transit", nfzs, uavIndex, {
      label: "return corridor entry",
    });
    const finalLegTime = safePathLength(hold, base, nfzs, uavIndex) / config.speedMps;
    const latestHoldDeparture = Math.max(
      route[route.length - 1].t,
      desiredArrivalS - finalLegTime,
    );
    if (latestHoldDeparture > route[route.length - 1].t + 1) {
      route.push(waypoint(hold, latestHoldDeparture, "loiter", { label: "RTB slot hold" }));
    }
  }

  appendSafeLeg(route, base, config.speedMps, "return", nfzs, uavIndex, {
    label: "RTB slot arrival",
  });
}

export function buildRouteFromStart(
  start: Point,
  startTimeS: number,
  strips: CoverageStrip[],
  config: MissionConfig,
  base: Point | HomeBase,
  uavIndex: number,
  includeLaunch = false,
  nfzs: Nfz[] = [],
  pattern: InfillPattern = initialInfillPattern(config),
): RouteBuildResult {
  const homeBase =
    "outboundWaypoints" in base ? normalizeHomeBase(base) : homeBaseFromPoint(base);
  const result = buildCoverageRoute(
    start,
    startTimeS,
    strips,
    config,
    uavIndex,
    includeLaunch,
    nfzs,
    homeBase,
    pattern,
  );
  const desiredArrivalS = Math.max(
    result.coverageEndS + safePathLength(result.endPoint, homeBase.point, nfzs, uavIndex) / config.speedMps + 60,
    result.coverageEndS,
  );
  appendRtb(result.route, homeBase, config, uavIndex, desiredArrivalS, nfzs);
  return result;
}

function makeMessages(uavIds: string[]): MissionMessage[] {
  return [
    {
      id: "MSG_LOAD",
      type: "MISSION_LOAD",
      timeS: 0,
      sourceId: "BASE",
      targetIds: uavIds,
      countInMission: false,
      text: "Mission contract loaded to all UAVs before launch",
    },
  ];
}

function makeInitialEvents(uavCount: number): MissionEvent[] {
  return [
    {
      id: "EVT_000",
      timeS: 0,
      severity: "info",
      text: "Mission contract loaded to all UAVs",
    },
    {
      id: "EVT_001",
      timeS: 0,
      severity: "success",
      text: `${uavCount} fixed-wing UAVs armed with deterministic sector logic`,
    },
  ];
}

function missionBaseForAoo(aoo: Point[]): Point {
  const box = bounds(aoo);
  return {
    x: box.minX - 420,
    y: box.minY - 520,
  };
}

function buildMissionPlan(
  config: MissionConfig,
  mapPreset: MapPreset,
  aoo: Point[],
  base: Point | HomeBase,
  nfzs: Nfz[] = [],
): MissionPlan {
  const homeBase = "outboundWaypoints" in base ? normalizeHomeBase(base) : homeBaseFromPoint(base);
  const basePoint = homeBase.point;
  const assignedStrips = assignStrips(
    generateCoverageStrips(aoo, config, initialInfillPattern(config)),
    config,
  ).map((strip) => {
    const blocked = nfzs.some((nfz) => {
      if (nfz.polygon?.length) {
        return (
          pointInPolygon(strip.center, nfz.polygon) ||
          segmentIntersectsPolygon(strip.start, strip.end, nfz.polygon)
        );
      }
      return distance(strip.center, nfz.center) <= nfz.radiusM + config.sensorSwathM * 0.5;
    });
    return blocked ? { ...strip, status: "blocked_by_nfz" as const } : strip;
  });
  const uavIds = Array.from({ length: config.uavCount }, (_, index) => `UAV_${index + 1}`);

  const uavs: UavPlan[] = uavIds.map((uavId, index) => {
    const strips = assignedStrips.filter((strip) => strip.assignedUavId === uavId);
    const routeStrips = strips.filter((strip) => strip.status !== "blocked_by_nfz");
    const build = buildRouteFromStart(
      basePoint,
      index * 12,
      routeStrips,
      config,
      homeBase,
      index,
      true,
      nfzs,
    );
    build.skippedStripIds.forEach((stripId) => {
      const skipped = assignedStrips.find((strip) => strip.id === stripId);
      if (skipped) skipped.status = "coverage_debt";
    });
    const routeEnd = build.route[build.route.length - 1]?.t ?? 1;
    const assignedStripIds = strips
      .filter(
        (strip) =>
          strip.status !== "coverage_debt" &&
          strip.status !== "blocked_by_nfz" &&
          strip.status !== "completed",
      )
      .map((strip) => strip.id);
    return {
      id: uavId,
      label: `UAV-${index + 1}`,
      color: UAV_COLORS[index].color,
      colorSoft: UAV_COLORS[index].soft,
      altitudeM: config.altitudeLayerStartM + index * config.altitudeLayerSpacingM,
      status: "active",
      assignedStripIds,
      route: build.route,
      rtbSlotS: build.route[build.route.length - 1]?.t ?? 0,
      coverageTimeS: build.coverageTimeS,
      utilizationPct: Math.min(100, (build.coverageTimeS / routeEnd) * 100),
      rechargeCount: build.rechargeCount,
      forcedRtbCount: build.forcedRtbCount,
      enduranceWarning: build.enduranceWarning,
    };
  });

  uavs.forEach((uav, index) => {
    if (!routeIntersectsAnyNfz(uav.route, nfzs)) return;
    uav.assignedStripIds.forEach((stripId) => {
      const strip = assignedStrips.find((candidate) => candidate.id === stripId);
      if (!strip) return;
      const blocked = nfzs.some((nfz) => segmentIntersectsNfz(strip.start, strip.end, nfz));
      if (blocked) strip.status = "blocked_by_nfz";
    });
    uav.status = "replanned";
    const remainingStrips = assignedStrips.filter(
      (strip) => strip.assignedUavId === uav.id && strip.status !== "blocked_by_nfz",
    );
    const rebuilt = buildRouteFromStart(
      basePoint,
      index * 12,
      remainingStrips,
      config,
      homeBase,
      index,
      true,
      nfzs,
    );
    rebuilt.skippedStripIds.forEach((stripId) => {
      const skipped = assignedStrips.find((strip) => strip.id === stripId);
      if (skipped) skipped.status = "coverage_debt";
    });
    uav.originalRoute = uav.route;
    uav.route = rebuilt.route;
    uav.coverageTimeS = rebuilt.coverageTimeS;
    uav.rechargeCount = rebuilt.rechargeCount;
    uav.forcedRtbCount = rebuilt.forcedRtbCount;
    uav.enduranceWarning = rebuilt.enduranceWarning;
    uav.assignedStripIds = assignedStrips
      .filter(
        (strip) =>
          strip.assignedUavId === uav.id &&
          strip.status !== "coverage_debt" &&
          strip.status !== "blocked_by_nfz" &&
          strip.status !== "completed",
      )
      .map((strip) => strip.id);
    uav.rtbSlotS = rebuilt.route.at(-1)?.t ?? uav.rtbSlotS;
    const routeEnd = rebuilt.route.at(-1)?.t ?? 1;
    uav.utilizationPct = Math.min(100, (uav.coverageTimeS / routeEnd) * 100);
  });

  const plan: MissionPlan = {
    id: `mission-${config.seed}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    seed: config.seed,
    config,
    mapPreset,
    base: basePoint,
    homeBase,
    aoo,
    strips: assignedStrips,
    uavs,
    nfzs,
    threats: [],
    messages: makeMessages(uavIds),
    events: makeInitialEvents(config.uavCount),
    lossResponseMode: "dispatch_replacement",
    metrics: {
      coveragePct: 0,
      missionCompletionTimeS: 0,
      minSeparationM: 0,
      averageUtilizationPct: 0,
      messagesUsed: 0,
      totalStrips: assignedStrips.length,
      completedStrips: 0,
      coverageDebtStripCount: 0,
      blockedStripCount: 0,
      rechargeCycleCount: 0,
      forcedRtbCount: 0,
      enduranceWarningCount: 0,
      feasible: true,
      rtbSpacingS: config.rtbSlotSpacingS,
    },
  };

  plan.metrics = computeMissionMetrics(plan);
  return plan;
}

export function generateMissionPlan(config: MissionConfig): MissionPlan {
  const mapPreset = getMapPreset(config.mapPresetId);
  const aoo = mapPreset.aooPolygons[config.aooPresetId];
  return buildMissionPlan(config, mapPreset, aoo, homeBaseFromPoint(mapPreset.baseM, "Demo Base"));
}

export function generateMissionPlanFromArea(
  config: MissionConfig,
  aoo: Point[],
  base?: Point | HomeBase,
  nfzs: Nfz[] = [],
): MissionPlan {
  const mapPreset = getMapPreset(config.mapPresetId);
  return buildMissionPlan(config, mapPreset, aoo, base ?? missionBaseForAoo(aoo), nfzs);
}

export function planningNfzToMissionNfz(
  id: string,
  polygon: Point[],
  createdAtS = 0,
): Nfz {
  const center = polygonCentroid(polygon);
  return {
    id,
    center,
    radiusM: polygonApproxRadius(polygon, center),
    createdAtS,
    polygon,
  };
}

export function getMissionMaxTime(plan: MissionPlan | null): number {
  if (!plan) return 1;
  return Math.max(
    1,
    ...plan.uavs.map((uav) => uav.route[uav.route.length - 1]?.t ?? 0),
  );
}

export function routeDistance(route: RouteWaypoint[]): number {
  return routeLength(route);
}
