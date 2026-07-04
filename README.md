# OmniVis Mission Compiler

OmniVis is a web-based mission compiler and 2D simulator for radio-minimal cooperative maritime coverage by 3-5 fixed-wing UAVs.

It demonstrates:

- A shared pre-mission contract instead of continuous datalink control
- Dark tactical real-map visualization using a local simplified maritime GeoJSON basemap
- RTS-style command controls and selectable UAV unit cards
- Coverage strip generation over a maritime Area of Operations
- Sector allocation across multiple UAVs
- Base-drone and drone-drone communication blips for sparse message events
- Geometry/timing deconfliction with altitude layers and staggered RTB slots
- Vehicle-loss contingency handling with replacement dispatch or swarm redistribution
- Pop-up no-fly-zone replanning with dashed original routes and solid detours
- Mission Planner-compatible export artifacts, including QGC WPL 110-style waypoint files

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Demo flow

1. Generate mission.
2. Run the simulation.
3. Select a UAV and trigger UAV loss.
4. Switch between replacement dispatch and spread remaining swarm.
5. Add a pop-up NFZ.
6. Review before/after metrics and the tactical event feed.
7. Export the mission package.
8. Use the Mission Planner panel as the placeholder for the recorded import demo.

OmniVis is not a replacement for Mission Planner. It is an upstream autonomy compiler that exports per-UAV waypoint files and mission metadata for operator review, upload, and simulation.
