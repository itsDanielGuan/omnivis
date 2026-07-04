import {
  distance,
  interpolateRoute,
  pointInPolygon,
  segmentDistanceToPoint,
} from "@/lib/geometry";
import type { CoverageStrip, MissionMetrics, MissionPlan, Point } from "@/lib/types";

function isStripCoverable(strip: CoverageStrip) {
  return strip.status !== "coverage_debt" && strip.status !== "blocked_by_nfz";
}

function estimateCoverage(plan: MissionPlan): number {
  const { aoo, strips, config } = plan;
  const coveredStrips = strips.filter(isStripCoverable);
  if (coveredStrips.length === 0) return 0;

  const xs = aoo.map((point) => point.x);
  const ys = aoo.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const step = Math.max(90, Math.min(220, config.sensorSwathM * 0.75));
  let total = 0;
  let covered = 0;

  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const point: Point = { x, y };
      if (!pointInPolygon(point, aoo)) continue;
      total += 1;
      const isCovered = coveredStrips.some(
        (strip) =>
          segmentDistanceToPoint(strip.start, strip.end, point) <=
          config.sensorSwathM * 0.53,
      );
      if (isCovered) covered += 1;
    }
  }

  return total === 0 ? 0 : Math.min(100, (covered / total) * 100);
}

function estimateMinSeparation(plan: MissionPlan): number {
  const activeUavs = plan.uavs.filter((uav) => uav.status !== "lost");
  if (activeUavs.length < 2) return 0;
  const maxTime = Math.max(
    ...activeUavs.map((uav) => uav.route[uav.route.length - 1]?.t ?? 0),
  );
  let min = Number.POSITIVE_INFINITY;

  for (let t = 45; t <= maxTime; t += 45) {
    for (let i = 0; i < activeUavs.length; i += 1) {
      for (let j = i + 1; j < activeUavs.length; j += 1) {
        const a = activeUavs[i];
        const b = activeUavs[j];
        const pa = interpolateRoute(a.route, t);
        const pb = interpolateRoute(b.route, t);
        const nearBase =
          distance(pa, plan.base) < 260 || distance(pb, plan.base) < 260;
        if (nearBase) continue;
        const horizontal = distance(pa, pb);
        const vertical = Math.abs(a.altitudeM - b.altitudeM);
        const protectedSeparation =
          vertical >= plan.config.altitudeLayerSpacingM
            ? Math.max(horizontal, plan.config.minSeparationM + vertical)
            : horizontal;
        min = Math.min(min, protectedSeparation);
      }
    }
  }

  if (!Number.isFinite(min)) return plan.config.minSeparationM;
  return min;
}

export function computeMissionMetrics(plan: MissionPlan): MissionMetrics {
  const activeUavs = plan.uavs.filter((uav) => uav.status !== "lost");
  const missionCompletionTimeS = Math.max(
    1,
    ...activeUavs.map((uav) => uav.route[uav.route.length - 1]?.t ?? 0),
  );
  const completedStrips = plan.strips.filter(isStripCoverable).length;
  const coverageDebtStripCount = plan.strips.filter(
    (strip) => strip.status === "coverage_debt",
  ).length;
  const blockedStripCount = plan.strips.filter(
    (strip) => strip.status === "blocked_by_nfz",
  ).length;

  return {
    coveragePct: estimateCoverage(plan),
    missionCompletionTimeS,
    minSeparationM: estimateMinSeparation(plan),
    averageUtilizationPct:
      activeUavs.reduce((sum, uav) => sum + uav.utilizationPct, 0) /
      Math.max(1, activeUavs.length),
    messagesUsed: plan.messages.filter((message) => message.countInMission).length,
    totalStrips: plan.strips.length,
    completedStrips,
    coverageDebtStripCount,
    blockedStripCount,
    feasible: missionCompletionTimeS <= plan.config.enduranceMin * 60,
    rtbSpacingS: plan.config.rtbSlotSpacingS,
    before: plan.metrics?.before,
  };
}
