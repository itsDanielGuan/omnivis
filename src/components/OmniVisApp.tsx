"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportPanel } from "@/components/ExportPanel";
import { Header } from "@/components/Header";
import { MapMissionView } from "@/components/MapMissionView";
import { MetricsPanel } from "@/components/MetricsPanel";
import { MissionControls } from "@/components/MissionControls";
import { MissionPlannerVideo } from "@/components/MissionPlannerVideo";
import { TacticalEventFeed } from "@/components/TacticalEventFeed";
import { TimelineControls } from "@/components/TimelineControls";
import { UnitCard } from "@/components/UnitCard";
import { downloadMissionPackage } from "@/lib/exporters";
import { getMissionMaxTime, generateMissionPlanFromArea, planningNfzToMissionNfz } from "@/lib/planner";
import { DEFAULT_CONFIG, getMapPreset } from "@/lib/presets";
import { normalizeHomeBase } from "@/lib/routing";
import {
  applyBaseOfflineFailover,
  applyNfz,
  applySignalRegain,
  applyVehicleLoss,
  armRtbDemo,
  sendHealthPing,
} from "@/lib/simulator";
import type {
  BaseWaypointMode,
  DemoMode,
  EditorMode,
  HomeBase,
  LossResponseMode,
  MissionConfig,
  MissionPlan,
  PlanningArea,
  PlanningNfz,
  Point,
  PolygonGroup,
} from "@/lib/types";

type PersistedPlanningState = {
  version: 1;
  polygonGroups: PolygonGroup[];
  areas: PlanningArea[];
  homeBases: HomeBase[];
  planningNfzs: PlanningNfz[];
  activeGroupId: string;
};

type EditorFeatureKind = "area" | "base" | "nfz" | "waypoint";

const STORAGE_KEY = "omnivis.planning-state.v1";
const DEFAULT_GROUP: PolygonGroup = { id: "group-1", label: "Group 1" };

function initialPlanningState(): PersistedPlanningState {
  return (
    readPersistedState() ?? {
      version: 1,
      polygonGroups: [DEFAULT_GROUP],
      areas: [],
      homeBases: [],
      planningNfzs: [],
      activeGroupId: DEFAULT_GROUP.id,
    }
  );
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function shiftPolygon(polygon: Point[], delta: Point, vertexIndex?: number): Point[] {
  return polygon.map((point, index) => {
    if (vertexIndex !== undefined && index !== vertexIndex) return point;
    return {
      x: point.x + delta.x,
      y: point.y + delta.y,
    };
  });
}

function normalizePlanningArea(area: PlanningArea): PlanningArea {
  return {
    ...area,
    backupBaseId: area.backupBaseId === area.linkedBaseId ? undefined : area.backupBaseId,
  };
}

function isHomeBaseAvailable(base?: HomeBase): base is HomeBase {
  return Boolean(base && normalizeHomeBase(base).available !== false);
}

function resolveAreaHomeBase(
  area: PlanningArea,
  homeBases: HomeBase[],
  selectedBase?: HomeBase,
): HomeBase | undefined {
  const primary = area.linkedBaseId
    ? homeBases.find((base) => base.id === area.linkedBaseId)
    : undefined;
  const backup = area.backupBaseId
    ? homeBases.find((base) => base.id === area.backupBaseId)
    : undefined;

  if (isHomeBaseAvailable(primary)) return primary;
  if (isHomeBaseAvailable(backup)) return backup;
  if (isHomeBaseAvailable(selectedBase)) return selectedBase;
  return homeBases.find(isHomeBaseAvailable) ?? primary ?? backup ?? selectedBase ?? homeBases[0];
}

function resolveFailoverBaseForOfflineBase(
  offlineBaseId: string,
  areas: PlanningArea[],
  homeBases: HomeBase[],
  selectedArea?: PlanningArea,
): HomeBase | undefined {
  const orderedAreas = [
    ...(selectedArea ? [selectedArea] : []),
    ...areas.filter((area) => area.id !== selectedArea?.id),
  ].filter((area) => area.linkedBaseId === offlineBaseId);

  for (const area of orderedAreas) {
    const backup = area.backupBaseId
      ? homeBases.find((base) => base.id === area.backupBaseId)
      : undefined;
    if (backup && backup.id !== offlineBaseId && isHomeBaseAvailable(backup)) return backup;
  }

  return homeBases.find(
    (base) => base.id !== offlineBaseId && isHomeBaseAvailable(base),
  );
}

function readPersistedState(): PersistedPlanningState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlanningState;
    if (parsed.version !== 1) return null;
    return {
      ...parsed,
      polygonGroups: parsed.polygonGroups?.length ? parsed.polygonGroups : [DEFAULT_GROUP],
      areas: (parsed.areas ?? []).map((area) => normalizePlanningArea(area)),
      homeBases: (parsed.homeBases ?? []).map((base) => normalizeHomeBase(base)),
      planningNfzs: parsed.planningNfzs ?? [],
      activeGroupId: parsed.activeGroupId ?? DEFAULT_GROUP.id,
    };
  } catch {
    return null;
  }
}

export function OmniVisApp() {
  const [initialState] = useState<PersistedPlanningState>(() => initialPlanningState());
  const [config, setConfig] = useState<MissionConfig>(DEFAULT_CONFIG);
  const [demoMode, setDemoMode] = useState<DemoMode>("normal");
  const [lossResponseMode, setLossResponseMode] =
    useState<LossResponseMode>("dispatch_replacement");
  const [editorMode, setEditorMode] = useState<EditorMode>("select");
  const [polygonGroups, setPolygonGroups] = useState<PolygonGroup[]>(
    initialState.polygonGroups.length ? initialState.polygonGroups : [DEFAULT_GROUP],
  );
  const [activeGroupId, setActiveGroupId] = useState(initialState.activeGroupId);
  const [areas, setAreas] = useState<PlanningArea[]>(initialState.areas);
  const [homeBases, setHomeBases] = useState<HomeBase[]>(initialState.homeBases);
  const [planningNfzs, setPlanningNfzs] = useState<PlanningNfz[]>(initialState.planningNfzs);
  const [selectedAreaId, setSelectedAreaId] = useState<string | undefined>(
    initialState.areas[0]?.id,
  );
  const [selectedBaseId, setSelectedBaseId] = useState<string | undefined>(
    initialState.homeBases[0]?.id,
  );
  const [selectedNfzId, setSelectedNfzId] = useState<string | undefined>(
    initialState.planningNfzs[0]?.id,
  );
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);
  const [plan, setPlan] = useState<MissionPlan | null>(null);
  const [selectedUavId, setSelectedUavId] = useState<string>();
  const [simTimeS, setSimTimeS] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(30);
  const mapPreset = useMemo(() => getMapPreset(config.mapPresetId), [config.mapPresetId]);
  const maxTimeS = useMemo(() => getMissionMaxTime(plan), [plan]);

  useEffect(() => {
    const payload: PersistedPlanningState = {
      version: 1,
      polygonGroups,
      areas,
      homeBases,
      planningNfzs,
      activeGroupId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [activeGroupId, areas, homeBases, planningNfzs, polygonGroups]);

  useEffect(() => {
    if (!isRunning) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = ((now - last) / 1000) * playbackRate;
      last = now;
      setSimTimeS((current) => {
        const next = Math.min(maxTimeS, current + elapsed);
        if (next >= maxTimeS) setIsRunning(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isRunning, maxTimeS, playbackRate]);

  const selectedArea = areas.find((area) => area.id === selectedAreaId);
  const linkedBase = selectedArea?.linkedBaseId
    ? homeBases.find((base) => base.id === selectedArea.linkedBaseId)
    : undefined;
  const backupBase = selectedArea?.backupBaseId
    ? homeBases.find((base) => base.id === selectedArea.backupBaseId)
    : undefined;
  const selectedBase = homeBases.find((base) => base.id === selectedBaseId) ?? linkedBase ?? backupBase;
  const compileBase = selectedArea
    ? resolveAreaHomeBase(selectedArea, homeBases, selectedBase)
    : selectedBase;
  const canCompile = Boolean(selectedArea && compileBase);

  const compileMission = useCallback(() => {
    const area = selectedArea ?? areas[0];
    if (!area) return;
    const base = resolveAreaHomeBase(area, homeBases, selectedBase);
    if (!base) return;
    const primaryBase = area.linkedBaseId
      ? homeBases.find((candidate) => candidate.id === area.linkedBaseId)
      : undefined;
    const backupBaseForArea = area.backupBaseId
      ? homeBases.find((candidate) => candidate.id === area.backupBaseId)
      : undefined;
    const nfzs = planningNfzs.map((nfz, index) =>
      planningNfzToMissionNfz(nfz.label || `NFZ_${index + 1}`, nfz.polygon, simTimeS),
    );
    const nextPlan = generateMissionPlanFromArea(config, area.polygon, base, nfzs);
    if (
      primaryBase &&
      normalizeHomeBase(primaryBase).available === false &&
      backupBaseForArea &&
      base.id === backupBaseForArea.id
    ) {
      nextPlan.events.push({
        id: `EVT_${String(nextPlan.events.length + 1).padStart(3, "0")}_BACKUP_BASE`,
        timeS: 0,
        severity: "warning",
        text: `${primaryBase.label} unavailable; ${backupBaseForArea.label} activated as backup home base`,
      });
    }
    nextPlan.lossResponseMode =
      config.commsPolicy === "full_signal" ? lossResponseMode : "dispatch_replacement";
    setPlan(nextPlan);
    setSelectedUavId(nextPlan.uavs[0]?.id);
    setSimTimeS(0);
    setIsRunning(false);
  }, [areas, config, homeBases, lossResponseMode, planningNfzs, selectedArea, selectedBase, simTimeS]);

  const resetSimulation = useCallback(() => {
    setPlan(null);
    setSelectedUavId(undefined);
    setSimTimeS(0);
    setIsRunning(false);
  }, []);

  const handleConfigChange = (next: MissionConfig) => {
    const normalizedNext: MissionConfig = {
      ...next,
      commsPolicy: next.commsPolicy === "full_signal" ? "full_signal" : "silent_operation",
      pathPattern: next.pathPattern ?? "sector_lanes",
    };
    if (normalizedNext.commsPolicy !== "full_signal") {
      setLossResponseMode("dispatch_replacement");
    }
    setConfig(normalizedNext);
    setPlan(null);
    setSimTimeS(0);
  };

  const handleLossResponseModeChange = (mode: LossResponseMode) => {
    if (config.commsPolicy !== "full_signal" && mode === "spread_remaining_swarm") {
      setLossResponseMode("dispatch_replacement");
      return;
    }
    setLossResponseMode(mode);
  };

  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode);
    setDraftPolygon([]);
  };

  const handleMapPoint = (point: Point) => {
    if (editorMode === "place_base") {
      const nextBase: HomeBase = {
        id: makeId("base"),
        label: `Base ${homeBases.length + 1}`,
        point,
        available: true,
        outboundWaypoints: [],
        inboundWaypoints: [],
        waypointMode: "nearest_safe",
      };
      setHomeBases((current) => [...current, nextBase]);
      setSelectedBaseId(nextBase.id);
      setSelectedNfzId(undefined);
      setEditorMode("select");
      return;
    }
    if (editorMode === "place_outbound_waypoint" || editorMode === "place_inbound_waypoint") {
      const baseId = selectedBaseId ?? selectedBase?.id ?? homeBases[0]?.id;
      if (!baseId) return;
      const direction = editorMode === "place_outbound_waypoint" ? "outbound" : "inbound";
      setHomeBases((current) =>
        current.map((base) => {
          if (base.id !== baseId) return base;
          const normalized = normalizeHomeBase(base);
          const currentWaypoints =
            direction === "outbound"
              ? normalized.outboundWaypoints
              : normalized.inboundWaypoints;
          const waypoint = {
            id: makeId(direction === "outbound" ? "out-wp" : "in-wp"),
            label: `${direction === "outbound" ? "Out" : "In"} WP ${currentWaypoints.length + 1}`,
            point,
          };
          return direction === "outbound"
            ? {
                ...normalized,
                outboundWaypoints: [...normalized.outboundWaypoints, waypoint],
                specificOutboundWaypointId:
                  normalized.specificOutboundWaypointId ?? waypoint.id,
              }
            : {
                ...normalized,
                inboundWaypoints: [...normalized.inboundWaypoints, waypoint],
                specificInboundWaypointId:
                  normalized.specificInboundWaypointId ?? waypoint.id,
              };
        }),
      );
      setSelectedBaseId(baseId);
      setSelectedAreaId(undefined);
      setSelectedNfzId(undefined);
      setEditorMode("select");
      setPlan(null);
      return;
    }
    if (editorMode === "draw_area" || editorMode === "draw_nfz") {
      setDraftPolygon((current) => [...current, point]);
    }
  };

  const finishPolygon = () => {
    if (draftPolygon.length < 3) return;
    const polygon = [...draftPolygon];
    if (editorMode === "draw_area") {
      const area: PlanningArea = {
        id: makeId("area"),
        label: `Area ${areas.length + 1}`,
        groupId: activeGroupId,
        polygon,
        linkedBaseId: selectedBaseId,
      };
      setAreas((current) => [...current, area]);
      setSelectedAreaId(area.id);
      setSelectedNfzId(undefined);
    }
    if (editorMode === "draw_nfz") {
      const nfz: PlanningNfz = {
        id: makeId("nfz"),
        label: `NFZ ${planningNfzs.length + 1}`,
        polygon,
      };
      setPlanningNfzs((current) => [...current, nfz]);
      setPlan((current) =>
        current ? applyNfz(current, polygon, simTimeS, selectedUavId) : current,
      );
      setSelectedNfzId(nfz.id);
      setSelectedAreaId(undefined);
      setSelectedBaseId(undefined);
    }
    setDraftPolygon([]);
    setEditorMode("select");
  };

  const createGroup = () => {
    const group: PolygonGroup = {
      id: makeId("group"),
      label: `Group ${polygonGroups.length + 1}`,
    };
    setPolygonGroups((current) => [...current, group]);
    setActiveGroupId(group.id);
  };

  const deleteSelected = () => {
    if (selectedAreaId) {
      setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
      setSelectedAreaId(undefined);
    } else if (selectedBaseId) {
      setHomeBases((current) => current.filter((base) => base.id !== selectedBaseId));
      setAreas((current) =>
        current.map((area) =>
          area.linkedBaseId === selectedBaseId || area.backupBaseId === selectedBaseId
            ? {
                ...area,
                linkedBaseId:
                  area.linkedBaseId === selectedBaseId ? undefined : area.linkedBaseId,
                backupBaseId:
                  area.backupBaseId === selectedBaseId ? undefined : area.backupBaseId,
              }
            : area,
        ),
      );
      setSelectedBaseId(undefined);
    } else if (selectedNfzId) {
      setPlanningNfzs((current) => current.filter((nfz) => nfz.id !== selectedNfzId));
      setSelectedNfzId(undefined);
    }
    setPlan(null);
  };

  const linkBaseToArea = () => {
    if (!selectedAreaId || !selectedBaseId) return;
    setAreas((current) =>
      current.map((area) =>
        area.id === selectedAreaId
          ? {
              ...area,
              linkedBaseId: selectedBaseId,
              backupBaseId:
                area.backupBaseId === selectedBaseId ? undefined : area.backupBaseId,
            }
          : area,
      ),
    );
    setPlan(null);
  };

  const linkBackupBaseToArea = () => {
    if (!selectedAreaId || !selectedBaseId) return;
    setAreas((current) =>
      current.map((area) => {
        if (area.id !== selectedAreaId || area.linkedBaseId === selectedBaseId) return area;
        return { ...area, backupBaseId: selectedBaseId };
      }),
    );
    setPlan(null);
  };

  const toggleSelectedBaseAvailability = () => {
    if (!selectedBaseId) return;
    const currentBase = homeBases.find((base) => base.id === selectedBaseId);
    if (!currentBase) return;
    const normalizedBase = normalizeHomeBase(currentBase);
    const markingOffline = normalizedBase.available !== false;
    const failoverBase = markingOffline
      ? resolveFailoverBaseForOfflineBase(selectedBaseId, areas, homeBases, selectedArea)
      : undefined;

    setHomeBases((current) =>
      current.map((base) => {
        if (base.id !== selectedBaseId) return base;
        const normalized = normalizeHomeBase(base);
        return { ...normalized, available: normalized.available === false };
      }),
    );

    if (markingOffline && plan?.homeBase.id === selectedBaseId && failoverBase) {
      setPlan(applyBaseOfflineFailover(plan, selectedBaseId, failoverBase, simTimeS));
    } else if (!plan) {
      setPlan(null);
    }
  };

  const updateSelectedBaseRoutingMode = (mode: BaseWaypointMode) => {
    if (!selectedBaseId) return;
    setHomeBases((current) =>
      current.map((base) =>
        base.id === selectedBaseId ? { ...normalizeHomeBase(base), waypointMode: mode } : base,
      ),
    );
    setPlan(null);
  };

  const updateSpecificBaseWaypoint = (
    direction: "outbound" | "inbound",
    waypointId: string | undefined,
  ) => {
    if (!selectedBaseId) return;
    setHomeBases((current) =>
      current.map((base) => {
        if (base.id !== selectedBaseId) return base;
        const normalized = normalizeHomeBase(base);
        return direction === "outbound"
          ? { ...normalized, specificOutboundWaypointId: waypointId }
          : { ...normalized, specificInboundWaypointId: waypointId };
      }),
    );
    setPlan(null);
  };

  const deleteBaseWaypoint = (waypointId: string) => {
    setHomeBases((current) =>
      current.map((base) => {
        const normalized = normalizeHomeBase(base);
        const outboundWaypoints = normalized.outboundWaypoints.filter(
          (waypoint) => waypoint.id !== waypointId,
        );
        const inboundWaypoints = normalized.inboundWaypoints.filter(
          (waypoint) => waypoint.id !== waypointId,
        );
        return {
          ...normalized,
          outboundWaypoints,
          inboundWaypoints,
          specificOutboundWaypointId:
            normalized.specificOutboundWaypointId === waypointId
              ? outboundWaypoints[0]?.id
              : normalized.specificOutboundWaypointId,
          specificInboundWaypointId:
            normalized.specificInboundWaypointId === waypointId
              ? inboundWaypoints[0]?.id
              : normalized.specificInboundWaypointId,
        };
      }),
    );
    setPlan(null);
  };

  const handleSelectEditorFeature = (kind: EditorFeatureKind, id: string) => {
    if (kind === "area") {
      setSelectedAreaId(id);
      setSelectedNfzId(undefined);
    } else if (kind === "base") {
      setSelectedBaseId(id);
      setSelectedNfzId(undefined);
    } else if (kind === "waypoint") {
      const parentBase = homeBases.find((base) => {
        const normalized = normalizeHomeBase(base);
        return (
          normalized.outboundWaypoints.some((waypoint) => waypoint.id === id) ||
          normalized.inboundWaypoints.some((waypoint) => waypoint.id === id)
        );
      });
      if (parentBase) {
        setSelectedBaseId(parentBase.id);
        setSelectedAreaId(undefined);
        setSelectedNfzId(undefined);
      }
    } else {
      setSelectedNfzId(id);
      setSelectedAreaId(undefined);
      setSelectedBaseId(undefined);
    }
  };

  const handleMoveEditorFeature = (
    kind: EditorFeatureKind,
    id: string,
    delta: Point,
    vertexIndex?: number,
  ) => {
    if (kind === "area") {
      setAreas((current) =>
        current.map((area) =>
          area.id === id ? { ...area, polygon: shiftPolygon(area.polygon, delta, vertexIndex) } : area,
        ),
      );
    } else if (kind === "nfz") {
      setPlanningNfzs((current) =>
        current.map((nfz) =>
          nfz.id === id ? { ...nfz, polygon: shiftPolygon(nfz.polygon, delta, vertexIndex) } : nfz,
        ),
      );
    } else if (kind === "base") {
      setHomeBases((current) =>
        current.map((base) =>
          base.id === id
            ? { ...base, point: { x: base.point.x + delta.x, y: base.point.y + delta.y } }
            : base,
        ),
      );
    } else {
      setHomeBases((current) =>
        current.map((base) => {
          const normalized = normalizeHomeBase(base);
          return {
            ...normalized,
            outboundWaypoints: normalized.outboundWaypoints.map((waypoint) =>
              waypoint.id === id
                ? { ...waypoint, point: { x: waypoint.point.x + delta.x, y: waypoint.point.y + delta.y } }
                : waypoint,
            ),
            inboundWaypoints: normalized.inboundWaypoints.map((waypoint) =>
              waypoint.id === id
                ? { ...waypoint, point: { x: waypoint.point.x + delta.x, y: waypoint.point.y + delta.y } }
                : waypoint,
            ),
          };
        }),
      );
    }
    setPlan(null);
  };

  const triggerLoss = () => {
    if (!plan) return;
    const failedId = selectedUavId ?? plan.uavs.find((uav) => !uav.reserve)?.id;
    if (!failedId) return;
    setPlan(applyVehicleLoss(plan, failedId, lossResponseMode, simTimeS));
  };

  const triggerNfzDemo = () => {
    if (!plan) return;
    const nfz = planningNfzs.find((candidate) => candidate.id === selectedNfzId);
    const geometry = nfz?.polygon ?? {
      x: plan.aoo.reduce((sum, point) => sum + point.x, 0) / plan.aoo.length,
      y: plan.aoo.reduce((sum, point) => sum + point.y, 0) / plan.aoo.length,
    };
    setPlan(applyNfz(plan, geometry, simTimeS || 90, selectedUavId));
  };

  const handleDemoModeChange = (mode: DemoMode) => {
    setDemoMode(mode);
    if (!plan) return;
    if (mode === "loss_replacement") {
      setLossResponseMode("dispatch_replacement");
      setPlan(applyVehicleLoss(plan, selectedUavId ?? "UAV_3", "dispatch_replacement", simTimeS || 180));
    } else if (mode === "loss_spread") {
      const spreadMode =
        config.commsPolicy === "full_signal" ? "spread_remaining_swarm" : "dispatch_replacement";
      setLossResponseMode(spreadMode);
      setPlan(applyVehicleLoss(plan, selectedUavId ?? "UAV_3", spreadMode, simTimeS || 180));
    } else if (mode === "nfz") {
      triggerNfzDemo();
    } else if (mode === "rtb") {
      setPlan(armRtbDemo(plan, simTimeS));
    }
  };

  return (
    <main className="flex h-screen min-h-0 flex-col bg-neutral-950 text-neutral-100">
      <Header
        canExport={Boolean(plan)}
        onExport={() => {
          if (plan) void downloadMissionPackage(plan);
        }}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[21rem_minmax(0,1fr)_22rem]">
        <MissionControls
          config={config}
          demoMode={demoMode}
          lossResponseMode={lossResponseMode}
          editorMode={editorMode}
          polygonGroups={polygonGroups}
          activeGroupId={activeGroupId}
          areas={areas}
          homeBases={homeBases}
          planningNfzs={planningNfzs}
          selectedAreaId={selectedAreaId}
          selectedBaseId={selectedBaseId}
          selectedNfzId={selectedNfzId}
          draftPointCount={draftPolygon.length}
          canCompile={canCompile}
          canDeleteSelected={Boolean(selectedAreaId || selectedBaseId || selectedNfzId)}
          canTriggerSelectedLoss={Boolean(plan && selectedUavId)}
          onConfigChange={handleConfigChange}
          onDemoModeChange={handleDemoModeChange}
          onEditorModeChange={handleEditorModeChange}
          onActiveGroupChange={setActiveGroupId}
          onCreateGroup={createGroup}
          onSelectedAreaChange={(id) => {
            setSelectedAreaId(id);
            setSelectedNfzId(undefined);
          }}
          onSelectedBaseChange={(id) => {
            setSelectedBaseId(id);
            setSelectedNfzId(undefined);
          }}
          onSelectedNfzChange={(id) => {
            setSelectedNfzId(id);
            setSelectedAreaId(undefined);
            setSelectedBaseId(undefined);
          }}
          onFinishPolygon={finishPolygon}
          onCancelDraft={() => {
            setDraftPolygon([]);
            setEditorMode("select");
          }}
          onDeleteSelected={deleteSelected}
          onLinkBaseToArea={linkBaseToArea}
          onLinkBackupBaseToArea={linkBackupBaseToArea}
          onToggleBaseAvailability={toggleSelectedBaseAvailability}
          onAddBaseWaypoint={(direction) =>
            setEditorMode(direction === "outbound" ? "place_outbound_waypoint" : "place_inbound_waypoint")
          }
          onBaseWaypointModeChange={updateSelectedBaseRoutingMode}
          onSpecificBaseWaypointChange={updateSpecificBaseWaypoint}
          onDeleteBaseWaypoint={deleteBaseWaypoint}
          onGenerate={compileMission}
          onReset={resetSimulation}
          onSimulateLoss={triggerLoss}
          onSetLossResponseMode={handleLossResponseModeChange}
        />
        <div className="min-h-0">
          <MapMissionView
            plan={plan}
            mapPreset={mapPreset}
            areas={areas}
            homeBases={homeBases}
            planningNfzs={planningNfzs}
            draftPolygon={draftPolygon}
            editorMode={editorMode}
            simTimeS={simTimeS}
            selectedUavId={selectedUavId}
            selectedAreaId={selectedAreaId}
            selectedBaseId={selectedBaseId}
            selectedNfzId={selectedNfzId}
            onSelectUav={setSelectedUavId}
            onMapPoint={handleMapPoint}
            onSelectEditorFeature={handleSelectEditorFeature}
            onMoveEditorFeature={handleMoveEditorFeature}
          />
        </div>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-black p-3">
          <MetricsPanel
            plan={plan}
            simTimeS={simTimeS}
            selectedUavId={selectedUavId}
            onSelectUav={setSelectedUavId}
          />
          <UnitCard
            plan={plan}
            selectedUavId={selectedUavId}
            simTimeS={simTimeS}
            onTriggerLoss={triggerLoss}
            onPreviewLossResponse={handleLossResponseModeChange}
            onForceRtbPreview={() => plan && setPlan(armRtbDemo(plan, simTimeS))}
            onHealthPing={() => plan && selectedUavId && setPlan(sendHealthPing(plan, selectedUavId, simTimeS))}
            onRegainSignal={() => plan && selectedUavId && setPlan(applySignalRegain(plan, selectedUavId, simTimeS))}
          />
          <TacticalEventFeed plan={plan} simTimeS={simTimeS} />
          <ExportPanel plan={plan} />
          <MissionPlannerVideo />
        </aside>
      </div>
      <TimelineControls
        simTimeS={simTimeS}
        maxTimeS={maxTimeS}
        isRunning={isRunning}
        playbackRate={playbackRate}
        onTimeChange={setSimTimeS}
        onRunningChange={setIsRunning}
        onPlaybackRateChange={setPlaybackRate}
        onResetTime={() => {
          setSimTimeS(0);
          setIsRunning(false);
        }}
      />
    </main>
  );
}
