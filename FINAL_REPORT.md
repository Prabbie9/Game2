# Harbourline: final report

Harbourline is a browser open-world sandbox: Downtown is streamed and has a working Harbour; you can drive, walk, shoot, steal cars, get chased by the police and drive a boat. It is built with three.js (WebGL2 + pmndrs postprocessing), Rapier physics in a worker, and sourced CC-BY assets: Mixamo-rigged people, an 80s car family, weapons and boats.
Nobody has played it. Every "gate" below is a bot-measured proxy, and the FUN gate is marked **UNPLAYED: needs human**.

## Where to play
See PLAY.md. Short version: the private Artifact preview, or `npm run play` in a Codespace or locally.

## Milestones
| | Result | Notes |
|---|---|---|
| M0 Setup | done | Drive indexed (846 clips), Sketchfab pipeline with a licence ledger, Artifact route |
| M1 Vehicle feel | done | Rapier ray-cast vehicle + arcade assists; fun-gate proxies pass for every preset |
| M2 Look slice | done, shortfall | Look 5.3/7 at the gate |
| M3 Streaming + Downtown | done | 128 m chunks built in workers, near/far LOD, highway, underpass |
| M4 Characters + animation | done, shortfalls | 15 Mixamo-rigged bodies × 4 palettes; gait blending, foot IK, ragdolls with get-up. Stairs grounding still fails (logged) |
| M5 Weapons + combat | done | 11 weapons; combat gate (TTK bands, recoil, hit detection) and grip test pass; hostile AI in cover |
| M6 Fleet + damage | done, cuts | 14 classes all pass the per-class fun gate; dents, glass, fire, explosion, wreck. Motorbike and detachable parts cut |
| M7 Life + police | done | Street traffic, carjacking, wanted 1–5, cruisers + officers, evasion, BUSTED/WASTED, stress test |
| M8 World + sandbox | done, cuts | Harbour, drivable boat, spawn menu. Hillside, interiors, ambient events and challenge playlist cut (all on the spec's cut list) |
| M9 Audio + polish | done, partial | Gamepad, photo mode, Credits screen, gun/explosion/ambient audio, skin shading, shop themes, tier pass |

## Gates
- **FUN (proxies)**: vehicle fun gate passes for all 14 classes (PLAYTEST.md M6). Combat gate passes (M5). Foot gate passes except stairs (M4). Traffic and police behaviour were verified in captures (M7). **UNPLAYED: needs human.** There are five or more human questions per milestone in PLAYTEST.md.
- **LOOK**: self-scored 5.3 (M2) → 5.7 (M4) → about 6.0 (M5) against a target of 7. Not met. See GRAPHICS_BACKLOG.md for what would close the gap.
- **ANIMATION**: grounding and grip numbers are in PLAYTEST.md (M4/M5). Remaining: stairs, door opening and crouch-walk arms.
- **REALISM**: physics-driven vehicles, ragdolls and explosions (Δv model), plus vehicle damage. No buoyancy physics for the boat (it uses an arcade model).

## Stress test and tiers
STRESS_AND_TIERS_PLACEHOLDER

## Budgets used
STEPS_PLACEHOLDER

## Known issues (most important first)
1. Stairs grounding fails the foot gate: feet float or clip on long stair runs.
2. Traffic has no lane changes or cross-traffic negotiation; panicking drivers can crash at junctions.
3. Carjacking swaps cars instantly; no driver is pulled out.
4. Police officers can spawn on the far side of a cruiser that is in a wall; evasion relies on building ray casts only (vegetation does not block line of sight).
5. The boat is arcade (no waves or buoyancy) and only collides with the quay, the piers and the map edge (not with moored boats).
6. Look is below the 7/7 target. The biggest wins would be density and variety (decals, signage), sourced Harbour props, a second water normal layer, and real luminance adaptation.
7. SwiftShader is the only renderer measured here: real-GPU frame times are unknown.

## What a human should do first
1. Play 10 minutes: drive each class from the spawn menu (B), steal a car, start a 3-star chase, lose it, take the boat out at the Harbour.
2. Answer the human questions in PLAYTEST.md.
3. Check the Credits screen (Esc → Credits). AMBER-graded assets (if any) need a licence review before any public link.
