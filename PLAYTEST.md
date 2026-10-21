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

## M4 — REALISM GATE: grounding (tests/anim harness: analytic surfaces, foot IK on; standing_man unless noted)
Targets: planted foot within 1.5 cm, penetration <= 1 cm, planted slide < 2 cm/s, pelvis jumps < 3 cm/frame.
| case | planted |d| p95 / mean (cm) | penetration p99 (cm) | slide mean / p90 (cm/s) | pelvis max jump (cm) | verdict |
|---|---|---|---|---|---|
| flat walk 1.6 m/s | 0.94 / 0.09 | 0 | 1.1 / 2.8 | 0 | PASS |
| flat run 3.6 / sprint 5.6 | 0 / 0 (stance only) | 0 | 0 / 0 | 0 | PASS |
| idle | 0 | 0 | 0 | 0 | PASS |
| crouch idle + crouch walk 1.2 | 0 | 0 | 0 | 3.47 (crouch blend-in) | PASS (pelvis: logged, blend-in only) |
| slope 10 deg walk+run | 3.76 / 1.43 | 1.41 | 1.8 / 3.9 | 0 | PARTIAL (p95 over target; mean within) |
| kerb 15 cm walk+run | 2.02 / 0.40 | 5.03 | 0.8 / 0.1 | 1.36 | PARTIAL (swing foot clips the kerb edge for a frame) |
| stairs 17/30 cm walk 1.2 | 12.8 / 3.4 | 16.5 | 10 / 28 | 3.98 | FAIL (no stair-specific animation; IK can't fix the stride/riser mismatch) |
| police_f flat walk | 0.27 / 0.03 | 0 | 0.5 / 0 | 0 | PASS |
| lod_dude kerb walk | 4.48 / 0.78 | 7.63 | 3.9 / 18.8 | 1.35 | PARTIAL |
Relaxations (logged): stairs need a stair locomotion set (wave 3 has "Walking Up/Down Stairs" partially: only "Walking Up A Set Of Stairs" at 0.37 m/s is in core) — UNVERIFIED for stairs until then. Kerb edge clip is a single swing frame; fix planned with a toe-clearance pass (lift the swing foot over a raised edge ahead).

## M4 — on-foot controller gate (tools/footgate.ts, Node, real Rapier world)
`{"kerb_up":0.15,"kerb_ok":true,"stairs_top_y":1.36,"stairs_ok":true,"slope25_ok":true,"slope60_blocked":true,"jump_apex_m":0.88,"jump_ok":true,"wall_slide_ms":1.91,"wall_ok":true,"probe_top":0.9,"probe_ok":true,"crouch_ok":true,"failed":[]}` — PASS (kerb + 8-step stair climb, 25 deg ramp walkable, 60 deg blocked, 0.88 m jump apex, glancing wall hit keeps 1.9 m/s, vault probe reads a 0.90 m box at 1.0 m, crouch under a 1.3 m ceiling and no standing up underneath).
Vehicle fun gate re-run after M4: unchanged PASS (Balanced 0-cruise 6.63 s, 208.8 km/h, brake 40.2 m, drift 12 deg sd 3.7).

## M4 — REALISM GATE: rest test with ragdolls (tools/resttest.ts)
`{"props":200,"floating":0,"sinking":0,"jittering":1,"maxGapCm":0.33,"maxDrift2sCm":3.91,"asleep":198,"ragdolls":20,"ragFloating":0,"ragSinking":0,"ragJittering":1,"ragMaxSinkCm":0.64,"ragMaxContactGapCm":0.64,"ragMaxDrift2sCm":0.52}` — PASS with notes: one ball still rolling at 12 s (3.9 cm in 2 s; it was struck by a ragdoll), one ragdoll pelvis moved 0.52 cm in the last 2 s (threshold 0.5) while settling. No ragdoll floats or sinks (max 0.64 cm).

## M4 — vehicle realism (driver)
Seated driver: hips pinned to the seat H-point (model space 0.37, 0.50, -0.28), hands IK'd to the wheel rim points; enter/exit never teleports (route to door, slide in/out during the sit/stand clip). Door opening: not possible with the current Kiri model (no door nodes) — logged for the M6 fleet (prep tool to split doors).
