#!/bin/sh
# Re-run character prep for every cast body listed in tools/cast_candidates.txt (id sex [extra args]).
cd "$(dirname "$0")/.."
while read id sex extra; do
  uid=$(python3 -c "import json;print(next(d['uid'] for d in json.load(open('assets/catalog/sketchfab-ledger.json'))['downloads'] if d['file']=='$id.glb'))")
  node tools/char_prep.mjs $id assets/sources/sketchfab/$id.glb --sex $sex --uid $uid $extra 2>&1 | grep -v "Warn\|prune\|metalRough" | tail -3
done < tools/cast_candidates.txt
echo DONE
