# PROGRESS
NEXT STEP: M2 — source CC0 PBR sets (ambientCG: asphalt, concrete, brick, painted metal) + one Poly Haven HDRI; build tools/textures.mjs (resize, KTX2 or webp) and the look-slice city block (src/world/lookslice.ts).

STEPS_USED: ~150 (M0 ~80, M1 ~70)   DRIVE_CALLS_USED: 103 / 300
MILESTONE: M1 done (checkpoint 2)

## Milestones
- M0 Setup: DONE. Drive indexed (846 clips, 23 chars), wave 1 (82 clips) fetched + ingested (2.0MB bundles), Sketchfab working, Artifact route published, renderer = WebGL + postprocessing.

- M1 Vehicle feel grey-box: DONE. Rapier ray-cast vehicle in a worker + arcade assists (drift state + angle limiter, yaw assist, countersteer, anti-flip, self-right), chase cam, tuning panel (K) with presets + copy, synthesized audio, rain/night mood test. Fun gate proxies pass for all presets (PLAYTEST.md).

## DECISIONS
- Renderer (a) WebGL2 + pmndrs postprocessing (see DESIGN.md).
- Drive characters too big for the connector (10MB cap) -> stand-ins (three.js Mixamo models, Sketchfab Mixamo-rigged humanoids later).
- Artifact build ships non-web binaries as base64 JSON (`.b64.json`) because the host refuses .bin/.glb.
- Known-good build = commit hash in builds/known-good/COMMIT (no build outputs in git; rebuild with npm run build).
- Physics worker protocol: main posts 'step n' with inputs, worker replies with transferable snapshot; main interpolates. Weapon/IK raycasts will use a main-thread query world of statics (M4/M5).
- Shot mode simulates warm-up frames without rendering (SwiftShader is slow) and renders the last 4 frames at 1/30 s fixed dt.
- Sprint uses "Running Fast" (Drive "Sprinting" is a 2-key pose).

## MISSING CLIPS
- Sprint loop: "Sprinting" is a static pose -> use "Running Fast" (5.5 m/s) time-scaled.
- Car enter/exit: none in library -> procedural door/entry blend + "Standing Up From Seated Position"/"Pulled Out Of Pilot Seat" segments + IK (M4).
- Pistol idle/reload: no dedicated clips found -> "Pistol Aim To Holster Idle" frames + procedural reload (M5).
