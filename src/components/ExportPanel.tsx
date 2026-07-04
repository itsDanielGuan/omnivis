"use client";

import { Download, FileArchive, FileJson } from "lucide-react";
import {
  buildMissionArtifacts,
  downloadArtifact,
  downloadMissionPackage,
} from "@/lib/exporters";
import type { MissionPlan } from "@/lib/types";

type Props = {
  plan: MissionPlan | null;
};

export function ExportPanel({ plan }: Props) {
  const artifacts = plan ? buildMissionArtifacts(plan) : [];

  return (
    <section className="border border-slate-800 bg-slate-900/72">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <FileArchive className="size-4 text-emerald-300" />
          Export Package
        </div>
        <button
          className="inline-flex items-center gap-1.5 border border-emerald-400/50 bg-emerald-400/10 px-2 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!plan}
          onClick={() => plan && downloadMissionPackage(plan)}
        >
          <Download className="size-3.5" />
          ZIP
        </button>
      </div>
      <div className="max-h-44 overflow-y-auto p-3">
        <div className="grid gap-2">
          {artifacts.map((artifact) => (
            <button
              key={artifact.name}
              className="flex items-center justify-between gap-3 border border-slate-800 bg-slate-950/70 px-2 py-2 text-left text-xs text-slate-300 transition hover:border-slate-600"
              onClick={() => downloadArtifact(artifact)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileJson className="size-3.5 shrink-0 text-slate-500" />
                <span className="truncate">{artifact.name}</span>
              </span>
              <Download className="size-3.5 shrink-0 text-slate-500" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
