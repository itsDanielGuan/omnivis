"use client";

import {
  BatteryCharging,
  Eye,
  PlaneLanding,
  RadioTower,
  ScanSearch,
  ShieldAlert,
  Shuffle,
  Siren,
} from "lucide-react";
import { detectionRadiusM, formatMissionClock } from "@/lib/geometry";
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
  const detectionRadius = detectionRadiusM(plan.config, uav.altitudeM);
  const fullSignal = plan.config.commsPolicy === "full_signal";
  const lossDetectedAtS = uav.lossDetectedAtS ?? uav.lostAtS;
  const hasLossLifecycle =
    uav.communicationLostAtS !== undefined ||
    uav.lossDetectedAtS !== undefined ||
    uav.lostAtS !== undefined ||
    uav.status === "lost" ||
    uav.status === "regained" ||
    Boolean(uav.reserve);
  const canTriggerLoss = !hasLossLifecycle;
  const canRegainSignal =
    uav.status === "lost" && uav.communicationLostAtS !== undefined;
  const sortieStart =
    [...uav.route]
      .reverse()
      .find(
        (point) =>
          point.t <= simTimeS && (point.phase === "preflight" || point.phase === "recharge"),
      )?.t ?? 0;
  const enduranceRemainingMin = Math.max(
    0,
    Math.round(plan.config.enduranceMin - (simTimeS - sortieStart) / 60),
  );
  const routeEndS = uav.route.at(-1)?.t ?? simTimeS;
  const boundedTimeS = Math.max(uav.route[0]?.t ?? 0, Math.min(simTimeS, routeEndS));
  const reservePct = Math.max(
    0,
    Math.min(100, (plan.config.batteryReserveMin / plan.config.enduranceMin) * 100),
  );
  const rechargeIndex = uav.route.findIndex((point, index) => {
    const previous = uav.route[index - 1];
    return point.phase === "recharge" && previous && boundedTimeS >= previous.t && boundedTimeS < point.t;
  });
  const batteryPct =
    rechargeIndex > 0
      ? Math.max(
          reservePct,
          Math.min(
            100,
            reservePct +
              ((boundedTimeS - uav.route[rechargeIndex - 1].t) /
                Math.max(1, uav.route[rechargeIndex].t - uav.route[rechargeIndex - 1].t)) *
                (100 - reservePct),
          ),
        )
      : Math.max(
          0,
          Math.min(100, 100 - ((boundedTimeS - sortieStart) / (plan.config.enduranceMin * 60)) * 100),
        );
  const batteryColor =
    batteryPct <= reservePct + 5
      ? "bg-red-500"
      : batteryPct <= reservePct + 20
        ? "bg-amber-500"
        : "bg-emerald-400";

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
            {enduranceRemainingMin}m
          </span>
        </div>
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">RTB slot</span>
          <span className="font-mono text-neutral-100">
            {formatMissionClock(uav.rtbSlotS)}
          </span>
        </div>
      </div>

      <div className="mt-2 border border-cyan-300/25 bg-cyan-400/5 p-2 text-xs">
        <span className="flex items-center gap-1 text-cyan-200/80">
          <ScanSearch className="size-3.5" />
          Detection zone radius
        </span>
        <span className="mt-0.5 block font-mono text-base text-cyan-100">
          {Math.round(detectionRadius)}m
        </span>
        <span className="mt-0.5 block text-[10px] text-neutral-500">
          Suspicious-object sensing range from sensor swath and altitude layer.
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="border border-white/10 bg-black p-2">
          <span className="flex items-center gap-1 text-neutral-500">
            <BatteryCharging className="size-3.5" />
            Recharge cycles
          </span>
          <span className="font-mono text-neutral-100">{uav.rechargeCount ?? 0}</span>
        </div>
        <div className="border border-white/10 bg-black p-2">
          <span className="block text-neutral-500">Reserve RTB</span>
          <span className="font-mono text-neutral-100">{uav.forcedRtbCount ?? 0}</span>
        </div>
      </div>
      {uav.enduranceWarning ? (
        <div className="mt-2 border border-amber-300/25 bg-amber-400/10 p-2 text-xs text-amber-100">
          {uav.enduranceWarning}
        </div>
      ) : null}
      <div className="mt-2 border border-white/10 bg-black p-2">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>Battery level</span>
          <span className="font-mono text-neutral-100">
            {rechargeIndex > 0 ? "Charging" : `${Math.round(batteryPct)}%`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden bg-neutral-800">
          <span className={`block h-full ${batteryColor}`} style={{ width: `${batteryPct}%` }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="inline-flex items-center justify-center gap-1.5 border border-white/10 bg-black px-2 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/5">
          <Eye className="size-3.5" />
          Inspect Route
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 border border-red-400/50 bg-red-500/12 px-2 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!canTriggerLoss}
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
          disabled={!canRegainSignal}
          onClick={onRegainSignal}
        >
          <RadioTower className="size-3.5" />
          {lossDetectedAtS !== undefined && simTimeS >= lossDetectedAtS
            ? "Late Regain + Continue"
            : "Regain Signal + Continue"}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
        <ShieldAlert className="size-3.5" />
        Phase {snapshot.phase}; progress {Math.round(snapshot.progressPct)}%.
      </div>
    </section>
  );
}
