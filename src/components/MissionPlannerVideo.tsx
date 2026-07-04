"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";

export function MissionPlannerVideo() {
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/mission-planner-export-demo.mp4", { method: "HEAD" })
      .then((response) => {
        if (active) setShowVideo(response.ok);
      })
      .catch(() => {
        if (active) setShowVideo(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="border border-slate-800 bg-slate-900/72">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-sm font-semibold text-slate-200">
        <Clapperboard className="size-4 text-cyan-300" />
        Mission Planner export path
      </div>
      <div className="p-3">
        {showVideo ? (
          <video
            controls
            className="w-full border border-slate-700"
            onError={() => setShowVideo(false)}
          >
            <source src="/mission-planner-export-demo.mp4" type="video/mp4" />
          </video>
        ) : (
          <div className="border border-dashed border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-400">
            <p className="font-medium text-slate-200">
              Mission Planner export demo video placeholder
            </p>
            <p className="mt-2 text-xs leading-5">
              Record: Export Mission Package {"->"} open Mission Planner {"->"} Flight Plan {"->"} Load WP File {"->"} select uav_1.waypoints.
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              OmniVis exports per-aircraft waypoint files and mission metadata. The video demonstrates one exported UAV mission being imported for operator review.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
