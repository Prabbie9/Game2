# PERF_LOG

Every change is listed with the numbers measured before and after it. All numbers come from headless Chromium on
SwiftShader (CPU raster) in this container.

- **What carries over to real hardware:** draw calls, triangle counts, texture memory, JS heap and download size.
- **What doesn't:** frame times from this container are not real performance. No frame rate in this file was
  measured on a GPU.

## How things are measured
- **Tier pass** (`tools/tierpass.mjs`):
  - Views: Downtown golden hour (`m3_golden`) and Harbour (`m8_harbour`) at 1280×720, each plain and under the stress
    load (40 cars, 100 pedestrians, 20 combatants, 5 simultaneous explosions).
  - **draws** = `renderer.info.render.calls` for one full frame, all passes.
  - **mainTris** = triangles of meshes inside the main camera frustum, counted once (the scene triangles for one main
    view).
  - **passTris** = `renderer.info` triangles for the whole frame, including every shadow cascade and the depth/normal
    pre-passes. The earlier "triangle budgets" were compared against passTris and were self-set, so they are
    **unconfirmed**.
  - **texMB** = estimated GPU texture memory: KTX2 mip data size for compressed textures, w×h×4×1.33 for the rest.
  - **heapMB** = `performance.memory.usedJSHeapSize`.
- **Draw audit** (`tools/drawaudit.mjs <shot> <tier>`): groups visible meshes by category. Its estimate counts
  meshes before frustum culling, so its rows add up to more than `draws`.

## Targets (Phase 1)
| tier | draw calls (Downtown, Harbour, plain and under stress) | texture budget (tiers.ts) |
|---|---|---|
| Lite | ≤ 800 | 512 MB |
| Low | ≤ 1,200 | 1,024 MB |
| Medium | ≤ 1,800 | 2,048 MB |
| High | ≤ 2,500 | 4,096 MB |

## Baseline (before Phase 1)
From the M9 tier pass (preview v9) and the Lite measurement (preview v10), plain views:
| tier | Downtown draws | Harbour draws | Downtown passTris | texMB | heapMB |
|---|---|---|---|---|---|
| Lite | 1,472 | 831 | 2.91 M | 792 (over the 512 budget) | 264 |
| Low | 1,607 | 932 | 3.53 M | 850 | 270 |
| Medium | 2,716 | 1,446 | 8.93 M | 1,090 | 340 |
| High | 3,251 | 1,808 | 14.0 M | 963 | 462 |

Under stress (Low, 480×270, stress harness): about 5,741 draws loaded and 5,791 with explosions.

## Changes
| # | change | measured on | before | after | tested |
|---|---|---|---|---|---|
| 1 | One wall material per style (building tint as vertex colour; was one material per tint); Lite/Low cars cast shadows from the body mesh only; Low traffic cap 8; Lite/Low police caps; Harbour cranes and sheds merged | Low Downtown, draw audit | 1,607 | 1,377 | yes (audit) |
| 2 | Parked cars as GPU instances (`ParkedFleet`, one InstancedMesh per material; ~396 → 22 meshes); car wheels merged per material | Low Downtown | 1,377 | 1,343 | yes (audit). Most parked cars were already frustum-culled in this view, so the visible saving is small. |
| 3 | Traffic lights as instance pools (1 housing + 6 lamp pools instead of ~256 meshes); far chunks skip sidewalk slabs on Lite/Low; car light materials shared per source material | Low Downtown | 1,343 | 1,259 | yes (audit). Far sidewalk drop compared in `shots/m10/far_walk_sheet.png` (slightly flatter far ground, so Lite/Low only). The skinned-mesh merge built in the same step had **no effect** (characters still 99 meshes; under investigation). |
| 4 | Character frustum culling: skinned meshes get a padded, bone-transformed bounding sphere (they were `frustumCulled = false`, so every character drew even off-screen); shadow budget (only the nearest 2/4/8/16 characters cast on Lite/Low/Medium/High) | Low Downtown | 1,259 | 1,040 | yes (audit + hero screenshot `shots/m10/hero_merged.png`). The first sphere attempt used quantised bind-pose positions and culled the player; fixed by computing it from bone-transformed vertices. A skinned sub-mesh merge was **reverted**: meshopt-quantised sub-meshes have different inverse bind matrices, and reconciling them broke the mouth mesh (`shots/m10/char_check.png`). |
| 5 | Lite/Low: trim, awnings, rooftop parts, poles and roofs stop casting shadows; the 5 sign colours share one material (colour per vertex drives the emissive); white and yellow road paint share one material; street trees are instances of one template (3 pools instead of 3 meshes per chunk) | Low Downtown | 1,040 | 898 | yes (audit + `shots/m10/golden_compare.png`, `shots/m10/night_compare.png`). Street-prop layout shifts slightly because the template tree consumes fewer random numbers. |
| 6 | Far-LOD chunks merged per 4×4-chunk region (`FarMerger`, ≤1 region rebuilt per frame) | Low Downtown | 898 | 885 | yes (audit; aerial `shots/m10/far_merge_compare.png` is identical). Small win in this view because most far chunks were already frustum-culled; it matters more for wide views. |
| 7 | Car far LOD: beyond 30/40/60/80 m (Lite/Low/Medium/High) a traffic car draws as one vertex-coloured impostor mesh (average texture colour per material); the player's car always stays full detail | Low Downtown, traffic view | 885 | 871 | yes (audit + `shots/m10/carlod_traffic.png`) |
| 8 | Lite texture cap: uncompressed textures over 512 px are downscaled once on a canvas before upload (KTX2 left alone) | Lite Downtown, tier pass | 724 MB texMB | 428 MB | yes (tier pass + `shots/m10/lite_texcap_hero.png`) |
| 9 | Character detail LOD (eyes, teeth, lashes and sub-meshes under 1,500 vertices hidden beyond 12/18/25/35 m); Lite uses the LOD1 bodies for traffic drivers, pedestrians and combatants; the shadow/detail budget now also runs the frame a character finishes loading (before, it ran every 15 frames, so freshly spawned combatants drew full detail with shadows) | Lite Harbour stress, tier pass | 3,726 | 1,854 | yes (tier pass). Lite Downtown plain 810 → 722 in the same build |
| 10 | Lite/Low crowd: each crowd body's VAT parts merged into one geometry with an albedo atlas (one draw per body instead of ~9); Lite crowd no longer casts shadows (the check only excluded Low) | Lite Harbour stress, `tools/drawattrib.mjs` | 1,854 | 1,648 | yes (draw attribution; `shots/m10/crowd_atlas_lite.png`) |
| 11 | Transmissive glass replaced by alpha glass in `setupMaterial` (the speedboat windshield has KHR_materials_transmission; while a boat was on screen three.js re-rendered every opaque object into a refraction target) | Lite Harbour stress | 1,648 | 1,022 | yes (draw attribution; `shots/m10/boat_glass_lite.png`) |
| 12 | AI weapons: merged lean model (textured parts per material, flat-colour parts in one vertex-coloured mesh; the rifle was 11 meshes, now 1); weapon shadows follow the holder's shadow budget; rigid character gear under 6,000 vertices (pouches, magazines, patches) hidden beyond detail range | Lite Harbour stress | 1,022 | 377 | yes (draw attribution; `shots/m10/lean_ai_lite.png`) |
| 13 | Artifact base64 assets: payload sliced out of the `{b64}` JSON instead of `JSON.parse`, decoded with native `Uint8Array.fromBase64` (fallback: the old atob loop) | 8 MB blob, headless Chromium | 277 ms | 31 ms | yes (bytes identical; container CPU, so compare ratio only) |
| 14 | Dynamic quality scaler (`src/renderer/scaler.ts`): over budget for 1.5 s → render scale −0.1 down to 0.5, then population −25% down to 25%; 4 s well under budget → population first, then resolution back up. Lite/Low/Medium only | `tools/scalertest.mjs` (forced frame times) | – | steps down to 0.5 / 25% and fully recovers | yes (scaler test PASS) |

## Tier pass after changes 1–14 (commit b858762, `tools/tierpass.mjs`, 1280×720)
draws = all passes for one frame; mainTris = main-view scene triangles counted once; passTris = whole frame incl. shadow cascades and depth/normal pre-passes. Stress = 40 cars, 100 pedestrians, 20 combatants, 5 explosions.
| tier (target) | view | draws | mainTris | passTris | texMB (budget) | heapMB |
|---|---|---|---|---|---|---|
| Lite (≤800) | Downtown | 304 ✅ | 1.57 M | 2.36 M | 278 (512) ✅ | 217 |
| Lite | Harbour | 223 ✅ | 1.37 M | 2.32 M | 279 ✅ | 217 |
| Lite | Downtown stress | 459 ✅ | 2.64 M | 3.45 M | 403 ✅ | 329 |
| Lite | Harbour stress | 377 ✅ | 2.43 M | 3.41 M | 391 ✅ | 257 |
| Low (≤1,200) | Downtown | 372 ✅ | 1.84 M | 3.60 M | 708 (1,024) ✅ | 278 |
| Low | Harbour | 274 ✅ | 1.62 M | 3.40 M | 845 ✅ | 262 |
| Low | Downtown stress | 561 ✅ | 2.77 M | 4.68 M | **1,489 ❌** | 454 |
| Low | Harbour stress | 442 ✅ | 2.50 M | 4.46 M | **1,192 ❌** | 284 |
| Medium (≤1,800) | Downtown | 952 ✅ | 2.45 M | 8.69 M | 872 (2,048) ✅ | 301 |
| Medium | Harbour | 769 ✅ | 2.24 M | 8.51 M | 735 ✅ | 243 |
| Medium | Downtown stress | 1,560 ✅ | 2.89 M | 9.25 M | 1,568 ✅ | 464 |
| Medium | Harbour stress | 1,044 ✅ | 2.64 M | 8.39 M | 1,208 ✅ | 289 |
| High (≤2,500) | Downtown | 1,358 ✅ | 2.91 M | 13.5 M | 1,077 (4,096) ✅ | 430 |
| High | Harbour | 966 ✅ | 2.70 M | 12.9 M | 849 ✅ | 380 |
| High | Downtown stress | 1,926 ✅ | 2.91 M | 12.2 M | 1,676 ✅ | 629 |
| High | Harbour stress | 1,405 ✅ | 2.64 M | 11.5 M | 1,332 ✅ | 422 |

Every draw-call target is met. Texture memory on Low under stress is over budget; change 15 (Low 1,024 px texture cap) addresses it and is re-measured on the next tier pass. Heap is within budget everywhere (budgets: Lite 600, Low 700, Medium 900, High 1,200 MB).

### Re-measure on commit 690659c (Low 1,024 px cap, Harbour dressing, water layer)
Draws (target): Lite 313 / 232 / 471 / 386; Low 382 / 286 / 555 / 454; Medium 1,051 / 785 / 1,518 / 1,060; High 1,481 / 985 / 2,040 / 1,424 (Downtown / Harbour / Downtown stress / Harbour stress). All within target.
**Low texture memory under stress is still over budget: 1,609 MB Downtown, 1,203 MB Harbour (budget 1,024). The 1,024 px cap had no measurable effect** — the bulk is not uncompressed images above 1,024 px. Under investigation (change 15 is not counted as a fix).
