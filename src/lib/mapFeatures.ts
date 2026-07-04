import { closeRing, localCircleToLngLat, pointsToLngLat, toLngLat } from "@/lib/geo";
import { getUavSnapshot } from "@/lib/simulator";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { MissionMessage, MissionPlan, Point, RouteWaypoint } from "@/lib/types";

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

export function missionToGeoJson(
  plan: MissionPlan,
  simTimeS: number,
  selectedUavId?: string,
): FeatureCollection {
  const features: Feature[] = [];

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
    const owner = plan.uavs.find((uav) => uav.id === strip.assignedUavId);
    features.push(
      feature(
        {
          type: "Polygon",
          coordinates: [closeRing(pointsToLngLat(plan.mapPreset, strip.polygon))],
        },
        {
          kind: "strip",
          id: strip.id,
          ownerId: strip.assignedUavId,
          status: strip.status,
          color:
            strip.status === "coverage_debt"
              ? "#f97316"
              : strip.status === "blocked_by_nfz"
                ? "#ef4444"
                : owner?.colorSoft ?? "rgba(148, 163, 184, 0.18)",
          lineColor: owner?.color ?? "#94a3b8",
        },
      ),
    );
  });

  plan.uavs.forEach((uav) => {
    const routeFeature = lineFromRoute(plan, uav.route, {
      kind: "route",
      id: `${uav.id}_route`,
      uavId: uav.id,
      color: uav.status === "lost" ? "#ef4444" : uav.color,
      selected: uav.id === selectedUavId,
    });
    if (routeFeature) features.push(routeFeature);

    if (uav.originalRoute) {
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
      features.push(
        feature(
          {
            type: "Polygon",
            coordinates: [
              localCircleToLngLat(
                plan.mapPreset,
                current,
                plan.config.sensorSwathM * 0.48,
                32,
              ),
            ],
          },
          {
            kind: "sensor",
            id: `${uav.id}_sensor`,
            color: uav.colorSoft,
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
