"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapMouseEvent,
  Popup as MapLibrePopup,
  StyleSpecification,
} from "maplibre-gl";
import { AlertTriangle, Crosshair } from "lucide-react";
import { closeRing, latLonToLocalMeters, pointsToLngLat, toLngLat } from "@/lib/geo";
import { distance, midpoint, polygonCentroid } from "@/lib/geometry";
import { missionToGeoJson } from "@/lib/mapFeatures";
import { normalizeHomeBase } from "@/lib/routing";
import type { Feature, FeatureCollection } from "geojson";
import type {
  EditorMode,
  HomeBase,
  MapPreset,
  MissionPlan,
  PlanningArea,
  PlanningNfz,
  PlanningThreat,
  Point,
} from "@/lib/types";

type EditorFeatureKind = "area" | "base" | "nfz" | "waypoint" | "threat";

type Props = {
  plan: MissionPlan | null;
  mapPreset: MapPreset;
  areas: PlanningArea[];
  homeBases: HomeBase[];
  planningNfzs: PlanningNfz[];
  planningThreats: PlanningThreat[];
  draftPolygon: Point[];
  editorMode: EditorMode;
  simTimeS: number;
  selectedUavId?: string;
  selectedAreaId?: string;
  selectedBaseId?: string;
  selectedNfzId?: string;
  selectedThreatId?: string;
  onSelectUav: (uavId: string) => void;
  onMapPoint: (point: Point) => void;
  onSelectEditorFeature: (kind: EditorFeatureKind, id: string) => void;
  onMoveEditorFeature: (
    kind: EditorFeatureKind,
    id: string,
    delta: Point,
    vertexIndex?: number,
  ) => void;
  onCommitEditorFeatureMove: (
    kind: EditorFeatureKind,
    id: string,
    delta?: Point,
    vertexIndex?: number,
  ) => void;
};

const EMPTY_COLLECTION = {
  type: "FeatureCollection" as const,
  features: [],
};

function shiftPolygon(polygon: Point[], delta: Point, vertexIndex?: number): Point[] {
  return polygon.map((point, index) => {
    if (vertexIndex !== undefined && index !== vertexIndex) return point;
    return {
      x: point.x + delta.x,
      y: point.y + delta.y,
    };
  });
}

function circlePoints(center: Point, radiusM: number, steps: number): Point[] {
  return Array.from({ length: steps }, (_, index) => {
    const angle = (2 * Math.PI * index) / steps;
    return {
      x: center.x + Math.cos(angle) * radiusM,
      y: center.y + Math.sin(angle) * radiusM,
    };
  });
}

const EDITOR_HIT_LAYERS = [
  "editor-vertices",
  "editor-waypoint-hit",
  "editor-waypoint",
  "editor-threat-hit",
  "editor-threat-dot",
  "editor-base-hit",
  "editor-base",
  "editor-nfz-fill",
  "editor-area-fill",
] as const;

const EDITOR_POPUP_LAYERS = [
  "editor-base-hit",
  "editor-waypoint-hit",
  "editor-threat-hit",
  "editor-nfz-fill",
  "editor-area-fill",
] as const;

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["/api/osm/{z}/{x}/{y}"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "black-bg",
      type: "background",
      paint: { "background-color": "#222b30" },
    },
    {
      id: "osm-raster",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -1,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.5,
        "raster-contrast": -0.12,
        "raster-opacity": 0.56,
      },
    },
  ],
};

function draftFeatures(
  mapPreset: MapPreset,
  draftPolygon: Point[],
  editorMode: EditorMode,
): Feature[] {
  const features: Feature[] = [];
  if (draftPolygon.length >= 3) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closeRing(pointsToLngLat(mapPreset, draftPolygon))],
      },
      properties: {
        kind: editorMode === "draw_nfz" ? "draft_nfz" : "draft_area",
        entityKind: editorMode === "draw_nfz" ? "nfz" : "area",
      },
    });
  }
  if (draftPolygon.length >= 2) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: pointsToLngLat(mapPreset, draftPolygon),
      },
      properties: {
        kind: editorMode === "draw_nfz" ? "draft_nfz_line" : "draft_area_line",
        entityKind: editorMode === "draw_nfz" ? "nfz" : "area",
      },
    });
  }
  draftPolygon.forEach((point, index) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: toLngLat(mapPreset, point),
      },
      properties: {
        kind: "draft_point",
        entityKind: editorMode === "draw_nfz" ? "nfz" : "area",
        index: index + 1,
      },
    });
  });
  return features;
}

function editorFeatures({
  mapPreset,
  areas,
  homeBases,
  planningNfzs,
  planningThreats,
  draftPolygon,
  editorMode,
  selectedAreaId,
  selectedBaseId,
  selectedNfzId,
  selectedThreatId,
}: {
  mapPreset: MapPreset;
  areas: PlanningArea[];
  homeBases: HomeBase[];
  planningNfzs: PlanningNfz[];
  planningThreats: PlanningThreat[];
  draftPolygon: Point[];
  editorMode: EditorMode;
  selectedAreaId?: string;
  selectedBaseId?: string;
  selectedNfzId?: string;
  selectedThreatId?: string;
}): Feature[] {
  const features: Feature[] = [];
  const normalizedHomeBases = homeBases.map((base) => normalizeHomeBase(base));

  areas.forEach((area) => {
    if (!area.linkedBaseId) return;
    const linkedBase = normalizedHomeBases.find((base) => base.id === area.linkedBaseId);
    if (!linkedBase) return;
    const areaCenter = polygonCentroid(area.polygon);
    const distanceKm = distance(linkedBase.point, areaCenter) / 1000;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          toLngLat(mapPreset, linkedBase.point),
          toLngLat(mapPreset, areaCenter),
        ],
      },
      properties: {
        kind: "area_base_link",
        entityKind: "link",
        id: `${area.id}_${linkedBase.id}`,
        areaId: area.id,
        baseId: linkedBase.id,
        label: `${linkedBase.label} linked to ${area.label}`,
        selected: area.id === selectedAreaId || linkedBase.id === selectedBaseId,
      },
    });
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: toLngLat(mapPreset, midpoint(linkedBase.point, areaCenter)),
      },
      properties: {
        kind: "area_base_link_label",
        entityKind: "link",
        id: `${area.id}_${linkedBase.id}_distance`,
        label: `${distanceKm.toFixed(distanceKm >= 10 ? 0 : 1)} km`,
        selected: area.id === selectedAreaId || linkedBase.id === selectedBaseId,
      },
    });
  });

  areas.forEach((area) => {
    if (!area.backupBaseId) return;
    const backupBase = normalizedHomeBases.find((base) => base.id === area.backupBaseId);
    if (!backupBase) return;
    const areaCenter = polygonCentroid(area.polygon);
    const distanceKm = distance(backupBase.point, areaCenter) / 1000;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          toLngLat(mapPreset, backupBase.point),
          toLngLat(mapPreset, areaCenter),
        ],
      },
      properties: {
        kind: "area_base_backup_link",
        entityKind: "link",
        id: `${area.id}_${backupBase.id}_backup`,
        areaId: area.id,
        baseId: backupBase.id,
        label: `${backupBase.label} backup for ${area.label}`,
        selected: area.id === selectedAreaId || backupBase.id === selectedBaseId,
      },
    });
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: toLngLat(mapPreset, midpoint(backupBase.point, areaCenter)),
      },
      properties: {
        kind: "area_base_link_label",
        entityKind: "link",
        id: `${area.id}_${backupBase.id}_backup_distance`,
        label: `${distanceKm.toFixed(distanceKm >= 10 ? 0 : 1)} km`,
        selected: area.id === selectedAreaId || backupBase.id === selectedBaseId,
      },
    });
  });

  areas.forEach((area) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closeRing(pointsToLngLat(mapPreset, area.polygon))],
      },
      properties: {
        kind: "planning_area",
        entityKind: "area",
        id: area.id,
        label: area.label,
        linkedBaseId: area.linkedBaseId,
        backupBaseId: area.backupBaseId,
        selected: area.id === selectedAreaId,
      },
    });
    area.polygon.forEach((point, index) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(mapPreset, point) },
        properties: {
          kind: "area_vertex",
          entityKind: "area",
          id: area.id,
          index,
          selected: area.id === selectedAreaId,
        },
      });
    });
  });

  planningNfzs.forEach((nfz) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closeRing(pointsToLngLat(mapPreset, nfz.polygon))],
      },
      properties: {
        kind: "planning_nfz",
        entityKind: "nfz",
        id: nfz.id,
        label: nfz.label,
        enabled: nfz.enabled !== false,
        selected: nfz.id === selectedNfzId,
      },
    });
    nfz.polygon.forEach((point, index) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(mapPreset, point) },
        properties: {
          kind: "nfz_vertex",
          entityKind: "nfz",
          id: nfz.id,
          index,
          selected: nfz.id === selectedNfzId,
        },
      });
    });
  });

  planningThreats.forEach((threat) => {
    const color =
      threat.kind === "large" ? "#ef4444" : threat.kind === "small" ? "#f97316" : "#f59e0b";
    const ringRadius = threat.kind === "large" ? 340 : threat.kind === "small" ? 230 : 160;
    const label =
      threat.kind === "large" ? "LARGE?" : threat.kind === "small" ? "SMALL?" : "MERCHANT?";
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closeRing(pointsToLngLat(mapPreset, circlePoints(threat.point, ringRadius, 48)))],
      },
      properties: {
        kind: "planning_threat_ring",
        entityKind: "threat",
        id: threat.id,
        color,
        selected: threat.id === selectedThreatId,
      },
    });
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: toLngLat(mapPreset, threat.point) },
      properties: {
        kind: "planning_threat",
        entityKind: "threat",
        id: threat.id,
        label,
        color,
        selected: threat.id === selectedThreatId,
      },
    });
  });

  normalizedHomeBases.forEach((normalizedBase) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: toLngLat(mapPreset, normalizedBase.point) },
      properties: {
        kind: "home_base",
        entityKind: "base",
        id: normalizedBase.id,
        label: normalizedBase.label,
        available: normalizedBase.available !== false,
        selected: normalizedBase.id === selectedBaseId,
      },
    });
    [
      ...normalizedBase.outboundWaypoints.map((waypoint) => ({
        ...waypoint,
        direction: "outbound" as const,
      })),
      ...normalizedBase.inboundWaypoints.map((waypoint) => ({
        ...waypoint,
        direction: "inbound" as const,
      })),
    ].forEach((waypoint) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(mapPreset, waypoint.point) },
        properties: {
          kind: "base_waypoint",
          entityKind: "waypoint",
          id: waypoint.id,
          baseId: normalizedBase.id,
          label: waypoint.label,
          direction: waypoint.direction,
          selected: normalizedBase.id === selectedBaseId,
        },
      });
    });
  });

  return [
    ...features,
    ...draftFeatures(mapPreset, draftPolygon, editorMode),
  ];
}

function makeSdfIcon(kind: "triangle" | "diamond", size = 64): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create map icon");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "white";
  ctx.beginPath();
  if (kind === "triangle") {
    ctx.moveTo(size / 2, 6);
    ctx.lineTo(size - 8, size - 8);
    ctx.lineTo(size / 2, size - 18);
    ctx.lineTo(8, size - 8);
  } else {
    ctx.moveTo(size / 2, 5);
    ctx.lineTo(size - 7, size / 2);
    ctx.lineTo(size / 2, size - 5);
    ctx.lineTo(7, size / 2);
  }
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function ensureMapImages(map: MapLibreMap) {
  if (!map.hasImage("uav-triangle")) {
    map.addImage("uav-triangle", makeSdfIcon("triangle"), { sdf: true });
  }
  if (!map.hasImage("base-diamond")) {
    map.addImage("base-diamond", makeSdfIcon("diamond"), { sdf: true });
  }
}

function popupContent({
  kind,
  label,
  detail,
}: {
  kind: string;
  label: string;
  detail?: string;
}) {
  const root = document.createElement("div");
  root.style.cssText =
    "min-width: 110px; background: rgba(0,0,0,0.82); color: #f5f5f5; padding: 5px 7px; box-shadow: 0 8px 18px rgba(0,0,0,0.28);";
  const eyebrow = document.createElement("div");
  eyebrow.style.cssText =
    "font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin-bottom: 1px;";
  eyebrow.textContent = kind;
  const title = document.createElement("div");
  title.style.cssText =
    "font-size: 11px; line-height: 1.15; font-weight: 700; color: #f8fafc;";
  title.textContent = label;
  root.append(eyebrow, title);
  if (detail) {
    const detailNode = document.createElement("div");
    detailNode.style.cssText =
      "margin-top: 3px; font-size: 9px; line-height: 1.2; color: #cbd5e1;";
    detailNode.textContent = detail;
    root.append(detailNode);
  }
  return root;
}

function addMissionLayers(map: MapLibreMap) {
  ensureMapImages(map);
  if (!map.getSource("editor")) {
    map.addSource("editor", {
      type: "geojson",
      data: EMPTY_COLLECTION,
    });
  }
  if (!map.getSource("mission")) {
    map.addSource("mission", {
      type: "geojson",
      data: EMPTY_COLLECTION,
    });
  }

  const editorLayers = [
    {
      id: "editor-link-line",
      type: "line",
      filter: [
        "in",
        ["get", "kind"],
        ["literal", ["area_base_link", "area_base_backup_link"]],
      ],
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "kind"], "area_base_backup_link"],
          "#fbbf24",
          "#a7f3d0",
        ],
        "line-width": ["case", ["==", ["get", "selected"], true], 2.8, 1.8],
        "line-opacity": ["case", ["==", ["get", "selected"], true], 0.95, 0.62],
        "line-dasharray": [1, 1.8],
      },
    },
    {
      id: "editor-link-label",
      type: "symbol",
      filter: ["==", ["get", "kind"], "area_base_link_label"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-rotation-alignment": "viewport",
        "text-pitch-alignment": "viewport",
      },
      paint: {
        "text-color": ["case", ["==", ["get", "selected"], true], "#f8fafc", "#d1fae5"],
        "text-halo-color": "#020617",
        "text-halo-width": 2,
        "text-opacity": ["case", ["==", ["get", "selected"], true], 1, 0.86],
      },
    },
    {
      id: "editor-area-fill",
      type: "fill",
      filter: ["in", ["get", "kind"], ["literal", ["planning_area", "draft_area"]]],
      paint: {
        "fill-color": "#38bdf8",
        "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.2, 0.11],
      },
    },
    {
      id: "editor-nfz-fill",
      type: "fill",
      filter: ["in", ["get", "kind"], ["literal", ["planning_nfz", "draft_nfz"]]],
      paint: {
        "fill-color": "#ef4444",
        "fill-opacity": [
          "case",
          ["==", ["get", "enabled"], false],
          0.04,
          ["==", ["get", "selected"], true],
          0.24,
          0.15,
        ],
      },
    },
    {
      id: "editor-area-line",
      type: "line",
      filter: [
        "in",
        ["get", "kind"],
        ["literal", ["planning_area", "draft_area", "draft_area_line"]],
      ],
      paint: {
        "line-color": "#38bdf8",
        "line-width": ["case", ["==", ["get", "selected"], true], 3, 2],
        "line-opacity": 0.92,
      },
    },
    {
      id: "editor-nfz-line",
      type: "line",
      filter: [
        "in",
        ["get", "kind"],
        ["literal", ["planning_nfz", "draft_nfz", "draft_nfz_line"]],
      ],
      paint: {
        "line-color": "#fb7185",
        "line-width": ["case", ["==", ["get", "selected"], true], 3, 2],
        "line-opacity": ["case", ["==", ["get", "enabled"], false], 0.28, 0.95],
      },
    },
    {
      id: "editor-threat-ring-fill",
      type: "fill",
      filter: ["==", ["get", "kind"], "planning_threat_ring"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.16, 0.08],
      },
    },
    {
      id: "editor-threat-ring-line",
      type: "line",
      filter: ["==", ["get", "kind"], "planning_threat_ring"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["==", ["get", "selected"], true], 2.4, 1.4],
        "line-opacity": ["case", ["==", ["get", "selected"], true], 0.95, 0.78],
        "line-dasharray": [2, 2],
      },
    },
    {
      id: "editor-threat-dot",
      type: "circle",
      filter: ["==", ["get", "kind"], "planning_threat"],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 9, 7],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.88,
        "circle-stroke-color": "#050505",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "editor-threat-hit",
      type: "circle",
      filter: ["==", ["get", "kind"], "planning_threat"],
      paint: {
        "circle-radius": 18,
        "circle-color": "#ffffff",
        "circle-opacity": 0,
      },
    },
    {
      id: "editor-threat-label",
      type: "symbol",
      filter: ["==", ["get", "kind"], "planning_threat"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "#000000",
        "text-halo-width": 1.4,
      },
    },
    {
      id: "editor-vertices",
      type: "circle",
      filter: [
        "in",
        ["get", "kind"],
        ["literal", ["area_vertex", "nfz_vertex", "draft_point"]],
      ],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 5, 4],
        "circle-color": [
          "case",
          ["==", ["get", "entityKind"], "nfz"],
          "#fecdd3",
          "#bae6fd",
        ],
        "circle-stroke-color": "#050505",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "editor-waypoint",
      type: "circle",
      filter: ["==", ["get", "kind"], "base_waypoint"],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 7, 6],
        "circle-color": [
          "case",
          ["==", ["get", "direction"], "outbound"],
          "#60a5fa",
          "#34d399",
        ],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#050505",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "editor-waypoint-hit",
      type: "circle",
      filter: ["==", ["get", "kind"], "base_waypoint"],
      paint: {
        "circle-radius": 16,
        "circle-color": "#ffffff",
        "circle-opacity": 0,
      },
    },
    {
      id: "editor-base-halo",
      type: "circle",
      filter: ["==", ["get", "kind"], "home_base"],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 22, 16],
        "circle-color": [
          "case",
          ["==", ["get", "available"], false],
          "#f59e0b",
          "#38bdf8",
        ],
        "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.18, 0.1],
        "circle-stroke-color": "#bae6fd",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 2, 1],
      },
    },
    {
      id: "editor-base",
      type: "symbol",
      filter: ["==", ["get", "kind"], "home_base"],
      layout: {
        "icon-image": "base-diamond",
        "icon-size": 0.42,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-color": [
          "case",
          ["==", ["get", "available"], false],
          "#fbbf24",
          "#e5e7eb",
        ],
        "icon-opacity": 0.98,
      },
    },
    {
      id: "editor-base-hit",
      type: "circle",
      filter: ["==", ["get", "kind"], "home_base"],
      paint: {
        "circle-radius": 18,
        "circle-color": "#ffffff",
        "circle-opacity": 0,
      },
    },
  ] as const;

  editorLayers.forEach((layer) => {
    if (!map.getLayer(layer.id)) {
      map.addLayer({
        ...layer,
        source: "editor",
      } as never);
    }
  });

  const layers = [
    {
      id: "mission-aoo-fill",
      type: "fill",
      filter: ["in", ["get", "kind"], ["literal", ["aoo", "draft_area"]]],
      paint: {
        "fill-color": "#38bdf8",
        "fill-opacity": ["case", ["==", ["get", "kind"], "draft_area"], 0.07, 0.035],
      },
    },
    {
      id: "mission-strip-fill",
      type: "fill",
      filter: ["==", ["get", "kind"], "strip"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": [
          "case",
          ["==", ["get", "status"], "coverage_debt"],
          0.18,
          ["==", ["get", "status"], "blocked_by_nfz"],
          0.16,
          0.08,
        ],
      },
    },
    {
      id: "mission-sensor-fill",
      type: "circle",
      filter: ["==", ["get", "kind"], "sensor"],
      paint: {
        // Radius stays constant in meters: pixels = radiusPxAtZoom0 * 2^zoom.
        "circle-radius": [
          "interpolate",
          ["exponential", 2],
          ["zoom"],
          0,
          ["get", "radiusPxAtZoom0"],
          22,
          ["*", ["get", "radiusPxAtZoom0"], 4194304],
        ],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.45,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.9,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "mission-nfz-fill",
      type: "fill",
      filter: ["==", ["get", "kind"], "nfz"],
      paint: {
        "fill-color": "#ef4444",
        "fill-opacity": 0.2,
      },
    },
    {
      id: "mission-comms-ring",
      type: "line",
      filter: ["==", ["get", "kind"], "comms_ring"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2,
        "line-opacity": 0.8,
      },
    },
    {
      id: "mission-aoo-line",
      type: "line",
      filter: ["in", ["get", "kind"], ["literal", ["aoo", "draft_area", "draft_line"]]],
      paint: {
        "line-color": "#38bdf8",
        "line-width": ["case", ["==", ["get", "kind"], "draft_line"], 2.5, 1.5],
        "line-opacity": 0.82,
      },
    },
    {
      id: "mission-strip-line",
      type: "line",
      filter: ["==", ["get", "kind"], "strip"],
      paint: {
        "line-color": ["get", "lineColor"],
        "line-width": 0.45,
        "line-opacity": 0.14,
      },
    },
    {
      id: "mission-original-route",
      type: "line",
      filter: ["==", ["get", "kind"], "original_route"],
      paint: {
        "line-color": "#94a3b8",
        "line-width": 1.8,
        "line-opacity": 0.28,
        "line-dasharray": [2, 2],
      },
    },
    {
      id: "mission-route",
      type: "line",
      filter: ["==", ["get", "kind"], "route"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["==", ["get", "selected"], true], 4.6, 2.5],
        "line-opacity": ["case", ["==", ["get", "selected"], true], 0.9, 0.64],
      },
    },
    {
      id: "mission-draft-point",
      type: "circle",
      filter: ["==", ["get", "kind"], "draft_point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#f5f5f5",
        "circle-opacity": 0.9,
        "circle-stroke-color": "#171717",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "mission-comms",
      type: "line",
      filter: ["==", ["get", "kind"], "comms"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
        "line-opacity": 0.86,
        "line-blur": 1.2,
      },
    },
    {
      id: "mission-nfz-line",
      type: "line",
      filter: ["==", ["get", "kind"], "nfz"],
      paint: {
        "line-color": "#f87171",
        "line-width": 2,
        "line-opacity": 0.95,
      },
    },
    {
      id: "mission-threat-ring-fill",
      type: "fill",
      filter: ["==", ["get", "kind"], "threat_ring"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.1,
      },
    },
    {
      id: "mission-threat-ring-line",
      type: "line",
      filter: ["==", ["get", "kind"], "threat_ring"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.4,
        "line-opacity": 0.8,
        "line-dasharray": [2, 2],
      },
    },
    {
      id: "mission-threat-fill",
      type: "circle",
      filter: ["==", ["get", "kind"], "threat"],
      paint: {
        "circle-radius": 7,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.9,
        "circle-stroke-color": "#0a0a0a",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "mission-threat-label",
      type: "symbol",
      filter: ["==", ["get", "kind"], "threat"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "#000000",
        "text-halo-width": 1.4,
      },
    },
    {
      id: "mission-base-halo",
      type: "circle",
      filter: ["==", ["get", "kind"], "base"],
      paint: {
        "circle-radius": 18,
        "circle-color": "#22d3ee",
        "circle-opacity": 0.13,
        "circle-stroke-color": "#67e8f9",
        "circle-stroke-width": 1,
      },
    },
    {
      id: "mission-base",
      type: "symbol",
      filter: ["==", ["get", "kind"], "base"],
      layout: {
        "icon-image": "base-diamond",
        "icon-size": 0.36,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-color": "#67e8f9",
        "icon-opacity": 0.96,
      },
    },
    {
      id: "mission-base-waypoint",
      type: "circle",
      filter: ["==", ["get", "kind"], "base_waypoint"],
      paint: {
        "circle-radius": 5,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#020617",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "mission-uav-select",
      type: "circle",
      filter: ["all", ["==", ["get", "kind"], "uav"], ["==", ["get", "selected"], true]],
      paint: {
        "circle-radius": 18,
        "circle-color": "#67e8f9",
        "circle-opacity": 0.08,
        "circle-stroke-color": "#67e8f9",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.92,
      },
    },
    {
      id: "mission-uav-dot",
      type: "circle",
      filter: ["==", ["get", "kind"], "uav"],
      paint: {
        "circle-radius": 7,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#020617",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "mission-uav-symbol",
      type: "symbol",
      filter: ["==", ["get", "kind"], "uav"],
      layout: {
        "icon-image": "uav-triangle",
        "icon-size": 0.28,
        "icon-rotate": ["get", "heading"],
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-color": ["get", "color"],
        "icon-opacity": 0.98,
      },
    },
  ] as const;

  layers.forEach((layer) => {
    if (!map.getLayer(layer.id)) {
      map.addLayer({
        ...layer,
        source: "mission",
      } as never);
    }
  });
}

function fitPlan(map: MapLibreMap, plan: MissionPlan) {
  const coords = [
    ...pointsToLngLat(plan.mapPreset, plan.aoo),
    toLngLat(plan.mapPreset, plan.base),
  ];
  const lngs = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  const bounds: LngLatBoundsLike = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
  map.fitBounds(bounds, { padding: 90, duration: 850, maxZoom: 12.8 });
}

const THEATER_JUMPS = [
  {
    label: "Ukraine-Russia border",
    center: { lat: 49.92, lon: 36.62 },
    zoom: 6.4,
  },
  {
    label: "Iran",
    center: { lat: 32.45, lon: 53.68 },
    zoom: 5.2,
  },
  {
    label: "Palestine-Israel border",
    center: { lat: 31.72, lon: 35.05 },
    zoom: 8.1,
  },
] as const;

const DEFAULT_THEATER_JUMP = THEATER_JUMPS[0];

export function MapMissionView({
  plan,
  mapPreset,
  areas,
  homeBases,
  planningNfzs,
  planningThreats,
  draftPolygon,
  editorMode,
  simTimeS,
  selectedUavId,
  selectedAreaId,
  selectedBaseId,
  selectedNfzId,
  selectedThreatId,
  onSelectUav,
  onMapPoint,
  onSelectEditorFeature,
  onMoveEditorFeature,
  onCommitEditorFeatureMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const planIdRef = useRef<string | null>(null);
  const lastPresetIdRef = useRef(mapPreset.id);
  const nfzMarkersRef = useRef<Array<{ remove: () => void }>>([]);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const popupSuppressedUntilRef = useRef(0);
  const editorDataRef = useRef({ areas, homeBases, planningNfzs, planningThreats });
  const editorViewRef = useRef({
    draftPolygon,
    editorMode,
    selectedAreaId,
    selectedBaseId,
    selectedNfzId,
    selectedThreatId,
  });
  const callbacksRef = useRef({
    onSelectUav,
    onMapPoint,
    onSelectEditorFeature,
    onMoveEditorFeature,
    onCommitEditorFeatureMove,
  });
  const dragRef = useRef<{
    kind: EditorFeatureKind;
    id: string;
    vertexIndex?: number;
    startPoint: Point;
    lastPoint: Point;
    totalDelta: Point;
    originalPolygon?: Point[];
    moved: boolean;
    committed?: boolean;
  } | null>(null);
  const initialViewRef = useRef({
    center: DEFAULT_THEATER_JUMP.center,
    zoom: DEFAULT_THEATER_JUMP.zoom,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    editorDataRef.current = { areas, homeBases, planningNfzs, planningThreats };
  }, [areas, homeBases, planningNfzs, planningThreats]);

  useEffect(() => {
    editorViewRef.current = {
      draftPolygon,
      editorMode,
      selectedAreaId,
      selectedBaseId,
      selectedNfzId,
      selectedThreatId,
    };
  }, [draftPolygon, editorMode, selectedAreaId, selectedBaseId, selectedNfzId, selectedThreatId]);

  useEffect(() => {
    callbacksRef.current = {
      onSelectUav,
      onMapPoint,
      onSelectEditorFeature,
      onMoveEditorFeature,
      onCommitEditorFeatureMove,
    };
  }, [
    onCommitEditorFeatureMove,
    onMapPoint,
    onMoveEditorFeature,
    onSelectEditorFeature,
    onSelectUav,
  ]);

  const geoJson: FeatureCollection = useMemo(() => {
    return plan
      ? missionToGeoJson(plan, simTimeS, selectedUavId)
      : EMPTY_COLLECTION;
  }, [plan, selectedUavId, simTimeS]);

  const editorGeoJson: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: editorFeatures({
        mapPreset: plan?.mapPreset ?? mapPreset,
        areas,
        homeBases,
        planningNfzs,
        planningThreats: plan
          ? plan.threats
              .filter(
                (threat) =>
                  !["destroyed", "friendly", "removed"].includes(threat.phase),
              )
              .map((threat) => ({
                id: threat.id,
                kind: threat.kind,
                point: threat.point,
              }))
          : planningThreats,
        draftPolygon,
        editorMode,
        selectedAreaId,
        selectedBaseId,
        selectedNfzId,
        selectedThreatId,
      }),
    }),
    [
      areas,
      draftPolygon,
      editorMode,
      homeBases,
      mapPreset,
      plan,
      planningNfzs,
      planningThreats,
      selectedAreaId,
      selectedBaseId,
      selectedNfzId,
      selectedThreatId,
    ],
  );

  useEffect(() => {
    let disposed = false;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [
          initialViewRef.current.center.lon,
          initialViewRef.current.center.lat,
        ],
        zoom: initialViewRef.current.zoom,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
      });
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
        }),
        "bottom-right",
      );
      map.addControl(
        new maplibregl.NavigationControl({
          visualizePitch: false,
          showCompass: false,
        }),
        "top-right",
      );
      mapRef.current = map;
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "omnivis-editor-popup",
      });
      let overlayReady = false;
      const activateMissionOverlay = () => {
        if (disposed || overlayReady) return;
        try {
          addMissionLayers(map);
        } catch {
          window.setTimeout(activateMissionOverlay, 120);
          return;
        }
        overlayReady = true;
        window.setTimeout(() => map.resize(), 0);
        setLoaded(true);
      };
      map.on("load", activateMissionOverlay);
      map.on("style.load", activateMissionOverlay);
      map.on("styledata", activateMissionOverlay);
      window.setTimeout(activateMissionOverlay, 0);
    }

    initMap();

    return () => {
      disposed = true;
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("mission") as GeoJSONSource | undefined;
    source?.setData(geoJson);
  }, [geoJson, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("editor") as GeoJSONSource | undefined;
    source?.setData(editorGeoJson);
  }, [editorGeoJson, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan) return;
    if (planIdRef.current !== plan.id) {
      planIdRef.current = plan.id;
      fitPlan(map, plan);
    }
  }, [loaded, plan]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || plan || lastPresetIdRef.current === mapPreset.id) return;
    lastPresetIdRef.current = mapPreset.id;
    map.easeTo({
      center: [mapPreset.mapCenter.lon, mapPreset.mapCenter.lat],
      zoom: mapPreset.mapZoom,
      duration: 550,
    });
    planIdRef.current = null;
  }, [mapPreset, plan]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const localPoint = (event: MapMouseEvent) =>
      latLonToLocalMeters(mapPreset.baseLat, mapPreset.baseLon, {
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
      });

    const popupInfoForFeature = (feature: Feature) => {
      const props = feature.properties ?? {};
      const id = String(props.id ?? "");
      const label = String(props.label ?? "");
      const kind = String(props.kind ?? "");
      const {
        areas: latestAreas,
        homeBases: latestHomeBases,
        planningNfzs: latestPlanningNfzs,
        planningThreats: latestPlanningThreats,
      } = editorDataRef.current;
      if (kind === "planning_area") {
        const area = latestAreas.find((candidate) => candidate.id === id);
        const linkedBase = area?.linkedBaseId
          ? latestHomeBases.find((base) => base.id === area.linkedBaseId)
          : undefined;
        const backupBase = area?.backupBaseId
          ? latestHomeBases.find((base) => base.id === area.backupBaseId)
          : undefined;
        const linkedText = linkedBase
          ? `Primary ${linkedBase.label}${linkedBase.available === false ? " offline" : ""}`
          : "No primary base";
        const backupText = backupBase
          ? `backup ${backupBase.label}${backupBase.available === false ? " offline" : ""}`
          : "no backup";
        return {
          kind: "Fly area",
          label: (area?.label ?? label) || "Unnamed area",
          detail: `${linkedText}; ${backupText}`,
        };
      }
      if (kind === "home_base") {
        const base = latestHomeBases.find((candidate) => candidate.id === id);
        const linkedAreas = latestAreas.filter((area) => area.linkedBaseId === id);
        const backupAreas = latestAreas.filter((area) => area.backupBaseId === id);
        const roleText = [
          linkedAreas.length > 0
            ? `Primary for ${linkedAreas.map((area) => area.label).join(", ")}`
            : "",
          backupAreas.length > 0
            ? `Backup for ${backupAreas.map((area) => area.label).join(", ")}`
            : "",
        ].filter(Boolean);
        return {
          kind: "Home base",
          label: `${(base?.label ?? label) || "Unnamed base"}${
            base?.available === false ? " offline" : ""
          }`,
          detail: roleText.length > 0 ? roleText.join("; ") : "No fly area linked",
        };
      }
      if (kind === "planning_nfz") {
        const nfz = latestPlanningNfzs.find((candidate) => candidate.id === id);
        return {
          kind: "No-fly zone",
          label: (nfz?.label ?? label) || "Unnamed NFZ",
          detail: nfz?.enabled === false ? "Disabled polygon" : "Active restricted polygon",
        };
      }
      if (kind === "planning_threat") {
        const threat = latestPlanningThreats.find((candidate) => candidate.id === id);
        const threatLabel =
          threat?.kind === "large"
            ? "Large enemy threat"
            : threat?.kind === "small"
              ? "Small enemy vehicle"
              : "Merchant / friendly";
        return {
          kind: "Threat target",
          label: threatLabel,
          detail: threat
            ? `Local ${threat.point.x.toFixed(0)}, ${threat.point.y.toFixed(0)}; drag to move`
            : "Drag to move",
        };
      }
      if (kind === "base_waypoint") {
        return {
          kind: String(props.direction ?? "") === "outbound" ? "Outbound waypoint" : "Inbound waypoint",
          label: label || "Base waypoint",
          detail: "Drag to move",
        };
      }
      return null;
    };

    const suppressEditorPopup = (durationMs = 350) => {
      popupSuppressedUntilRef.current = performance.now() + durationMs;
      popupRef.current?.remove();
    };

    const popupSuppressed = () => performance.now() < popupSuppressedUntilRef.current;

    const previewNfzDrag = (drag: NonNullable<typeof dragRef.current>) => {
      if (drag.kind !== "nfz" || !drag.originalPolygon) return;
      const {
        areas: latestAreas,
        homeBases: latestHomeBases,
        planningNfzs: latestPlanningNfzs,
        planningThreats: latestPlanningThreats,
      } =
        editorDataRef.current;
      const {
        draftPolygon: latestDraftPolygon,
        editorMode: latestEditorMode,
        selectedAreaId: latestSelectedAreaId,
        selectedBaseId: latestSelectedBaseId,
        selectedNfzId: latestSelectedNfzId,
        selectedThreatId: latestSelectedThreatId,
      } = editorViewRef.current;
      const source = map.getSource("editor") as GeoJSONSource | undefined;
      const previewNfzs = latestPlanningNfzs.map((nfz) =>
        nfz.id === drag.id
          ? {
              ...nfz,
              polygon: shiftPolygon(drag.originalPolygon ?? nfz.polygon, drag.totalDelta, drag.vertexIndex),
            }
          : nfz,
      );
      source?.setData({
        type: "FeatureCollection",
        features: editorFeatures({
          mapPreset,
          areas: latestAreas,
          homeBases: latestHomeBases,
          planningNfzs: previewNfzs,
          planningThreats: latestPlanningThreats,
          draftPolygon: latestDraftPolygon,
          editorMode: latestEditorMode,
          selectedAreaId: latestSelectedAreaId,
          selectedBaseId: latestSelectedBaseId,
          selectedNfzId: latestSelectedNfzId,
          selectedThreatId: latestSelectedThreatId,
        }),
      });
    };

    const showEditorPopup = (event: MapMouseEvent, feature: Feature) => {
      if (popupSuppressed()) return;
      const info = popupInfoForFeature(feature);
      if (!info || !popupRef.current) return;
      popupRef.current
        .setLngLat(event.lngLat)
        .setDOMContent(popupContent(info))
        .addTo(map);
    };

    const updateEditorPopup = (event: MapMouseEvent) => {
      if (!loaded || editorMode !== "select" || dragRef.current || popupSuppressed()) {
        popupRef.current?.remove();
        return;
      }
      const features = map.queryRenderedFeatures(event.point, {
        layers: EDITOR_POPUP_LAYERS as unknown as string[],
      });
      const feature = features.find(
        (candidate) => candidate.properties?.kind && candidate.properties?.id,
      ) as Feature | undefined;
      if (!feature) {
        popupRef.current?.remove();
        return;
      }
      showEditorPopup(event, feature);
    };

    function handleClick(event: MapMouseEvent) {
      if (!map) return;
      if (popupSuppressed()) {
        popupRef.current?.remove();
        return;
      }
      if (dragRef.current?.moved) {
        suppressEditorPopup();
        dragRef.current = null;
        return;
      }
      if (
        editorMode === "draw_area" ||
        editorMode === "draw_nfz" ||
        editorMode === "place_base" ||
        editorMode === "place_outbound_waypoint" ||
        editorMode === "place_inbound_waypoint" ||
        editorMode === "place_threat"
      ) {
        callbacksRef.current.onMapPoint(localPoint(event));
        return;
      }

      if (loaded) {
        const editorFeaturesAtClick = map.queryRenderedFeatures(event.point, {
          layers: EDITOR_HIT_LAYERS as unknown as string[],
        });
        const editorFeature = editorFeaturesAtClick.find(
          (feature) => feature.properties?.entityKind && feature.properties?.id,
        );
        if (editorFeature?.properties?.entityKind && editorFeature.properties.id) {
          showEditorPopup(event, editorFeature as Feature);
          callbacksRef.current.onSelectEditorFeature(
            editorFeature.properties.entityKind as EditorFeatureKind,
            String(editorFeature.properties.id),
          );
          return;
        }
      }

      if (!plan) return;
      if (!loaded || !map.getLayer("mission-uav-symbol") || !map.getLayer("mission-uav-dot")) {
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: ["mission-uav-symbol", "mission-uav-dot"],
      });
      const uavFeature = features.find((feature) => feature.properties?.id);
      if (uavFeature?.properties?.id) {
        callbacksRef.current.onSelectUav(String(uavFeature.properties.id));
      }
    }

    function handleMouseDown(event: MapMouseEvent) {
      if (!map || editorMode !== "select" || !loaded) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: EDITOR_HIT_LAYERS as unknown as string[],
      });
      const editorFeature = features.find(
        (feature) => feature.properties?.entityKind && feature.properties?.id,
      );
      if (!editorFeature?.properties?.entityKind || !editorFeature.properties.id) return;
      const kind = editorFeature.properties.entityKind as EditorFeatureKind;
      const id = String(editorFeature.properties.id);
      const vertexKind = String(editorFeature.properties.kind ?? "");
      const vertexIndex =
        vertexKind === "area_vertex" || vertexKind === "nfz_vertex"
          ? Number(editorFeature.properties.index)
          : undefined;
      callbacksRef.current.onSelectEditorFeature(kind, id);
      if (kind === "area" || kind === "nfz") {
        suppressEditorPopup();
      } else {
        popupRef.current?.remove();
      }
      const startPoint = localPoint(event);
      dragRef.current = {
        kind,
        id,
        vertexIndex: Number.isFinite(vertexIndex) ? vertexIndex : undefined,
        startPoint,
        lastPoint: startPoint,
        totalDelta: { x: 0, y: 0 },
        originalPolygon:
          kind === "nfz"
            ? editorDataRef.current.planningNfzs.find((nfz) => nfz.id === id)?.polygon
            : undefined,
        moved: false,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      event.preventDefault();
    }

    function handleMouseMove(event: MapMouseEvent) {
      const drag = dragRef.current;
      if (!drag) {
        updateEditorPopup(event);
        return;
      }
      const nextPoint = localPoint(event);
      const delta = {
        x: nextPoint.x - drag.lastPoint.x,
        y: nextPoint.y - drag.lastPoint.y,
      };
      if (Math.hypot(delta.x, delta.y) < 0.1) return;
      drag.moved = true;
      drag.lastPoint = nextPoint;
      drag.totalDelta = {
        x: nextPoint.x - drag.startPoint.x,
        y: nextPoint.y - drag.startPoint.y,
      };
      if (drag.kind === "area" || drag.kind === "nfz") {
        suppressEditorPopup();
      }
      if (drag.kind === "nfz") {
        previewNfzDrag(drag);
        return;
      }
      callbacksRef.current.onMoveEditorFeature(drag.kind, drag.id, delta, drag.vertexIndex);
    }

    function handleMouseUp() {
      const drag = dragRef.current;
      if (!drag) return;
      if (!map) return;
      if (drag.moved && (drag.kind === "area" || drag.kind === "nfz")) {
        suppressEditorPopup(500);
      }
      if (drag.moved && !drag.committed) {
        drag.committed = true;
        callbacksRef.current.onCommitEditorFeatureMove(
          drag.kind,
          drag.id,
          drag.totalDelta,
          drag.vertexIndex,
        );
      }
      map.dragPan.enable();
      map.getCanvas().style.cursor = editorMode === "select" ? "" : "crosshair";
      window.setTimeout(() => {
        dragRef.current = null;
      }, 0);
    }

    function handleMouseLeave() {
      popupRef.current?.remove();
      if (!dragRef.current) return;
      if (!map) return;
      if (dragRef.current.moved && !dragRef.current.committed) {
        dragRef.current.committed = true;
        callbacksRef.current.onCommitEditorFeatureMove(
          dragRef.current.kind,
          dragRef.current.id,
          dragRef.current.totalDelta,
          dragRef.current.vertexIndex,
        );
      }
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      dragRef.current = null;
    }

    map.on("click", handleClick);
    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);
    map.on("mouseleave", handleMouseLeave);

    const editorLayerReady = loaded && Boolean(map.getLayer("editor-area-fill"));
    const editorEnter = () => {
      if (editorMode === "select") map.getCanvas().style.cursor = "grab";
    };
    const editorLeave = () => {
      if (!dragRef.current && editorMode === "select") map.getCanvas().style.cursor = "";
    };
    if (editorLayerReady) {
      EDITOR_HIT_LAYERS.forEach((layerId) => {
        map.on("mouseenter", layerId, editorEnter);
        map.on("mouseleave", layerId, editorLeave);
      });
    }
    if (
      editorMode === "draw_area" ||
      editorMode === "draw_nfz" ||
      editorMode === "place_base" ||
      editorMode === "place_outbound_waypoint" ||
      editorMode === "place_inbound_waypoint" ||
      editorMode === "place_threat"
    ) {
      map.getCanvas().style.cursor = "crosshair";
    } else if (!dragRef.current) {
      map.getCanvas().style.cursor = "";
    }

    const uavLayerReady = loaded && Boolean(map.getLayer("mission-uav-symbol"));
    const handleMouseEnter = () => {
      if (editorMode === "select") map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeaveUav = () => {
      if (!dragRef.current && editorMode === "select") map.getCanvas().style.cursor = "";
    };
    if (uavLayerReady) {
      map.on("mouseenter", "mission-uav-symbol", handleMouseEnter);
      map.on("mouseleave", "mission-uav-symbol", handleMouseLeaveUav);
    }

    return () => {
      map.off("click", handleClick);
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
      map.off("mouseleave", handleMouseLeave);
      if (editorLayerReady) {
        EDITOR_HIT_LAYERS.forEach((layerId) => {
          map.off("mouseenter", layerId, editorEnter);
          map.off("mouseleave", layerId, editorLeave);
        });
      }
      if (uavLayerReady) {
        map.off("mouseenter", "mission-uav-symbol", handleMouseEnter);
        map.off("mouseleave", "mission-uav-symbol", handleMouseLeaveUav);
      }
    };
  }, [
    editorMode,
    loaded,
    mapPreset,
    plan,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (
      editorMode === "draw_area" ||
      editorMode === "draw_nfz" ||
      editorMode === "place_base" ||
      editorMode === "place_outbound_waypoint" ||
      editorMode === "place_inbound_waypoint" ||
      editorMode === "place_threat"
    ) {
      map.getCanvas().style.cursor = "crosshair";
    } else if (!dragRef.current) {
      map.getCanvas().style.cursor = "";
    }
  }, [editorMode]);

  useEffect(() => {
    const node = containerRef.current;
    const map = mapRef.current;
    if (!node || !map) return;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan) return;
    const currentPlan = plan;
    const currentMap = map;

    let disposed = false;
    nfzMarkersRef.current.forEach((marker) => marker.remove());
    nfzMarkersRef.current = [];

    async function addNfzLabels() {
      const maplibregl = await import("maplibre-gl");
      if (disposed) return;

      currentPlan.nfzs.forEach((nfz) => {
        const label = document.createElement("div");
        label.className =
          "border border-red-300/80 bg-red-950/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-100 shadow-lg";
        label.textContent = nfz.id;
        const marker = new maplibregl.Marker({
          element: label,
          anchor: "bottom",
        })
          .setLngLat(toLngLat(currentPlan.mapPreset, nfz.center))
          .addTo(currentMap);
        nfzMarkersRef.current.push(marker);
      });
    }

    void addNfzLabels();

    return () => {
      disposed = true;
      nfzMarkersRef.current.forEach((marker) => marker.remove());
      nfzMarkersRef.current = [];
    };
  }, [loaded, plan]);

  const branchLabel =
    plan?.activeContingency === "nfz"
      ? "NFZ REPLAN ACTIVE"
      : plan?.activeContingency === "vehicle_loss"
        ? "VEHICLE LOSS BRANCH ACTIVE"
        : plan?.activeContingency === "rtb"
          ? "RTB SLOT VIEW ACTIVE"
          : null;

  const jumpToTheater = (theater: (typeof THEATER_JUMPS)[number]) => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();
    map.easeTo({
      center: [theater.center.lon, theater.center.lat],
      zoom: theater.zoom,
      pitch: 0,
      bearing: 0,
      duration: 700,
    });
  };

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-neutral-950">
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <div className="absolute left-3 top-3 z-30 flex flex-wrap gap-2 text-xs font-semibold text-neutral-100">
        {THEATER_JUMPS.map((theater) => (
          <button
            key={theater.label}
            type="button"
            className="border border-white/15 bg-black/75 px-2.5 py-1.5 shadow-lg backdrop-blur transition hover:bg-neutral-900 focus:border-sky-300/60 focus:outline-none"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              jumpToTheater(theater);
            }}
          >
            {theater.label}
          </button>
        ))}
      </div>

      {editorMode === "draw_area" ? (
        <div className="pointer-events-none absolute inset-x-3 top-28 border border-white/15 bg-black/76 px-3 py-2 text-sm font-semibold text-neutral-100 shadow-xl backdrop-blur md:inset-x-auto md:right-3 md:w-80">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4" />
            Click the map to draw a blue fly-area polygon. Save after 3+ points.
          </div>
        </div>
      ) : null}

      {editorMode === "draw_nfz" ? (
        <div className="pointer-events-none absolute inset-x-3 top-28 border border-white/15 bg-black/76 px-3 py-2 text-sm font-semibold text-neutral-100 shadow-xl backdrop-blur md:inset-x-auto md:right-3 md:w-80">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4" />
            Click the map to draw a red no-fly polygon. Save after 3+ points.
          </div>
        </div>
      ) : null}

      {editorMode === "place_base" ? (
        <div className="pointer-events-none absolute inset-x-3 top-28 border border-white/15 bg-black/76 px-3 py-2 text-sm font-semibold text-neutral-100 shadow-xl backdrop-blur md:inset-x-auto md:right-3 md:w-80">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4" />
            Click the map to add a draggable home base.
          </div>
        </div>
      ) : null}

      {editorMode === "place_outbound_waypoint" || editorMode === "place_inbound_waypoint" ? (
        <div className="pointer-events-none absolute inset-x-3 top-28 border border-white/15 bg-black/76 px-3 py-2 text-sm font-semibold text-neutral-100 shadow-xl backdrop-blur md:inset-x-auto md:right-3 md:w-80">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4" />
            Click the map to add a draggable{" "}
            {editorMode === "place_outbound_waypoint" ? "outbound" : "inbound"} waypoint.
          </div>
        </div>
      ) : null}

      {branchLabel ? (
        <div className="pointer-events-none absolute right-14 top-3 border border-white/15 bg-black/78 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-100 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {branchLabel}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] border border-white/10 bg-black/80 p-2 text-xs text-neutral-300 shadow-xl backdrop-blur">
        <div className="mb-1.5 flex flex-wrap gap-2">
          {plan?.uavs.slice(0, 6).map((uav) => (
            <span key={uav.id} className="inline-flex items-center gap-1.5">
              <span className="size-2" style={{ backgroundColor: uav.color }} />
              {uav.label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-5 bg-neutral-200" />
            Route
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-5 border-t border-dashed border-neutral-400" />
            Original
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 border border-sky-200 bg-sky-400/40" />
            Fly area
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 border border-red-300 bg-red-500/40" />
            NFZ
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 border border-neutral-300/50 bg-neutral-300/20" />
            Strip
          </span>
        </div>
      </div>

    </section>
  );
}
