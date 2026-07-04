"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { formatMissionClock } from "@/lib/geometry";

type Props = {
  simTimeS: number;
  maxTimeS: number;
  isRunning: boolean;
  playbackRate: number;
  onTimeChange: (timeS: number) => void;
  onRunningChange: (running: boolean) => void;
  onPlaybackRateChange: (rate: number) => void;
  onResetTime: () => void;
};

const RATES = [1, 10, 30, 60, 120];

export function TimelineControls({
  simTimeS,
  maxTimeS,
  isRunning,
  playbackRate,
  onTimeChange,
  onRunningChange,
  onPlaybackRateChange,
  onResetTime,
}: Props) {
  return (
    <section className="border-t border-white/10 bg-black px-4 py-3 md:px-6">
      <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex size-10 items-center justify-center border border-white/15 bg-neutral-100 text-black transition hover:bg-white"
            onClick={() => onRunningChange(!isRunning)}
            aria-label={isRunning ? "Pause simulation" : "Run simulation"}
          >
            {isRunning ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            className="inline-flex size-10 items-center justify-center border border-white/10 bg-neutral-950 text-neutral-200 transition hover:border-white/25 hover:bg-white/5"
            onClick={onResetTime}
            aria-label="Restart timeline"
          >
            <RotateCcw className="size-4" />
          </button>
          <div className="min-w-28 border border-white/10 bg-neutral-950 px-3 py-2 font-mono text-lg text-neutral-100">
            {formatMissionClock(simTimeS)}
          </div>
        </div>
        <input
          className="h-2 w-full accent-neutral-200"
          min={0}
          max={Math.max(1, Math.round(maxTimeS))}
          type="range"
          value={Math.min(simTimeS, maxTimeS)}
          onChange={(event) => onTimeChange(Number(event.target.value))}
        />
        <div className="flex items-center gap-1 border border-white/10 bg-neutral-950 p-1">
          {RATES.map((rate) => (
            <button
              key={rate}
              className={`min-w-12 px-2 py-1.5 text-xs font-semibold transition ${
                playbackRate === rate
                  ? "bg-neutral-100 text-black"
                  : "text-neutral-300 hover:bg-white/5"
              }`}
              onClick={() => onPlaybackRateChange(rate)}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
