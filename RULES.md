# RULES (one-page working copy — SPEC.md is authoritative)

## Session protocol
- Resume: read RULES.md, DESIGN.md, PROGRESS.md (SPEC.md only for detail) -> run `npm run smoke` -> do NEXT STEP. Never restart/re-plan/re-summarise/ask.
- Feedback in a user message: apply it first, then continue.
- After each meaningful step: update NEXT STEP (one precise action). Commit + push after every chunk (`git push -u origin claude/hopeful-planck-6zmdbo`), at least every 30 steps, never force-push.
- Record STEPS_USED and DRIVE_CALLS_USED at every checkpoint. Keep builds/known-good current.
- Every checkpoint = playable, no console errors, no visible placeholders/TODOs; hide unfinished features.
- Never ask questions mid-run: decide, log under DECISIONS, continue. Limits: schedule "continue" after reset if possible, else stop cleanly.
- At 85% of STEP_BUDGET (1275 steps): stop starting features, polish (graphics first), write FINAL_REPORT.md.
- Milestone cap overrun 1.5x -> move on, log why.

## Hard limits
- Drive (folder 1EEE9K89wnqsCae86tSGU-OfidZIGW-bW) is READ-ONLY: only search/get/download. Never list again (drive-index.json is final). Never re-download (assets/sources/.decoded.json, clipmeta.json). DRIVE_CALL_BUDGET 300.
- Drive downloads cap at 10MB: characters (24-87MB) are unreachable that way -> stand-ins / other sources; ingest incoming/ each milestone.
- Never print/write/commit tokens or keys. No accounts, no paid services, no passwords. PUBLISHING = NEVER (Artifact previews are private; never share).
- Licence: GREEN ok, AMBER ok + logged, RED never. Log every source in CREDITS.md at download time. Sketchfab: check licence first, cache, <=150 downloads, back off on 429.

## Cost discipline
- Medium effort default; high for rendering, vehicle physics, animation, IK, combat. Small targeted edits over rewrites.
- Never dump big files/dirs into context: scripts that print counts/summaries; grep/head.
- Batch work into scripts; full smoke test at checkpoints only. Critique-fix rounds <= 3 per milestone (4 for M2).
- Images: contact sheets downscaled + a few full-res crops, viewed in batches.

## Tools
- tools/drive_decode.py (decode download spills), tools/catalog.py (catalog + `grep REGEX`), tools/wave.py (resolve wave list),
  tools/ingest_clips.mjs (FBX->bundles), tools/shoot.mjs (headless capture/smoke), tools/sheet.py (contact sheets).
