# PROGRESS
NEXT STEP: M4 — search Sketchfab for realistic Mixamo-rigged humanoids (verify mixamorig bones, CC-BY/CC0), then player controller + anim state machine.

STEPS_USED: ~450 (M0 ~80, M1 ~75, M2 ~190, M3 ~95, M4 ~10)   DRIVE_CALLS_USED: 165 / 300
MILESTONE: M3 done (checkpoint 4) — look gate BELOW target (5.4/7), carried forward

## Milestones
- M0 Setup: DONE. Drive indexed (846 clips, 23 chars), wave 1 (82 clips) fetched + ingested (2.0MB bundles), Sketchfab working, Artifact route published, renderer = WebGL + postprocessing.

- M1 Vehicle feel grey-box: DONE. Rapier ray-cast vehicle in a worker + arcade assists (drift state + angle limiter, yaw assist, countersteer, anti-flip, self-right), chase cam, tuning panel (K) with presets + copy, synthesized audio, rain/night mood test. Fun gate proxies pass for all presets (PLAYTEST.md).
- M2 Look slice: DONE with shortfall. PBR KTX2 library, building kit + interior mapping, intersection slice, SSR, sky dome, scene probe, sourced car via prep tool (Kiri '86), Mixamo peds, rest test (props pass).
- M3 World generator + streaming: DONE. Seeded Downtown (grid, arterials, plaza, underpass/tunnel, elevated highway), 128 m chunks built in 2 workers, near/far LOD, physics groups, time-sliced apply, shader pre-warm, bot budget reports.

## DECISIONS
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

## MISSING CLIPS
- Sprint loop: "Sprinting" is a static pose -> use "Running Fast" (5.5 m/s) time-scaled.
- Car enter/exit: none in library -> procedural door/entry blend + "Standing Up From Seated Position"/"Pulled Out Of Pilot Seat" segments + IK (M4).
- Pistol idle/reload: no dedicated clips found -> "Pistol Aim To Holster Idle" frames + procedural reload (M5).
