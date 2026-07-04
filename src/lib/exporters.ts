import JSZip from "jszip";
import { saveAs } from "file-saver";
import { formatClock } from "@/lib/geometry";
import { localMetersToLatLon } from "@/lib/geo";
import type { MissionPlan, RouteWaypoint, UavPlan } from "@/lib/types";

export type MissionArtifact = {
  name: string;
  content: string;
  mime: string;
};

function jsonArtifact(name: string, value: unknown): MissionArtifact {
  return {
    name,
    mime: "application/json",
    content: JSON.stringify(value, null, 2),
  };
}

function routeForExport(route: RouteWaypoint[]): RouteWaypoint[] {
  return route.filter(
    (point, index) =>
      index === 0 ||
      index === route.length - 1 ||
      index % 3 === 0 ||
      point.phase === "covering" ||
      point.phase === "return" ||
      point.phase === "detour",
  );
}

function waypointRow(
  seq: number,
  current: 0 | 1,
  frame: number,
  command: number,
  lat: number,
  lon: number,
  alt: number,
) {
  return [
    seq,
    current,
    frame,
    command,
    0,
    0,
    0,
    0,
    lat.toFixed(7),
    lon.toFixed(7),
    alt.toFixed(2),
    1,
  ].join("\t");
}

function buildWaypointFile(plan: MissionPlan, uav: UavPlan): MissionArtifact {
  const rows = ["QGC WPL 110"];
  const home = localMetersToLatLon(
    plan.mapPreset.baseLat,
    plan.mapPreset.baseLon,
    plan.base,
  );
  rows.push(waypointRow(0, 1, 0, 16, home.lat, home.lon, uav.altitudeM));
  rows.push(waypointRow(1, 0, 3, 22, home.lat, home.lon, uav.altitudeM));

  routeForExport(uav.route).forEach((point, index) => {
    const geo = localMetersToLatLon(
      plan.mapPreset.baseLat,
      plan.mapPreset.baseLon,
      point,
    );
    rows.push(
      waypointRow(
        index + 2,
        0,
        3,
        16,
        geo.lat,
        geo.lon,
        uav.altitudeM,
      ),
    );
  });
  rows.push(`${rows.length}\t0\t3\t20\t0\t0\t0\t0\t0\t0\t0\t1`);

  return {
    name: `${uav.id.toLowerCase()}.waypoints`,
    mime: "text/plain",
    content: rows.join("\n"),
  };
}

function buildReadme(plan: MissionPlan): MissionArtifact {
  return {
    name: "README_mission_planner_import.txt",
    mime: "text/plain",
    content: [
      "OmniVis Mission Package",
      "",
      "These files demonstrate Mission Planner-compatible export from the OmniVis web simulator.",
      "",
      "Import flow used in the demo video:",
      "1. Open Mission Planner.",
      "2. Go to Flight Plan.",
      "3. Use Load WP File.",
      "4. Select uav_1.waypoints.",
      "5. Inspect generated waypoints and route.",
      "6. Repeat for additional UAV files if using multiple simulated vehicles.",
      "",
      "OmniVis is not a replacement for Mission Planner. It is an upstream autonomy compiler that generates cooperative mission artifacts for review, upload, and simulation.",
      "",
      `Generated mission: ${plan.id}`,
      `Mission time: ${formatClock(plan.metrics.missionCompletionTimeS)}`,
    ].join("\n"),
  };
}

export function buildMissionArtifacts(plan: MissionPlan): MissionArtifact[] {
  const initialInfill =
    plan.config.initialInfillPattern ?? plan.config.pathPattern ?? "rectilinear";
  const contingencyInfill =
    plan.config.contingencyInfillPattern ?? initialInfill;
  const missionContract = {
    schema: "omnivis.mission_contract.v1",
    missionId: plan.id,
    generatedAt: plan.generatedAt,
    seed: plan.seed,
    mapPreset: plan.mapPreset.label,
    base: {
      localM: plan.base,
      lat: plan.mapPreset.baseLat,
      lon: plan.mapPreset.baseLon,
      homeBase: {
        id: plan.homeBase.id,
        label: plan.homeBase.label,
        available: plan.homeBase.available !== false,
        waypointMode: plan.homeBase.waypointMode,
        specificOutboundWaypointId: plan.homeBase.specificOutboundWaypointId,
        specificInboundWaypointId: plan.homeBase.specificInboundWaypointId,
        outboundWaypoints: plan.homeBase.outboundWaypoints,
        inboundWaypoints: plan.homeBase.inboundWaypoints,
      },
    },
    aooPolygonM: plan.aoo,
    config: plan.config,
    infill: {
      initial: initialInfill,
      contingency: contingencyInfill,
    },
    uavs: plan.uavs.map((uav) => ({
      id: uav.id,
      label: uav.label,
      altitudeM: uav.altitudeM,
      status: uav.status,
      assignedStripIds: uav.assignedStripIds,
      rtbSlotS: uav.rtbSlotS,
      color: uav.color,
    })),
    strips: plan.strips.map((strip) => ({
      id: strip.id,
      assignedUavId: strip.assignedUavId,
      status: strip.status,
      start: strip.start,
      end: strip.end,
    })),
  };

  const contingencyPolicy = {
    schema: "omnivis.contingency_policy.v1",
    commsPolicy: plan.config.commsPolicy,
    vehicleLoss: {
      activeMode: plan.lossResponseMode,
      dispatchReplacement:
        "Replacement UAVs launch from the active home or backup base and inherit unfinished work from the lost aircraft.",
      spreadRemainingSwarm: `In full-signal operation, unfinished strips are redistributed using the ${contingencyInfill} contingency infill.`,
    },
    popUpNfz:
      "Live NFZ updates block intersecting strips and trigger NFZ-safe replans for affected future route legs.",
    rtb:
      "Return-to-base arrival windows are staggered in the mission contract and reinforced with hold points before the final corridor.",
  };

  const trace = {
    schema: "omnivis.simulation_trace.v1",
    samplesEveryS: 120,
    samples: Array.from(
      { length: Math.ceil(plan.metrics.missionCompletionTimeS / 120) + 1 },
      (_, index) => {
        const t = index * 120;
        return {
          t,
          uavs: plan.uavs.map((uav) => {
            const point =
              uav.route.find((candidate) => candidate.t >= t) ??
              uav.route[uav.route.length - 1];
            return {
              id: uav.id,
              x: point?.x ?? 0,
              y: point?.y ?? 0,
              phase: point?.phase ?? "preflight",
            };
          }),
        };
      },
    ),
  };

  return [
    jsonArtifact("mission_contract.json", missionContract),
    jsonArtifact("contingency_policy.json", contingencyPolicy),
    jsonArtifact("metrics.json", plan.metrics),
    jsonArtifact("simulation_trace.json", trace),
    ...plan.uavs
      .filter((uav) => uav.status !== "lost")
      .map((uav) => buildWaypointFile(plan, uav)),
    buildReadme(plan),
  ];
}

export function downloadArtifact(artifact: MissionArtifact) {
  saveAs(new Blob([artifact.content], { type: artifact.mime }), artifact.name);
}

export async function downloadMissionPackage(plan: MissionPlan) {
  const zip = new JSZip();
  buildMissionArtifacts(plan).forEach((artifact) => {
    zip.file(artifact.name, artifact.content);
  });
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${plan.id}.zip`);
}
