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
