"use client";

import {
  Activity,
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
import type { MissionPlan } from "@/lib/types";

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
      </div>

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
                  style={{ backgroundColor: uav.status === "lost" ? "#ef4444" : uav.color }}
                />
                <span>
                  <span className="block text-sm font-semibold text-neutral-100">
                    {uav.label}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {getCurrentTask(uav, simTimeS)}
                  </span>
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
