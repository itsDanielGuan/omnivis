import type { AooPresetId, MapPreset, MissionConfig } from "@/lib/types";

export const UAV_COLORS = [
  { color: "#38bdf8", soft: "rgba(56, 189, 248, 0.22)" },
  { color: "#f59e0b", soft: "rgba(245, 158, 11, 0.22)" },
  { color: "#34d399", soft: "rgba(52, 211, 153, 0.22)" },
  { color: "#a78bfa", soft: "rgba(167, 139, 250, 0.22)" },
  { color: "#fb7185", soft: "rgba(251, 113, 133, 0.22)" },
  { color: "#f97316", soft: "rgba(249, 115, 22, 0.22)" },
];

const AOO_POLYGONS: Record<AooPresetId, MapPreset["aooPolygons"][AooPresetId]> = {
  rectangular: [
    { x: 0, y: 0 },
    { x: 5200, y: 0 },
    { x: 5200, y: 3200 },
    { x: 0, y: 3200 },
  ],
  irregular: [
    { x: 200, y: 200 },
    { x: 5100, y: 0 },
    { x: 5600, y: 1800 },
    { x: 4300, y: 3400 },
    { x: 1400, y: 3600 },
    { x: -200, y: 1800 },
  ],
  corridor: [
    { x: 0, y: 500 },
    { x: 7000, y: 0 },
    { x: 7600, y: 1200 },
    { x: 900, y: 2100 },
  ],
};

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "singapore",
    label: "Singapore Strait Demo",
    shortLabel: "Singapore Strait",
    baseLat: 1.248,
    baseLon: 103.842,
    mapCenter: { lat: 1.266, lon: 103.872 },
    mapZoom: 11.1,
    baseM: { x: 360, y: -620 },
    aooPolygons: AOO_POLYGONS,
  },
  {
    id: "baltic",
    label: "Baltic Coastal Patrol",
    shortLabel: "Baltic Patrol",
    baseLat: 59.327,
    baseLon: 18.21,
    mapCenter: { lat: 59.345, lon: 18.285 },
    mapZoom: 10.8,
    baseM: { x: -360, y: -820 },
    aooPolygons: {
      ...AOO_POLYGONS,
      irregular: [
        { x: 100, y: 200 },
        { x: 3900, y: -300 },
        { x: 5700, y: 950 },
        { x: 4800, y: 3200 },
        { x: 1100, y: 3700 },
        { x: -450, y: 1900 },
      ],
    },
  },
  {
    id: "open-sea",
    label: "Open Sea Search Box",
    shortLabel: "Open Sea",
    baseLat: 45,
    baseLon: 12,
    mapCenter: { lat: 45.018, lon: 12.036 },
    mapZoom: 10.4,
    baseM: { x: 280, y: -720 },
    aooPolygons: {
      ...AOO_POLYGONS,
      rectangular: [
        { x: -300, y: -100 },
        { x: 6300, y: 80 },
        { x: 6050, y: 3800 },
        { x: -580, y: 3480 },
      ],
    },
  },
];

export const DEFAULT_CONFIG: MissionConfig = {
  mapPresetId: "singapore",
  aooPresetId: "irregular",
  uavCount: 4,
  sensorSwathM: 180,
  overlapRatio: 0.15,
  speedMps: 22,
  enduranceMin: 55,
  minSeparationM: 250,
  altitudeLayerStartM: 120,
  altitudeLayerSpacingM: 30,
  turnRadiusM: 90,
  stripAngleDeg: 15,
  rtbSlotSpacingS: 90,
  commsPolicy: "silent_operation",
  pathPattern: "sector_lanes",
  seed: 7429,
};

export function getMapPreset(id: string): MapPreset {
  return MAP_PRESETS.find((preset) => preset.id === id) ?? MAP_PRESETS[0];
}

export const DEMO_MODES = [
  { id: "normal", label: "Normal mission" },
  { id: "loss_replacement", label: "Vehicle loss - replacement dispatch" },
  { id: "loss_spread", label: "Vehicle loss - swarm redistribution" },
  { id: "nfz", label: "Pop-up NFZ contingency" },
  { id: "rtb", label: "RTB deconfliction" },
] as const;
