# GRAPHICS BACKLOG (ordered by visual impact; done items move to the bottom)

## Open
0. (M2 5.3, M3 5.4 vs 7) Low tier near LOD needs flat-facade mid detail (Low tris 1.68 M > 1.0 M target); far LOD massing could get roof/facade variation.
0b. (M2 look gate shortfall, avg 5.3 vs 7) — fix first in M3: (a) density: clutter/decals/signage/litter, more traffic+peds, real streamed blocks instead of skyline boxes; (b) facade materials: edge wear, window variety, trims with grime masks; (c) tower glass: stronger probe reflections per block, panel variation; (d) night sky + light shafts; (e) effects in M5.
1. Characters: Michelle/Soldier stand-ins are stylised; need realistic Mixamo-rigged humans (Sketchfab, M4) with skin SSS fake, hair, cloth variation.
2. Vegetation: leaf-card trees are serviceable; source proper tree models (Sketchfab/Poly Haven CC0) with alpha cards + wind + LOD/impostors (M3/M8).
3. Golden hour warmth/aerial perspective: sky-tinted height fog + per-TOD LUT (3D LUT) instead of lift/gain grade; sun glare/flare; god rays.
4. Auto-exposure is per-TOD (deterministic); real luminance adaptation (downsampled avg luminance) still REPLACED.
5. Decals: cracks/oil/graffiti/tyre marks atlas (currently tar patches + manholes + skid ribbons).
6. Building variety: corner pieces, balconies, fire escapes, signage text, rooftop cables; ground-floor door details.
7. Night: light shafts in rain, wet-road light streaks (SSR covers part), headlight volumetric cone fakes.
8. SSR: half-res + temporal reuse for cost; currently full-res 40 steps on High/Ultra only.
9. Motion blur REPLACED by radial speed blur; per-object velocity blur not available.
10. Lens dirt + bloom streaks; heat haze for exhaust.
11. Texture budget: 2k normals dominate (39 MB); consider 1k normals on High with 2k albedo.

## Done
- M1: HDR pipeline (N8AO, bloom, AgX, grade, vignette, grain, CA, SMAA), CSM 4 cascades, Preetham sky + IBL, wet/puddle shader, rain.
- M2: KTX2 PBR sets (15 CC0), anti-tiling + grime, building kit with interior-mapped windows, look-slice street (paint, kerbs, manholes, lamps, traffic lights, trees, furniture, parked cars), SSR for wet surfaces, cloud/star/moon dome, scene reflection probe, sourced car (Kiri '86) via prep tool.
- (M4) Skin shading: add a cheap subsurface/wrap term + specular occlusion for character skin (faces read slightly plasticky at golden hour).
- (M4) Shop interiors: the bookshop interior repeats on every shopfront; add 4-6 interior themes (cafe, clothes, electronics, pharmacy) with per-shop selection.
- (M4) Crowd LOD1 shading: VAT crowd has no hair cut-out shadows; add alpha-tested depth for hair cards.
