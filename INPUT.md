# INPUT — actions, bindings, extension points

Code: `src/input/input.ts`. Game code only reads **actions**; it never sees keys.

## API
- `input.held(action)` digital hold, `input.pressed(action)` edge this frame, `input.value(action)` analog 0..1, `input.axis(neg, pos)` analog -1..1.
- `input.lookDelta()` — the single look interface (radians-ish, sensitivity applied, acceleration OFF). `input.aimAssist` hook is intentionally `null`.
- `input.rebind(action, slot, code)`, `input.resetBindings()`; bindings persist in localStorage (`harbourline.bindings.v1`).
- Options: `sensitivity`, `invertY`, `holdAim` / `holdCrouch` / `holdSprint` (hold vs toggle).
- Prompt glyphs: `GLYPHS` lookup table + `glyph(code)`; controller glyphs plug in here.

## Default bindings (laptop-safe: no Ctrl/Alt/Meta/F-keys, numpad, middle mouse or wheel)
On foot: WASD move, mouse look, Shift sprint, Space jump, C crouch, LMB/F fire, RMB hold or X toggle aim, R reload, 1-5 weapons, [ ] cycle, G throwable, V melee, E interact.
Driving: W/S throttle & brake/reverse, A/D steer, Space handbrake, Shift boost, V camera, H horn, Q look behind.
Global: M map, B spawn menu, T time & weather, L frame-time overlay, K vehicle tuning, Esc pause, P photo mode.
(Keyboard events with Ctrl/Alt/Meta held are ignored by the game, so browser shortcuts never trigger actions.)

## Adding controller support (follow-up task)
1. Add a Gamepad source polled once per frame (navigator.getGamepads) that writes analog values: extend `value()` to return `max(keyboard, padValue[action])` and `axis()` to prefer non-zero stick values.
2. Map: left stick -> moveLeft/Right/Forward/Back + steerLeft/Right, RT -> throttle/fire, LT -> brake/aim, A -> jump/handbrake, right stick -> `lookDelta()` (add stick deltas there; keep acceleration curve optional).
3. Add pad glyphs to `GLYPHS` keyed like `Pad:A`.
4. Menus: the pause menu uses native focusable controls (buttons, selects, inputs) so D-pad focus navigation only needs a small focus mover.
