"use client";

import {
  Eye,
  PlaneLanding,
  RadioTower,
  ScanSearch,
  ShieldAlert,
  Shuffle,
  Siren,
} from "lucide-react";
import { formatMissionClock } from "@/lib/geometry";
import { getCurrentTask, getUavSnapshot } from "@/lib/simulator";
import type { LossResponseMode, MissionPlan } from "@/lib/types";

type Props = {
  plan: MissionPlan | null;
  selectedUavId?: string;
  simTimeS: number;
  onTriggerLoss: () => void;
  onPreviewLossResponse: (mode: LossResponseMode) => void;
  onForceRtbPreview: () => void;
  onHealthPing: () => void;
  onRegainSignal: () => void;
};

export function UnitCard({
  plan,
  selectedUavId,
  simTimeS,
  onTriggerLoss,
  onPreviewLossResponse,
  onForceRtbPreview,
  onHealthPing,
  onRegainSignal,
}: Props) {
  const uav = plan?.uavs.find((candidate) => candidate.id === selectedUavId);
  if (!plan || !uav) {
    return (
      <section className="shrink-0 border border-white/10 bg-neutral-950 p-3 text-sm text-neutral-500">
        Select a UAV on the map or table to open the unit card.
      </section>
    );
  }

  const snapshot = getUavSnapshot(uav, simTimeS);
  const fullSignal = plan.config.commsPolicy === "full_signal";

  return (
    <section className="shrink-0 border border-white/10 bg-neutral-950 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2.5" style={{ backgroundColor: uav.color }} />
            <h2 className="text-base font-semibold text-neutral-50">{uav.label}</h2>
          </div>
          <p className="text-xs text-neutral-500">{getCurrentTask(uav, simTimeS)}</p>
        </div>
        <span className="border border-white/10 bg-black px-2 py-1 text-xs uppercase text-neutral-300">
          {uav.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">Altitude layer</span>
          <span className="font-mono text-neutral-100">{uav.altitudeM}m</span>
        </div>
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">Assigned strips</span>
          <span className="font-mono text-neutral-100">{uav.assignedStripIds.length}</span>
        </div>
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">Endurance remain</span>
          <span className="font-mono text-neutral-100">
            {Math.max(
              0,
              Math.round(plan.config.enduranceMin - simTimeS / 60),
            )}
            m
          </span>
        </div>
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">RTB slot</span>
          <span className="font-mono text-neutral-100">
            {formatMissionClock(uav.rtbSlotS)}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5">
          <Eye className="size-3.5" />
          Inspect Route
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-red-400/50 bg-red-500/12 px-2 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/20"
          onClick={onTriggerLoss}
        >
          <Siren className="size-3.5" />
          Trigger Loss Here
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5"
          onClick={() => onPreviewLossResponse("dispatch_replacement")}
        >
          <ScanSearch className="size-3.5" />
          Use Replacement
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!fullSignal}
          onClick={() => onPreviewLossResponse("spread_remaining_swarm")}
        >
          <Shuffle className="size-3.5" />
          {fullSignal ? "Use Spread" : "Spread needs GPS"}
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5"
          onClick={onForceRtbPreview}
        >
          <PlaneLanding className="size-3.5" />
          Force RTB Preview
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5"
          onClick={onHealthPing}
        >
          <RadioTower className="size-3.5" />
          Health Ping
        </button>
        <button
          className="col-span-2 inline-flex items-center justify-center gap-1.5 border border-emerald-300/35 bg-emerald-400/10 px-2 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={uav.status !== "lost"}
          onClick={onRegainSignal}
        >
          <RadioTower className="size-3.5" />
          Regain Signal + RTB
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
        <ShieldAlert className="size-3.5" />
        Phase {snapshot.phase}; progress {Math.round(snapshot.progressPct)}%.
      </div>
    </section>
  );
}
