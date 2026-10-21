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
| M7 Life + police | done, **2 gate failures** | Street traffic, carjacking, wanted 1–5, cruisers + officers. Wanted gate: WASTED passes; LOSE POLICE and BUSTED **fail** (below). Stress test run |
| M8 World + sandbox | done, cuts | Harbour, drivable boat, spawn menu. Hillside, interiors, ambient events and challenge playlist cut (all on the spec's cut list) |
| M9 Audio + polish | done, partial | Gamepad (standard mapping; not tested with a real pad), photo mode, Credits screen, gun/explosion/ambient audio, skin sheen, shop themes, tier pass (fails budgets). Screenshots: shots/m9/ |

## Gates
- **FUN (proxies)**: vehicle fun gate passes for all 14 classes (PLAYTEST.md M6). Combat gate passes (M5). Foot gate passes except stairs (M4). The wanted-system gate (M7) passes WASTED but **fails LOSE POLICE and BUSTED**. Frame-time p99 is not within any budget on the software renderer (below). **UNPLAYED: needs human.** Human questions for each milestone are in PLAYTEST.md (3–5 each).
- **LOOK**: self-scored 5.3 (M2) → 5.7 (M4) → about 6.0 (M5) against a target of 7. Not met. See GRAPHICS_BACKLOG.md for what would close the gap.
- **ANIMATION**: grounding and grip numbers are in PLAYTEST.md (M4/M5). Remaining: stairs, door opening and crouch-walk arms.
- **REALISM**: physics-driven vehicles, ragdolls and explosions (Δv model), plus vehicle damage. No buoyancy physics for the boat (it uses an arcade model).

## Stress test and tiers
All of this runs on SwiftShader (CPU raster) in this container. Counts and memory are real; frame times only compare phases with each other.

**Stress test** (tools/stresstest.mjs; Low tier, 480×270; 40 cars, 100 pedestrians, 20 combatants, 5 simultaneous explosions):
| phase | frame p50 | frame p99 | physics p50 / p95 | draw calls |
|---|---|---|---|---|
| baseline (12 cars) | 1.40 s | 13.2 s | 45 ms / 10.0 s | 1,031 |
| loaded (40 cars, 20 AI) | 7.86 s | 8.98 s | 174 ms / 215 ms | 5,741 |
| + 5 explosions | 7.62 s | 20.7 s | 169 ms / 12.0 s | 5,791 |
Under load the median frame time is ×5.6 the baseline. Explosions double the p99 (physics stalls of 12–21 s), and draw calls reach about 4.8× the Low budget. The baseline tail contains streaming stalls, so compare p50s. A first run was invalid (it measured the clamped `dt`, so every frame read 100 ms). It is kept as `tools/out/stresstest_run1_dtclamped.json`.

**Tier pass** (tools/tierpass.mjs; Downtown golden-hour and Harbour views at 1280×720), measured / budget:
| tier | draw calls (Downtown / Harbour) | triangles (Downtown) | textures | JS heap |
|---|---|---|---|---|
| Low | 1,607 ❌ / 932 ✅ of 1,200 | 3.53 M ❌ of 1.0 M | 850 MB ✅ | 270 MB ✅ |
| Medium | 2,716 ❌ / 1,446 ✅ of 2,000 | 8.93 M ❌ of 2.5 M | 1,090 MB ✅ | 340 MB ✅ |
| High | 3,251 ❌ / 1,808 ✅ of 3,000 | 14.0 M ❌ of 5 M | 963 MB ✅ | 462 MB ✅ |
| Ultra | 4,359 ✅ / 2,219 ✅ of 4,500 | 18.6 M ❌ of 8 M | 1,162 MB ✅ | 542 MB ✅ |
- Triangles fail on every tier, and Downtown draw calls fail on Low, Medium and High. Triangle counts include every shadow cascade and the depth/normal pre-passes.
- The LOD chains do run on Low and Medium (9 near and 88/128 far chunks; LOD1 bodies) but don't get Low within budget.
- The budgets were set for this pass, not measured on real laptops. **The laptop-tier goal is not met.**

## Budgets used
STEPS_USED about 1,150 of 1,500, with features stopped at the user's request before the 85% mark. DRIVE_CALLS_USED 196 / 300 (read-only). SKETCHFAB_DOWNLOADS 63 / 150, all CC-BY (GREEN; the ledger records 63 × `by`, and CREDITS.md has no AMBER or RED rows). Publishing stayed private: one Artifact preview, version 9.

## Known issues (most important first)
1. **Losing the police doesn't work.** Dispatch keeps spawning cruisers 90–140 m from the player's current position, so line of sight comes back at once and the evade timer never runs (gate: stars still 2 after 30 s, 1.2 km away).
2. **BUSTED never triggers.** Officers stop advancing at about 2.49 m, outside the 2.4 m arrest radius (gate: 60 s, no arrest).
3. **Performance on laptops is unproven and over budget.** Draw calls and triangles exceed the budgets (tier pass), the stress test degrades the median frame ×5.6, and explosions cause physics stalls.
4. Stairs grounding fails the foot gate: feet float or clip on long stair runs.
5. Traffic has no lane changes or cross-traffic negotiation; panicking drivers can crash at junctions.
6. Carjacking swaps cars instantly; no driver is pulled out.
7. Police officers can spawn on the far side of a cruiser that is in a wall; evasion relies on building ray casts only (vegetation does not block line of sight).
8. The boat is arcade (no waves or buoyancy) and only collides with the quay, the piers and the map edge (not with moored boats).
9. Look is below the 7/7 target. The biggest wins would be density and variety (decals, signage), sourced Harbour props, a second water normal layer, and real luminance adaptation.
10. SwiftShader is the only renderer measured here: real-GPU frame times are unknown.
11. The hosted preview (version 9) was checked only by booting the same base64 build locally (no errors, boat loaded). The claude.ai-hosted copy needs your sign-in and wasn't opened from here.

## What a human should do first
1. Play 10 minutes: drive each class from the spawn menu (B), steal a car, start a 3-star chase (losing it is known to be broken; use the spawn menu's Clear wanted), take the boat out at the Harbour.
2. Answer the human questions in PLAYTEST.md.
3. Check the Credits screen (Esc → Credits). Every Sketchfab asset is CC-BY and needs the credit kept if you ever share it publicly.
