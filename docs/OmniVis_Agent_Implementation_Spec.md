# OmniVis Mission Compiler - Agent Implementation Spec

## 0. Purpose of this file

This is a single-file implementation brief for an autonomous coding agent. Build a hosted web app for the Mantavia AB challenge:

**Drone swarming for cooperative maritime area coverage**

The final deliverable is a polished **Next.js + Tailwind web app** that showcases a 2D mission-planning and simulation environment for 3-5 fixed-wing UAVs cooperatively covering a maritime Area of Operations. The app must demonstrate cooperative autonomy without relying on a permanent datalink, contingency handling, return-to-base deconfliction, and export artifacts compatible with a Mission Planner workflow.

The team will also show **one recorded video** of an exported mission file being loaded into Mission Planner. The web app itself does not need live Mission Planner integration.

---

## 1. Product name and positioning

### Name

**OmniVis Mission Compiler**

### Subtitle

**Radio-minimal cooperative maritime coverage for fixed-wing UAV teams**

### One-sentence pitch

OmniVis turns a maritime Area of Operations into deconflicted, contingency-aware UAV mission packages that preserve swarm cooperation even when the datalink is absent or intentionally silent.

### Core story

Mainstream ground-control software can upload and monitor multiple UAV missions, but it does not natively encode cooperation if a permanent datalink is unavailable. OmniVis acts as an upstream autonomy layer: it compiles a shared mission contract into per-UAV route plans, sector assignments, timing windows, altitude layers, return corridors, contingency rules, and exportable mission files.

---

## 2. Challenge alignment

The app must visibly map to the Mantavia statement.

| Challenge requirement | App feature |
|---|---|
| 3-5 fixed-wing UAVs | Configurable UAV count from 3 to 5; fixed speed, endurance, minimum turn radius, altitude layers. |
| Cooperative maritime Area of Operations coverage | AOO polygon, coverage strips, sector assignment, moving UAVs, coverage metric. |
| Partition into sectors | Colored strip/sector assignment per UAV. |
| Maximize sensor coverage | Sensor swath width, grid-based coverage calculation, percentage covered. |
| Return to base | Base marker, return corridors, loiter/hold points, return-to-base timeline. |
| Deconflicted arrival windows | Staggered RTB arrival slots and displayed arrival schedule. |
| Separation guaranteed by geometry and timing | Altitude layers, route corridors, sampled pairwise separation, slot schedule. |
| No permanent datalink | Mission contract and deterministic onboard logic; normal mission uses zero messages. |
| Loss of vehicle | Button to simulate UAV loss; uncovered task debt and reallocation. |
| Pop-up no-fly zone known to one vehicle | Click to add NFZ; affected path detours; optional one-message exception token. |
| Little/no transmission rewarded | Comms counter: 0 normal messages, sparse exception tokens only. |
| Mission Planner relevance | Export per-UAV waypoint files, mission_contract.json, contingency_policy.json, simulation_trace.json; include embedded video of Mission Planner import. |

---

## 3. Scope

### Must build

1. Next.js web app deployable to Vercel.
2. Tailwind-styled UI.
3. Fully client-side 2D planner and simulator.
4. Mission setup panel.
5. 2D real-map simulation visualization using MapLibre GL JS with a fully customizable local GeoJSON basemap by default and optional PMTiles support.
6. Dark tactical/RTS-style interface by default.
7. Communication blips for drone-drone and base-drone interactions.
8. Generate coverage strips inside an AOO polygon.
9. Assign strips to 3-5 UAVs.
10. Display per-UAV colored routes and sectors.
11. Animate UAV movement over mission time.
12. Compute and display metrics:
   - coverage percentage
   - mission completion time
   - minimum sampled separation
   - UAV utilization
   - number of messages used
   - number of strips assigned/completed
   - RTB arrival spacing
13. Simulate UAV loss.
14. Let operators choose the UAV-loss response mode: dispatch a replacement UAV or redistribute all remaining UAVs.
15. Simulate the replacement UAV moving from base/reserve staging to the lost UAV's coverage area.
16. Simulate pop-up no-fly zone.
17. Show before/after metrics for contingencies.
18. Export mission artifacts as downloadable files.
19. Include an embedded panel for a Mission Planner export/import demo video.

### Should build if time permits

1. Time slider with play/pause and speed multiplier.
2. Click-to-place circular NFZ.
3. Select UAV to fail.
4. Select loss response mode: `Dispatch replacement` or `Spread remaining swarm`.
5. Show ghost preview of replacement route or redistribution sectors before applying.
6. Deterministic seed display.
7. Download all mission artifacts as a zip.
8. RTB timeline chart.
9. Export QGC WPL 110 `.waypoints` files for Mission Planner/QGroundControl-style import.
10. Dashed original path vs solid replanned path after NFZ.
11. Coverage heatmap/grid overlay.

### Do not build

1. Live drone control.
2. Live MAVLink connection.
3. Real RF communication.
4. AirSDK/Sphinx integration.
5. Full 3D physics.
6. Real maritime charts.
7. Complex Dubins solver unless trivial to add.
8. Mission Planner plugin.

---

## 4. Recommended stack

Use a single Next.js app with all logic in TypeScript.

### Framework

- Next.js, App Router.
- TypeScript.
- Tailwind CSS.
- Hosted on Vercel.

### Suggested packages

Use minimal dependencies to reduce risk.

Required/recommended:

```bash
npm install lucide-react clsx tailwind-merge jszip file-saver maplibre-gl
```

Optional:

```bash
npm install zustand pmtiles
```

Use `pmtiles` only if implementing the optional offline/self-hosted vector-tile path. The MVP should not depend on any online map-tile service to run.

### Map and rendering choice

Use **MapLibre GL JS as the mandatory and only primary map renderer** for the main simulation view. The app should feel like a dark tactical real-time strategy command map, not a generic chart. All tactical objects must live in MapLibre sources/layers so they pan, zoom, and scale with the basemap without drifting.

#### Basemap strategy

The MVP should run without downloading live map-tile grids from the internet. Implement the map in this priority order:

1. **Default MVP path: MapLibre + local simplified GeoJSON basemap**
   - Store simplified maritime land/coastline/water/port-place geometry in `/public/maps/*.geojson`.
   - Render those local GeoJSON files as MapLibre sources/layers.
   - This gives full visual customization, reliable offline demos, no tile-service dependency, and exact alignment with mission overlays.

2. **Optional polished path: MapLibre + local or self-hosted PMTiles**
   - Support a local `.pmtiles` file in `/public/maps/region.pmtiles` or a static hosted file.
   - Use the `pmtiles` package and MapLibre protocol registration only if the file is available.
   - Use PMTiles for an OSM-derived vector-tile basemap that can be styled layer-by-layer.

3. **Last-resort development fallback only: remote raster/vector tiles**
   - Do not make the final demo depend on remote tiles.
   - If remote OSM tiles are temporarily used during development, keep all mission geometry in MapLibre GeoJSON layers and include the correct attribution.

#### Visual map requirements

- Default to a simplified dark maritime style: deep water background, muted landmass, thin coastline, sparse place labels, and only essential boundaries.
- Hide or heavily mute POIs, buildings, minor roads, shop labels, transit details, and non-mission clutter.
- Keep the map in dark mode by default.
- Keep map pitch at `0` and bearing at `0` unless alignment is fully tested.
- Always show required attribution for any OSM-derived or third-party basemap data.

#### Mission-layer rendering requirements

- Draw AOO polygons, coverage strips, UAV routes, NFZs, base, UAV markers, return corridors, sensor footprints, and communication blips as MapLibre `GeoJSONSource` + `Layer` objects wherever possible.
- Avoid a detached SVG overlay on top of the map unless it is fully synchronized with `map.project()` on every move/zoom frame.
- Do not store independent pixel coordinates for mission objects. Store mission state in local meters and/or WGS84 coordinates, then derive map geometry from that state.
- Do not use CSS transforms to scale mission overlays separately from the map. This causes drift.
- On panel resize or layout changes, call `map.resize()`.
- Use `fitBounds()` around the AOO and base after mission generation.

#### Hard alignment rule

There must be exactly one conversion pipeline for map geometry:

```text
local mission meters -> WGS84 lon/lat -> GeoJSON -> MapLibre source/layer
```

Do not mix screen pixels, SVG viewBoxes, canvas coordinates, and MapLibre coordinates for the same feature. Communication blips, sensor footprints, UAV positions, AOO outlines, NFZ circles, routes, and coverage strips must all use the same MapLibre geospatial pipeline.

Fallback rule:

If vector tiles or PMTiles are not available during development, use the local simplified GeoJSON basemap. Do not go back to a standalone SVG as the primary demo unless MapLibre setup completely fails.

---

## 5. User experience

### Layout

Use a 3-panel dashboard layout.

```text
+--------------------------------------------------------------------------------+
| Header: OmniVis Mission Compiler                                           |
+--------------------------+-----------------------------------+-----------------+
| Left mission controls    | Main 2D simulation viewport        | Metrics panel   |
|                          |                                   |                 |
| UAV count                | AOO polygon                        | Coverage %      |
| swath                    | base                               | Mission time    |
| speed                    | colored UAV routes                 | Min separation  |
| endurance                | coverage strips                    | Messages used   |
| separation               | moving UAV icons                   | RTB schedule    |
| comms mode               | NFZ                                | UAV table       |
| buttons                  | dashed/solid replan paths          |                 |
+--------------------------+-----------------------------------+-----------------+
| Bottom: timeline, export panel, Mission Planner video panel                    |
+--------------------------------------------------------------------------------+
```

### Header copy

Title:

```text
OmniVis Mission Compiler
```

Subtitle:

```text
A radio-minimal autonomy layer for cooperative maritime coverage by 3-5 fixed-wing UAVs.
```

### Primary buttons

1. `Generate Mission`
2. `Run Simulation`
3. `Pause`
4. `Reset`
5. `Simulate UAV Loss`
6. `Dispatch Replacement` / `Spread Remaining Swarm` toggle in the loss panel
7. `Add Pop-up NFZ`
8. `Export Mission Package`

### Demo modes

Include a segmented control or dropdown:

1. `Normal mission`
2. `Vehicle loss - replacement dispatch`
3. `Vehicle loss - swarm redistribution`
4. `Pop-up NFZ contingency`
5. `RTB deconfliction`

### RTS-style interaction model

The controls should feel like a polished real-time strategy game command interface, adapted to a UAV mission-planning context.

Design intent:

```text
The user is not filling out a form; they are commanding a small autonomous air team from a tactical mission console.
```

Required RTS-inspired behaviors:

1. **Selectable units**
   - Clicking a UAV selects it.
   - The selected UAV gets a glowing ring/outline and a unit card.
   - The unit card shows state, altitude layer, assigned strips, progress, endurance remaining, RTB slot, and current task.

2. **Command deck**
   - The left panel should look like a tactical command deck with grouped controls, not a plain form.
   - Use compact labels, badges, toggles, sliders, and command buttons.
   - Primary command buttons should have clear states: armed, active, disabled, or completed.

3. **Context actions**
   - When a UAV is selected, expose actions such as:
     - `Inspect Route`
     - `Trigger Loss Here`
     - `Dispatch Replacement Preview`
     - `Spread Swarm Preview`
     - `Force RTB Preview`
     - `Send Health Ping` in exception-token mode
     - `Show Assigned Sector`
   - These actions are simulation controls only; they do not imply live drone command.

4. **Mission timeline as game clock**
   - Show mission time prominently, e.g. `T+18:42`.
   - Include play, pause, restart, and speed controls.
   - Use speed options like `1x`, `10x`, `30x`, `60x`, `120x`.

5. **Tactical event feed**
   - Add a scrolling event feed similar to an RTS battle log.
   - Example events:
     - `T+00:00 Mission contract loaded to all UAVs`
     - `T+04:20 UAV_2 entered coverage strip S_12`
     - `T+14:00 UAV_3 missed health epoch`
     - `T+14:15 Coverage debt reassigned to UAV_1 and UAV_4`
     - `T+14:18 Replacement UAV_R1 launched from base to absorb UAV_3 sector`
     - `T+14:20 Remaining UAVs spread into new deterministic sectors`
     - `T+19:40 UAV_2 emitted NFZ exception token`
     - `T+42:00 UAV_1 entered RTB slot`

6. **Minimap / overview inset**
   - If time permits, add a small minimap showing AOO bounds, UAV dots, base, and NFZ.
   - This can be a simplified MapLibre inset or a small canvas/SVG derived from local coordinates.

7. **Hotkeys if easy**
   - `Space`: play/pause
   - `R`: reset simulation
   - `L`: simulate selected UAV loss
   - `N`: enter NFZ placement mode
   - `E`: export package

### Dark tactical visual style

The app must default to dark mode.

Visual direction:

- Background: deep navy/charcoal.
- Map: simplified dark maritime basemap.
- Water: dark blue/black.
- Land: muted slate/charcoal.
- Coastline: subtle thin line.
- Routes: high-contrast colored lines per UAV.
- Planned route: lower opacity.
- Active/current route segment: bright and thicker.
- Original route after replanning: dashed and muted.
- Replanned route: solid and bright.
- NFZ: red translucent circle/polygon with sharp outline.
- Base: command node icon with pulsing ring.
- UAV: small triangular fixed-wing marker oriented along track direction.
- Sensor footprint: translucent cone/circle, not too visually noisy.
- Text labels: minimal, readable, and military/tactical in tone.

Do not support light mode unless there is extra time. The default and judged demo should be dark.

### Communication blips and interaction visualization

The simulator must visibly show when a drone communicates with another drone or with the base.

Required behavior:

- When a `MissionMessage` occurs at the current simulation time, draw a quick animated line between the source and target.
- The line should appear as a short glowing blip/pulse and fade out within roughly `0.6s-1.2s` real time.
- For broadcast messages, draw a pulse from the source to all relevant UAVs, or a circular expanding ring from the source.
- For base-to-UAV messages, draw the pulse from the base marker to the UAV marker.
- For UAV-to-UAV messages, draw the pulse between UAV markers.
- For UAV-to-base health reports, draw the pulse from UAV to base.
- Also add the event to the tactical event feed and increment the message counter.

Important presentation rule:

```text
In nominal execution, there should be no communication blips except the initial mission-load visualization if shown before takeoff. This reinforces that cooperation is precompiled rather than continuously coordinated.
```

Recommended demo blip events:

1. `MISSION_LOAD`: base to all UAVs at `T-00:05` or `T+00:00`; optional and should not count as in-mission datalink dependency.
2. `HEALTH_EPOCH`: sparse health check in exception-token mode; base or peer-to-peer blip.
3. `HEALTH_MISS`: triggered when UAV loss is detected; show the health-check line fail or fade red.
4. `COVERAGE_DEBT_ASSIGN`: optional blip from base or deterministic local event marker; only if comms mode permits.
5. `REPLACEMENT_DISPATCH`: base to replacement UAV pulse, followed by a route highlight from base to the uncovered sector.
6. `SWARM_REDISTRIBUTE`: broadcast-style pulse or local deterministic event marker showing remaining UAVs spreading into new sectors.
7. `NFZ_EXCEPTION_TOKEN`: from detecting UAV to other UAVs; one strong pulse.
6. `RTB_SLOT_SYNC`: optional pre-mission scheduled marker; should be shown as precompiled timing rather than live communication.

Strict silent mode:

- Do not show live communication blips after launch.
- Instead, show local onboard logic effects as small onboard flashes/rings around the affected UAV.
- Event feed wording should say `precompiled branch activated` instead of `message sent`.

---

## 6. Mission setup controls

Build these controls in the left panel.

### Inputs

| Input | Type | Default | Notes |
|---|---|---:|---|
| UAV count | slider/dropdown | 4 | min 3, max 5 |
| Sensor swath width | slider | 180 m | range 80-350 m |
| UAV speed | slider | 22 m/s | fixed-wing cruise speed |
| Endurance | slider | 55 min | mission feasibility check |
| Minimum horizontal separation | slider | 250 m | show warning if violated |
| Altitude layer spacing | slider | 30 m | used for geometric separation |
| Base latitude | number | 45.0000 | used for export only |
| Base longitude | number | 12.0000 | used for export and map anchoring |
| Map preset / theater | dropdown | Singapore Strait Demo | controls OSM map center and default AOO |
| Basemap style URL | env/config | OSM-derived dark style | use `NEXT_PUBLIC_MAP_STYLE_URL` when available |
| Base local X/Y | fixed or draggable | near lower-left | simulation coordinate base |
| Turn radius | slider | 90 m | used as fixed-wing constraint label and optional turn smoothing |
| Strip angle | slider | 15 degrees | orientation of coverage sweeps |
| Overlap ratio | slider | 15% | strip spacing = swath * (1-overlap) |
| Comms policy | dropdown | Radio silent + exception tokens | affects contingency behavior |
| Random seed | number/text | 7429 | displayed and used deterministic assignment |

### Preset AOO selector

Provide at least 3 preset maritime AOOs:

1. `Rectangular Search Box`
2. `Irregular Coastal Patrol Zone`
3. `Long Maritime Corridor`

Each preset is a local XY polygon in meters.

Example polygons:

```ts
const PRESETS = {
  rectangular: [
    { x: 0, y: 0 },
    { x: 5200, y: 0 },
    { x: 5200, y: 3200 },
    { x: 0, y: 3200 },
  ],
  irregular: [
    { x: 200, y: 200 },
    { x: 5100, y: 0 },
    { x: 5600, y: 1800 },
    { x: 4300, y: 3400 },
    { x: 1400, y: 3600 },
    { x: -200, y: 1800 },
  ],
  corridor: [
    { x: 0, y: 500 },
    { x: 7000, y: 0 },
    { x: 7600, y: 1200 },
    { x: 900, y: 2100 },
  ],
};
```

### Real-map presets

The app should include real-map maritime presets in addition to local XY polygons. Each preset should define:

```ts
type MapPreset = {
  id: string;
  label: string;
  baseLat: number;
  baseLon: number;
  mapCenter: { lat: number; lon: number };
  mapZoom: number;
  aooPolygonM: Point[];
  baseM: Point;
};
```

Recommended presets:

1. `Singapore Strait Demo`
   - Good default for a maritime/coastal demo.
   - Use local XY geometry anchored around a Singapore Strait base lat/lon.
2. `Baltic Coastal Patrol`
   - Shows irregular coastlines and maritime patrol context.
3. `Open Sea Search Box`
   - Mostly water, useful for clean coverage-strip visualization.

Coordinate rule:

- The planning engine may operate in local meters for simplicity.
- The map display must convert every local meter point to WGS84 lon/lat relative to `baseLat/baseLon` before rendering in MapLibre.
- The export module should use the same conversion so the displayed route and exported waypoints match closely.

### Local MapLibre basemap assets

Create a small local basemap asset set so the demo works on Vercel without relying on live map tiles. Keep the data lightweight and maritime-focused.

Recommended files:

```text
/public/maps/singapore-strait-land.geojson
/public/maps/singapore-strait-coastline.geojson
/public/maps/singapore-strait-labels.geojson
/public/maps/baltic-coastal-land.geojson
/public/maps/baltic-coastal-coastline.geojson
/public/maps/open-sea-reference.geojson
```

The local basemap only needs to be visually plausible and geographically anchored. It does not need dense road/POI detail. It should intentionally look simplified, like a tactical naval command map.

Optional PMTiles files may be added later:

```text
/public/maps/singapore-strait.pmtiles
/public/maps/baltic-coastal.pmtiles
```

If a PMTiles file is missing, automatically fall back to the local GeoJSON basemap for that preset.

---

## 7. Core concepts to implement

### 7.1 Mission contract

The app must generate a `mission_contract.json` object representing the shared pre-mission plan every UAV receives.

Concept:

```json
{
  "mission_id": "omnivis_demo_001",
  "mission_epoch": 7,
  "seed": 7429,
  "aao_polygon_m": [[0,0],[5200,0],[5200,3200],[0,3200]],
  "base_m": [300, -500],
  "num_uavs": 4,
  "sensor_swath_m": 180,
  "overlap_ratio": 0.15,
  "speed_mps": 22,
  "endurance_min": 55,
  "min_separation_m": 250,
  "turn_radius_m": 90,
  "altitude_layers_m": {
    "UAV_1": 120,
    "UAV_2": 150,
    "UAV_3": 180,
    "UAV_4": 210
  },
  "rtb_arrival_slots_s": {
    "UAV_1": 0,
    "UAV_2": 90,
    "UAV_3": 180,
    "UAV_4": 270
  },
  "comms_policy": "radio_silent_except_contingency_token",
  "contingency_rules": [
    "loss_of_vehicle_reallocate_coverage_debt",
    "pop_up_nfz_local_detour_or_exception_token",
    "return_slots_are_preserved_by_loiter_if_early"
  ]
}
```

### 7.2 Radio-minimal autonomy principle

Normal mission:

```text
Messages used: 0
```

Contingency mission:

```text
Messages used: 0 in strict silent mode, or 1 sparse exception token for NFZ broadcast.
```

The UI must explicitly state:

```text
Cooperation is compiled into the pre-mission contract. A permanent datalink is not required for nominal execution.
```

### 7.3 Exception token

When NFZ mode uses communication, generate and display an example token:

```json
{
  "type": "NFZ",
  "source": "UAV_2",
  "center_cell": [42, 17],
  "radius_cells": 3,
  "valid_until_s": 4200,
  "confidence": 0.91,
  "mission_epoch": 7,
  "signature": "demo-signature"
}
```

In the app this can be shown in a small code block/card.

### 7.4 Communication event visualization model

Every simulated communication should be represented as both data and animation.

Create helper functions:

```ts
export function createMissionMessage(args: Partial<MissionMessage>): MissionMessage;
export function getMessageEndpoints(message: MissionMessage, plan: MissionPlan, simTimeS: number): { source: Point; targets: Point[] };
export function getActiveCommsBlips(messages: MissionMessage[], plan: MissionPlan, simTimeS: number, nowMs: number): ActiveCommsBlip[];
```

Rules:

- A message should appear in the event feed at its scheduled mission time.
- A message should create a short visual blip only if it has a physical source and target.
- `countsTowardCommsMetric` must be `false` for pre-launch mission loading and `true` for in-mission health checks, exception tokens, or contingency messages.
- The `messagesUsed` metric should count only messages where `countsTowardCommsMetric === true`.
- In strict silent mode, do not create in-mission `HEALTH_EPOCH`, `HEALTH_REPORT`, or `NFZ_EXCEPTION_TOKEN` messages. Use local `MISSION_EVENT` entries instead.

Example health ping:

```json
{
  "type": "HEALTH_REPORT",
  "sourceType": "uav",
  "sourceId": "UAV_2",
  "targetType": "base",
  "targetIds": ["BASE"],
  "countsTowardCommsMetric": true,
  "payload": { "battery_class": "green", "epoch": 3 }
}
```

---

## 8. Data model

Create `lib/types.ts`.

```ts
export type Point = {
  x: number; // local east-west meters relative to base/local origin
  y: number; // local north-south meters relative to base/local origin
};

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type Segment = {
  id: string;
  start: Point;
  end: Point;
  lengthM: number;
  stripIndex: number;
  assignedUavId?: string;
  status?: "planned" | "completed" | "coverage_debt" | "blocked_by_nfz";
};

export type UAV = {
  id: string;
  label: string;
  colorClass: string;
  altitudeM: number;
  speedMps: number;
  enduranceS: number;
  turnRadiusM: number;
  assignedSegments: Segment[];
  route: TimedRoutePoint[];
  originalRoute?: TimedRoutePoint[];
  state: "idle" | "reserve" | "transit" | "covering" | "detour" | "loiter" | "returning" | "landed" | "lost";
  role?: "primary" | "replacement";
  replacedUavId?: string;
  launchedAtS?: number;
  failedAtS?: number;
  rtbArrivalSlotS: number;
};

export type TimedRoutePoint = {
  t: number;
  point: Point;
  phase: "takeoff" | "transit" | "covering" | "detour" | "loiter" | "return" | "landed";
  segmentId?: string;
};

export type MissionConfig = {
  presetId: string;
  aooPolygon: Point[];
  base: Point;
  baseLat: number;
  baseLon: number;
  mapStyleUrl?: string;
  mapCenter?: GeoPoint;
  mapZoom?: number;
  uavCount: number;
  sensorSwathM: number;
  overlapRatio: number;
  speedMps: number;
  enduranceMin: number;
  minSeparationM: number;
  altitudeLayerStartM: number;
  altitudeLayerSpacingM: number;
  turnRadiusM: number;
  stripAngleDeg: number;
  rtbSlotSpacingS: number;
  commsPolicy: "strict_silent" | "radio_silent_except_tokens";
  vehicleLossResponseMode: "dispatch_replacement" | "spread_remaining_swarm";
  replacementUavEnabled: boolean;
  replacementLaunchDelayS: number;
  seed: number;
};

export type NoFlyZone = {
  id: string;
  center: Point;
  radiusM: number;
  detectedByUavId?: string;
  createdAtS: number;
};

export type MissionPlan = {
  config: MissionConfig;
  missionId: string;
  missionEpoch: number;
  strips: Segment[];
  uavs: UAV[];
  noFlyZones: NoFlyZone[];
  metrics: MissionMetrics;
  messages: MissionMessage[];
};

export type MissionMetrics = {
  coveragePct: number;
  coveredAreaApproxM2: number;
  totalAooAreaM2: number;
  missionCompletionTimeS: number;
  minSampledHorizontalSeparationM: number;
  minSampled3DSeparationM: number;
  messagesUsed: number;
  totalStripCount: number;
  completedStripCount: number;
  coverageDebtStripCount: number;
  blockedStripCount: number;
  replacementTravelTimeS?: number;
  replacementAbsorbedStripCount?: number;
  redistributionTouchedUavCount?: number;
  averageUavUtilizationPct: number;
  rtbSlotSpacingS: number;
  feasibleWithinEndurance: boolean;
};

export type MissionMessage = {
  id: string;
  t: number;
  type:
    | "MISSION_LOAD"
    | "HEALTH_EPOCH"
    | "HEALTH_REPORT"
    | "HEALTH_MISS"
    | "COVERAGE_DEBT_ASSIGN"
    | "REPLACEMENT_DISPATCH"
    | "REPLACEMENT_ARRIVAL"
    | "SWARM_REDISTRIBUTE"
    | "NFZ_EXCEPTION_TOKEN"
    | "RTB_SLOT_SYNC"
    | "MISSION_EVENT";
  sourceType: "base" | "uav" | "system";
  sourceId?: string;
  targetType?: "base" | "uav" | "broadcast" | "system";
  targetIds?: string[];
  countsTowardCommsMetric: boolean;
  blipStyle?: "blue" | "red" | "amber" | "green" | "white";
  payload: unknown;
};

export type ActiveCommsBlip = {
  messageId: string;
  startedAtRealMs: number;
  durationMs: number;
  source: Point;
  targets: Point[];
  style: "blue" | "red" | "amber" | "green" | "white";
};
```

---

## 9. Geometry implementation

Create `lib/geometry.ts`.

### Local meters to map coordinates

Create `lib/geo.ts`.

The planner uses local XY meters. The map and export use WGS84 lat/lon. Implement a single shared conversion path and use it everywhere.

```ts
export function localToGeo(p: Point, origin: GeoPoint): GeoPoint;
export function geoToLocal(g: GeoPoint, origin: GeoPoint): Point;
export function pointsToGeoJsonLine(points: Point[], origin: GeoPoint): GeoJSON.Feature<GeoJSON.LineString>;
export function polygonToGeoJson(points: Point[], origin: GeoPoint): GeoJSON.Feature<GeoJSON.Polygon>;
export function circleToGeoJson(center: Point, radiusM: number, origin: GeoPoint, steps?: number): GeoJSON.Feature<GeoJSON.Polygon>;
```

Use a simple equirectangular/local tangent approximation, which is sufficient for the small AOOs in this demo:

```ts
const metersPerDegLat = 111_320;
const metersPerDegLon = 111_320 * Math.cos(origin.lat * Math.PI / 180);
lat = origin.lat + p.y / metersPerDegLat;
lon = origin.lon + p.x / metersPerDegLon;
```

Alignment requirements:

- Use these helpers for **all** map rendering and **all** Mission Planner waypoint export.
- Do not duplicate conversion math in components.
- Do not mix local XY points and lat/lon points inside a single route layer.
- Store one authoritative origin per mission.
- When zooming or panning, MapLibre should handle projection; mission layers must remain geospatial GeoJSON.
- Sensor footprints and NFZ circles should be rendered as approximated GeoJSON polygons generated from local meters, not as fixed-pixel screen circles.

### Required functions

```ts
export function distance(a: Point, b: Point): number;
export function polylineLength(points: Point[]): number;
export function polygonArea(poly: Point[]): number;
export function pointInPolygon(p: Point, poly: Point[]): boolean;
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null;
export function rotatePoint(p: Point, angleRad: number, origin?: Point): Point;
export function rotatePolygon(poly: Point[], angleRad: number, origin?: Point): Point[];
export function bbox(poly: Point[]): { minX: number; minY: number; maxX: number; maxY: number };
export function distancePointToSegment(p: Point, a: Point, b: Point): number;
export function segmentIntersectsCircle(a: Point, b: Point, center: Point, radius: number): boolean;
export function segmentMidpoint(seg: Segment): Point;
```

### Point in polygon

Use ray casting. Good enough for demo.

### Area

Use shoelace formula.

### Strip generation algorithm

Create `lib/planner.ts` function:

```ts
export function generateCoverageStrips(config: MissionConfig): Segment[];
```

Algorithm:

1. Rotate the AOO polygon by `-stripAngleDeg` around its centroid.
2. Compute bounding box of rotated polygon.
3. Compute strip spacing:

```ts
const spacing = sensorSwathM * (1 - overlapRatio);
```

4. Sweep horizontal lines from `minY` to `maxY` with that spacing.
5. For each sweep line y:
   - Intersect the horizontal line with all polygon edges.
   - Sort intersections by x.
   - Pair intersections `[0,1]`, `[2,3]`, etc.
   - Each pair is one coverage segment.
6. Rotate segment endpoints back by `+stripAngleDeg`.
7. Filter very short segments below 50 m.
8. Assign unique ids like `S-001`.

This supports simple concave polygons.

---

## 10. Sector allocation algorithm

Create:

```ts
export function allocateStripsToUavs(strips: Segment[], config: MissionConfig): UAV[];
```

### Goal

Assign strip segments to UAVs while balancing workload and preserving spatial adjacency.

### Simple robust algorithm

1. Sort strips by their midpoint coordinate along the rotated sweep axis or by `stripIndex`.
2. Divide into contiguous bands among UAVs.
3. Then rebalance if one UAV workload is too high.

Suggested method:

```text
1. Sort all strips by stripIndex, then by midpoint x.
2. Split sorted list into N contiguous chunks by cumulative strip length.
3. Assign each chunk to one UAV.
4. Alternate strip directions inside each UAV route to create lawnmower behavior.
```

This produces visually clean sectors.

### UAV initialization

For `uavCount = N`:

```ts
altitude = altitudeLayerStartM + i * altitudeLayerSpacingM;
rtbArrivalSlotS = i * rtbSlotSpacingS;
```

Labels:

```text
UAV 1, UAV 2, UAV 3, UAV 4, UAV 5
```

Use fixed Tailwind color classes and matching MapLibre layer colors.

---

## 11. Route generation

Create:

```ts
export function buildRoutes(uavs: UAV[], config: MissionConfig): UAV[];
```

### Route phases

Every UAV route should contain:

1. `takeoff`: base to initial climb/entry point.
2. `transit`: base to first assigned strip.
3. `covering`: along assigned strips.
4. `transit`: between strips.
5. `loiter`: if early before return slot.
6. `return`: back to base.
7. `landed`.

### Simplified path generation

For each UAV:

1. Start at `base` at `t = 0`.
2. Move to nearest endpoint of first assigned segment.
3. Fly the segment.
4. For next segment:
   - Choose endpoint closest to current point.
   - Transit to that endpoint.
   - Fly segment.
5. After all assigned segments, compute planned return time.
6. RTB arrival time should be staggered:

```ts
const latestCoverageFinish = max(uavs.map(u => coverageFinishTime(u)));
const targetArrival = latestCoverageFinish + 300 + uav.rtbArrivalSlotS;
```

7. If UAV would arrive earlier than target, add loiter points around a holding point before returning.
8. End at base at target arrival.

### Holding point

Compute per-UAV holding points around base:

```ts
angle = (2 * Math.PI * i) / uavCount;
radius = 600 + 120 * i;
holdingPoint = {
  x: base.x + radius * Math.cos(angle),
  y: base.y + radius * Math.sin(angle)
};
```

### Fixed-wing cue

Display a small label/card:

```text
Fixed-wing assumptions: constant-speed flight, no hover, minimum turn radius 90 m. Holding is represented by loiter orbit approximation.
```

Do not need exact Dubins curves.

---

## 12. Simulation engine

Create `lib/simulator.ts`.

### Required functions

```ts
export function interpolateRoute(route: TimedRoutePoint[], t: number): TimedRoutePoint;
export function getUavPositions(plan: MissionPlan, t: number): Record<string, TimedRoutePoint>;
export function computeMetrics(plan: MissionPlan): MissionMetrics;
export function estimateCoverage(plan: MissionPlan, gridStepM?: number): MissionMetrics;
export function sampleMinimumSeparation(plan: MissionPlan, dtS?: number): {
  minHorizontalM: number;
  min3DM: number;
};
```

### Animation

Use React state:

```ts
const [simTimeS, setSimTimeS] = useState(0);
const [isRunning, setIsRunning] = useState(false);
const [playbackRate, setPlaybackRate] = useState(30); // sim seconds per real second
```

Use `requestAnimationFrame`.

### Time slider

Range from 0 to `missionCompletionTimeS`.

### UAV state at time t

Use route point phase:

- `takeoff`
- `transit`
- `covering`
- `detour`
- `loiter`
- `return`
- `landed`
- `lost` if `failedAtS` is defined and `t >= failedAtS`

### Sensor footprint visualization

For the current UAV position, draw a translucent circle or rectangle approximating the sensor footprint. Simpler:

```text
Circle with radius = sensorSwathM / 2
```

For total covered area, use grid estimation rather than visual footprint union.

### MapLibre layer implementation

Create a main component such as `components/MapMissionView.tsx`. This component owns all map rendering. It must initialize MapLibre, load local basemap sources, register optional PMTiles support when available, and update tactical GeoJSON sources as simulation state changes.

Required basemap sources/layers:

```text
source: basemap-land-local
  layer: basemap-land-fill

source: basemap-coastline-local
  layer: basemap-coastline-line

source: basemap-labels-local
  layer: basemap-place-labels

optional source: basemap-pmtiles
  layers: water, land, coastline, sparse labels only
```

Required mission sources/layers:

```text
source: aoo
  layer: aoo-fill
  layer: aoo-outline

source: coverage-strips
  layer: strips-planned
  layer: strips-assigned-uav-1..5 or data-driven color layer

source: routes
  layer: route-original-dashed
  layer: route-active
  layer: route-replanned

source: uavs
  layer or markers: UAV icons oriented by heading

source: base
  layer or marker: base command node

source: nfz
  layer: nfz-fill
  layer: nfz-outline

source: sensor-footprints
  layer: active-sensor-fill

source: comms-blips
  layer: comms-line
  layer: comms-pulse-points
```

Implementation notes:

- For per-UAV colors, either create separate layers or use GeoJSON feature properties like `uavId` and `color`.
- UAV markers can be React markers if easier, but they must be anchored by lon/lat from `localToGeo()`.
- For moving UAVs, update only the small `uavs`, `sensor-footprints`, and `comms-blips` sources each animation frame. Avoid reloading all route sources every frame.
- For route and strip layers, update only when a mission is generated or replanned.
- Disable scroll-jank by memoizing GeoJSON objects where possible.

---

## 13. Coverage metric

Use grid sampling for robust demo metrics.

Create:

```ts
export function estimateCoverageByGrid(
  aoo: Point[],
  flownSegments: Segment[],
  noFlyZones: NoFlyZone[],
  swathM: number,
  gridStepM = 80
): { coveragePct: number; coveredAreaApproxM2: number; totalAooAreaM2: number };
```

Algorithm:

1. Compute AOO bounding box.
2. Generate grid points every `gridStepM`.
3. A point is valid if:
   - inside AOO
   - not inside any NFZ
4. A valid point is covered if distance to any completed/planned coverage segment <= `swathM / 2`.
5. Coverage percentage = covered valid points / total valid points.
6. Approx area = count * `gridStepM * gridStepM`.

This is good enough and easy to visualize.

### Dynamic coverage during simulation

For current time `t`, consider a segment covered if its route phase has been flown past that segment or simpler:

- Compute all coverage segments assigned to UAVs that are not lost and not blocked by NFZ.
- For live animation, optionally show current coverage as cumulative up to t.

Minimum viable implementation can show final projected coverage plus current `simTimeS`.

---

## 14. Separation metric

### Horizontal separation

Sample positions every 5 seconds.

For each pair of active UAVs at each sample:

```ts
horizontal = distance(p1, p2)
```

Track minimum.

### 3D separation

Use altitude layers:

```ts
vertical = Math.abs(uav1.altitudeM - uav2.altitudeM)
separation3D = Math.sqrt(horizontal ** 2 + vertical ** 2)
```

### Display

Metrics panel:

```text
Min sampled horizontal separation: 312 m
Min sampled 3D separation: 316 m
Separation policy: altitude layering + RTB slot timing
```

If min separation below configured threshold, show warning:

```text
Warning: sampled horizontal separation below threshold. Increase altitude layer spacing or RTB slot spacing.
```

Even if horizontal separation briefly falls below threshold, altitude layers and time slots can still be discussed. But for a clean demo, tune defaults so it is above threshold.

---

## 15. Return-to-base deconfliction

### Behavior

All UAVs return to the same base but with staggered arrival windows.

Default:

```text
UAV 1: T + 0 s
UAV 2: T + 90 s
UAV 3: T + 180 s
UAV 4: T + 270 s
UAV 5: T + 360 s
```

Where `T` is after the latest coverage completion plus a buffer.

### UI

Show a small timeline:

```text
RTB arrival slots
UAV 1 | 42:00
UAV 2 | 43:30
UAV 3 | 45:00
UAV 4 | 46:30
```

### Explanation card

```text
Return separation is guaranteed by time slots and holding loiters. UAVs that finish coverage early wait at assigned holding points before entering the return corridor.
```

---

## 16. Contingency 1: vehicle loss

### UI interaction

Button:

```text
Simulate UAV Loss
```

Dropdown/select:

```text
Lost UAV: UAV 3
Failure time: 14:00
```

If no dropdown is implemented, default to losing UAV 3 at 35% mission time.

### Operator response mode

The vehicle-loss scenario must expose an operator choice that feels like an RTS tactical decision, while still representing autonomous mission logic.

Add a segmented control in the loss panel:

```text
Loss response:
[ Dispatch replacement UAV ] [ Spread remaining swarm ]
```

#### Mode A: dispatch replacement UAV

This mode shows a reserve/replacement UAV launching from the base or a nearby reserve holding point to absorb the lost UAV's remaining coverage debt.

Required behavior:

1. Show a reserve UAV icon at the base or reserve staging point before launch. Use an ID such as `UAV_R1` or `UAV_5` if the configured UAV count is below 5.
2. When the loss is triggered, draw a base-to-replacement communication blip if the comms policy allows sparse command tokens.
3. Animate the replacement UAV moving from the base/staging point to the nearest entry point of the lost UAV's uncovered sector.
4. Reassign as much of the lost UAV's remaining coverage debt as feasible to the replacement UAV first.
5. If the replacement cannot cover all debt within endurance, assign the remainder to neighboring active UAVs.
6. Display a route preview before applying if time permits: ghost line from base to replacement insertion point and highlighted inherited strips.
7. Update the event feed and metrics with replacement travel time, inherited strip count, and mission delay.

Presentation story:

```text
Replacement dispatch preserves the original sector structure. It is useful when a reserve aircraft exists and radio silence can be briefly broken for a sparse dispatch token. The replacement follows a precompiled insertion corridor and inherits the lost UAV's coverage debt.
```

#### Mode B: spread remaining swarm

This mode does not introduce a replacement. The remaining active UAVs expand outward and redistribute the lost UAV's remaining strips among themselves.

Required behavior:

1. Remove or fade the lost UAV after the failure time.
2. Mark its remaining strips as `coverage_debt`.
3. Recompute sector ownership for all active UAVs, not just immediate neighbors.
4. Animate the visual transition so colored sectors appear to spread or flow into the uncovered area.
5. Rebuild routes for all active UAVs using greedy nearest insertion or workload-balancing reassignment.
6. Show a `SWARM_REDISTRIBUTE` event. In strict silent mode, this is shown as deterministic onboard branch activation rather than a live message.
7. Update metrics with the number of UAVs whose routes changed and the total additional mission time.

Presentation story:

```text
Swarm redistribution is the radio-minimal fallback. Because every UAV carries the same mission contract and deterministic contingency rules, the team can spread into the uncovered sector without relying on continuous control from the base.
```

#### Visual comparison requirement

The app should make the two modes easy to compare. Add a compact comparison card after vehicle loss:

```text
Replacement dispatch
- More stable sector geometry
- Adds replacement travel delay
- Uses 0-1 sparse dispatch token
- Higher recovery if reserve UAV is available

Spread remaining swarm
- No replacement required
- More route changes across the team
- Works in strict silent mode
- May reduce final coverage if endurance is tight
```


### Algorithm

Create:

```ts
export function simulateVehicleLoss(
  plan: MissionPlan,
  lostUavId: string,
  failureTimeS: number,
  responseMode: "dispatch_replacement" | "spread_remaining_swarm"
): MissionPlan;

export function dispatchReplacementUav(
  plan: MissionPlan,
  lostUavId: string,
  failureTimeS: number
): MissionPlan;

export function spreadRemainingSwarm(
  plan: MissionPlan,
  lostUavId: string,
  failureTimeS: number
): MissionPlan;
```

Steps:

1. Mark selected UAV as lost after `failureTimeS`.
2. Identify its remaining assigned coverage segments after that time.
3. Mark those as `coverage_debt`.
4. Branch based on `responseMode`.
5. In `dispatch_replacement` mode:
   - Create or activate a replacement UAV at base/reserve staging.
   - Insert a launch delay using `replacementLaunchDelayS`.
   - Route the replacement to the closest feasible insertion point for the lost UAV's remaining sector.
   - Assign coverage debt to the replacement first, then overflow debt to nearby active UAVs.
   - Preserve as much of the original sector geometry as possible.
6. In `spread_remaining_swarm` mode:
   - Reallocate feasible debt segments across all remaining active UAVs.
   - Prefer greedy nearest insertion balanced by projected workload.
   - Allow sector colors and route ownership to change broadly so the visual reads as the team spreading out.
   - Skip any segment that would exceed endurance and keep it as remaining debt.
7. Rebuild routes for affected UAVs.
8. Preserve RTB slot spacing, optionally extending mission completion time.
9. Recompute metrics.
10. Add mission events. Add visible comms blips only when the event represents an actual sparse message; deterministic onboard branch activations should appear in the event feed but not count as communications.

```json
{
  "type": "HEALTH_MISS",
  "sourceType": "base",
  "sourceId": "BASE",
  "targetType": "uav",
  "targetIds": ["UAV_3"],
  "countsTowardCommsMetric": true,
  "blipStyle": "red",
  "payload": {
    "lost_uav": "UAV_3",
    "missed_epochs": 2,
    "activated_branch": "loss_of_UAV_3"
  }
}
```

Additional message examples:

```json
{
  "type": "REPLACEMENT_DISPATCH",
  "sourceType": "base",
  "sourceId": "BASE",
  "targetType": "uav",
  "targetIds": ["UAV_R1"],
  "countsTowardCommsMetric": true,
  "blipStyle": "blue",
  "payload": {
    "replacement_for": "UAV_3",
    "insertion_mode": "nearest_sector_entry"
  }
}
```

```json
{
  "type": "SWARM_REDISTRIBUTE",
  "sourceType": "system",
  "targetType": "system",
  "countsTowardCommsMetric": false,
  "blipStyle": "amber",
  "payload": {
    "lost_uav": "UAV_3",
    "route_changes": ["UAV_1", "UAV_2", "UAV_4"]
  }
}
```

Visualization: show a red base-to-UAV health-check line that blips and then fades/fails when the UAV is declared lost. In replacement mode, show a blue base-to-replacement blip and then animate the replacement UAV along its insertion corridor. In spread mode, show sector colors expanding into the lost UAV's area and route lines updating for all affected UAVs.

### Silent-mode story

In strict silent mode, the app should show:

```text
Strict silent fallback: adjacent UAVs execute preplanned reserve coverage branches. Coverage degrades gracefully without requiring a continuous datalink.
```

Implementation can still use reallocation under the hood. The UI text should explain it as deterministic precomputed contingency branch activation.

### Required explanation card for loss response modes

```text
After a vehicle loss, operators can choose either to dispatch a reserve UAV or to let the remaining swarm spread out. Replacement dispatch preserves the original sector design but introduces travel delay and may use one sparse command token. Swarm redistribution requires no replacement and can remain fully radio-minimal, but it changes more routes and may reduce final coverage if endurance is tight.
```

### Metrics to show

Before/after cards:

```text
Projected coverage before loss: 97.4%
Coverage if no reallocation: 74.8%
Coverage after contingency reallocation: 91.2%
Messages used: 0 strict silent / 1 sparse health miss token
Replacement travel time: 4.8 min if replacement mode is selected
Redistributed UAVs: 3 if spread mode is selected
```

Compute actual numbers dynamically.

---

## 17. Contingency 2: pop-up no-fly zone

### UI interaction

Button:

```text
Add Pop-up NFZ
```

Behavior:

- After clicking button, next click on simulation viewport places a circular NFZ.
- Default radius: 450 m.
- Created at current sim time.
- Detected by nearest UAV or selected UAV.

If implementing click is too slow, place a preset NFZ near the middle of the AOO.

### Algorithm

Create:

```ts
export function simulateNoFlyZone(plan: MissionPlan, nfz: NoFlyZone): MissionPlan;
```

Steps:

1. Add NFZ to plan.
2. For each coverage segment:
   - If segment intersects NFZ, mark as `blocked_by_nfz`.
   - Optional: split around NFZ if implementation time allows.
3. For each UAV route:
   - If route segment intersects NFZ, create a simple detour around the circle.
4. Reassign blocked coverage where possible around NFZ.
5. Rebuild routes and metrics.
6. Preserve RTB slots if possible.
7. If comms policy is `radio_silent_except_tokens`, add one `NFZ_EXCEPTION_TOKEN` message.
8. Visualize the NFZ token as a bright blip from the detecting UAV to the other active UAVs, or as an expanding broadcast ring from the detecting UAV.

### Simple detour algorithm

For a segment from A to B that crosses a circular NFZ:

1. Compute vector from A to B.
2. Compute perpendicular unit vector.
3. Choose side based on which detour waypoint is farther from AOO boundary or simply based on UAV id parity.
4. Create two detour waypoints:

```ts
const margin = 150;
const detourRadius = nfz.radiusM + margin;
const wp1 = center + perpendicular * detourRadius + along * -detourRadius;
const wp2 = center + perpendicular * detourRadius + along * detourRadius;
```

5. Replace direct segment A-B with A-wp1-wp2-B.
6. Mark route phase as `detour`.

### Display

- NFZ drawn as red translucent circle.
- Original route drawn dashed in faint color.
- Replanned route drawn solid.
- Affected strips shown in red/orange.
- Exception token displayed if enabled.

### Required explanation card

```text
A pop-up NFZ known to one UAV cannot be avoided by other UAVs unless they observe it, receive a token, or already have a conservative plan. OmniVis defaults to local onboard detour and optionally emits one sparse exception token so all vehicles deterministically replan without a permanent link.
```

This honest framing is important.

---

## 18. Export module

Create `lib/exporters.ts`.

### Export button

Button:

```text
Export Mission Package
```

On click, download a zip or individual files.

Preferred: zip file named:

```text
omnivis_mission_package.zip
```

Use JSZip.

### Files to export

1. `mission_contract.json`
2. `contingency_policy.json`
3. `metrics.json`
4. `simulation_trace.json`
5. `uav_1.waypoints`
6. `uav_2.waypoints`
7. `uav_3.waypoints`
8. `uav_4.waypoints` if applicable
9. `uav_5.waypoints` if applicable
10. `README_mission_planner_import.txt`

### mission_contract.json

Include the mission config, AOO, UAVs, altitude layers, RTB slots, and comms policy.

### contingency_policy.json

Example:

```json
{
  "policy_name": "OmniVis Contingency Policy",
  "vehicle_loss": {
    "detection": "missed scheduled liveness epochs or preplanned branch activation",
    "normal_comms_required": false,
    "operator_modes": {
      "dispatch_replacement": "reserve UAV launches from base/staging point and inherits lost sector debt before overflow reassignment",
      "spread_remaining_swarm": "all active UAVs deterministically spread and rebalance coverage debt without requiring a replacement"
    },
    "action": "selected operator mode absorbs coverage debt using deterministic shared planner",
    "fallback": "coverage gracefully degrades if endurance prevents full recovery"
  },
  "pop_up_no_fly_zone": {
    "strict_silent_action": "detecting UAV locally detours and marks blocked strips",
    "exception_token_action": "one sparse NFZ token lets all UAVs deterministically replan",
    "token_size_goal_bytes": "80-200 demo bytes"
  },
  "return_to_base": {
    "method": "staggered arrival slots with loiter holds",
    "separation_basis": "geometry and timing, not permanent datalink"
  }
}
```

### metrics.json

Export current metrics.

### simulation_trace.json

Export time-sampled UAV positions:

```json
{
  "sample_period_s": 10,
  "samples": [
    {
      "t": 0,
      "uavs": {
        "UAV_1": { "x": 300, "y": -500, "altitude_m": 120, "phase": "takeoff" }
      }
    }
  ]
}
```

### Mission Planner waypoint file

Export QGC WPL 110-style `.waypoints` text. This does not need to be perfect autopilot code, but should be plausible and loadable for the recorded demo.

Format:

```text
QGC WPL 110
0	1	0	16	0	0	0	0	45.000000	12.000000	120.000000	1
1	0	3	22	0	0	0	0	45.000500	12.000500	120.000000	1
2	0	3	16	0	0	0	0	45.001000	12.001000	120.000000	1
...
N	0	3	20	0	0	0	0	0	0	0	1
```

Command hints:

- `16` = NAV_WAYPOINT
- `22` = NAV_TAKEOFF
- `20` = NAV_RETURN_TO_LAUNCH
- frame `3` = global relative altitude

### Local XY to lat/lon conversion

Use simple approximation around base:

```ts
export function localMetersToLatLon(baseLat: number, baseLon: number, p: Point): { lat: number; lon: number } {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((baseLat * Math.PI) / 180);
  return {
    lat: baseLat + p.y / metersPerDegLat,
    lon: baseLon + p.x / metersPerDegLon,
  };
}
```

### Exported waypoints

For each UAV:

1. First row: home/base waypoint.
2. Takeoff near base at UAV altitude.
3. Include route points, downsampled to avoid huge files.
4. Add RTL command at end.

Downsample route:

```ts
const exportPoints = route.filter((pt, idx) => idx === 0 || idx % 3 === 0 || pt.phase === "covering" || pt.phase === "return");
```

### README_mission_planner_import.txt

Content:

```text
OmniVis Mission Package

These files demonstrate Mission Planner-compatible export from the OmniVis web simulator.

Import flow used in the demo video:
1. Open Mission Planner.
2. Go to Flight Plan.
3. Use Load WP File.
4. Select uav_1.waypoints.
5. Inspect generated waypoints and route.
6. Repeat for additional UAV files if using multiple simulated vehicles.

OmniVis is not a replacement for Mission Planner. It is an upstream autonomy compiler that generates cooperative mission artifacts for review, upload, and simulation.
```

---

## 19. Mission Planner video panel

The team will record one video outside the app. The app should include a placeholder panel that can embed it if the file exists.

### File path

Place video at:

```text
/public/mission-planner-export-demo.mp4
```

### Component behavior

If video file is present, show:

```tsx
<video controls className="w-full rounded-xl border">
  <source src="/mission-planner-export-demo.mp4" type="video/mp4" />
</video>
```

If not present, show placeholder:

```text
Mission Planner export demo video placeholder
Record: Export Mission Package -> open Mission Planner -> Flight Plan -> Load WP File -> select uav_1.waypoints.
```

### Label text

```text
Mission Planner export path
OmniVis exports per-aircraft waypoint files and mission metadata. The video demonstrates one exported UAV mission being imported for operator review.
```

---

## 20. Suggested file structure

```text
silent-swarm/
  app/
    globals.css
    layout.tsx
    page.tsx
  components/
    Header.tsx
    MissionControls.tsx
    CommandDeck.tsx
    UnitCard.tsx
    MapMissionView.tsx
    TacticalEventFeed.tsx
    MetricsPanel.tsx
    TimelineControls.tsx
    UavStatusTable.tsx
    ExportPanel.tsx
    MissionPlannerVideo.tsx
    ExplanationCards.tsx
  lib/
    types.ts
    presets.ts
    geo.ts
    geometry.ts
    planner.ts
    simulator.ts
    contingencies.ts
    comms.ts
    mapLayers.ts
    exporters.ts
    format.ts
  public/
    mission-planner-export-demo.mp4    optional
  package.json
  tailwind.config.ts
  tsconfig.json
  README.md
```

---

## 21. Component requirements

### Header.tsx

Displays title, subtitle, and challenge alignment badge.

Badges:

```text
3-5 fixed-wing UAVs
Radio-minimal
Geometry + timing separation
Mission Planner export
```

### MissionControls.tsx

Props:

```ts
type Props = {
  config: MissionConfig;
  onConfigChange: (next: MissionConfig) => void;
  onGenerate: () => void;
  onReset: () => void;
  onSimulateLoss: () => void;
  onSetLossResponseMode: (mode: "dispatch_replacement" | "spread_remaining_swarm") => void;
  onPreviewLossResponseMode?: (mode: "dispatch_replacement" | "spread_remaining_swarm") => void;
  onPrepareNfzPlacement: () => void;
  nfzPlacementActive: boolean;
};
```

### MapMissionView.tsx

Props:

```ts
type Props = {
  plan: MissionPlan | null;
  simTimeS: number;
  selectedUavId?: string;
  onSelectUav?: (uavId: string) => void;
  onPlaceNfz?: (point: Point) => void;
  nfzPlacementActive: boolean;
};
```

Render through MapLibre:

1. Simplified dark OSM-derived basemap.
2. AOO polygon as GeoJSON.
3. Base marker as a command-node marker/layer.
4. Coverage strips by assigned UAV color.
5. Routes as GeoJSON line layers.
6. Original routes dashed if replanned.
7. NFZs as GeoJSON polygon layers.
8. Current UAV positions as markers or point layers.
9. Sensor footprint polygons.
10. Holding points and RTB corridors.
11. Communication blips as short-lived line/pulse layers.
12. Replacement UAV reserve icon, insertion corridor, and inherited sector highlight when replacement mode is active.
13. Redistribution transition styling when spread mode is active: fading old sector ownership and bright new sector ownership.
14. Legend and selected-unit highlight.

Do not use an independent SVG viewBox for the main map. Use MapLibre projection and GeoJSON sources so features stay aligned during pan/zoom/resize.

### CommandDeck.tsx and UnitCard.tsx

These components provide the RTS-like interaction layer.

`CommandDeck.tsx` should contain grouped tactical controls, mission mode buttons, contingency buttons, vehicle-loss response mode selection, preview actions, and export actions.

`UnitCard.tsx` should appear when a UAV is selected and show:

- UAV state.
- Altitude layer.
- Assigned sector/strip count.
- Current route phase.
- Endurance remaining.
- RTB slot.
- Selected-unit actions.
- Loss-response buttons when the selected UAV is used as the failure target: `Dispatch Replacement Preview` and `Spread Swarm Preview`.

### TacticalEventFeed.tsx

Shows chronological mission events and communication events. It should read from `plan.messages` plus simulation-derived state events. Keep it compact, high-contrast, and game-like.

### MetricsPanel.tsx

Show metric cards:

- Coverage
- Mission completion time
- Minimum separation
- Messages used
- Feasibility
- RTB slot spacing
- Coverage debt

Also show a UAV status table.

### TimelineControls.tsx

Props:

```ts
type Props = {
  simTimeS: number;
  maxTimeS: number;
  isRunning: boolean;
  playbackRate: number;
  onTimeChange: (t: number) => void;
  onRunningChange: (running: boolean) => void;
  onPlaybackRateChange: (rate: number) => void;
};
```

Controls:

- Play/pause.
- Time slider.
- Speed dropdown: 1x, 10x, 30x, 60x, 120x.
- Current time formatted as `MM:SS`.

### ExportPanel.tsx

Buttons:

- Download mission package.
- Download mission_contract.json.
- Download UAV waypoint files.

Show list of files produced.

### ExplanationCards.tsx

Include concise cards explaining:

1. Mission contract.
2. Geometry/timing deconfliction.
3. Vehicle loss contingency.
4. Pop-up NFZ exception token.
5. Mission Planner export path.

---

## 22. Styling guidance

Use a polished defense-tech dashboard aesthetic.

### Visual style

- Dark background.
- Slate panels.
- Cyan/blue accent for nominal mission.
- Amber for warnings/contingencies.
- Red for NFZ/lost UAV.
- Green for successful coverage.

### Tailwind classes

Suggested background:

```text
bg-slate-950 text-slate-100
```

Panels:

```text
rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl
```

Buttons:

```text
rounded-xl px-4 py-2 font-medium transition hover:brightness-110
```

Important: ensure the app looks good in a projected demo. Use high contrast and large metric numbers.

---

## 23. Default demo scenario

On first load, generate a compelling default mission automatically or provide a clear `Generate Mission` button.

Default config:

```ts
{
  presetId: "irregular",
  uavCount: 4,
  sensorSwathM: 180,
  overlapRatio: 0.15,
  speedMps: 22,
  enduranceMin: 55,
  minSeparationM: 250,
  altitudeLayerStartM: 120,
  altitudeLayerSpacingM: 30,
  turnRadiusM: 90,
  stripAngleDeg: 15,
  rtbSlotSpacingS: 90,
  commsPolicy: "radio_silent_except_tokens",
  seed: 7429,
  base: { x: 300, y: -500 },
  baseLat: 45.0,
  baseLon: 12.0
}
```

Expected story:

1. Generate mission.
2. Show 4 UAVs assigned colored sectors.
3. Run animation.
4. At about 35% time, simulate UAV 3 loss.
5. Show coverage debt and reallocation.
6. Add NFZ in the center-right of AOO.
7. Show detour and exception token.
8. Show RTB slots.
9. Export mission package.
10. Mention video demonstrates importing one exported file into Mission Planner.

---

## 24. Metrics formulas

### Mission completion time

```ts
missionCompletionTimeS = max(uavs.map(u => last(u.route).t));
```

### UAV utilization

For each UAV:

```ts
coverageTime = sum(length(segment) / speedMps for assigned segments)
missionTime = last(route).t
utilizationPct = 100 * coverageTime / missionTime
```

Average over active UAVs.

### Feasible within endurance

```ts
feasible = missionCompletionTimeS <= enduranceMin * 60
```

### Coverage debt

```ts
coverageDebtStripCount = strips.filter(s => s.status === "coverage_debt").length
```

### Blocked strips

```ts
blockedStripCount = strips.filter(s => s.status === "blocked_by_nfz").length
```

---

## 25. Demo text to include in app

Include these exact or similar explanation snippets.

### Mission contract card

```text
Mission contract: each UAV receives the same deterministic plan before launch: AOO geometry, strip tasks, altitude layer, return slot, contingency rules, and random seed. Cooperation is encoded before takeoff instead of depending on continuous command links.
```

### Geometry + timing card

```text
Deconfliction: separation is enforced through altitude layers, spatial route corridors, holding points, and staggered return-to-base arrival slots. UAVs that finish early loiter before entering the return corridor.
```

### Vehicle loss card

```text
Vehicle loss: remaining strips from the lost aircraft become coverage debt. Active UAVs absorb feasible debt using the same deterministic onboard reallocation rule. If endurance is insufficient, the system reports graceful degradation instead of hiding the gap.
```

### NFZ card

```text
Pop-up no-fly zone: the detecting UAV locally detours around the hazard. In exception-token mode, one sparse NFZ token is enough for all UAVs to recompute the same safe plan without a permanent datalink.
```

### Mission Planner export card

```text
Mission Planner path: OmniVis is not a replacement for Mission Planner. It is an upstream autonomy compiler that exports per-UAV waypoint files and mission metadata for operator review, upload, and simulation.
```

---

## 26. Implementation order for the coding agent

Build in this order.

### Phase 1: Project skeleton

1. Create Next.js app with TypeScript and Tailwind.
2. Add dark dashboard layout.
3. Add RTS-style command dashboard shell.
4. Add MapLibre map with local simplified dark maritime GeoJSON basemap; keep optional PMTiles support behind a clean fallback.
5. Add static panels and placeholder mission layers.

### Phase 2: Geometry, geo conversion, and planner

1. Implement types.
2. Implement local XY meter geometry.
3. Implement `localToGeo` / `geoToLocal` conversion helpers.
4. Implement polygon area, point-in-polygon, segment intersection.
5. Implement coverage strip generation.
6. Implement contiguous sector allocation.
7. Display AOO and strips as MapLibre GeoJSON layers.

### Phase 3: Routes and simulation

1. Build route points for UAVs.
2. Add timed interpolation.
3. Add play/pause animation.
4. Draw moving UAV markers, heading indicators, and sensor footprints on the map.
5. Add timeline slider and RTS-style mission clock.
6. Add selectable UAV cards and command actions.

### Phase 4: Metrics

1. Estimate coverage by grid.
2. Estimate min separation by route sampling.
3. Compute mission time and utilization.
4. Display metric cards.

### Phase 5: Contingencies and comms visualization

1. Implement UAV loss reallocation.
2. Implement the operator loss-response toggle: dispatch replacement vs spread remaining swarm.
3. Implement replacement UAV movement from base/reserve staging to the inherited sector.
4. Implement spread-mode sector redistribution across all active UAVs.
5. Implement NFZ placement and detour.
6. Show dashed original routes after replan.
7. Add message counter and exception token card.
8. Add communication blips between base/UAVs and UAV/UAVs.
9. Add tactical event feed entries for messages, replacement dispatch, redistribution, and onboard branch activations.

### Phase 6: Export

1. Implement mission_contract.json.
2. Implement contingency_policy.json.
3. Implement metrics.json.
4. Implement simulation_trace.json.
5. Implement `.waypoints` export.
6. Zip and download.
7. Add Mission Planner video panel.

### Phase 7: Polish

1. Improve dark tactical colors and labels.
2. Add legend.
3. Add status badges.
4. Add explanation cards.
5. Tune defaults so demo metrics look good.
6. Ensure map overlays do not drift when panning, zooming, resizing, or replaying the simulation.
7. Make the command interface feel like an RTS/tactical console rather than a plain dashboard.

---

## 27. Acceptance criteria

The app is acceptable if the following are true:

1. It runs locally with `npm run dev`.
2. It builds with `npm run build`.
3. It can be deployed to Vercel without a backend.
4. On page load, a user can generate a 4-UAV mission.
5. The MapLibre map shows a simplified dark maritime basemap from local GeoJSON by default, with optional PMTiles support, and AOO, base, strips, colored routes, communication blips, and UAVs aligned geospatially.
6. The simulation can play and pause.
7. Metrics update and show plausible values.
8. The user can simulate a UAV loss.
9. The user can choose between dispatching a replacement UAV and spreading the remaining swarm after vehicle loss.
10. Replacement mode visibly animates a replacement UAV moving from base/reserve staging to the new coverage area.
11. Spread mode visibly redistributes sectors/routes across the remaining UAVs.
12. The user can add or trigger an NFZ.
13. The app displays message count and exception-token concept.
14. RTB arrival slots are visible.
15. Export downloads mission files.
16. At least one exported `.waypoints` file is generated.
17. The Mission Planner video panel exists.
18. The UI clearly explains why the system does not need a permanent datalink.
19. The app defaults to dark mode and has an RTS-like tactical command feel.
20. Communication events create quick visible blips between base/UAVs or UAV/UAVs.
21. Mission overlays stay aligned with the map while panning, zooming, resizing, and replaying.
22. The map style hides or mutes unnecessary OSM features so the mission geometry remains the focus.

---

## 28. Known simplifications and how to present them

These simplifications are acceptable. Do not hide them; frame them as demo scope.

### 2D local-coordinate simulation with real-map display

Presentation wording:

```text
The simulator plans in a local maritime XY frame in meters for fast deterministic coverage logic, then renders and exports the same geometry through a shared WGS84 conversion anchored to the selected basemap location. This keeps the web map and Mission Planner export closely aligned.
```

### Simplified OSM basemap

Presentation wording:

```text
The basemap is OpenStreetMap-derived but intentionally simplified into a dark tactical maritime view. We mute roads, POIs, and visual clutter so judges can focus on the autonomy layer: sectors, routes, sensor coverage, contingencies, and communication events.
```

### Approximate fixed-wing dynamics

```text
This demo models fixed-wing constraints at the mission-software layer: constant-speed routes, minimum turn-radius awareness, and loiter holds. It is not a flight-dynamics simulator.
```

### Grid-based coverage metric

```text
Coverage is estimated through grid sampling over the AOO using the configured sensor swath. This makes before/after contingency comparisons fast and explainable.
```

### Mission Planner export only

```text
Mission Planner is used as the downstream review/upload environment. OmniVis focuses on the missing autonomy layer upstream of Mission Planner.
```

---

## 29. Example README for repository

Create a repository README with this content or similar.

```md
# OmniVis Mission Compiler

OmniVis is a web-based mission compiler and 2D simulator for radio-minimal cooperative maritime coverage by 3-5 fixed-wing UAVs.

It demonstrates:

- A shared pre-mission contract instead of continuous datalink control
- Dark tactical real-map visualization using an OpenStreetMap-derived basemap
- RTS-style command controls and selectable UAV unit cards
- Coverage strip generation over a maritime Area of Operations
- Sector allocation across multiple UAVs
- Base-drone and drone-drone communication blips for sparse message events
- Geometry/timing deconfliction
- Staggered return-to-base arrival windows
- Vehicle-loss contingency handling
- Pop-up no-fly-zone replanning
- Mission Planner-compatible export artifacts

## Run locally

npm install
npm run dev

## Build

npm run build

## Demo flow

1. Generate mission.
2. Run the simulation.
3. Trigger UAV loss.
4. Add pop-up NFZ.
5. Review metrics.
6. Export mission package.
7. Watch Mission Planner import demo video.
```

---

## 30. Final presentation narrative supported by the app

Use this narrative in the demo:

```text
OmniVis addresses the gap between mainstream ground-control mission upload and true cooperative autonomy. Rather than assuming a permanent datalink, it compiles cooperation into a shared mission contract before launch. Each UAV carries deterministic onboard logic for its sector, altitude layer, return window, and contingency branches.

In nominal execution, the swarm uses zero messages. The aircraft cover the maritime AOO using assigned sensor strips and return through staggered arrival slots. If one UAV is lost, its unfinished strips become coverage debt and are absorbed by remaining vehicles where endurance allows. If a pop-up no-fly zone appears, the detecting UAV locally detours; in exception-token mode, one sparse token lets the swarm recompute the same safe plan.

Mission Planner remains the downstream operator tool. OmniVis exports per-UAV waypoint files and mission metadata for review and upload, but the cooperative behavior is encoded before takeoff and does not depend on Mission Planner maintaining a permanent link.
```

---

## 31. One-day prioritization

If implementation time becomes tight, prioritize these in order:

1. Great-looking dark tactical map with route/sector visualization.
2. Working simulation animation.
3. Metrics dashboard.
4. UAV loss contingency.
5. Pop-up NFZ contingency.
6. Communication blips and event feed.
7. Export files.
8. Mission Planner video panel.
9. Extra polish.

The most important judging moment is not the export. It is showing that cooperation, contingency response, and RTB deconfliction are encoded in the autonomy layer rather than improvised by a ground controller over a permanent link.
