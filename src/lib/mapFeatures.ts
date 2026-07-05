import { closeRing, localCircleToLngLat, pointsToLngLat, toLngLat } from "@/lib/geo";
import { detectionRadiusM } from "@/lib/geometry";
import { getUavSnapshot } from "@/lib/simulator";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { CoverageStrip, MissionMessage, MissionPlan, Point, RouteWaypoint, UavPlan } from "@/lib/types";

function feature(
  geometry: Geometry,
  properties: Record<string, unknown>,
): Feature {
  return { type: "Feature", geometry, properties };
}

function lineFromRoute(
  plan: MissionPlan,
  route: RouteWaypoint[],
  properties: Record<string, unknown>,
): Feature | null {
  if (route.length < 2) return null;
  return feature(
    {
      type: "LineString",
      coordinates: route.map((point) => toLngLat(plan.mapPreset, point)),
    },
    properties,
  );
}

function messageTargets(
  plan: MissionPlan,
  message: MissionMessage,
): string[] {
  if (message.targetIds?.length) return message.targetIds;
  return message.targetId ? [message.targetId] : [];
}

function endpointForId(plan: MissionPlan, id: string, simTimeS: number): Point {
  if (id === "BASE") return plan.base;
  const uav = plan.uavs.find((candidate) => candidate.id === id);
  if (!uav) return plan.base;
  return getUavSnapshot(uav, simTimeS);
}

function pendingVehicleLossActivationS(plan: MissionPlan, simTimeS: number): number | undefined {
  if (plan.activeContingency !== "vehicle_loss") return undefined;
  const activationS = Math.min(
    ...plan.uavs
      .map((uav) => uav.lossDetectedAtS ?? uav.lostAtS)
      .filter((timeS): timeS is number => timeS !== undefined),
  );
  return Number.isFinite(activationS) && simTimeS < activationS ? activationS : undefined;
}

function originalOwnerForStrip(plan: MissionPlan, strip: CoverageStrip): string | undefined {
  return plan.uavs.find((uav) =>
    (uav.originalRoute ?? uav.route).some((point) => point.stripId === strip.id),
  )?.id;
}

function visibleRouteForUav(
  uav: UavPlan,
  activationS: number | undefined,
): RouteWaypoint[] {
  if (!activationS) return uav.route;
  if (uav.reserve) return [];
  if (uav.communicationLostAtS !== undefined) return uav.route;
  return uav.originalRoute ?? uav.route;
}

export function missionToGeoJson(
  plan: MissionPlan,
  simTimeS: number,
  selectedUavId?: string,
): FeatureCollection {
  const features: Feature[] = [];
  const vehicleLossActivationS = pendingVehicleLossActivationS(plan, simTimeS);

  features.push(
    feature(
      {
        type: "Polygon",
        coordinates: [closeRing(pointsToLngLat(plan.mapPreset, plan.aoo))],
      },
      { kind: "aoo", name: "AOO", color: "#38bdf8" },
    ),
  );

  plan.strips.forEach((strip) => {
    const ownerId = vehicleLossActivationS
      ? originalOwnerForStrip(plan, strip) ?? strip.assignedUavId
      : strip.assignedUavId;
    const owner = plan.uavs.find((uav) => uav.id === ownerId);
    const status =
      vehicleLossActivationS && strip.status === "coverage_debt" ? "planned" : strip.status;
    features.push(
      feature(
        {
          type: "Polygon",
          coordinates: [closeRing(pointsToLngLat(plan.mapPreset, strip.polygon))],
        },
        {
          kind: "strip",
          id: strip.id,
          ownerId,
          status,
          color:
            status === "coverage_debt"
              ? "#f97316"
              : status === "blocked_by_nfz"
                ? "#ef4444"
                : owner?.colorSoft ?? "rgba(148, 163, 184, 0.18)",
          lineColor: owner?.color ?? "#94a3b8",
        },
      ),
    );
  });

  plan.uavs.forEach((uav) => {
    if (uav.reserve && simTimeS < (uav.route[0]?.t ?? 0)) return;

    const visibleRoute = visibleRouteForUav(uav, vehicleLossActivationS);
    const routeFeature = lineFromRoute(plan, visibleRoute, {
      kind: "route",
      id: `${uav.id}_route`,
      uavId: uav.id,
      color: uav.status === "lost" ? "#ef4444" : uav.color,
      selected: uav.id === selectedUavId,
    });
    if (routeFeature) features.push(routeFeature);

    if (uav.originalRoute && (!vehicleLossActivationS || uav.communicationLostAtS !== undefined)) {
      const originalFeature = lineFromRoute(plan, uav.originalRoute, {
        kind: "original_route",
        id: `${uav.id}_original_route`,
        uavId: uav.id,
        color: "#94a3b8",
      });
      if (originalFeature) features.push(originalFeature);
    }

    const current = getUavSnapshot(uav, simTimeS);
    features.push(
      feature(
        {
          type: "Point",
          coordinates: toLngLat(plan.mapPreset, current),
        },
        {
          kind: "uav",
          id: uav.id,
          label: uav.label,
          color: uav.status === "lost" ? "#ef4444" : uav.color,
          heading: current.headingDeg,
          selected: uav.id === selectedUavId,
          phase: current.phase,
        },
      ),
    );

    if (uav.status !== "lost") {
      // Detection zone drawn as a native circle layer (guaranteed round in
      // screen space). We carry the radius as screen pixels at zoom 0 so the
      // paint expression can scale it by 2^zoom and keep it constant in meters.
      const detectionM = detectionRadiusM(plan.config, uav.altitudeM);
      const cosLat = Math.cos((plan.mapPreset.baseLat * Math.PI) / 180);
      const metersPerPixelAtZoom0 = 78271.5169 * cosLat;
      const radiusPxAtZoom0 = detectionM / metersPerPixelAtZoom0;
      features.push(
        feature(
          {
            type: "Point",
            coordinates: toLngLat(plan.mapPreset, current),
          },
          {
            kind: "sensor",
            id: `${uav.id}_sensor`,
            color: uav.colorSoft,
            radiusPxAtZoom0,
          },
        ),
      );
    }
  });

  plan.nfzs.forEach((nfz) => {
    features.push(
      feature(
        {
          type: "Polygon",
          coordinates: [
            nfz.polygon?.length
              ? closeRing(pointsToLngLat(plan.mapPreset, nfz.polygon))
              : localCircleToLngLat(plan.mapPreset, nfz.center, nfz.radiusM),
          ],
        },
        {
          kind: "nfz",
          id: nfz.id,
          color: "#ef4444",
        },
      ),
    );
  });

  plan.threats.forEach((threat) => {
    const destroyed =
      threat.phase === "destroyed" ||
      (threat.phase === "striking" && (threat.strike?.impactS ?? Infinity) <= simTimeS);
    const friendly = threat.phase === "friendly";
    const pending = threat.phase === "undetected";
    const color = destroyed
      ? "#6b7280"
      : friendly
        ? "#22c55e"
        : pending
          ? "#a3a3a3"
          : threat.kind === "large"
            ? "#ef4444"
            : threat.kind === "small"
              ? "#f97316"
              : "#f59e0b";
    const ringRadius = threat.kind === "large" ? 340 : threat.kind === "small" ? 230 : 160;
    const label = friendly
      ? "FRIENDLY"
      : destroyed
        ? "DESTROYED"
        : threat.phase === "striking"
          ? "STRIKE"
          : pending
            ? "CONTACT?"
            : threat.kind === "merchant"
              ? "MERCHANT?"
              : threat.kind === "small"
                ? "SMALL"
                : "LARGE";
    features.push(
      feature(
        {
          type: "Polygon",
          coordinates: [localCircleToLngLat(plan.mapPreset, threat.point, ringRadius, 48)],
        },
        { kind: "threat_ring", id: `${threat.id}_ring`, color },
      ),
    );
    features.push(
      feature(
        { type: "Point", coordinates: toLngLat(plan.mapPreset, threat.point) },
        {
          kind: "threat",
          id: threat.id,
          color,
          threatKind: threat.kind,
          phase: threat.phase,
          label,
        },
      ),
    );
  });

  features.push(
    feature(
      {
        type: "Point",
        coordinates: toLngLat(plan.mapPreset, plan.base),
      },
      { kind: "base", id: "BASE", color: "#22d3ee" },
    ),
  );

  [
    ...plan.homeBase.outboundWaypoints.map((waypoint) => ({
      ...waypoint,
      direction: "outbound" as const,
    })),
    ...plan.homeBase.inboundWaypoints.map((waypoint) => ({
      ...waypoint,
      direction: "inbound" as const,
    })),
  ].forEach((waypoint) => {
    features.push(
      feature(
        {
          type: "Point",
          coordinates: toLngLat(plan.mapPreset, waypoint.point),
        },
        {
          kind: "base_waypoint",
          id: waypoint.id,
          label: waypoint.label,
          direction: waypoint.direction,
          color: waypoint.direction === "outbound" ? "#60a5fa" : "#34d399",
        },
      ),
    );
  });

  plan.messages
    .filter((message) => simTimeS >= message.timeS && simTimeS <= message.timeS + 14)
    .forEach((message) => {
      const source = endpointForId(plan, message.sourceId, simTimeS);
      const targets = messageTargets(plan, message);
      if (targets.length === 0) {
        features.push(
          feature(
            {
              type: "Polygon",
              coordinates: [
                localCircleToLngLat(
                  plan.mapPreset,
                  source,
                  120 + (simTimeS - message.timeS) * 90,
                  40,
                ),
              ],
            },
            {
              kind: "comms_ring",
              id: message.id,
              color: message.type === "HEALTH_MISS" ? "#ef4444" : "#38bdf8",
            },
          ),
        );
      }
      targets.forEach((targetId) => {
        const target = endpointForId(plan, targetId, simTimeS);
        features.push(
          feature(
            {
              type: "LineString",
              coordinates: [
                toLngLat(plan.mapPreset, source),
                toLngLat(plan.mapPreset, target),
              ],
            },
            {
              kind: "comms",
              id: `${message.id}_${targetId}`,
              color: message.type === "HEALTH_MISS" ? "#ef4444" : "#38bdf8",
            },
          ),
        );
      });
    });

  return { type: "FeatureCollection", features };
}
