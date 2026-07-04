"use client";

import { ScrollText } from "lucide-react";
import { formatMissionClock } from "@/lib/geometry";
import type { MissionEvent, MissionMessage, MissionPlan } from "@/lib/types";

type Props = {
  plan: MissionPlan | null;
  simTimeS: number;
};

function toneForSeverity(severity: MissionEvent["severity"]) {
  return {
    info: "text-neutral-200",
    success: "text-emerald-200",
    warning: "text-amber-200",
    danger: "text-red-200",
  }[severity];
}

function messageToEvent(message: MissionMessage): MissionEvent {
  return {
    id: message.id,
    timeS: message.timeS,
    severity:
      message.type === "HEALTH_MISS"
        ? "danger"
        : message.type.includes("NFZ") || message.type.includes("REDISTRIBUTE")
          ? "warning"
          : "info",
    text: message.countInMission
      ? `${message.text} (${message.type})`
      : `${message.text} (prelaunch)`,
    uavId: message.sourceId,
  };
}

export function TacticalEventFeed({ plan, simTimeS }: Props) {
  const events = plan
    ? [...plan.events, ...plan.messages.map(messageToEvent)]
        .filter((event) => event.timeS <= simTimeS + 20)
        .sort((a, b) => b.timeS - a.timeS)
        .slice(0, 18)
    : [];

  return (
    <section className="shrink-0 border border-white/10 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
          <ScrollText className="size-4 text-neutral-300" />
          Tactical Event Feed
        </div>
        <span className="font-mono text-xs text-neutral-500">
          {formatMissionClock(simTimeS)}
        </span>
      </div>
      <div className="max-h-52 space-y-2 overflow-y-auto p-3 text-xs">
        {events.length === 0 ? (
          <p className="text-neutral-500">Events appear as the mission clock advances.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="grid grid-cols-[4.5rem_1fr] gap-2">
              <span className="font-mono text-neutral-500">
                {formatMissionClock(event.timeS)}
              </span>
              <span className={toneForSeverity(event.severity)}>{event.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
