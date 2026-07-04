"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  File,
  Folder,
  Home,
  Link2,
  PlaneTakeoff,
  Plus,
  Radio,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Shuffle,
  Siren,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { DEMO_MODES, MAP_PRESETS } from "@/lib/presets";
import type {
  BaseWaypointMode,
  CommsPolicy,
  DemoMode,
  EditorMode,
  HomeBase,
  LossResponseMode,
  MissionConfig,
  PlanningArea,
  PlanningNfz,
  PolygonGroup,
} from "@/lib/types";

type Props = {
  config: MissionConfig;
  demoMode: DemoMode;
  lossResponseMode: LossResponseMode;
  editorMode: EditorMode;
  polygonGroups: PolygonGroup[];
  activeGroupId: string;
  areas: PlanningArea[];
  homeBases: HomeBase[];
  planningNfzs: PlanningNfz[];
  selectedAreaId?: string;
  selectedBaseId?: string;
  selectedNfzId?: string;
  draftPointCount: number;
  canCompile: boolean;
  canDeleteSelected: boolean;
  canTriggerSelectedLoss: boolean;
  onConfigChange: (next: MissionConfig) => void;
  onDemoModeChange: (mode: DemoMode) => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onActiveGroupChange: (groupId: string) => void;
  onCreateGroup: () => void;
  onSelectedAreaChange: (areaId: string | undefined) => void;
  onSelectedBaseChange: (baseId: string | undefined) => void;
  onSelectedNfzChange: (nfzId: string | undefined) => void;
  onFinishPolygon: () => void;
  onCancelDraft: () => void;
  onDeleteSelected: () => void;
  onLinkBaseToArea: () => void;
  onAddBaseWaypoint: (direction: "outbound" | "inbound") => void;
  onBaseWaypointModeChange: (mode: BaseWaypointMode) => void;
  onSpecificBaseWaypointChange: (
    direction: "outbound" | "inbound",
    waypointId: string | undefined,
  ) => void;
  onDeleteBaseWaypoint: (waypointId: string) => void;
  onGenerate: () => void;
  onReset: () => void;
  onSimulateLoss: () => void;
  onSetLossResponseMode: (mode: LossResponseMode) => void;
  onPreviewLossResponseMode: (mode: LossResponseMode) => void;
};

function updateNumber(
  config: MissionConfig,
  key: keyof MissionConfig,
  value: number,
): MissionConfig {
  return { ...config, [key]: value };
}

function Field({
  label,
  value,
  suffix,
  children,
}: {
  label: string;
  value: string;
  suffix?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>{label}</span>
        <span className="font-mono text-neutral-200">
          {value}
          {suffix}
        </span>
      </div>
      {children}
    </label>
  );
}

function commandButton(active: boolean) {
  return active
    ? "border-white/30 bg-neutral-200 text-black"
    : "border-white/10 bg-neutral-900 text-neutral-100 hover:bg-neutral-800";
}

export function MissionControls({
  config,
  demoMode,
  lossResponseMode,
  editorMode,
  polygonGroups,
  activeGroupId,
  areas,
  homeBases,
  planningNfzs,
  selectedAreaId,
  selectedBaseId,
  selectedNfzId,
  draftPointCount,
  canCompile,
  canDeleteSelected,
  canTriggerSelectedLoss,
  onConfigChange,
  onDemoModeChange,
  onEditorModeChange,
  onActiveGroupChange,
  onCreateGroup,
  onSelectedAreaChange,
  onSelectedBaseChange,
  onSelectedNfzChange,
  onFinishPolygon,
  onCancelDraft,
  onDeleteSelected,
  onLinkBaseToArea,
  onAddBaseWaypoint,
  onBaseWaypointModeChange,
  onSpecificBaseWaypointChange,
  onDeleteBaseWaypoint,
  onGenerate,
  onReset,
  onSimulateLoss,
  onSetLossResponseMode,
  onPreviewLossResponseMode,
}: Props) {
  const selectedArea = areas.find((area) => area.id === selectedAreaId);
  const selectedBase = homeBases.find((base) => base.id === selectedBaseId);
  const linkedBase = selectedArea?.linkedBaseId
    ? homeBases.find((base) => base.id === selectedArea.linkedBaseId)
    : undefined;
  const displayedBase = selectedBase ?? linkedBase;
  const drawingPolygon = editorMode === "draw_area" || editorMode === "draw_nfz";
  const waypointPlacement =
    editorMode === "place_outbound_waypoint" || editorMode === "place_inbound_waypoint";

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-white/10 bg-black p-3">
      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <ScanLine className="size-4 text-neutral-400" />
          Command Deck
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition ${commandButton(editorMode === "draw_area")}`}
            onClick={() => onEditorModeChange(editorMode === "draw_area" ? "select" : "draw_area")}
          >
            <Crosshair className="size-4" />
            Add Area
          </button>
          <button
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition ${commandButton(editorMode === "draw_nfz")}`}
            onClick={() => onEditorModeChange(editorMode === "draw_nfz" ? "select" : "draw_nfz")}
          >
            <ShieldAlert className="size-4" />
            Add NFZ
          </button>
          <button
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition ${commandButton(editorMode === "place_base")}`}
            onClick={() => onEditorModeChange(editorMode === "place_base" ? "select" : "place_base")}
          >
            <Home className="size-4" />
            Home Base
          </button>
          <button
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${commandButton(editorMode === "place_outbound_waypoint")}`}
            disabled={!selectedBaseId}
            onClick={() =>
              editorMode === "place_outbound_waypoint"
                ? onEditorModeChange("select")
                : onAddBaseWaypoint("outbound")
            }
          >
            <PlaneTakeoff className="size-4" />
            Add Out WP
          </button>
          <button
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${commandButton(editorMode === "place_inbound_waypoint")}`}
            disabled={!selectedBaseId}
            onClick={() =>
              editorMode === "place_inbound_waypoint"
                ? onEditorModeChange("select")
                : onAddBaseWaypoint("inbound")
            }
          >
            <Home className="size-4" />
            Add In WP
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/10 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!canDeleteSelected}
            onClick={onDeleteSelected}
          >
            <Trash2 className="size-4" />
            Delete
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/15 bg-neutral-200 px-3 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canCompile}
            onClick={onGenerate}
          >
            <PlaneTakeoff className="size-4" />
            Compile
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/10 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
            onClick={onReset}
          >
            <RotateCcw className="size-4" />
            Reset Sim
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/10 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!canTriggerSelectedLoss}
            onClick={onSimulateLoss}
          >
            <Siren className="size-4" />
            UAV Loss
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!selectedAreaId || !selectedBaseId}
            onClick={onLinkBaseToArea}
          >
            <Link2 className="size-4" />
            Link Base
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          <div className="flex gap-2">
            <button
              className="inline-flex flex-1 items-center justify-center gap-2 border border-sky-300/40 bg-sky-400/15 px-2 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!drawingPolygon || draftPointCount < 3}
              onClick={onFinishPolygon}
            >
              <Plus className="size-3.5" />
              Save Shape
            </button>
            <button
              className="inline-flex flex-1 items-center justify-center gap-2 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!drawingPolygon && !waypointPlacement && draftPointCount === 0}
              onClick={onCancelDraft}
            >
              <X className="size-3.5" />
              Cancel Draft
            </button>
          </div>
          <div className="border border-white/10 bg-black p-2 text-xs text-neutral-400">
            Draft points: <span className="font-mono text-neutral-100">{draftPointCount}</span>.
            {waypointPlacement
              ? " Click the map once to place the selected base waypoint."
              : " Areas remain available after every compile/reset."}
          </div>
        </div>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <Folder className="size-4 text-neutral-400" />
          Mission Files
        </div>
        <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
          <div className="border border-white/10 bg-black px-2 py-2 text-xs text-neutral-400">
            New fly areas save into{" "}
            <span className="font-semibold text-neutral-100">
              {polygonGroups.find((group) => group.id === activeGroupId)?.label ?? "Group 1"}
            </span>
          </div>
          <button
            className="inline-flex items-center justify-center border border-white/10 bg-neutral-900 px-2 text-neutral-100 transition hover:bg-neutral-800"
            onClick={onCreateGroup}
            aria-label="Create polygon group"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto border border-white/10 bg-black p-1 text-xs">
          {polygonGroups.map((group) => {
            const groupAreas = areas.filter((area) => area.groupId === group.id);
            const active = group.id === activeGroupId;
            return (
              <div key={group.id} className="mb-1 last:mb-0">
                <button
                  className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left transition ${
                    active ? "bg-white/10 text-neutral-100" : "text-neutral-300 hover:bg-white/5"
                  }`}
                  onClick={() => onActiveGroupChange(group.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="size-3.5 shrink-0 text-sky-300" />
                    <span className="truncate">{group.label}</span>
                  </span>
                  <span className="font-mono text-[10px] text-neutral-500">
                    {groupAreas.length}
                  </span>
                </button>
                <div className="ml-3 border-l border-white/10 pl-2">
                  {groupAreas.length === 0 ? (
                    <div className="px-2 py-1.5 text-neutral-600">No fly areas</div>
                  ) : (
                    groupAreas.map((area) => {
                      const areaLinkedBase = area.linkedBaseId
                        ? homeBases.find((base) => base.id === area.linkedBaseId)
                        : undefined;
                      const selected = selectedAreaId === area.id;
                      return (
                        <button
                          key={area.id}
                          className={`grid w-full grid-cols-[1fr_auto] gap-2 px-2 py-1.5 text-left transition ${
                            selected
                              ? "bg-sky-400/15 text-sky-100"
                              : "text-neutral-300 hover:bg-white/5"
                          }`}
                          onClick={() => onSelectedAreaChange(area.id)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <File className="size-3.5 shrink-0 text-sky-300" />
                            <span className="truncate">{area.label}</span>
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] ${
                              areaLinkedBase ? "text-emerald-300" : "text-neutral-500"
                            }`}
                          >
                            {areaLinkedBase ? <CheckCircle2 className="size-3" /> : null}
                            {areaLinkedBase?.label ?? "No base"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}

          <div className="mt-2 border-t border-white/10 pt-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Home bases
            </div>
            {homeBases.length === 0 ? (
              <div className="px-2 py-1.5 text-neutral-600">No home bases</div>
            ) : (
              homeBases.map((base) => {
                const selected = selectedBaseId === base.id;
                return (
                  <div key={base.id} className="mb-1 last:mb-0">
                    <button
                      className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left transition ${
                        selected
                          ? "bg-emerald-400/15 text-emerald-100"
                          : "text-neutral-300 hover:bg-white/5"
                      }`}
                      onClick={() => onSelectedBaseChange(base.id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Home className="size-3.5 shrink-0 text-emerald-300" />
                        <span className="truncate">{base.label}</span>
                      </span>
                      <span className="font-mono text-[10px] text-neutral-500">
                        {base.waypointMode ?? "nearest_safe"}
                      </span>
                    </button>
                    <div className="ml-3 border-l border-white/10 pl-2">
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-sky-300/80">
                        Outbound
                      </div>
                      {base.outboundWaypoints.length === 0 ? (
                        <div className="px-2 py-1 text-neutral-600">No out waypoints</div>
                      ) : (
                        base.outboundWaypoints.map((waypoint) => (
                          <div
                            key={waypoint.id}
                            className="flex items-center justify-between gap-2 px-2 py-1 text-neutral-300"
                          >
                            <button
                              className="min-w-0 truncate text-left hover:text-sky-100"
                              onClick={() => onSelectedBaseChange(base.id)}
                            >
                              {waypoint.label}
                            </button>
                            <button
                              className="shrink-0 text-neutral-500 transition hover:text-red-200"
                              onClick={() => onDeleteBaseWaypoint(waypoint.id)}
                              aria-label={`Delete ${waypoint.label}`}
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ))
                      )}
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300/80">
                        Inbound
                      </div>
                      {base.inboundWaypoints.length === 0 ? (
                        <div className="px-2 py-1 text-neutral-600">No in waypoints</div>
                      ) : (
                        base.inboundWaypoints.map((waypoint) => (
                          <div
                            key={waypoint.id}
                            className="flex items-center justify-between gap-2 px-2 py-1 text-neutral-300"
                          >
                            <button
                              className="min-w-0 truncate text-left hover:text-emerald-100"
                              onClick={() => onSelectedBaseChange(base.id)}
                            >
                              {waypoint.label}
                            </button>
                            <button
                              className="shrink-0 text-neutral-500 transition hover:text-red-200"
                              onClick={() => onDeleteBaseWaypoint(waypoint.id)}
                              aria-label={`Delete ${waypoint.label}`}
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-2 border-t border-white/10 pt-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              No-fly zones
            </div>
            {planningNfzs.length === 0 ? (
              <div className="px-2 py-1.5 text-neutral-600">No NFZ polygons</div>
            ) : (
              planningNfzs.map((nfz) => (
                <button
                  key={nfz.id}
                  className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left transition ${
                    selectedNfzId === nfz.id
                      ? "bg-red-500/15 text-red-100"
                      : "text-neutral-300 hover:bg-white/5"
                  }`}
                  onClick={() => onSelectedNfzChange(nfz.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ShieldAlert className="size-3.5 shrink-0 text-red-300" />
                    <span className="truncate">{nfz.label}</span>
                  </span>
                  <span className="font-mono text-[10px] text-neutral-500">
                    {nfz.polygon.length} pts
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <Link2 className="size-4 text-neutral-400" />
          Area Base Link
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <div
            className={`border p-2 ${
              selectedArea
                ? "border-sky-300/40 bg-sky-400/12 text-sky-100"
                : "border-white/10 bg-black text-neutral-500"
            }`}
          >
            <span className="block text-[10px] uppercase tracking-wide text-neutral-500">
              Fly area
            </span>
            <span className="mt-1 block truncate text-xs font-semibold">
              {selectedArea?.label ?? "Select area"}
            </span>
          </div>
          <div className="flex items-center justify-center text-neutral-500">
            <Link2 className="size-5" />
          </div>
          <div
            className={`border p-2 ${
              displayedBase
                ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100"
                : "border-white/10 bg-black text-neutral-500"
            }`}
          >
            <span className="block text-[10px] uppercase tracking-wide text-neutral-500">
              Home base
            </span>
            <span className="mt-1 block truncate text-xs font-semibold">
              {displayedBase?.label ?? "Select base"}
            </span>
          </div>
        </div>
        <button
          className="mt-2 inline-flex w-full items-center justify-center gap-2 border border-emerald-300/40 bg-emerald-400/12 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!selectedAreaId || !selectedBaseId}
          onClick={onLinkBaseToArea}
        >
          <Link2 className="size-4" />
          Link selected base to selected area
        </button>
        <div className="mt-2 border border-white/10 bg-black p-2 text-xs text-neutral-400">
          {selectedArea && linkedBase
            ? `${selectedArea.label} is linked to ${linkedBase.label}.`
            : selectedArea && selectedBase
              ? `Ready: ${selectedBase.label} -> ${selectedArea.label}.`
              : "Pick one blue fly-area file and one green base file, then link them."}
        </div>
        {displayedBase ? (
          <div className="mt-3 border border-white/10 bg-black p-2">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-neutral-200">Waypoint routing</span>
              <span className="font-mono text-[10px] uppercase text-neutral-500">
                {displayedBase.outboundWaypoints.length} out / {displayedBase.inboundWaypoints.length} in
              </span>
            </div>
            <select
              className="w-full border border-white/10 bg-neutral-950 px-2 py-2 text-xs text-neutral-100 outline-none focus:border-white/30 disabled:opacity-45"
              disabled={!selectedBaseId}
              value={displayedBase.waypointMode}
              onChange={(event) =>
                onBaseWaypointModeChange(event.target.value as BaseWaypointMode)
              }
            >
              <option value="nearest_safe">Nearest safe waypoint</option>
              <option value="round_robin">Round robin by UAV</option>
              <option value="specific">Specific waypoint</option>
            </select>
            {displayedBase.waypointMode === "specific" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block text-[10px] uppercase tracking-wide text-neutral-500">
                  Outbound
                  <select
                    className="mt-1 w-full border border-white/10 bg-neutral-950 px-2 py-2 text-xs normal-case text-neutral-100 outline-none focus:border-white/30"
                    value={displayedBase.specificOutboundWaypointId ?? ""}
                    onChange={(event) =>
                      onSpecificBaseWaypointChange(
                        "outbound",
                        event.target.value || undefined,
                      )
                    }
                  >
                    <option value="">Fallback nearest</option>
                    {displayedBase.outboundWaypoints.map((waypoint) => (
                      <option key={waypoint.id} value={waypoint.id}>
                        {waypoint.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] uppercase tracking-wide text-neutral-500">
                  Inbound
                  <select
                    className="mt-1 w-full border border-white/10 bg-neutral-950 px-2 py-2 text-xs normal-case text-neutral-100 outline-none focus:border-white/30"
                    value={displayedBase.specificInboundWaypointId ?? ""}
                    onChange={(event) =>
                      onSpecificBaseWaypointChange(
                        "inbound",
                        event.target.value || undefined,
                      )
                    }
                  >
                    <option value="">Fallback nearest</option>
                    {displayedBase.inboundWaypoints.map((waypoint) => (
                      <option key={waypoint.id} value={waypoint.id}>
                        {waypoint.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <div className="mt-2 text-[11px] text-neutral-500">
              Compile uses base to outbound to area, then area to inbound to base.
            </div>
          </div>
        ) : null}
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <Crosshair className="size-4 text-neutral-400" />
          Map Start
        </div>
        <select
          className="mb-2 w-full border border-white/10 bg-black px-2 py-2 text-sm text-neutral-100 outline-none focus:border-white/30"
          value={config.mapPresetId}
          onChange={(event) =>
            onConfigChange({
              ...config,
              mapPresetId: event.target.value as MissionConfig["mapPresetId"],
            })
          }
        >
          {MAP_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <select
          className="w-full border border-white/10 bg-black px-2 py-2 text-sm text-neutral-100 outline-none focus:border-white/30"
          value={demoMode}
          onChange={(event) => onDemoModeChange(event.target.value as DemoMode)}
        >
          {DEMO_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <Sparkles className="size-4 text-neutral-400" />
          Air Team
        </div>
        <div className="space-y-3">
          <Field label="UAV count" value={String(config.uavCount)}>
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={3}
              max={5}
              step={1}
              value={config.uavCount}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "uavCount", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Sensor swath" value={String(config.sensorSwathM)} suffix=" m">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={80}
              max={350}
              step={10}
              value={config.sensorSwathM}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "sensorSwathM", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Cruise speed" value={String(config.speedMps)} suffix=" m/s">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={16}
              max={34}
              step={1}
              value={config.speedMps}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "speedMps", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Endurance" value={String(config.enduranceMin)} suffix=" min">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={25}
              max={90}
              step={5}
              value={config.enduranceMin}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "enduranceMin", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Turn radius" value={String(config.turnRadiusM)} suffix=" m">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={60}
              max={180}
              step={10}
              value={config.turnRadiusM}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "turnRadiusM", Number(event.target.value)))
              }
            />
          </Field>
        </div>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <ShieldAlert className="size-4 text-neutral-400" />
          Deconfliction
        </div>
        <div className="space-y-3">
          <Field label="Minimum separation" value={String(config.minSeparationM)} suffix=" m">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={150}
              max={600}
              step={25}
              value={config.minSeparationM}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "minSeparationM", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Altitude layer spacing" value={String(config.altitudeLayerSpacingM)} suffix=" m">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={20}
              max={80}
              step={5}
              value={config.altitudeLayerSpacingM}
              onChange={(event) =>
                onConfigChange(
                  updateNumber(config, "altitudeLayerSpacingM", Number(event.target.value)),
                )
              }
            />
          </Field>
          <Field label="Strip angle" value={String(config.stripAngleDeg)} suffix=" deg">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={-35}
              max={35}
              step={1}
              value={config.stripAngleDeg}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "stripAngleDeg", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Overlap" value={String(Math.round(config.overlapRatio * 100))} suffix="%">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={0}
              max={35}
              step={5}
              value={Math.round(config.overlapRatio * 100)}
              onChange={(event) =>
                onConfigChange({ ...config, overlapRatio: Number(event.target.value) / 100 })
              }
            />
          </Field>
        </div>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
          <Radio className="size-4 text-neutral-400" />
          Contingency Logic
        </div>
        <select
          className="mb-3 w-full border border-white/10 bg-black px-2 py-2 text-sm text-neutral-100 outline-none focus:border-white/30"
          value={config.commsPolicy}
          onChange={(event) =>
            onConfigChange({ ...config, commsPolicy: event.target.value as CommsPolicy })
          }
        >
          <option value="radio_silent_except_tokens">Radio silent + exception tokens</option>
          <option value="strict_silent">Strict silent mode</option>
          <option value="exception_tokens_plus_health">Exception tokens + sparse health</option>
          <option value="full_signal">Full signal + GPS continuation</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`inline-flex items-center justify-center gap-1.5 border px-2 py-2 text-xs font-semibold transition ${
              lossResponseMode === "dispatch_replacement"
                ? "border-white/30 bg-neutral-200 text-black"
                : "border-white/10 text-neutral-300 hover:bg-neutral-900"
            }`}
            onClick={() => onSetLossResponseMode("dispatch_replacement")}
            onMouseEnter={() => onPreviewLossResponseMode("dispatch_replacement")}
          >
            <PlaneTakeoff className="size-3.5" />
            Replacement
          </button>
          <button
            className={`inline-flex items-center justify-center gap-1.5 border px-2 py-2 text-xs font-semibold transition ${
              lossResponseMode === "spread_remaining_swarm"
                ? "border-white/30 bg-neutral-200 text-black"
                : "border-white/10 text-neutral-300 hover:bg-neutral-900"
            }`}
            onClick={() => onSetLossResponseMode("spread_remaining_swarm")}
            onMouseEnter={() => onPreviewLossResponseMode("spread_remaining_swarm")}
          >
            <Shuffle className="size-3.5" />
            Spread
          </button>
        </div>
        <label className="mt-3 block text-xs text-neutral-400">
          Seed
          <input
            className="mt-1 w-full border border-white/10 bg-black px-2 py-2 font-mono text-sm text-neutral-100 outline-none focus:border-white/30"
            type="number"
            value={config.seed}
            onChange={(event) =>
              onConfigChange(updateNumber(config, "seed", Number(event.target.value)))
            }
          />
        </label>
        <div className="mt-3 flex items-start gap-2 border border-white/10 bg-black p-2 text-xs text-neutral-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Drag polygons or bases on the map. Compile reruns against the selected blue area, linked base, and all red NFZ polygons.
        </div>
      </div>
    </aside>
  );
}
