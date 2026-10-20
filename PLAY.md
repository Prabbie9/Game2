# How to play Harbourline

## 1. Easiest: the private preview link (nothing to install)
1. Open https://claude.ai/artifact/KXHuxRYKPx7unuEtpcf6wW while signed in to claude.ai (it is private to you).
2. Click inside the game view to give it keyboard/mouse focus.
The delivery self-test is at the same link with `delivery.html` (open the artifact's file list). Current checkpoint: M2 — a downtown intersection (traffic, pedestrians, lights, rain at night via T). The old test track is at the same link with ?scene=test where URLs allow it. Click the view, then W/S drive, A/D steer, Space handbrake, Shift boost, V camera, K tuning panel, T time & weather, L frame-time overlay, Esc menu (quality, comfort, key list).

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
