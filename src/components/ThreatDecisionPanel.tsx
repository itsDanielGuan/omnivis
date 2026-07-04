"use client";

import { useState } from "react";
import { Crosshair, Radar, ShieldAlert, Timer } from "lucide-react";
import { STRIKE_DEFAULTS } from "@/lib/threats";
import type { StrikeType, Threat } from "@/lib/types";

type Props = {
  threat: Threat;
  strikeBaseLabel: string;
  onLoiter: () => void;
  onStrike: (strikeType: StrikeType, droneCount: number) => void;
};

const KIND_LABEL: Record<Threat["kind"], string> = {
  merchant: "Merchant / friendly",
  small: "Small enemy vehicle",
  large: "Large enemy threat",
};

export function ThreatDecisionPanel({ threat, strikeBaseLabel, onLoiter, onStrike }: Props) {
  const defaults = STRIKE_DEFAULTS[threat.kind];
  const [strikeType, setStrikeType] = useState<StrikeType>(defaults.type);
  const [droneCount, setDroneCount] = useState(defaults.count);

  return (
    <section className="shrink-0 border border-red-400/40 bg-red-500/10 p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert className="size-4 text-red-300" />
        <h2 className="text-sm font-semibold text-red-100">Hostile contact — decision required</h2>
      </div>
      <p className="mb-3 text-xs text-red-100/80">
        {KIND_LABEL[threat.kind]} confirmed by the second drone. Choose an action; continuing the
        simulation without choosing defaults to loiter.
      </p>

      <button
        className="mb-3 flex w-full items-center justify-center gap-2 border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20"
        onClick={onLoiter}
      >
        <Timer className="size-3.5" />
        Loiter &amp; hold, then clear as friendly
      </button>

      <div className="border border-white/10 bg-black p-2">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-100">
          <Crosshair className="size-3.5 text-red-300" />
          Initiate strike
        </div>

        <div className="mb-2 grid grid-cols-2 gap-1">
          {(["continuous", "saturation"] as StrikeType[]).map((type) => (
            <button
              key={type}
              className={`border px-2 py-1.5 text-[11px] font-semibold capitalize transition ${
                strikeType === type
                  ? "border-red-400/60 bg-red-500/20 text-red-100"
                  : "border-white/10 bg-neutral-950 text-neutral-300 hover:bg-white/5"
              }`}
              onClick={() => setStrikeType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <label className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
          <span className="flex items-center gap-1">
            <Radar className="size-3" />
            Strike drones
          </span>
          <span className="font-mono text-neutral-100">{droneCount}</span>
        </label>
        <input
          className="mb-2 h-1.5 w-full accent-red-400"
          type="range"
          min={defaults.min}
          max={defaults.max}
          value={droneCount}
          onChange={(event) => setDroneCount(Number(event.target.value))}
        />

        <div className="mb-2 text-[10px] text-neutral-500">
          Launch from strike base: <span className="text-neutral-300">{strikeBaseLabel}</span>.{" "}
          {strikeType === "saturation"
            ? "Drones surround the target, then strike simultaneously."
            : "Drones are sent at the target one at a time."}
        </div>

        <button
          className="flex w-full items-center justify-center gap-2 border border-red-400/60 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/30"
          onClick={() => onStrike(strikeType, droneCount)}
        >
          <Crosshair className="size-3.5" />
          Launch {droneCount}-drone {strikeType} strike
        </button>
      </div>
    </section>
  );
}
