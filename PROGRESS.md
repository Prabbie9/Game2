# PROGRESS
NEXT STEP: M9 — finish the stress-test numbers and the tier pass (tools/tierpass.mjs), final graphics pass on the new districts, artifact publish (vehicles + props batch), PLAY.md, FINAL_REPORT.md.

STEPS_USED: ~1035 (M0 ~80, M1 ~75, M2 ~190, M3 ~95, M4 ~220, M5 ~170, M6 ~105, M7 ~55, M8 ~30, M9 ~15 so far)   DRIVE_CALLS_USED: 196 / 300   SKETCHFAB_DOWNLOADS: 63 / 150
MILESTONE: M8 done (checkpoint 9) — Harbour + boat + spawn menu; M9 in progress (gamepad, photo mode, credits, audio, shop themes done)

## Milestones
- M0 Setup: DONE. Drive indexed (846 clips, 23 chars), wave 1 (82 clips) fetched + ingested (2.0MB bundles), Sketchfab working, Artifact route published, renderer = WebGL + postprocessing.

- M1 Vehicle feel grey-box: DONE. Rapier ray-cast vehicle in a worker + arcade assists (drift state + angle limiter, yaw assist, countersteer, anti-flip, self-right), chase cam, tuning panel (K) with presets + copy, synthesized audio, rain/night mood test. Fun gate proxies pass for all presets (PLAYTEST.md).
- M2 Look slice: DONE with shortfall. PBR KTX2 library, building kit + interior mapping, intersection slice, SSR, sky dome, scene probe, sourced car via prep tool (Kiri '86), Mixamo peds, rest test (props pass).
- M4 Characters + animation: DONE with shortfalls (stairs grounding, door opening, crouch walk arms, look avg 5.7). Wave 2 (62 clips) ingested -> 144 clips / 6 bundles. Cast: 15 Sketchfab Mixamo-rigged bodies (CC-BY) prepped to LOD0 (~24k tris, 60k player) + LOD1 (~6k) with meshopt + WebP, palette variants (4 per body -> 60 looks). On-foot player (Rapier character controller in the worker: autostep, snap, slope limit, crouch capsule, obstacle probe), speed-matched phase-synced gait blend tree, jump/fall/land, vault/climb, foot IK (two-bone, toe/heel contact, pelvis, ankle-to-normal, planted locking), car enter/exit without teleport (door route, seat H-point pin, steering-wheel hand IK), ragdolls + get-up blend, vehicle impacts, cast pedestrians, VAT instanced crowd (mid/far).
- M5 Weapons + combat: DONE. Wave 3 (29 clips), 11 sourced weapons (prep tool: auto orientation + sockets), data-driven ballistics, weapon rig (palm anchor, shouldering, spine aim offset, two-hand IK, recoil spring, procedural reload), directional armed stances, hitscan zones / projectiles / throwables / explosions with physics impulses, combat FX, player arsenal + aim camera + crosshair, hostile AI (cover, routing, warning + grace), combat + grip gates.
- M7 Life systems + police: DONE. Street traffic system (lane pursuit, signals, turns, following, panic, spawn/despawn), carjacking, wanted levels 1–5 with grid pursuit, ramming, officers (Combatants) by level, evasion by line of sight, BUSTED/WASTED, siren + light bars, crowd scatter on gunfire, stress-test harness.
- M8 World expansion + sandbox tools: DONE with cuts. Harbour district (water, quay, piers, containers, cranes, warehouses, floodlights, moored boats), drivable speedboat, drowning, spawn menu (B). Cut: Hillside, interiors, ambient events, challenge playlist.
- M6 Vehicle fleet + damage: DONE with cuts. 14 sourced classes (DanielZhabotinsky CC-BY family) prepped + packed (meshopt/WebP, 58→29 MB), per-class tuning generated from geometry with per-class gate bands — all 14 pass. VehicleDamage: dents, glass, smoke/fire, explosion, charred wreck. Per-class engine profile, per-model seat/door points. Cut: motorbike, detachable parts (logged in UPGRADES).
- M3 World generator + streaming: DONE. Seeded Downtown (grid, arterials, plaza, underpass/tunnel, elevated highway), 128 m chunks built in 2 workers, near/far LOD, physics groups, time-sliced apply, shader pre-warm, bot budget reports.

## DECISIONS
- M7: traffic is a lane-pursuit system on the analytic street grid instead of a baked lane graph (the grid is regular, so lanes and junction polylines are computed). Police reuse the traffic pool for cruisers and Combatant for officers.
- M8: the Harbour is one non-streamed district built on the main thread; the boat is an arcade model on the main thread (no Rapier buoyancy) to keep the physics worker unchanged. Hillside/interiors/ambient events cut per the spec's cut list.
- M6: motorbike and detachable parts cut for budget (spec priority list: extra vehicle classes cut from the end). Vehicles packed with meshopt; the runtime dequantises body meshes before merging so dents and merges work in float units.
- Renderer (a) WebGL2 + pmndrs postprocessing (see DESIGN.md).
- Drive characters too big for the connector (10MB cap) -> stand-ins (three.js Mixamo models, Sketchfab Mixamo-rigged humanoids later).
- Artifact build ships non-web binaries as base64 JSON (`.b64.json`) because the host refuses .bin/.glb.
- Known-good build = commit hash in builds/known-good/COMMIT (no build outputs in git; rebuild with npm run build).
- Physics worker protocol: main posts 'step n' with inputs, worker replies with transferable snapshot; main interpolates. Weapon/IK raycasts will use a main-thread query world of statics (M4/M5).
- Shot mode simulates warm-up frames without rendering (SwiftShader is slow) and renders the last 4 frames at 1/30 s fixed dt.
- Artifact build ships 1k textures only (download size); 2k on other routes for High/Ultra.
- Sourced vehicle family: DanielZhabotinsky's CC-BY low-poly 80s cars (Kiri, Fairheaven, Negotiator, Riverside, Illinois, Canyon taxi, Cop cruiser) for cohesion.
- SSR pass must run BEFORE N8AO (N8AO drops later pass output).
- Default scene is the streamed city; ?scene=slice keeps the M2 look slice, ?scene=test the M1 track.
- Ground heights are analytic from the city layout (useful for foot IK / props without physics queries).
- Sprint uses "Running Fast" (Drive "Sprinting" is a 2-key pose).
- Cast = Sketchfab Mixamo-rigged bodies (bones verified, renamed to bare Mixamo names in tools/char_prep.mjs). Rejected: fantasy/medieval Fuse outfits (3), sci-fi suit, broken SWAT rig, a body with a Marvel logo, multi-copy file, non-Mixamo rigs (Renderpeople UE skeleton, CC_Base, in3D), anything uploaded from games (CS2, Detroit, Last of Us, Scary Teacher) never downloaded.
- Default walk = "Male Walk Forward 03" (the "Walking Forwards" clip has an exaggerated arm swing); female bodies use "Female Walk Forward".
- Rapier character controller: never call setMinSlopeSlideAngle (kills autostep) and never toggle autostep at runtime (capsule sinks); steep ramps are blocked by projecting out the uphill velocity instead.
- Scripted moves (vault, entering/exiting a seat) disable the capsule collider so they never shove cars or props.
- Crowd: nearest pedestrians are full skinned characters (cast LOD0/LOD1); beyond 26 m an instanced VAT crowd (baked at load from LOD1 bodies, no assets shipped) scaled by tier (88 on Low .. 220 on High).
- Default sandbox start is on foot beside the parked car; shots with a route and ?bot= start seated.

## MISSING CLIPS
- Sprint loop: "Sprinting" is a static pose -> use "Running Fast" (5.5 m/s) time-scaled.
- Car enter/exit: none in library -> walk-to-door route + "Standing To Sitting Transition" slid into the seat (hips pinned to the H-point) / "Standing Up From Seated Position" for exit; hands on the wheel by IK. Doors don't open yet (Kiri model has no door nodes).
- Crouched forward walk: none -> "Walking Backwards While Crouched" played reversed.
- Pistol idle/reload: no dedicated clips found -> "Pistol Aim To Holster Idle" frames + procedural reload (M5).
- "Running Forwards" holds the right arm overhead in our retarget -> run gait = "Slow Run Forward" (wave 3a, 2 calls).
- Weapons: hand-held placement is procedural (palm anchor + aim alignment + IK) rather than authored per-weapon hand offsets; sockets come from geometry (tools/weapon_prep.mjs) with overrides in tools/weapon_overrides.json.
- AI navigation: grid routing via blocking-box corners on the main thread instead of recast-navigation-js (the street grid makes straight segments sufficient; revisit for Harbour/Hillside in M8).
- Character controller: refresh Rapier scene queries before controller steps; toggle the capsule collider only on change; keep a 0.5 m/s ground push (grounded flag).
