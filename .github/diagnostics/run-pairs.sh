#!/bin/bash
# PR70 diagnostic: the 12 test identities that failed at be9bf6e (run 37993232639) but not at 0e514b8
# (run 36073632407). Each test runs once per revision, so 24 executions in total. The two runs of a
# pair go back to back, and which revision goes first alternates from pair to pair. Every run uses
# 1 worker, 0 retries, the repository's own assertions/timeouts and test code, and keeps its trace.
# Tests are selected by EXACT full title (never by line number: four parameterized tests share
# asset-integration-wave-4.spec.ts:345), and the selection is verified on both revisions before any
# test runs.
# Usage: run-pairs.sh <list.tsv> <base-dir> <head-dir> <evidence-dir>
set -uo pipefail
LIST=$1 BASE=$2 HEAD=$3 EV=$4
mkdir -p "$EV"
esc() { printf '%s' "$1" | sed -e 's/[][\.*^$(){}?+|\/]/\\&/g'; }

# Phase 1: the selection must resolve to exactly the expected test, identically, on both revisions.
bad=0; i=0
while IFS=$'\t' read -r file title; do
  [ -z "$file" ] && continue
  leaf=${title##* › }
  for side in base head; do
    dir=$BASE; [ $side = head ] && dir=$HEAD
    listed=$(cd "$dir" && npx playwright test "$file" --grep "$(esc "$leaf")" --list 2>/dev/null | grep -E '^[[:space:]]+\[chromium\] › ' | sed -E 's/^[[:space:]]+\[chromium\] › [^ ]+ › //')
    n=$(printf '%s\n' "$listed" | grep -c . || true)
    if [ "$n" != 1 ] || [ "$listed" != "$title" ]; then
      echo "SELECTION MISMATCH #$i $side: expected [$title], listed $n: [$listed]" | tee -a "$EV/selection.txt"; bad=1
    else
      echo "ok #$i $side: $file › $listed" >> "$EV/selection.txt"
    fi
  done
  i=$((i + 1))
done < "$LIST"
echo "selection verified for $i tests" >> "$EV/selection.txt"
if [ "$bad" -ne 0 ] || [ "$i" -ne 12 ]; then echo "::error::selection did not resolve to the same 12 titles on both revisions"; exit 1; fi
[ -n "${SELECT_ONLY:-}" ] && exit 0

# Phase 2: 24 sequential executions, paired, alternating first revision.
printf 'idx\tfirst\tside\texit\tseconds\tresult\tsignature\tfile\ttitle\n' > "$EV/results.tsv"
run_one() { # idx side file title
  local idx=$1 side=$2 file=$3 title=$4 dir=$BASE; [ "$side" = head ] && dir=$HEAD
  local leaf=${title##* › } out="$EV/$side/$idx" log="$EV/$side-$idx.log"
  mkdir -p "$out"
  local t0; t0=$(date +%s)
  (cd "$dir" && /usr/bin/time -v -o "$EV/$side-$idx.cpu.txt" npx playwright test "$file" --grep "$(esc "$leaf")" \
    --workers=1 --retries=0 --reporter=list --trace on --output="$out" > "$log" 2>&1)
  local rc=$? dt=$(( $(date +%s) - t0 ))
  local res sig
  res=$(grep -E '^[[:space:]]+[0-9]+ (passed|failed|flaky|skipped|did not run)' "$log" | tr -s ' ' | tr '\n' ' ' | sed 's/ *$//')
  sig=$(grep -m1 -E '^[[:space:]]+(Error|TimeoutError)[:A-Za-z]' "$log" | grep -v 'Error Context' | sed -E 's/^[[:space:]]+//' | cut -c1-200)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$idx" "$FIRST" "$side" "$rc" "$dt" "$res" "$sig" "$file" "$title" >> "$EV/results.tsv"
  echo "#$idx $side exit=$rc ${dt}s [$res] $sig"
}
i=0
while IFS=$'\t' read -r file title <&3; do
  [ -z "$file" ] && continue
  if [ $((i % 2)) -eq 0 ]; then FIRST=base; ORDER="base head"; else FIRST=head; ORDER="head base"; fi
  echo "== pair #$i ($FIRST first): $title"
  for side in $ORDER; do run_one "$i" "$side" "$file" "$title"; done
  i=$((i + 1))
done 3< "$LIST"
echo "executions: $(($(wc -l < "$EV/results.tsv") - 1))"
