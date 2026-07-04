"use client";

import {
  Activity,
  BatteryCharging,
  Clock,
  Gauge,
  Plane,
  Radio,
  Ruler,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { formatClock } from "@/lib/geometry";
import { getCurrentTask, getUavSnapshot } from "@/lib/simulator";
import type { MissionPlan, UavPlan } from "@/lib/types";

type Props = {
  plan: MissionPlan | null;
  simTimeS: number;
  selectedUavId?: string;
  onSelectUav: (uavId: string) => void;
};

function MetricCard({
  label,
  value,
  tone = "default",
  Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const toneClass = {
    default: "text-neutral-100",
    success: "text-neutral-100",
    warning: "text-amber-200",
    danger: "text-red-200",
  }[tone];
  return (
    <div className="border border-white/10 bg-black p-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500">
        <span>{label}</span>
        <Icon className="size-4 text-neutral-500" />
      </div>
      <div className={`font-mono text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function uavStatusTone(uav: UavPlan, simTimeS: number) {
  const communicationLostAtS = uav.communicationLostAtS;
  const lossDetectedAtS = uav.lossDetectedAtS ?? uav.lostAtS;
  if (
    uav.status === "lost" &&
    communicationLostAtS !== undefined &&
    lossDetectedAtS !== undefined &&
    simTimeS >= communicationLostAtS &&
    simTimeS < lossDetectedAtS
  ) {
    return "#f59e0b";
  }
  return uav.status === "lost" ? "#ef4444" : uav.color;
}

function UavStatusTimeline({ uav, simTimeS }: { uav: UavPlan; simTimeS: number }) {
  const routeEndS = Math.max(1, uav.originalRoute?.at(-1)?.t ?? uav.route.at(-1)?.t ?? 1);
  const communicationLostAtS = uav.communicationLostAtS;
  const lossDetectedAtS = uav.lossDetectedAtS ?? uav.lostAtS;
  const currentPct = clampPct((simTimeS / routeEndS) * 100);

  if (communicationLostAtS === undefined || lossDetectedAtS === undefined) {
    return (
      <div className="mt-1">
        <div className="h-1.5 w-full overflow-hidden bg-neutral-800">
          <span className="block h-full bg-sky-500" style={{ width: `${currentPct}%` }} />
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase text-neutral-600">
          Status {currentPct.toFixed(0)}%
        </div>
      </div>
    );
  }

  const nominalPct = clampPct((communicationLostAtS / routeEndS) * 100);
  const detectedPct = clampPct((lossDetectedAtS / routeEndS) * 100);
  const communicationPct = Math.max(0, detectedPct - nominalPct);
  const lostPct = Math.max(0, 100 - detectedPct);
  const nominalFillPct = Math.min(currentPct, nominalPct);
  const communicationFillPct = Math.min(Math.max(currentPct - nominalPct, 0), communicationPct);
  const lostFillPct = Math.min(Math.max(currentPct - detectedPct, 0), lostPct);

  return (
    <div className="mt-1">
      <div
        className="flex h-1.5 w-full overflow-hidden bg-neutral-800"
        title={`Nominal ${nominalPct.toFixed(0)}%, communication loss ${communicationPct.toFixed(0)}%, drone loss ${lostPct.toFixed(0)}%`}
      >
        {nominalFillPct > 0 ? (
          <span className="bg-sky-500" style={{ width: `${nominalFillPct}%` }} />
        ) : null}
        {communicationFillPct > 0 ? (
          <span className="bg-amber-500" style={{ width: `${communicationFillPct}%` }} />
        ) : null}
        {lostFillPct > 0 ? (
          <span className="bg-red-500" style={{ width: `${lostFillPct}%` }} />
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase text-neutral-600">
        <span>Nom {nominalFillPct.toFixed(0)}%</span>
        <span>Comms {communicationFillPct.toFixed(0)}%</span>
        <span>Lost {lostFillPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function batteryState(uav: UavPlan, plan: MissionPlan, simTimeS: number) {
  const route = uav.route;
  const routeEndS = route.at(-1)?.t ?? simTimeS;
  const boundedTimeS = Math.max(route[0]?.t ?? 0, Math.min(simTimeS, routeEndS));
  const enduranceS = Math.max(60, plan.config.enduranceMin * 60);
  const reservePct = clampPct((plan.config.batteryReserveMin / plan.config.enduranceMin) * 100);
  const rechargeIndex = route.findIndex((point, index) => {
    const previous = route[index - 1];
    return point.phase === "recharge" && previous && boundedTimeS >= previous.t && boundedTimeS < point.t;
  });

  if (rechargeIndex > 0) {
    const rechargeEnd = route[rechargeIndex];
    const rechargeStart = route[rechargeIndex - 1];
    const rechargeProgress =
      (boundedTimeS - rechargeStart.t) / Math.max(1, rechargeEnd.t - rechargeStart.t);
    return {
      pct: clampPct(reservePct + rechargeProgress * (100 - reservePct)),
      label: "Charging",
      colorClass: "bg-emerald-400",
    };
  }

  const sortieStartS =
    [...route]
      .reverse()
      .find(
        (point) =>
          point.t <= boundedTimeS && (point.phase === "preflight" || point.phase === "recharge"),
      )?.t ?? route[0]?.t ?? 0;
  const pct = clampPct(100 - ((boundedTimeS - sortieStartS) / enduranceS) * 100);
  const colorClass =
    pct <= reservePct + 5 ? "bg-red-500" : pct <= reservePct + 20 ? "bg-amber-500" : "bg-emerald-400";
  return {
    pct,
    label: `${Math.round(pct)}%`,
    colorClass,
  };
}

function BatteryBar({ uav, plan, simTimeS }: { uav: UavPlan; plan: MissionPlan; simTimeS: number }) {
  const battery = batteryState(uav, plan, simTimeS);
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase text-neutral-600">
        <span>Battery</span>
        <span>{battery.label}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden bg-neutral-800">
        <span className={`block h-full ${battery.colorClass}`} style={{ width: `${battery.pct}%` }} />
      </div>
    </div>
  );
}

export function MetricsPanel({ plan, simTimeS, selectedUavId, onSelectUav }: Props) {
  if (!plan) {
    return (
      <section className="shrink-0 border border-white/10 bg-neutral-950 p-4 text-sm text-neutral-400">
        Draw an area and compile a mission to populate metrics.
      </section>
    );
  }

  const { metrics } = plan;
  const coverageTone =
    metrics.coveragePct > 94 ? "success" : metrics.coveragePct > 82 ? "warning" : "danger";
  const separationTone =
    metrics.minSeparationM >= plan.config.minSeparationM ? "success" : "danger";

  return (
    <section className="flex shrink-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Coverage"
          value={`${metrics.coveragePct.toFixed(1)}%`}
          tone={coverageTone}
          Icon={Activity}
        />
        <MetricCard
          label="Mission time"
          value={formatClock(metrics.missionCompletionTimeS)}
          tone={metrics.feasible ? "success" : "warning"}
          Icon={Clock}
        />
        <MetricCard
          label="Min separation"
          value={`${Math.round(metrics.minSeparationM)}m`}
          tone={separationTone}
          Icon={Ruler}
        />
        <MetricCard
          label="Messages"
          value={String(metrics.messagesUsed)}
          tone={metrics.messagesUsed === 0 ? "success" : "warning"}
          Icon={Radio}
        />
        <MetricCard
          label="Utilization"
          value={`${metrics.averageUtilizationPct.toFixed(0)}%`}
          Icon={Gauge}
        />
        <MetricCard
          label="RTB spacing"
          value={`${metrics.rtbSpacingS}s`}
          tone="success"
          Icon={ShieldCheck}
        />
        <MetricCard
          label="Recharge"
          value={`${metrics.rechargeCycleCount}`}
          tone={metrics.enduranceWarningCount > 0 ? "warning" : "success"}
          Icon={BatteryCharging}
        />
        <MetricCard
          label="Forced RTB"
          value={`${metrics.forcedRtbCount}`}
          tone={metrics.forcedRtbCount > 0 ? "warning" : "success"}
          Icon={TriangleAlert}
        />
      </div>

      {metrics.enduranceWarningCount > 0 || metrics.coverageDebtStripCount > 0 ? (
        <div className="border border-amber-300/25 bg-amber-400/10 p-3 text-xs text-amber-100">
          {metrics.enduranceWarningCount > 0
            ? `${metrics.enduranceWarningCount} UAV route warning${metrics.enduranceWarningCount === 1 ? "" : "s"}: at least one strip cannot fit inside a fresh sortie plus RTB reserve.`
            : "Coverage debt remains after contingency replanning."}
        </div>
      ) : null}

      {metrics.before ? (
        <div className="border border-white/10 bg-black p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <TriangleAlert className="size-4" />
            Before / After
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-neutral-300">
            <span>Coverage</span>
            <span className="text-right font-mono">
              {metrics.before.coveragePct.toFixed(1)}% {"->"} {metrics.coveragePct.toFixed(1)}%
            </span>
            <span>Messages</span>
            <span className="text-right font-mono">
              {metrics.before.messagesUsed} {"->"} {metrics.messagesUsed}
            </span>
            <span>Coverage debt</span>
            <span className="text-right font-mono">
              {metrics.before.coverageDebtStripCount} {"->"} {metrics.coverageDebtStripCount}
            </span>
          </div>
        </div>
      ) : null}

      <div className="border border-white/10 bg-black">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
            <Plane className="size-4 text-neutral-300" />
            UAV Table
          </div>
          <span className="text-xs text-neutral-500">
            {metrics.completedStrips}/{metrics.totalStrips} strips viable
          </span>
        </div>
        <div className="divide-y divide-white/10">
          {plan.uavs.map((uav) => {
            const snapshot = getUavSnapshot(uav, simTimeS);
            const selected = uav.id === selectedUavId;
            return (
              <button
                key={uav.id}
                className={`grid w-full grid-cols-[auto_1fr_auto] gap-2 px-3 py-2 text-left transition ${
                  selected ? "bg-white/10" : "hover:bg-white/5"
                }`}
                onClick={() => onSelectUav(uav.id)}
              >
                <span
                  className="mt-1 size-2.5"
                  style={{ backgroundColor: uavStatusTone(uav, simTimeS) }}
                />
                <span>
                  <span className="block text-sm font-semibold text-neutral-100">
                    {uav.label}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {getCurrentTask(uav, simTimeS)}
                  </span>
                  {uav.rechargeCount || uav.forcedRtbCount || uav.enduranceWarning ? (
                    <span className="mt-0.5 block truncate text-[11px] text-amber-300/90">
                      {uav.enduranceWarning ??
                        `${uav.rechargeCount ?? 0} recharge / ${uav.forcedRtbCount ?? 0} reserve RTB`}
                    </span>
                  ) : null}
                  <UavStatusTimeline uav={uav} simTimeS={simTimeS} />
                  <BatteryBar uav={uav} plan={plan} simTimeS={simTimeS} />
                </span>
                <span className="text-right font-mono text-xs text-neutral-300">
                  {Math.round(snapshot.progressPct)}%
                  <span className="block text-neutral-500">{uav.altitudeM}m</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
