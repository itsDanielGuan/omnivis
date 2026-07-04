"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Crosshair,
  Folder,
  Home,
  Info,
  Link2,
  PlaneTakeoff,
  Plus,
  Radio,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  BaseWaypointMode,
  CommsPolicy,
  DemoMode,
  EditorMode,
  HomeBase,
  InfillPattern,
  LossResponseMode,
  MissionConfig,
  PlanningArea,
  PlanningNfz,
  ThreatKind,
} from "@/lib/types";

type ActionMenu =
  | {
      kind: "area" | "base" | "nfz";
      id: string;
      x: number;
      y: number;
    }
  | null;

type PendingDelete = {
  kind: "area" | "base" | "nfz";
  id: string;
  label: string;
} | null;

type Props = {
  config: MissionConfig;
  demoMode: DemoMode;
  lossResponseMode: LossResponseMode;
  editorMode: EditorMode;
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
  onSelectedAreaChange: (areaId: string | undefined) => void;
  onSelectedBaseChange: (baseId: string | undefined) => void;
  onSelectedNfzChange: (nfzId: string | undefined) => void;
  onFinishPolygon: () => void;
  onCancelDraft: () => void;
  onLinkBaseToArea: () => void;
  onLinkBackupBaseToArea: () => void;
  onClearBackupBaseFromArea: () => void;
  onLinkStrikeBaseToArea: () => void;
  onClearStrikeBaseFromArea: () => void;
  threatKind: ThreatKind;
  onPlaceThreat: (kind: ThreatKind) => void;
  onRenameArea: (areaId: string, label: string) => void;
  onRenameBase: (baseId: string, label: string) => void;
  onRenameNfz: (nfzId: string, label: string) => void;
  onDeleteArea: (areaId: string) => void;
  onDeleteBase: (baseId: string) => void;
  onDeleteNfz: (nfzId: string) => void;
  onToggleNfzEnabled: (nfzId: string) => void;
  onToggleBaseAvailability: () => void;
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

const INFILL_PATTERN_OPTIONS: Array<{
  id: InfillPattern;
  label: string;
  shortLabel: string;
  description: string;
  contingency: string;
  stroke: string;
  routes: string[];
}> = [
  {
    id: "rectilinear",
    label: "Rectilinear",
    shortLabel: "Lines",
    description: "Parallel passes at the configured strip angle.",
    contingency: "Keeps unfinished work in predictable lane blocks.",
    stroke: "#38bdf8",
    routes: ["M18 24 H118 M18 38 H118 M18 52 H118 M18 66 H118"],
  },
  {
    id: "zigzag",
    label: "Zigzag",
    shortLabel: "Zigzag",
    description: "Serpentine lane sequencing reduces long deadhead turns.",
    contingency: "Useful when debt should be consumed as a continuous back-and-forth path.",
    stroke: "#f59e0b",
    routes: ["M18 24 H118 L18 38 H118 L18 52 H118 L18 66 H118"],
  },
  {
    id: "grid",
    label: "Grid",
    shortLabel: "Grid",
    description: "Two rectilinear passes at right angles form square cells.",
    contingency: "Interleaves unfinished cells across the active swarm.",
    stroke: "#22d3ee",
    routes: ["M18 28 H118 M18 58 H118", "M42 16 V74 M88 16 V74"],
  },
  {
    id: "triangles",
    label: "Triangles",
    shortLabel: "Tri",
    description: "Three angled passes form a triangular truss pattern.",
    contingency: "Greedy reassignment works well when geometry is highly interlocked.",
    stroke: "#a78bfa",
    routes: ["M18 66 H118", "M24 72 L68 18 L112 72", "M18 30 L62 74 L118 18"],
  },
  {
    id: "tri_hex",
    label: "Tri-hex",
    shortLabel: "Tri-hex",
    description: "Sparse three-axis passes suggest hex cells with triangular braces.",
    contingency: "Balances strong mesh coverage with fewer contingency segments.",
    stroke: "#34d399",
    routes: ["M20 28 H116 M20 60 H116", "M30 74 L72 16 L116 74", "M18 18 L60 74 L112 18"],
  },
  {
    id: "diamond",
    label: "Diamond",
    shortLabel: "Diamond",
    description: "Opposed diagonal passes create a faceted diamond mesh.",
    contingency: "Good when recovery should expand out from the centerline.",
    stroke: "#fb7185",
    routes: ["M20 70 L68 18 L116 70", "M20 18 L68 70 L116 18"],
  },
  {
    id: "chevron",
    label: "Chevron",
    shortLabel: "Chevron",
    description: "Alternating slanted passes form sharp V-shaped coverage.",
    contingency: "Closes damaged boundaries before working back through the middle.",
    stroke: "#60a5fa",
    routes: ["M20 64 L48 24 L76 64 L104 24", "M32 74 L60 34 L88 74 L116 34"],
  },
  {
    id: "crosshatch",
    label: "Crosshatch",
    shortLabel: "Hatch",
    description: "Grid passes get a lighter diagonal brace pass.",
    contingency: "Shares work round-robin while preserving multiple approach axes.",
    stroke: "#f472b6",
    routes: ["M18 32 H118 M18 58 H118", "M42 18 V74 M92 18 V74", "M20 72 L118 20"],
  },
  {
    id: "lattice",
    label: "Lattice",
    shortLabel: "Lattice",
    description: "A denser multi-axis truss for highly cooperative coverage.",
    contingency: "Interleaves active UAVs through a robust mesh of remaining work.",
    stroke: "#2dd4bf",
    routes: ["M18 24 H118 M18 64 H118", "M26 74 L70 16 L118 72", "M18 18 L62 74 L116 22"],
  },
  {
    id: "lightning",
    label: "Lightning",
    shortLabel: "Bolt",
    description: "Sparse angular passes prioritize fast opportunistic infill.",
    contingency: "Greedy nearest-work absorption favors quick local recovery.",
    stroke: "#fde047",
    routes: ["M18 70 L38 28 L56 54 L82 20 L98 62 L118 34"],
  },
];

function infillOption(pattern: InfillPattern) {
  return INFILL_PATTERN_OPTIONS.find((option) => option.id === pattern) ?? INFILL_PATTERN_OPTIONS[0];
}

function CoveragePathGraphic({
  pattern,
  compact = false,
}: {
  pattern: InfillPattern;
  compact?: boolean;
}) {
  const option = infillOption(pattern);
  return (
    <svg
      className={compact ? "h-16 w-full" : "h-20 w-full"}
      viewBox="0 0 136 88"
      role="img"
      aria-label={`${option.label} coverage path preview`}
    >
      <path
        d="M12 18 L122 14 L128 74 L20 78 Z"
        fill="rgba(14,165,233,0.08)"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />
      {[24, 38, 52, 66].map((y) => (
        <path
          key={y}
          d={`M20 ${y} H116`}
          stroke="rgba(255,255,255,0.16)"
          strokeDasharray="2 4"
          strokeWidth="1"
        />
      ))}
      {option.routes.map((route, index) => (
        <path
          key={route}
          d={route}
          fill="none"
          stroke={option.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={index === 0 ? 1 : 0.62}
          strokeWidth={index === 0 ? 4 : 3}
        />
      ))}
      <circle cx="15" cy="74" r="4" fill="#e5e5e5" />
      <path d="M15 74 L24 66" stroke="rgba(229,229,229,0.8)" strokeWidth="1.5" />
    </svg>
  );
}

function infillLabel(pattern: InfillPattern) {
  return infillOption(pattern).label;
}

export function MissionControls({
  config,
  lossResponseMode,
  editorMode,
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
  onEditorModeChange,
  onSelectedAreaChange,
  onSelectedBaseChange,
  onSelectedNfzChange,
  onFinishPolygon,
  onCancelDraft,
  onLinkBaseToArea,
  onLinkBackupBaseToArea,
  onClearBackupBaseFromArea,
  onLinkStrikeBaseToArea,
  onClearStrikeBaseFromArea,
  threatKind,
  onPlaceThreat,
  onRenameArea,
  onRenameBase,
  onRenameNfz,
  onDeleteArea,
  onDeleteBase,
  onDeleteNfz,
  onToggleNfzEnabled,
  onToggleBaseAvailability,
  onAddBaseWaypoint,
  onBaseWaypointModeChange,
  onSpecificBaseWaypointChange,
  onDeleteBaseWaypoint,
  onGenerate,
  onReset,
  onSimulateLoss,
  onSetLossResponseMode,
}: Props) {
  const selectedArea = areas.find((area) => area.id === selectedAreaId);
  const selectedBase = homeBases.find((base) => base.id === selectedBaseId);
  const linkedBase = selectedArea?.linkedBaseId
    ? homeBases.find((base) => base.id === selectedArea.linkedBaseId)
    : undefined;
  const backupBase = selectedArea?.backupBaseId
    ? homeBases.find((base) => base.id === selectedArea.backupBaseId)
    : undefined;
  const strikeBase = selectedArea?.strikeBaseId
    ? homeBases.find((base) => base.id === selectedArea.strikeBaseId)
    : undefined;
  const displayedBase = selectedBase ?? linkedBase ?? backupBase;
  const linkedBaseOffline = linkedBase?.available === false;
  const backupBaseOffline = backupBase?.available === false;
  const drawingPolygon = editorMode === "draw_area" || editorMode === "draw_nfz";
  const waypointPlacement =
    editorMode === "place_outbound_waypoint" || editorMode === "place_inbound_waypoint";
  const operationMode: CommsPolicy =
    config.commsPolicy === "full_signal" ? "full_signal" : "silent_operation";
  const spreadAvailable = operationMode === "full_signal";
  const initialInfillPattern = config.initialInfillPattern ?? config.pathPattern ?? "rectilinear";
  const contingencyInfillPattern =
    config.contingencyInfillPattern ?? initialInfillPattern;
  const initialInfillOption = infillOption(initialInfillPattern);
  const contingencyInfillOption = infillOption(contingencyInfillPattern);
  const spreadUsesContingency =
    spreadAvailable && lossResponseMode === "spread_remaining_swarm";
  const [actionMenu, setActionMenu] = useState<ActionMenu>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  useEffect(() => {
    if (!actionMenu) return;
    const close = () => setActionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenu]);

  const openActionMenu = (
    kind: "area" | "base" | "nfz",
    id: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 136;
    const height = kind === "nfz" ? 116 : 84;
    const x = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const below = rect.bottom + 6;
    const y =
      below + height > window.innerHeight - 8
        ? Math.max(8, rect.top - height - 6)
        : below;
    setActionMenu({ kind, id, x, y });
  };

  const closeActionMenu = () => setActionMenu(null);

  const deleteLabel = (kind: "area" | "base" | "nfz", id: string) => {
    if (kind === "area") return areas.find((area) => area.id === id)?.label ?? "Unnamed zone";
    if (kind === "base") return homeBases.find((base) => base.id === id)?.label ?? "Unnamed base";
    return planningNfzs.find((nfz) => nfz.id === id)?.label ?? "Unnamed NFZ";
  };

  const requestDelete = (kind: "area" | "base" | "nfz", id: string) => {
    setPendingDelete({ kind, id, label: deleteLabel(kind, id) });
    closeActionMenu();
  };

  const requestSelectedDelete = () => {
    if (selectedAreaId) {
      requestDelete("area", selectedAreaId);
    } else if (selectedBaseId) {
      requestDelete("base", selectedBaseId);
    } else if (selectedNfzId) {
      requestDelete("nfz", selectedNfzId);
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "area") onDeleteArea(pendingDelete.id);
    if (pendingDelete.kind === "base") onDeleteBase(pendingDelete.id);
    if (pendingDelete.kind === "nfz") onDeleteNfz(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <aside className="flex min-h-0 flex-col border-r border-white/10 bg-black">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
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
            onClick={requestSelectedDelete}
          >
            <Trash2 className="size-4" />
            Delete
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
          <Crosshair className="size-4 text-rose-300" />
          Threats
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "merchant", label: "Merchant", hint: "friendly" },
              { id: "small", label: "Small", hint: "medium" },
              { id: "large", label: "Large", hint: "saturation" },
            ] as { id: ThreatKind; label: string; hint: string }[]
          ).map((option) => {
            const active = editorMode === "place_threat" && threatKind === option.id;
            return (
              <button
                key={option.id}
                className={`flex flex-col items-center gap-0.5 border px-2 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-rose-400/60 bg-rose-500/20 text-rose-100"
                    : "border-white/10 bg-black text-neutral-300 hover:bg-white/5"
                }`}
                onClick={() => onPlaceThreat(option.id)}
              >
                <span>{option.label}</span>
                <span className="text-[9px] font-normal text-neutral-500">{option.hint}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 border border-white/10 bg-black p-2 text-xs text-neutral-400">
          {editorMode === "place_threat"
            ? "Click the map to drop the selected threat onto a searching drone's path."
            : "Compile and run a mission, pick a threat type, then click the map to drop it."}
        </div>
      </div>

      <div className="border border-white/10 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-200">
            <Folder className="size-4 text-neutral-400" />
            Mission Files
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
            {areas.length + homeBases.length + planningNfzs.length} items
          </span>
        </div>
        <div className="max-h-96 space-y-3 overflow-y-auto text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">
              <span>Normal zones</span>
              <span className="font-mono text-neutral-500">{areas.length}</span>
            </div>
            {areas.length === 0 ? (
              <div className="border border-white/10 bg-black px-2 py-2 text-neutral-600">
                No normal zones yet.
              </div>
            ) : (
              areas.map((area) => {
                const primaryBase = area.linkedBaseId
                  ? homeBases.find((base) => base.id === area.linkedBaseId)
                  : undefined;
                const backup = area.backupBaseId
                  ? homeBases.find((base) => base.id === area.backupBaseId)
                  : undefined;
                const selected = selectedAreaId === area.id;
                return (
                  <div
                    key={area.id}
                    className={`border p-2 transition ${
                      selected
                        ? "border-sky-300/45 bg-sky-400/15 text-sky-100"
                        : "border-white/10 bg-black text-neutral-300"
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        className="min-w-0 border border-transparent bg-transparent px-1 py-0.5 font-semibold text-current outline-none transition focus:border-sky-300/40 focus:bg-black/60"
                        value={area.label}
                        onFocus={() => onSelectedAreaChange(area.id)}
                        onChange={(event) => onRenameArea(area.id, event.target.value)}
                        aria-label={`Rename ${area.label}`}
                      />
                      <button
                        className="border border-white/10 bg-neutral-950 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-300 hover:bg-neutral-900"
                        onClick={(event) => openActionMenu("area", area.id, event)}
                      >
                        Actions
                      </button>
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-neutral-400">
                      <div>
                        Primary:{" "}
                        <span className={primaryBase ? "text-emerald-300" : "text-neutral-600"}>
                          {primaryBase
                            ? `${primaryBase.label}${primaryBase.available === false ? " offline" : ""}`
                            : "None"}
                        </span>
                      </div>
                      <div>
                        Backup:{" "}
                        <span className={backup ? "text-amber-300" : "text-neutral-600"}>
                          {backup
                            ? `${backup.label}${backup.available === false ? " offline" : ""}`
                            : "None"}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] uppercase text-neutral-500">
                        {area.polygon.length} polygon points
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-1.5 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/80">
              <span>Home bases</span>
              <span className="font-mono text-neutral-500">{homeBases.length}</span>
            </div>
            {homeBases.length === 0 ? (
              <div className="border border-white/10 bg-black px-2 py-2 text-neutral-600">
                No home bases yet.
              </div>
            ) : (
              homeBases.map((base) => {
                const primaryFor = areas.filter((area) => area.linkedBaseId === base.id);
                const backupFor = areas.filter((area) => area.backupBaseId === base.id);
                const selected = selectedBaseId === base.id;
                return (
                  <div
                    key={base.id}
                    className={`border p-2 transition ${
                      selected
                        ? "border-emerald-300/45 bg-emerald-400/15 text-emerald-100"
                        : "border-white/10 bg-black text-neutral-300"
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        className="min-w-0 border border-transparent bg-transparent px-1 py-0.5 font-semibold text-current outline-none transition focus:border-emerald-300/40 focus:bg-black/60"
                        value={base.label}
                        onFocus={() => onSelectedBaseChange(base.id)}
                        onChange={(event) => onRenameBase(base.id, event.target.value)}
                        aria-label={`Rename ${base.label}`}
                      />
                      <button
                        className="border border-white/10 bg-neutral-950 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-300 hover:bg-neutral-900"
                        onClick={(event) => openActionMenu("base", base.id, event)}
                      >
                        Actions
                      </button>
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-neutral-400">
                      <div>
                        Supports:{" "}
                        <span className={primaryFor.length ? "text-emerald-300" : "text-neutral-600"}>
                          {primaryFor.map((area) => area.label).join(", ") || "No primary zones"}
                        </span>
                      </div>
                      <div>
                        Backup for:{" "}
                        <span className={backupFor.length ? "text-amber-300" : "text-neutral-600"}>
                          {backupFor.map((area) => area.label).join(", ") || "No backup zones"}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] uppercase text-neutral-500">
                        {base.available === false ? "offline" : "available"} / {base.waypointMode}
                      </div>
                      {base.outboundWaypoints.length || base.inboundWaypoints.length ? (
                        <div className="mt-1 grid gap-1 border-l border-white/10 pl-2">
                          {[...base.outboundWaypoints, ...base.inboundWaypoints].map((waypoint) => (
                            <div key={waypoint.id} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-neutral-400">
                                {waypoint.label}
                              </span>
                              <button
                                className="shrink-0 text-[10px] uppercase tracking-wide text-red-200 hover:text-red-100"
                                onClick={() => onDeleteBaseWaypoint(waypoint.id)}
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-1.5 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-red-300/80">
              <span>No-fly zones</span>
              <span className="font-mono text-neutral-500">{planningNfzs.length}</span>
            </div>
            {planningNfzs.length === 0 ? (
              <div className="border border-white/10 bg-black px-2 py-2 text-neutral-600">
                No NFZ polygons yet.
              </div>
            ) : (
              planningNfzs.map((nfz) => {
                const selected = selectedNfzId === nfz.id;
                const enabled = nfz.enabled !== false;
                return (
                  <div
                    key={nfz.id}
                    className={`border p-2 transition ${
                      selected
                        ? "border-red-300/45 bg-red-500/15 text-red-100"
                        : "border-white/10 bg-black text-neutral-300"
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        className="min-w-0 border border-transparent bg-transparent px-1 py-0.5 font-semibold text-current outline-none transition focus:border-red-300/40 focus:bg-black/60"
                        value={nfz.label}
                        onFocus={() => onSelectedNfzChange(nfz.id)}
                        onChange={(event) => onRenameNfz(nfz.id, event.target.value)}
                        aria-label={`Rename ${nfz.label}`}
                      />
                      <button
                        className="border border-white/10 bg-neutral-950 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-300 hover:bg-neutral-900"
                        onClick={(event) => openActionMenu("nfz", nfz.id, event)}
                      >
                        Actions
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase">
                      <span className={enabled ? "text-red-300" : "text-neutral-600"}>
                        {enabled ? "active" : "disabled"}
                      </span>
                      <span className="text-neutral-500">
                        {nfz.polygon.length} restricted polygon points
                      </span>
                    </div>
                  </div>
                );
              })
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
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 border border-amber-300/40 bg-amber-400/10 px-2 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!selectedAreaId || !selectedBaseId || selectedArea?.linkedBaseId === selectedBaseId}
            onClick={onLinkBackupBaseToArea}
          >
            <Link2 className="size-3.5" />
            Set Backup
          </button>
          <button
            className={`inline-flex items-center justify-center gap-2 border px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
              selectedBase?.available === false
                ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/18"
                : "border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/18"
            }`}
            disabled={!selectedBaseId}
            onClick={onToggleBaseAvailability}
          >
            <AlertTriangle className="size-3.5" />
            {selectedBase?.available === false ? "Restore Base" : "Mark Offline"}
          </button>
        </div>
        <button
          className="mt-2 inline-flex w-full items-center justify-center gap-2 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-300 transition hover:border-white/25 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!selectedArea?.backupBaseId}
          onClick={onClearBackupBaseFromArea}
        >
          <X className="size-3.5" />
          Remove backup from selected area
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div
            className={`border p-2 ${
              linkedBase
                ? linkedBaseOffline
                  ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
                  : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                : "border-white/10 bg-black text-neutral-500"
            }`}
          >
            <span className="block uppercase tracking-wide text-neutral-500">Primary</span>
            <span className="mt-1 block truncate font-semibold">
              {linkedBase?.label ?? "None"}
              {linkedBaseOffline ? " offline" : ""}
            </span>
          </div>
          <div
            className={`border p-2 ${
              backupBase
                ? backupBaseOffline
                  ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
                  : "border-amber-300/30 bg-amber-400/10 text-amber-100"
                : "border-white/10 bg-black text-neutral-500"
            }`}
          >
            <span className="block uppercase tracking-wide text-neutral-500">Backup</span>
            <span className="mt-1 block truncate font-semibold">
              {backupBase?.label ?? "None"}
              {backupBaseOffline ? " offline" : ""}
            </span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 border border-rose-300/40 bg-rose-400/10 px-2 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/18 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!selectedAreaId || !selectedBaseId}
            onClick={onLinkStrikeBaseToArea}
          >
            <Crosshair className="size-3.5" />
            Set Strike Base
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-300 transition hover:border-white/25 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!selectedArea?.strikeBaseId}
            onClick={onClearStrikeBaseFromArea}
          >
            <X className="size-3.5" />
            Clear Strike Base
          </button>
        </div>
        <div className="mt-2 border border-rose-300/20 bg-rose-500/5 p-2 text-[11px] text-rose-100/80">
          Strike base for this area:{" "}
          <span className="font-semibold text-rose-100">
            {strikeBase?.label ?? "Primary base (default)"}
          </span>
          . Strike packages launch from here.
        </div>
        <div className="mt-2 border border-white/10 bg-black p-2 text-xs text-neutral-400">
          {selectedArea && linkedBaseOffline && backupBase && !backupBaseOffline
            ? `${linkedBase.label} is offline; compile will route ${selectedArea.label} through backup ${backupBase.label}.`
            : selectedArea && linkedBase
            ? `${selectedArea.label} is linked to ${linkedBase.label}.`
            : selectedArea && selectedBase
              ? `Ready: ${selectedBase.label} -> ${selectedArea.label}.`
              : "Pick one blue zone and one green base on the map, then link them. Select another base to set it as backup."}
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
          <Field label="RTB reserve" value={String(config.batteryReserveMin)} suffix=" min">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={5}
              max={20}
              step={1}
              value={config.batteryReserveMin}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "batteryReserveMin", Number(event.target.value)))
              }
            />
          </Field>
          <Field label="Recharge" value={String(config.rechargeDurationMin)} suffix=" min">
            <input
              className="w-full accent-neutral-200"
              type="range"
              min={5}
              max={30}
              step={1}
              value={config.rechargeDurationMin}
              onChange={(event) =>
                onConfigChange(updateNumber(config, "rechargeDurationMin", Number(event.target.value)))
              }
            />
          </Field>
          <div className="flex items-start gap-2 border border-emerald-300/25 bg-emerald-400/10 p-2 text-xs text-emerald-100">
            <BatteryCharging className="mt-0.5 size-3.5 shrink-0" />
            UAVs automatically RTB near reserve, recharge, and relaunch for remaining strips.
          </div>
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
          value={operationMode}
          onChange={(event) => {
            const nextPolicy = event.target.value as CommsPolicy;
            if (nextPolicy === "silent_operation") {
              onSetLossResponseMode("dispatch_replacement");
            }
            onConfigChange({ ...config, commsPolicy: nextPolicy });
          }}
        >
          <option value="silent_operation">Silent operation</option>
          <option value="full_signal">Full signal + GPS</option>
        </select>
        <div className="mb-3 text-xs text-neutral-400">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span>Initial infill</span>
            <span className="group relative inline-flex">
              <Info className="size-3.5 text-neutral-500" />
              <span className="pointer-events-none absolute right-0 top-5 z-30 hidden w-80 border border-white/10 bg-black p-2 shadow-2xl group-hover:block group-focus-within:block">
                <span className="grid grid-cols-2 gap-2">
                  {INFILL_PATTERN_OPTIONS.map((candidate) => (
                    <span
                      key={candidate.id}
                      className={`border p-1 ${
                        candidate.id === initialInfillPattern
                          ? "border-white/30 bg-white/10"
                          : "border-white/10 bg-neutral-950"
                      }`}
                    >
                      <CoveragePathGraphic pattern={candidate.id} compact />
                      <span className="block text-center font-mono text-[9px] uppercase text-neutral-300">
                        {candidate.shortLabel}
                      </span>
                    </span>
                  ))}
                </span>
              </span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {INFILL_PATTERN_OPTIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`border px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                  candidate.id === initialInfillPattern
                    ? "border-white/30 bg-neutral-200 text-black"
                    : "border-white/10 bg-black text-neutral-300 hover:bg-neutral-900"
                }`}
                onClick={() =>
                  onConfigChange({
                    ...config,
                    initialInfillPattern: candidate.id,
                    pathPattern: candidate.id,
                  })
                }
              >
                {candidate.shortLabel}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-4 text-neutral-500">
            Generates the compiled coverage geometry before launch.
          </div>
        </div>
        <div className="mb-3 border border-white/10 bg-black p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
            <span>{infillLabel(initialInfillPattern)}</span>
            <span>Compile preview</span>
          </div>
          <CoveragePathGraphic pattern={initialInfillPattern} />
          <div className="mt-1 text-[11px] leading-4 text-neutral-400">
            {initialInfillOption.description}
          </div>
        </div>
        <div className="mb-3 text-xs text-neutral-400">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span>Contingency infill</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-600">
              Future work
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {INFILL_PATTERN_OPTIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`border px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                  candidate.id === contingencyInfillPattern
                    ? "border-white/30 bg-neutral-200 text-black"
                    : "border-white/10 bg-black text-neutral-300 hover:bg-neutral-900"
                }`}
                onClick={() =>
                  onConfigChange({ ...config, contingencyInfillPattern: candidate.id })
                }
              >
                {candidate.shortLabel}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-4 text-neutral-500">
            Re-sequences replacement, spread, and NFZ-safe future branches without reviving completed or blocked strips.
          </div>
        </div>
        <div className="mb-3 border border-white/10 bg-black p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
            <span>{infillLabel(contingencyInfillPattern)}</span>
            <span>Contingency preview</span>
          </div>
          <CoveragePathGraphic pattern={contingencyInfillPattern} />
          <div className="mt-1 text-[11px] leading-4 text-neutral-400">
            {contingencyInfillOption.contingency}
          </div>
        </div>
        <div className="mb-3 border border-white/10 bg-black p-2 text-xs text-neutral-400">
          {operationMode === "full_signal"
            ? "Full Signal: choose Replacement or Spread. Spread can reassign live unfinished coverage."
            : "Silent operation: only alive/health signals are assumed, so a loss redoes the assigned sector from base."}
          <span className="mt-1 block text-neutral-500">
            {spreadUsesContingency
              ? contingencyInfillOption.contingency
              : `Replacement launches from the active base and uses ${infillLabel(contingencyInfillPattern)} for inherited work.`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`inline-flex items-center justify-center gap-1.5 border px-2 py-2 text-xs font-semibold transition ${
              lossResponseMode === "dispatch_replacement"
                ? "border-white/30 bg-neutral-200 text-black"
                : "border-white/10 text-neutral-300 hover:bg-neutral-900"
            }`}
            onClick={() => onSetLossResponseMode("dispatch_replacement")}
          >
            <PlaneTakeoff className="size-3.5" />
            Replacement
          </button>
          <button
            className={`inline-flex items-center justify-center gap-1.5 border px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
              lossResponseMode === "spread_remaining_swarm"
                ? "border-white/30 bg-neutral-200 text-black"
                : "border-white/10 text-neutral-300 hover:bg-neutral-900"
            }`}
            disabled={!spreadAvailable}
            onClick={() => onSetLossResponseMode("spread_remaining_swarm")}
          >
            <Shuffle className="size-3.5" />
            {spreadAvailable ? "Spread" : "GPS Spread"}
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
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black p-3 shadow-[0_-16px_30px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-2 gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/15 bg-neutral-200 px-3 py-2.5 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canCompile}
            onClick={onGenerate}
          >
            <PlaneTakeoff className="size-4" />
            Compile
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 border border-white/10 bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
            onClick={onReset}
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>
      </div>
      {actionMenu ? (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close actions menu"
            onClick={closeActionMenu}
          />
          <div
            className="fixed z-50 grid w-34 gap-1 border border-white/10 bg-black p-1 text-xs shadow-2xl"
            style={{ left: actionMenu.x, top: actionMenu.y, width: 136 }}
          >
            <button
              className="px-2 py-1.5 text-left text-neutral-200 hover:bg-white/10"
              onClick={() => {
                if (actionMenu.kind === "area") onSelectedAreaChange(actionMenu.id);
                if (actionMenu.kind === "base") onSelectedBaseChange(actionMenu.id);
                if (actionMenu.kind === "nfz") onSelectedNfzChange(actionMenu.id);
                closeActionMenu();
              }}
            >
              Select
            </button>
            {actionMenu.kind === "nfz" ? (
              <button
                className="px-2 py-1.5 text-left text-neutral-200 hover:bg-white/10"
                onClick={() => {
                  onToggleNfzEnabled(actionMenu.id);
                  closeActionMenu();
                }}
              >
                {planningNfzs.find((nfz) => nfz.id === actionMenu.id)?.enabled === false
                  ? "Enable"
                  : "Disable"}
              </button>
            ) : null}
            <button
              className="px-2 py-1.5 text-left text-red-200 hover:bg-red-500/15"
              onClick={() => {
                requestDelete(actionMenu.kind, actionMenu.id);
              }}
            >
              Delete
            </button>
          </div>
        </>
      ) : null}
      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border border-red-300/30 bg-neutral-950 p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
                <div>
                  <div className="text-sm font-semibold text-red-100">
                    Delete {pendingDelete.kind === "nfz" ? "NFZ" : pendingDelete.kind}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    You are about to delete{" "}
                    <span className="font-semibold text-neutral-100">{pendingDelete.label}</span>.
                    This cannot be undone and any compiled mission will be cleared.
                  </div>
                </div>
              </div>
              <button
                className="text-neutral-500 transition hover:text-neutral-200"
                aria-label="Cancel delete"
                onClick={() => setPendingDelete(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="border border-white/10 bg-black px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-white/5"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                className="border border-red-300/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/25"
                onClick={confirmDelete}
              >
                Delete {pendingDelete.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
