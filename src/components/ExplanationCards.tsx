"use client";

import { useState } from "react";
import { Boxes, ChevronDown, GitBranch, MapPinned, Radio, Route } from "lucide-react";

const CARDS = [
  {
    title: "Mission contract",
    Icon: Boxes,
    text: "Mission contract: each UAV receives the same deterministic plan before launch: AOO geometry, strip tasks, altitude layer, return slot, contingency rules, and random seed. Cooperation is encoded before takeoff instead of depending on continuous command links.",
  },
  {
    title: "Deconfliction",
    Icon: Route,
    text: "Deconfliction: separation is enforced through altitude layers, spatial route corridors, holding points, and staggered return-to-base arrival slots. UAVs that finish early loiter before entering the return corridor.",
  },
  {
    title: "Vehicle loss",
    Icon: GitBranch,
    text: "Vehicle loss: remaining strips from the lost aircraft become coverage debt. Active UAVs absorb feasible debt using the same deterministic onboard reallocation rule. If endurance is insufficient, the system reports graceful degradation instead of hiding the gap.",
  },
  {
    title: "Pop-up NFZ",
    Icon: MapPinned,
    text: "Pop-up no-fly zone: the detecting UAV locally detours around the hazard. In exception-token mode, one sparse NFZ token is enough for all UAVs to recompute the same safe plan without a permanent datalink.",
  },
  {
    title: "Mission Planner",
    Icon: Radio,
    text: "Mission Planner path: OmniVis is not a replacement for Mission Planner. It is an upstream autonomy compiler that exports per-UAV waypoint files and mission metadata for operator review, upload, and simulation.",
  },
];

export function ExplanationCards() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border border-slate-800 bg-slate-900/72">
      <button
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:bg-slate-800/60"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="inline-flex items-center gap-2">
          <Boxes className="size-4 text-cyan-300" />
          Mission rationale cards
        </span>
        <ChevronDown
          className={`size-4 text-slate-500 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="grid gap-3 border-t border-slate-800 p-3 md:grid-cols-2 xl:grid-cols-5">
          {CARDS.map(({ title, Icon, text }) => (
            <article key={title} className="border border-slate-800 bg-slate-950/65 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Icon className="size-4 text-cyan-300" />
                {title}
              </div>
              <p className="text-xs leading-5 text-slate-400">{text}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
          Shared contract, geometry/timing separation, vehicle loss, NFZ token, and Mission Planner export notes are available here.
        </div>
      )}
    </section>
  );
}
