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
