# PLAYTEST
All numbers are bot/automation measured. Headless frame times are software-rendered and are NOT real fps.

## M0
- Delivery test: WebGL2 PASS, Worker PASS, WASM PASS, 10MB asset PASS, Cache API PASS (headless Chromium, local static server).
- Renderer prototype: both (a) and (b) render on WebGL2; first 3 frames 0.99s (a) / 0.58s (b) in SwiftShader (meaningless for real fps).

## M1 — vehicle FUN GATE (bot, Node, real sim core; tools/fungate.ts)
Sedan, targets: 0-100 km/h in 6.5-11 s; 100-0 braking 30-55 m; stable drift 10-45° slip with sd < 12°; no flips in a 110 km/h full-lock slalom; 30° wall hit at 60 km/h keeps > 40% speed (slides); kerbs at 50 km/h stay upright; ramp jump lands upright; upside-down car self-rights.

| Preset | 0-100 s | top km/h | 100-0 m | drift slip ° | slalom min up | wall exit km/h | kerb | ramp air s | self-right | failed |
|---|---|---|---|---|---|---|---|---|---|---|
| Balanced | 6.88 | 208.8 | 43.2 | 11.9 ± 4 | 1 | 55.3 | True | 0.9 / upright True | True | none |
| Grippy | 6.88 | 208.8 | 43.2 | 1.8 ± 0.8 | 1 | 54.4 | True | 0.9 / upright True | True | none |
| Drifty | 6.88 | 208.8 | 43.2 | 16.8 ± 3.4 | 1 | 54.3 | True | 0.9 / upright True | True | none |
(Grippy is designed to resist drifting; its drift check only requires no spin.)

Readability (M1 captures, shots/m1/): road edges, lane paint and the car stay readable at golden hour, overcast and rainy night; rain streaks reduced to 15% opacity so they never hide the road. Bot drove the `loop` and `straight` routes in-browser without stalls (138 km/h on the straight, drift route at 94 km/h).
Frame time: headless SwiftShader only — NOT real fps. High tier draw calls 595, triangles 49k for the grey-box.

FUN GATE M1: proxies PASS (all presets). **UNPLAYED: needs human.** Questions:
1. Does Balanced feel stable enough at 120+ km/h on the straight, or does the steering feel twitchy/too slow (tuning panel: steerRate, steerMinAtSpeed)?
2. When you pull the handbrake at ~70 km/h and hold throttle, can you hold a drift with gentle countersteer, or does it snap back / spin (driftRearGrip, driftAngle, driftControl)?
3. Is the chase camera distance/FOV comfortable, and does the speed blur + FOV kick feel fast without causing discomfort (Esc > comfort toggles)?
4. Do braking distance and reverse speed feel natural for a sedan?
5. Does the synthesized engine/tyre audio match what the car is doing (shifts, slides), or is it distracting?

## M2 — REALISM GATE: rest test (props) — tools/resttest.ts
200 mixed props (boxes, cylinders, balls; 5-29 kg) dropped on flat ground and on a 15 cm slab, simulated 12 s:
floating 0, sinking 0 (max contact gap 0.3 cm), asleep 199/200, 1 ball still rolling slowly (3.9 cm over the last 2 s = 2 cm/s; props now have angular damping 0.6 to emulate rolling resistance).
Ragdolls: UNVERIFIED (ragdolls arrive in M4).

## M2 — LOOK GATE (shots/m2/, before/after: shots/m2/before_after.jpg)
Rounds: 4 self critique-fix rounds + 1 fix pass on the independent review. Defects fixed along the way: white unlit roads (texture fallback), Z-up rig retarget, inside-building camera, crushed shadow-side facades, flat/striped shop interiors, SSR silently disabled by N8AO pass order, ghost steam, too-bright night, missing contact shadows, white horizon void (distant skyline + ground), heavy grain, clipped day sky.

| Category | Independent reviewer (pre-fix) | Self, after final fixes | Evidence |
|---|---|---|---|
| Lighting & shadows | 5 | 6 | crisp CSM shadows, warm golden hour at 19:10, AO + car contact blobs now visible; no bounce light |
| Materials | 5 | 6 | KTX2 PBR asphalt/pavers/brick with anti-tiling + grime; plaster/concrete facades still flat, no edge wear |
| Reflections & glass | 4 | 5.5 | SSR on wet roads now works (cars/buildings reflected at night); tower glass reflections still weak |
| Atmosphere | 5 | 5.5 | clouds, fog, rain with varied streaks, steam; night sky flat, no light shafts |
| Density & detail | 3 | 5 | 6 traffic cars, 8 peds, skyline ring; still sparse clutter/decals/signage |
| Character & vehicle shading | 5 | 5.5 | sourced Kiri '86 cars good; stand-in character is stylised (replaced in M4) |
| Effects | 3 | 3.5 | rain, steam, tyre smoke only; combat/fire effects arrive in M5 |
| Post & colour | 5 | 6 | AgX + TOD grade, lighter grain, bloom; per-TOD LUT and auto-exposure still REPLACED |
| Cohesion | 4 | 5 | cars cohesive; stylised stand-in character and box skyline break realism |
| **Average** | **4.3** | **5.3** | **BELOW the M2 target of 7** |

DECISION: round cap (4 for M2) reached and M2 is at its step cap; per spec the remaining shortfall is logged and its causes are at the top of GRAPHICS_BACKLOG.md. M3 (world generator) carries the "average >= 7 by M3" requirement and starts with the backlog's top items (density, facade materials, glass reflections, vegetation, night sky).
Checklist: wet-road reflections PASS (night), glass reflections PARTIAL, crushed blacks FIXED, clipped highlights FIXED (day exposure), bloom OK (sun only), shadows stable PASS, distinct materials PARTIAL, tiling at street scale PASS (anti-tiling), flat-lit surfaces PARTIAL (overcast), focal point PARTIAL, consistent style FAIL (stand-in character), roads readable PASS, convincing night PARTIAL, popping N/A (no streaming yet).
Budgets (High, golden shot): 2096 draw calls, 2.84 M triangles incl. 4 shadow cascades, 135 textures, JS heap ~240 MB -> must drop in M3 (LOD, instancing, shadow-caster culling).

## M3 — bot drives: streaming budgets (headless SwiftShader; frame times NOT meaningful)
Report mode (`?bot=<route>&report=1`) simulates at 1/30 s and renders every 30th frame, sampling stats.
| Run | samples | max km/h | draw calls | triangles (incl. 4 shadow cascades) | JS heap MB | worker chunk build max ms | main-thread chunk apply max ms |
|---|---|---|---|---|---|---|---|
| High, downtown avenue | 18 | 59 | 1263-2494 | 1.74-2.15 M | 273-300 | 790 | 84 (before time-slicing) |
| High, elevated highway | 16 | 109 | 933-2268 | 1.20-3.20 M | 254-345 | 1729 | **22** (time-sliced + pre-compiled shaders) |
| Low, elevated highway | 25 | 108 | 518-995 | 0.83-1.68 M | 141-200 | 987 | 33 |
Hitches: chunk application moved to a 4 ms/frame time slice and all kit shaders pre-compile at start (149 ms -> 22 ms worst case). Worker build time is off the main thread.
Budget targets (logged against in M9): High <= 2500 draws / 3.5 M tris; Low <= 1000 draws / 1.0 M tris — **Low exceeds the triangle target (1.68 M)**: Low needs a mid-detail near LOD (flat facades) — GRAPHICS_BACKLOG.
Drivability: the bot drove the avenue (-150 -> +108) and the highway ramp + deck (-960 -> -344) with no stalls; the tunnel route descends the 11% ramp and passes the covered section (m3_tunnel shot at 67 km/h).

## M3 — LOOK GATE (self-scored; shots/m3/)
| Category | Score | Evidence |
|---|---|---|
| Lighting & shadows | 6 | stable CSM over streamed chunks, canyon shadows with blue skylight fill, tower lobbies lit |
| Materials | 5.5 | PBR streets/sidewalks; facades still uniform per building, no edge wear |
| Reflections & glass | 6 | SSR wet avenues at night, curtain-wall towers with interiors; probe follows player |
| Atmosphere | 5.5 | haze hides LOD edge well (aerial), clouds; no light shafts |
| Density & detail | 5.5 | lamps, trees, furniture, parked cars, fire escapes, water towers, billboards, road wear; still few people/traffic |
| Character & vehicle | 5.5 | sourced cars good; stand-in characters (M4) |
| Effects | 3.5 | rain/steam/tyre smoke only (M5) |
| Post & colour | 6 | AgX + grade, light grain |
| Cohesion | 5.5 | consistent kit; far LOD massing plain |
| **Average** | **5.4** | **BELOW 7 (required by M3)** — remaining gap is mostly characters (M4) and effects (M5); GRAPHICS_BACKLOG item 0 updated |
Gates: FUN (vehicle) unchanged PASS on the shared sim; REALISM rest test props PASS, ragdolls UNVERIFIED; city drivable end to end incl. highway + tunnel (bot).
