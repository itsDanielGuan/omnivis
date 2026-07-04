export type Point = {
  x: number;
  y: number;
};

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type AooPresetId = "rectangular" | "irregular" | "corridor";

export type MapPresetId = "singapore" | "baltic" | "open-sea";

export type DemoMode =
  | "normal"
  | "loss_replacement"
  | "loss_spread"
  | "nfz"
  | "rtb";

export type CommsPolicy = "silent_operation" | "full_signal";

export type PathPattern =
  | "sector_lanes"
  | "alternating_lanes"
  | "nearest_infill";

export type LossResponseMode =
  | "dispatch_replacement"
  | "spread_remaining_swarm";

export type EditorMode =
  | "select"
  | "draw_area"
  | "draw_nfz"
  | "place_base"
  | "place_outbound_waypoint"
  | "place_inbound_waypoint";

export type RoutePhase =
  | "preflight"
  | "launch"
  | "transit"
  | "covering"
  | "loiter"
  | "return"
  | "detour"
  | "lost"
  | "reserve"
  | "replacement"
  | "regained";

export type UavStatus =
  | "ready"
  | "active"
  | "replanned"
  | "lost"
  | "regained"
  | "rtb"
  | "reserve";

export type StripStatus =
  | "planned"
  | "completed"
  | "coverage_debt"
  | "blocked_by_nfz";

export type Severity = "info" | "success" | "warning" | "danger";

export type MissionConfig = {
  mapPresetId: MapPresetId;
  aooPresetId: AooPresetId;
  uavCount: number;
  sensorSwathM: number;
  overlapRatio: number;
  speedMps: number;
  enduranceMin: number;
  minSeparationM: number;
  altitudeLayerStartM: number;
  altitudeLayerSpacingM: number;
  turnRadiusM: number;
  stripAngleDeg: number;
  rtbSlotSpacingS: number;
  commsPolicy: CommsPolicy;
  pathPattern: PathPattern;
  seed: number;
};

export type MapPreset = {
  id: MapPresetId;
  label: string;
  shortLabel: string;
  baseLat: number;
  baseLon: number;
  mapCenter: GeoPoint;
  mapZoom: number;
  baseM: Point;
  aooPolygons: Record<AooPresetId, Point[]>;
};

export type PlanningArea = {
  id: string;
  label: string;
  polygon: Point[];
  linkedBaseId?: string;
  backupBaseId?: string;
};

export type BaseWaypointMode = "nearest_safe" | "round_robin" | "specific";

export type BaseWaypoint = {
  id: string;
  label: string;
  point: Point;
};

export type HomeBase = {
  id: string;
  label: string;
  point: Point;
  available?: boolean;
  outboundWaypoints: BaseWaypoint[];
  inboundWaypoints: BaseWaypoint[];
  waypointMode: BaseWaypointMode;
  specificOutboundWaypointId?: string;
  specificInboundWaypointId?: string;
};

export type PlanningNfz = {
  id: string;
  label: string;
  polygon: Point[];
  enabled?: boolean;
};

export type CoverageStrip = {
  id: string;
  order: number;
  start: Point;
  end: Point;
  center: Point;
  polygon: Point[];
  assignedUavId: string;
  status: StripStatus;
};

export type RouteWaypoint = Point & {
  t: number;
  phase: RoutePhase;
  stripId?: string;
  label?: string;
};

export type UavPlan = {
  id: string;
  label: string;
  color: string;
  colorSoft: string;
  altitudeM: number;
  status: UavStatus;
  assignedStripIds: string[];
  route: RouteWaypoint[];
  originalRoute?: RouteWaypoint[];
  rtbSlotS: number;
  utilizationPct: number;
  coverageTimeS: number;
  reserve?: boolean;
  communicationLostAtS?: number;
  lossDetectedAtS?: number;
  lostAtS?: number;
  lossPoint?: Point;
  regainedAtS?: number;
};

export type Nfz = {
  id: string;
  center: Point;
  radiusM: number;
  createdAtS: number;
  sourceUavId?: string;
  polygon?: Point[];
};

export type MissionMessageType =
  | "MISSION_LOAD"
  | "HEALTH_EPOCH"
  | "HEALTH_MISS"
  | "COVERAGE_DEBT_ASSIGN"
  | "REPLACEMENT_DISPATCH"
  | "SWARM_REDISTRIBUTE"
  | "NFZ_EXCEPTION_TOKEN"
  | "RTB_SLOT_SYNC"
  | "SIGNAL_REGAINED";

export type MissionMessage = {
  id: string;
  type: MissionMessageType;
  timeS: number;
  sourceId: string;
  targetId?: string;
  targetIds?: string[];
  text: string;
  countInMission: boolean;
};

export type MissionEvent = {
  id: string;
  timeS: number;
  severity: Severity;
  text: string;
  uavId?: string;
};

export type MissionMetrics = {
  coveragePct: number;
  missionCompletionTimeS: number;
  minSeparationM: number;
  averageUtilizationPct: number;
  messagesUsed: number;
  totalStrips: number;
  completedStrips: number;
  coverageDebtStripCount: number;
  blockedStripCount: number;
  feasible: boolean;
  rtbSpacingS: number;
  before?: {
    coveragePct: number;
    missionCompletionTimeS: number;
    messagesUsed: number;
    coverageDebtStripCount: number;
  };
};

export type MissionPlan = {
  id: string;
  generatedAt: string;
  seed: number;
  config: MissionConfig;
  mapPreset: MapPreset;
  base: Point;
  homeBase: HomeBase;
  aoo: Point[];
  strips: CoverageStrip[];
  uavs: UavPlan[];
  nfzs: Nfz[];
  messages: MissionMessage[];
  events: MissionEvent[];
  metrics: MissionMetrics;
  lossResponseMode: LossResponseMode;
  activeContingency?: "vehicle_loss" | "nfz" | "rtb" | "base_offline";
};

export type UavSnapshot = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  headingDeg: number;
  phase: RoutePhase;
  altitudeM: number;
  progressPct: number;
};
