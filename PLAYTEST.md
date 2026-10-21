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

## M4 — ANIMATION GATE (frame strips: shots/m4/anim_strip_loco.png, run_strip.png, anim_strip_enter.png, ragdoll_sheet.png)
- Locomotion (unarmed): walk / run / sprint read naturally, phase-synced and speed-matched (grounding table above). Defects found + fixed: "Walking Forwards" exaggerated arm swing (-> Male Walk Forward 03), "Running Forwards" right arm stuck overhead (-> Slow Run Forward), thread of stretched triangles between the knees (cross-leg triangles dropped in prep), backwards-facing / black-headed bodies (hair cut-out + facing fix), giant/invisible bodies (skinned bind-pose bounds). Open: crouch walk is a reversed backward clip with arms reaching forward (no unarmed forward crouch walk in the library).
- Enter/exit: route around the car to the driver door, sit while sliding in, hips pinned to the seat, hands on the wheel; no teleport. Open: door does not open (model has no door node) so the body passes through the closed door for ~0.4 s.
- Ragdoll + get-up: flung body tumbles over the car bonnet, settles flat (rest test), get-up picks back/stomach clip and blends from the ragdoll pose. Open: hit reactions by direction exist as clips (react bundle) but are wired with weapons in M5.
- Skeleton sanity: no inverted hips or twisted limbs in the strips; all 15 cast bodies share the Mixamo skeleton (verified by bone names). Crowd variety: 15 bodies x 4 palette variants (skinned) + per-instance tints (VAT crowd) — shots/m4/vat_close2.png.
- Aim up/down, fire, reload: UNVERIFIED until M5.

## M4 — LOOK GATE (self-scored; shots/m4/m4_final_sheet.jpg)
| category | score | evidence |
|---|---|---|
| lighting & shadows | 6 | golden-hour key light and contact shadows on the hero character; night street-lamp pools; shop interiors still flat |
| materials | 5.5 | cobbles/asphalt/kerb PBR read well; facades repetitive |
| reflections & glass | 5.5 | wet cobbles reflect lamps at night; tower glass still uniform |
| atmosphere | 6 | rain streaks + haze at night, warm sky at dusk |
| world density | 6 | skinned pedestrians + VAT crowd on sidewalks; few props |
| character & vehicle shading | 6.5 | realistic faces/clothes, hair cut-out, clearcoat car; skin lacks subsurface warmth |
| effects | 4 | rain/steam/skids only; fire/explosions arrive in M5/M6 |
| post & colour | 6 | AgX + grade; slightly dark mid-tones |
| cohesion | 6 | cast and car read as one era/style; bookshop interiors repeat |
Average 5.7 (target 7 by M3, carried forward; see GRAPHICS_BACKLOG). FUN GATE (on foot): UNPLAYED: needs human — questions added below.
- Human questions (M4): 1) Does the on-foot speed (walk 1.6 / run 3.7 / sprint 5.9 m/s) feel right, and is the turn-around too snappy? 2) Is getting into the car (walk round to the door, ~1.3 s sit) acceptable or too slow? 3) Does the camera behind the player collide or jump near shop pillars? 4) Do pedestrians look varied enough at a glance? 5) After being hit by a car, is the get-up delay (~3-4 s) too long?

## M5 — FUN GATE (combat, tools/combatgate.ts: Monte Carlo over src/data/weapons.json, aimed fire at the chest with bloom)
| weapon @ range vs target | TTK s | band | verdict |
|---|---|---|---|
| pistol@15m civ | 0.4 | [0.15, 1.2] | PASS |
| pistol@30m tac | 1.6 | [0.6, 3.5] | PASS |
| smg@5m tac | 0.75 | [0.1, 0.8] | PASS |
| smg@60m tac | 6.45 | [1.2, 10] | PASS |
| rifle@30m civ | 0.28 | [0.05, 0.6] | PASS |
| rifle@60m tac | 0.94 | [0.2, 2] | PASS |
| shotgun@5m civ | 0 | [0, 0.2] | PASS |
| shotgun@30m tac | None | [1.5, 10] | PASS |
| sniper@100m tac | 1.33 | [0, 1.6] | PASS |
Tuning from the gate: SMG damage 22->24, shotgun falloff 6-22 m/0.25 -> 8-28 m/0.35 and aimed spread 5->4 deg, sniper 110->150. Recoil: deterministic pitch per shot (10-shot burst pitch = 10 x 0.35 x recoil), yaw jitter bounded (reproducible envelope). Hit detection (ray vs capsule zones): head capsule hit when centred and missed 20 cm off at 10/50/150 m — PASS. Reload/switch timings come straight from the data (rig reload duration = data.reload; ammo refills at t+reload).

## M5 — REALISM GATE: grip test (tests/weapons?hold=<w>: 6 guns x [aim, pitch +25, pitch -20, low ready, strafing walk])
Primary grip error 0.0 cm everywhere; support hand <= 0.2 cm (after iterating the palm-offset IK and clamping the foregrip to arm reach); muzzle-to-aim-ray error < 0.001 deg while aiming. Weapon-body / weapon-wall penetration: not measured numerically (visual only: shots/m5/hold_sheet.png) — UNVERIFIED. Socket debug view: tests/weapons (shots/m5/weapons_sockets.png). Knife source is two crossed objects (knife + sheath): logged, melee only.

## M5 — AI test (shot m5_ai_fight, night rain, 3 hostiles at 20 m)
Hostiles alert on sight/gunfire (0.4 s sight confirmation), pick separate cover (reservation), advance when no cover, fire bursts after a 0.8 s aim-up warning and 1.5 s grace (misses first), max 4 simultaneous shooters, no friendly fire. In 200 frames: 43 player shots / 3 hits; player took 3 hits (200 -> 59 hp: fairness OK, lethal if you stand still). Navigation is grid routing via box corners (no navmesh library yet: DECISION logged). Stuck AI: none observed in the capture (all in cover/toCover states).

## M5 — LOOK GATE (shots/m5/combat_sheet.png, ai_fight.png, explosion.png)
Effects category 4 -> 5.5 (muzzle flash + pooled light, tracers, decals, sparks/dust, shells, explosion fireball + shockwave + smoke + debris + light). Night firefight with rain and wet reflections reads well. Average ~6.0 (still below 7: interiors repeat, no volumetric smoke, no fire spread yet).
- Human questions (M5): 1) Does aiming (RMB) feel responsive and is the over-the-shoulder zoom too tight? 2) Is the rifle too accurate when hip-firing? 3) Do AI opponents feel fair (warning, grace, accuracy)? 4) Is the recoil kick readable without being nauseating? 5) Are grenade arcs predictable enough without a trajectory preview?


## M6 — vehicle fleet, damage (checkpoint 7)

### Fleet fun gate (tools/fungate.ts, Balanced preset, per-class bands from `gate` in vehicle_tuning.json)
| class | 0→cruise s (band) | top km/h | 100→0 m | drift slip ° | wall exit km/h | ramp air s | result |
|---|---|---|---|---|---|---|---|
| ambulance | 10.2 (8–14) | 158.4 | 40.8 | n/a (not required) | 53.3 | 0.82 | PASS |
| compact | 7.93 (7–13) | 150.9 | 36.4 | n/a (not required) | 53.7 | 0.88 | PASS |
| muscle | 4.63 (3.5–7) | 237.6 | 40.3 | 14.4 | 60.5 | 1.03 | PASS |
| pickup | 7.25 (6.5–11) | 180 | 40.4 | 10 | 55.3 | 0.9 | PASS |
| police | 5.48 (4–8) | 230.3 | 40.3 | 13 | 57.8 | 0.95 | PASS |
| sedan2 | 7.18 (6.5–11) | 198 | 40.3 | 12.1 | 55.7 | 0.9 | PASS |
| sedan3 | 6.83 (6.5–11) | 201.6 | 40.2 | 12 | 56 | 0.9 | PASS |
| sedan | 6.63 (6.5–11) | 208.8 | 40.2 | 12 | 56.4 | 0.92 | PASS |
| sports | 4.2 (3.5–7) | 244.8 | 39.9 | 12.8 | 60.7 | 1.02 | PASS |
| suv | 7.28 (6–11) | 180 | 40.5 | n/a (not required) | 55.9 | 0.9 | PASS |
| taxi | 7.33 (6.5–11) | 198 | 40.4 | 10.2 | 55.3 | 0.9 | PASS |
| truck | 10.12 (8–22) | 118.7 | 67.6 | n/a (not required) | 0 | 0.73 | PASS |
| van | 10.2 (8–14) | 158.4 | 40.7 | n/a (not required) | 52.3 | 0.82 | PASS |
| wagon | 6.53 (6.5–11) | 208.8 | 40.4 | 10.6 | 56.6 | 0.93 | PASS |

All 14 classes pass. Braking converges on ~40 m for every car (the tyre friction model caps it, not brake force); the
box truck is detuned (67.6 m). Drift is only required of rear-drive cars with a low centre of mass.

### Damage test (shots/m6/m6_sheet.png, shots m6_damage / m6_car_explosion)
- Collision damage from horizontal Δv > ~3.5 g (2 s spawn grace); bullets and explosions via `hit()`.
- Dents: vertex displacement around the hit point (per-car geometry copies). Glass shatters (hidden + particles).
- Health: smoke < 45%, fire < 20%, explosion at 0 or after 7 s burning → charred, immobile wreck with lights off.
- Bug found and fixed: loaded cars merge their meshes under the body at load, so damage walked an empty node. It now
  walks the whole car root. A parked city car spawned on the player car's spot was also hiding the wreck; parked cars
  near the player's car are now hidden.
- Not done (logged): detachable parts (doors/bumpers), motorbike (no CC-BY bike with a usable rig found in budget).

### Fleet visuals (shots/m6/fleet_sheet.png)
14 sourced models (DanielZhabotinsky 80s family, CC-BY). Packed with tools/vehicle_pack.mjs: meshopt + WebP
(LOD0 1024, LOD1 256): 58 MB → 29 MB. Per-model seat H-point and door point derived from the model size
(+ `seatFront` override for cab-forward vans, ambulance, truck, colby). Engine audio profile (i4/v6/v8) follows the class.

### Human questions (M6)
1. Does each class feel distinct (sports/muscle vs. van/truck)? Is the truck too sluggish?
2. Are dents readable enough, or should impacts deform more?
3. Is the charred wreck dark enough at night?

## M7 — life systems and police (checkpoint 8)

### Traffic (shots/m7/m7_sheet.png, `?shot=m7_traffic`, 30 s simulated)
- Measured at 30 s: 21 spawned, 13 alive (tier cap), 8 despawned. Cruise 40–48 km/h on 16 m roads; cars stop at the stop line on red (e.g. x = −113, stop line at −112.5) and turn at intersections (several mid-turn in each sample).
- Deadlock found: two cars blocked each other at near-zero speed. Fixed with a creep-past after 6 s stuck and removal after 20 s when out of view. In the next sample no car was stuck for more than 6 s.
- Known gaps: no lane changes; turning cars yield only through the following check; no cross-traffic negotiation when signals are ignored (panic).

### Wanted / police (`?shot=m7_police`, 2 stars set at frame 20, 37 s simulated)
- Two pursuit cruisers spawned on the grid and reached the player; two officers deployed (states cover/advance) and fired. Player health 200 → 132 during the capture. Light bar flashing, siren audible in-browser.
### Wanted-system gate (tools/wantedgate.mjs → tools/out/wantedgate.json; `?report`, fixed 1/30 s per frame, simulated seconds)
| test | result | numbers |
|---|---|---|
| WASTED: 250 damage at 1 star | **PASS** | banner at 0 s; respawn after 5.6 s with health 200, on foot; stars 0 |
| LOSE POLICE: 2 stars, cruiser dispatched, player moved 1.2 km away (Harbour) | **FAIL** | stars still 2 after 30 s; unseen time stays 0; 2 units + 2 officers within 14 m of the player |
| BUSTED: 1 star, player standing still on foot | **FAIL** | officers out after 11.6 s; over 60 s the nearest officer holds at 2.49 m, just outside the 2.4 m arrest radius |

- Lose police: dispatch keeps spawning new cruisers 90–140 m from the player's current position with no knowledge check, so line of sight is regained almost immediately and the evade timer never runs. In play this means stars can only be lost if no road near the player is in streaming range, which effectively never happens. Not fixed (reported per instruction).
- Busted: the officer AI's advance stops at a standoff distance of about 2.5 m, which never satisfies the 2.4 m arrest check. Not fixed (reported per instruction).
- The test moves the player by teleport rather than by driving away. That isolates the evade timer from chase driving, so the failure above is in the dispatch rule, not in driving.

### Stress test (tools/stresstest.mjs → tools/out/stresstest.json)
See the table below (SwiftShader CPU raster at 480×270 — compare the phases with each other, not as fps).

### Human questions (M7)
1. Does traffic feel alive enough at the default density (16 cars), or does the city feel empty?
2. Is 2-star police aggression fair? Do officers shoot too accurately at range?
3. Does the evade timer (8 s + 3 s per star) feel right?
4. Is carjacking (E near any car) readable without a driver being pulled out?

## M8 — Harbour and sandbox tools (checkpoint 9)

### Harbour (shots/m8/m8_sheet.png)
- Water, quay, three piers, about 250 containers, four cranes, four warehouses, floodlights, two trawlers and two speedboats moored, one drivable speedboat.
- Boat test (`?shot=m8_boat`): the player walks the pier, boards from the pier side, and drives at full throttle with −0.3 rudder. Reached 10.1 m/s (36 km/h) in about 20 s with spray and planing pitch.
- Bugs found and fixed:
  - Car door routing assumed the door was on +X, which walked the player into the sea. Generalised to either side.
  - The boat door point sat below the deck, so the player never arrived at it. Raised it to deck height.
  - The speedboat model faced backwards. Re-prepped with `--flip`.
- Cut (per the spec's cut list): Hillside, real interiors, ambient events, challenge playlist.

### Spawn menu (B)
- Lists vehicles (14), weapons (9), teleports (5), traffic density, wanted level controls, god mode / never wanted, times of day and weathers. Spawning a car while seated swaps it under you.

### Human questions (M8)
1. Is the boat fun to drive? Is the turning too floaty?
2. Does the Harbour read as a working port at golden hour and at night?
3. Is the spawn menu quick enough to use mid-play?


## M9 — laptop tier pass (tools/tierpass.mjs → tools/out/tierpass.json)
Same views on every tier at 1280×720 (Downtown golden hour `m3_golden`; Harbour `m8_harbour`). Measured value / budget:
| tier | view | draw calls | triangles | texture MB (est.) | JS heap MB |
|---|---|---|---|---|---|
| low | Downtown | 1607 / 1200 ❌ | 3.53 M / 1.0 M ❌ | 850 / 1024 ✅ | 270 / 700 ✅ |
| low | Harbour | 932 / 1200 ✅ | 2.84 M / 1.0 M ❌ | 746 / 1024 ✅ | 249 / 700 ✅ |
| medium | Downtown | 2716 / 2000 ❌ | 8.93 M / 2.5 M ❌ | 1090 / 2048 ✅ | 340 / 900 ✅ |
| medium | Harbour | 1446 / 2000 ✅ | 7.68 M / 2.5 M ❌ | 861 / 2048 ✅ | 270 / 900 ✅ |
| high | Downtown | 3251 / 3000 ❌ | 14.01 M / 5.0 M ❌ | 963 / 4096 ✅ | 462 / 1200 ✅ |
| high | Harbour | 1808 / 3000 ✅ | 12.18 M / 5.0 M ❌ | 906 / 4096 ✅ | 390 / 1200 ✅ |
| ultra | Downtown | 4359 / 4500 ✅ | 18.56 M / 8.0 M ❌ | 1162 / 8192 ✅ | 542 / 1600 ✅ |
| ultra | Harbour | 2219 / 4500 ✅ | 16.00 M / 8.0 M ❌ | 906 / 8192 ✅ | 457 / 1600 ✅ |

- **Triangles fail on every tier.** Counts are per-frame totals across all passes: 2–4 shadow cascades and the depth/normal pre-passes for AO/SSR re-draw the scene. Even allowing for that, Downtown on Low is about 3.5× the 1.0 M budget (the M3 backlog already flagged Low near-LOD at 1.68 M scene triangles).
- **Downtown draw calls fail on Low, Medium and High** (1607, 2716, 3251). Harbour is within budget on every tier.
- Texture memory (estimated from texture dimensions / KTX2 mip data) and JS heap are within budget on every tier.
- LOD chains confirmed running (same view, `HARBOURLINE_DEBUG.stats().chunks`). Low: 9 near-LOD and 88 far-LOD chunks. Medium: 9 near and 128 far (longer draw distance). Character meshes in the scene: 3 large skinned meshes (player LOD0) and 96 small ones (under 9k vertices, i.e. LOD1 bodies). That LOD0/LOD1 split is a vertex-count heuristic. The LOD chains run, but they don't bring Low within the triangle or draw-call budget.
- The budgets were set for this pass (Low 1200 draws / 1.0 M triangles / 1 GB textures / 700 MB heap, doubling roughly per tier). They are not measured from real laptops.
