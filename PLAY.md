# How to play Harbourline

## 1. Easiest: the private preview link (nothing to install)
1. Open https://claude.ai/artifact/KXHuxRYKPx7unuEtpcf6wW while signed in to claude.ai (it is private to you).
2. Click inside the game view to give it keyboard/mouse focus.
The delivery self-test is at the same link with `delivery.html` (open the artifact's file list). Current checkpoint: M3 — the streamed Downtown district: avenues, the elevated highway (ramps at the far east/west ends of the arterial north of the start), the underpass/tunnel, and the central plaza. W/S drive, A/D steer, Space handbrake, Shift boost, V camera, K tuning, T time & weather, L frame-time overlay, Esc menu.

## 2. GitHub Codespace (private, runs on your own GPU)
1. On GitHub open the Game2 repo, branch `claude/hopeful-planck-6zmdbo`.
2. Click **Code** > **Codespaces** > **Create codespace on claude/hopeful-planck-6zmdbo**.
3. In the terminal run: `npm run play` (installs, builds, serves on port 4173).
4. In the **Ports** tab, keep port 4173 visibility **Private** and click the globe icon to open it.

## 3. Local (only if you already have Node.js)
`npm run play` then open http://localhost:4173  (or, with Python and an existing `dist/`: `python3 -m http.server -d dist 4173`).
Never open index.html by double-clicking: modules, workers and WASM do not run from file://.

## 4. GitHub Pages (optional, only if YOU choose to publish)
A workflow is provided at `.github/workflows/pages.yml.disabled`. To enable: rename it to `pages.yml`, then repo **Settings > Pages > Source: GitHub Actions**. A Pages site is reachable by anyone with the URL, even from a private repo.

## Controls (keyboard + mouse; a standard gamepad also works)
| On foot | Keys | Pad |
|---|---|---|
| Move / sprint / jump-vault / crouch | WASD / Shift / Space / C | LS / L3 / A / R3 |
| Aim / fire / reload | RMB (or X toggle) / LMB or F / R | LT / RT / X |
| Weapons: slots, cycle, throw grenade, melee | 1–5, [ ], G, V | D-pad ← → ↓, B |
| Enter own car / steal any car / board the boat at the pier | E | Y |

| Driving | Keys | Pad |
|---|---|---|
| Throttle / brake-reverse / steer | W / S / A D | RT / LT / LS |
| Handbrake / boost / horn / look behind / camera | Space / Shift / H / Q / V | RB / A / R3 / LB / View |
| Get out (slow down first; boats: alongside a pier) | E | Y |

| Sandbox | Keys |
|---|---|
| Spawn menu: vehicles, weapons, teleports (incl. Harbour), traffic density, wanted level, god mode, time & weather | B |
| Photo mode (WASD orbit, R/F zoom, Q/E FOV, [ ] time of day) | P |
| Time & weather panel / vehicle tuning panel / frame-time overlay | T / K / L |
| Pause menu: quality tier, mouse sensitivity, comfort options, key list, Credits | Esc |

Crimes witnessed in the street (shooting, hitting people, stealing occupied cars, explosions) raise the wanted level.
Police cruisers chase from 1 star, ram from 3 and boost from 4; officers get out with heavier guns as the level climbs.
Break line of sight for 8 s + 3 s per star to lose them. At 1 star, standing still next to an officer gets you BUSTED.
