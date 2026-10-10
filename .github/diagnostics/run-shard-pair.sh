#!/bin/bash
# PR70 suite-context diagnostic: one gate shard, run at BOTH revisions back to back on THIS runner,
# exactly as the gate runs it (same --shard=N/8 split, 1 worker, 0 retries, unchanged tests),
# with traces kept for every test. The first revision is given by FIRST (alternated across shards).
# The shard composition is verified identical on both revisions before running.
# Usage: run-shard-pair.sh <shard N> <first: base|head> <base-dir> <head-dir> <evidence-dir>
set -uo pipefail
N=$1 FIRST=$2 BASE=$3 HEAD=$4 EV=$5
mkdir -p "$EV"
for side in base head; do
  dir=$BASE; [ $side = head ] && dir=$HEAD
  (cd "$dir" && npx playwright test tests/e2e --shard="$N/8" --list 2>/dev/null) | grep -E '^[[:space:]]+\[chromium\] › ' | sed -E 's/:[0-9]+:[0-9]+ › / › /' > "$EV/list-$side.txt"
done
if ! cmp -s "$EV/list-base.txt" "$EV/list-head.txt" || [ ! -s "$EV/list-base.txt" ]; then
  echo "::error::shard $N/8 resolves to different tests on the two revisions"; diff "$EV/list-base.txt" "$EV/list-head.txt" | head -20; exit 1
fi
echo "shard $N/8: $(wc -l < "$EV/list-base.txt") tests, identical on both revisions" | tee "$EV/selection.txt"
ORDER="base head"; [ "$FIRST" = head ] && ORDER="head base"
for side in $ORDER; do
  dir=$BASE; [ $side = head ] && dir=$HEAD
  echo "runner loadavg before $side: $(cat /proc/loadavg)" >> "$EV/runner.txt"
  t0=$(date +%s)
  (cd "$dir" && /usr/bin/time -v -o "$EV/$side.cpu.txt" npx playwright test tests/e2e --shard="$N/8" \
     --workers=1 --retries=0 --reporter=list --trace on --output="$EV/$side-results" > "$EV/$side.log" 2>&1)
  rc=$?
  echo "$side: exit=$rc seconds=$(( $(date +%s) - t0 )) $(grep -E '^[[:space:]]+[0-9]+ (passed|failed|flaky|skipped|did not run)' "$EV/$side.log" | tr -s ' ' | tr '\n' ' ')" | tee -a "$EV/outcome.txt"
  grep -E '^[[:space:]]+✘' "$EV/$side.log" | sed -E "s/^/$side /" >> "$EV/failures.txt"
done
true
