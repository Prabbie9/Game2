# PROGRESS
NEXT STEP: M1 — create src/ module skeleton (renderer/input/vehicles/camera/physics worker), build the grey-box test area + procedural car on Rapier raycast vehicle, chase camera.

STEPS_USED: ~75 (M0)   DRIVE_CALLS_USED: 103 / 300
MILESTONE: M0 done (checkpoint 1)

## Milestones
- M0 Setup: DONE. Drive indexed (846 clips, 23 chars), wave 1 (82 clips) fetched + ingested (2.0MB bundles), Sketchfab working, Artifact route published, renderer = WebGL + postprocessing.

## DECISIONS
- Renderer (a) WebGL2 + pmndrs postprocessing (see DESIGN.md).
- Drive characters too big for the connector (10MB cap) -> stand-ins (three.js Mixamo models, Sketchfab Mixamo-rigged humanoids later).
- Artifact build ships non-web binaries as base64 JSON (`.b64.json`) because the host refuses .bin/.glb.
- Sprint uses "Running Fast" (Drive "Sprinting" is a 2-key pose).

## MISSING CLIPS
- Sprint loop: "Sprinting" is a static pose -> use "Running Fast" (5.5 m/s) time-scaled.
- Car enter/exit: none in library -> procedural door/entry blend + "Standing Up From Seated Position"/"Pulled Out Of Pilot Seat" segments + IK (M4).
- Pistol idle/reload: no dedicated clips found -> "Pistol Aim To Holster Idle" frames + procedural reload (M5).
