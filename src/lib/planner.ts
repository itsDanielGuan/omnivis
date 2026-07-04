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
};

function waypoint(
  point: Point,
  t: number,
  phase: RouteWaypoint["phase"],
  extra?: Partial<RouteWaypoint>,
): RouteWaypoint {
  return { ...point, t, phase, ...extra };
}

export function generateCoverageStrips(
  aoo: Point[],
  config: MissionConfig,
): CoverageStrip[] {
  const angle = (config.stripAngleDeg * Math.PI) / 180;
  const rotated = aoo.map((point) => rotatePoint(point, -angle));
  const box = bounds(rotated);
  const spacing = Math.max(40, config.sensorSwathM * (1 - config.overlapRatio));
  const strips: CoverageStrip[] = [];
  let order = 0;

  for (let y = box.minY + spacing / 2; y <= box.maxY - spacing / 4; y += spacing) {
    const xs = horizontalLinePolygonIntersections(rotated, y);
    for (let i = 0; i < xs.length - 1; i += 2) {
      const x1 = xs[i];
      const x2 = xs[i + 1];
      if (x2 - x1 < config.sensorSwathM * 0.45) continue;
      const start = rotatePoint({ x: x1, y }, angle);
      const end = rotatePoint({ x: x2, y }, angle);
      strips.push({
        id: `S_${String(order + 1).padStart(2, "0")}`,
        order,
        start,
        end,
        center: midpoint(start, end),
        polygon: stripPolygon(start, end, config.sensorSwathM / 2),
        assignedUavId: "",
        status: "planned",
      });
      order += 1;
    }
  }

  return strips;
}

function assignStrips(strips: CoverageStrip[], config: MissionConfig): CoverageStrip[] {
  const ordered = [...strips].sort((a, b) => a.order - b.order);
  const sectorSize = Math.ceil(ordered.length / config.uavCount);

  return ordered.map((strip, index) => {
    const contiguousSector = Math.min(config.uavCount - 1, Math.floor(index / sectorSize));
    return {
      ...strip,
      assignedUavId: `UAV_${contiguousSector + 1}`,
    };
  });
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
): RouteBuildResult {
  const route: RouteWaypoint[] = [waypoint(start, startTimeS, includeLaunch ? "preflight" : "transit")];
  let coverageTimeS = 0;

  if (includeLaunch) {
    const launchPoint = {
      x: start.x + 180 + uavIndex * 45,
      y: start.y + 170 + uavIndex * 95,
    };
    appendSafeLeg(route, launchPoint, config.speedMps, "launch", nfzs, uavIndex, {
      label: "staggered launch corridor",
    });

    const firstSectorTarget = strips[0]?.center ?? launchPoint;
    if (homeBase) {
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
  }

  strips.forEach((strip, idx) => {
    const current = route[route.length - 1];
    const startsAtA = distance(current, strip.start) <= distance(current, strip.end);
    const entry = startsAtA ? strip.start : strip.end;
    const exit = startsAtA ? strip.end : strip.start;
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
  const hold = {
    x: base.x - 300 - uavIndex * 30,
    y: base.y + (uavIndex - 2) * 210,
  };
  appendSafeLeg(route, hold, config.speedMps, "transit", nfzs, uavIndex, {
    label: "return corridor entry",
  });
  const inbound = selectBaseWaypoint({
    base: homeBase,
    direction: "inbound",
    from: hold,
    to: base,
    nfzs,
    uavIndex,
  });
  const returnDistance = inbound
    ? safePathLength(hold, inbound.point, nfzs, uavIndex) +
      safePathLength(inbound.point, base, nfzs, uavIndex)
    : safePathLength(hold, base, nfzs, uavIndex);
  const returnTime = returnDistance / config.speedMps;
  const latestHoldDeparture = Math.max(route[route.length - 1].t, desiredArrivalS - returnTime);
  if (latestHoldDeparture > route[route.length - 1].t + 1) {
    route.push(waypoint(hold, latestHoldDeparture, "loiter", { label: "RTB slot hold" }));
  }
  if (inbound) {
    appendSafeLeg(route, inbound.point, config.speedMps, "transit", nfzs, uavIndex, {
      label: `inbound waypoint ${inbound.label}`,
    });
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
  rtbAnchorS: number,
  includeLaunch = false,
  nfzs: Nfz[] = [],
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
  );
  const desiredArrivalS = Math.max(
    result.coverageEndS + safePathLength(result.endPoint, homeBase.point, nfzs, uavIndex) / config.speedMps + 60,
    rtbAnchorS + uavIndex * config.rtbSlotSpacingS,
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
  const assignedStrips = assignStrips(generateCoverageStrips(aoo, config), config).map((strip) => {
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

  const coverageBuilds = uavIds.map((uavId, index) =>
    buildCoverageRoute(
      basePoint,
      index * 12,
      assignedStrips.filter(
        (strip) => strip.assignedUavId === uavId && strip.status !== "blocked_by_nfz",
      ),
      config,
      index,
      true,
      nfzs,
      homeBase,
    ),
  );
  const rtbAnchorS = Math.max(...coverageBuilds.map((build) => build.coverageEndS)) + 210;

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
      rtbAnchorS,
      true,
      nfzs,
    );
    const routeEnd = build.route[build.route.length - 1]?.t ?? 1;
    return {
      id: uavId,
      label: `UAV-${index + 1}`,
      color: UAV_COLORS[index].color,
      colorSoft: UAV_COLORS[index].soft,
      altitudeM: config.altitudeLayerStartM + index * config.altitudeLayerSpacingM,
      status: "active",
      assignedStripIds: strips.map((strip) => strip.id),
      route: build.route,
      rtbSlotS: build.route[build.route.length - 1]?.t ?? 0,
      coverageTimeS: build.coverageTimeS,
      utilizationPct: Math.min(100, (build.coverageTimeS / routeEnd) * 100),
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
      rtbAnchorS,
      true,
      nfzs,
    );
    uav.originalRoute = uav.route;
    uav.route = rebuilt.route;
    uav.coverageTimeS = rebuilt.coverageTimeS;
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
