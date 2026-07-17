#!/usr/bin/env bash
# Honest FINAL gate for the Crime v1 Integration Hardening sprint (Hard M6).
# Runs the ENTIRE BlockLife regression — not just the crime suites — because the
# hardening work touched shared systems (AmbientCitizens panic refactor,
# PlayerWeapon bystanders, dispatch reconcile). Everything runs SEQUENTIALLY on
# the one dev server (never two Playwright suites at once — 2x load starves the
# second-based timers and yields false timeouts). Expected counts are DERIVED
# from the spec files (grep -c 'test('), never hardcoded. pipefail + count-vs-
# DEFINED + skip guard so a truncated reporter line or a stray .only can't hide
# a failure.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v23.3.0/bin:$PATH"
cd /Users/harshitkargeti/GTABrowser || exit 2
LOG="/private/tmp/claude-501/-Users-harshitkargeti-GTABrowser/886c4b54-3f68-4867-90eb-9c94fdab0504/scratchpad"
FAIL=0
hr() { printf -- '========================================\n'; }
num() { grep -oE "$2" "$1" | grep -oE '[0-9]+' | tail -1; }
defined_dir() { grep -rhcE '^\s*test\(' "$1"/*.spec.ts | awk '{s+=$1} END {print s}'; }

# Skip/only guard across the WHOLE suite — either would silently mask tests.
hr; echo "[0/8] .only / .skip / .fixme guard"
if grep -rnE 'test\.only|describe\.only|test\.skip|test\.fixme|\.skip\(|\.fixme\(' tests/ >/dev/null 2>&1; then
  echo "  GUARD: .only/.skip/.fixme present — would mask tests. FAIL"; FAIL=1
  grep -rnE 'test\.only|describe\.only|test\.skip|test\.fixme|\.skip\(|\.fixme\(' tests/
else echo "  guard: clean (no only/skip/fixme)"; fi

E2E_DEF=$(defined_dir tests/e2e)
VIS_DEF=$(defined_dir tests/visual)
echo "  DEFINED: e2e=$E2E_DEF, visual=$VIS_DEF"

# NOTE: `tsc --noEmit` is VACUOUS here — the root tsconfig.json is a solution
# file ("files": [], references only), so it compiles ZERO files and always
# passes. `-b --force` builds the referenced projects (app + node = ~1556 files)
# and is the only form that actually typechecks. --force defeats .tsbuildinfo
# incremental skipping, which would otherwise let a stale PASS through.
hr; echo "[1/8] tsc -b --force (typecheck; --noEmit alone checks 0 files)"
if npx tsc -b --force >"$LOG/hg-tsc.log" 2>&1; then echo "  tsc: PASS"; else echo "  tsc: FAIL"; FAIL=1; tail -8 "$LOG/hg-tsc.log"; fi

hr; echo "[2/8] oxlint (0 errors required; warnings recorded)"
npx oxlint src/ >"$LOG/hg-lint.log" 2>&1; LEXIT=$?
LWARN=$(num "$LOG/hg-lint.log" 'Found [0-9]+ warning'); LWARN=${LWARN:-0}
LERR=$(num "$LOG/hg-lint.log" '[0-9]+ error'); LERR=${LERR:-0}
echo "  lint: exit $LEXIT, warnings $LWARN, errors $LERR"
if [ "$LEXIT" -ne 0 ] || [ "$LERR" -ne 0 ]; then echo "  lint: FAIL"; FAIL=1; tail -8 "$LOG/hg-lint.log"; fi

hr; echo "[3/8] unit tests (vitest run) — passed>0, failed 0"
npx vitest run >"$LOG/hg-unit.log" 2>&1; UEXIT=$?
UPASS=$(num "$LOG/hg-unit.log" 'Tests +[0-9]+ passed'); UPASS=${UPASS:-0}
UFAILED=$(grep -cE '[0-9]+ failed' "$LOG/hg-unit.log")
echo "  unit: $UPASS passed (exit $UEXIT, failed-lines $UFAILED)"
if [ "$UEXIT" -ne 0 ] || [ "$UFAILED" -ne 0 ]; then echo "  unit: FAIL"; FAIL=1; tail -10 "$LOG/hg-unit.log"; fi

hr; echo "[4/8] production build + dist test-API leak check"
rm -rf dist
if npm run build >"$LOG/hg-build.log" 2>&1; then
  LEAK=$(grep -rlE 'GAME_TEST_API|spawnPoliceResponse|givePlayerWeapon|firePlayerWeaponAt|forcePoliceDismount|isNpcPanicking' dist/ 2>/dev/null | wc -l | tr -d ' ')
  echo "  build: PASS; test-API strings in dist: $LEAK"
  [ "$LEAK" -eq 0 ] || { echo "  dist LEAK: FAIL"; FAIL=1; }
else echo "  build: FAIL"; FAIL=1; tail -10 "$LOG/hg-build.log"; fi

hr; echo "[5/8] FULL E2E — all tests/e2e (incl. 180s soak) — passed==$E2E_DEF, failed 0, skipped 0"
npx playwright test tests/e2e --reporter=line >"$LOG/hg-e2e.log" 2>&1; EEXIT=$?
EPASS=$(num "$LOG/hg-e2e.log" '[0-9]+ passed'); EPASS=${EPASS:-0}
EFAIL=$(num "$LOG/hg-e2e.log" '[0-9]+ failed'); EFAIL=${EFAIL:-0}
ESKIP=$(num "$LOG/hg-e2e.log" '[0-9]+ skipped'); ESKIP=${ESKIP:-0}
echo "  e2e: $EPASS passed, $EFAIL failed, $ESKIP skipped (exit $EEXIT); defined $E2E_DEF"
if [ "$EEXIT" -ne 0 ] || [ "$EPASS" -ne "$E2E_DEF" ] || [ "$EFAIL" -ne 0 ] || [ "$ESKIP" -ne 0 ]; then
  echo "  e2e: FAIL"; FAIL=1; grep -E '✘|failed|flaky|Error' "$LOG/hg-e2e.log" | tail -20; fi

hr; echo "[6/8] FULL visual — pass 1 — all tests/visual — passed==$VIS_DEF, failed 0"
npx playwright test tests/visual --reporter=line >"$LOG/hg-vis1.log" 2>&1; V1EXIT=$?
V1PASS=$(num "$LOG/hg-vis1.log" '[0-9]+ passed'); V1PASS=${V1PASS:-0}
V1FAIL=$(num "$LOG/hg-vis1.log" '[0-9]+ failed'); V1FAIL=${V1FAIL:-0}
echo "  visual1: $V1PASS passed, $V1FAIL failed (exit $V1EXIT); defined $VIS_DEF"
if [ "$V1EXIT" -ne 0 ] || [ "$V1PASS" -ne "$VIS_DEF" ] || [ "$V1FAIL" -ne 0 ]; then
  echo "  visual1: FAIL"; FAIL=1; grep -E '✘|failed|Error|toHaveScreenshot' "$LOG/hg-vis1.log" | tail -20; fi

hr; echo "[7/8] FULL visual — pass 2 (stability) — passed==$VIS_DEF, failed 0"
npx playwright test tests/visual --reporter=line >"$LOG/hg-vis2.log" 2>&1; V2EXIT=$?
V2PASS=$(num "$LOG/hg-vis2.log" '[0-9]+ passed'); V2PASS=${V2PASS:-0}
V2FAIL=$(num "$LOG/hg-vis2.log" '[0-9]+ failed'); V2FAIL=${V2FAIL:-0}
echo "  visual2: $V2PASS passed, $V2FAIL failed (exit $V2EXIT); defined $VIS_DEF"
if [ "$V2EXIT" -ne 0 ] || [ "$V2PASS" -ne "$VIS_DEF" ] || [ "$V2FAIL" -ne 0 ]; then
  echo "  visual2: FAIL"; FAIL=1; grep -E '✘|failed|Error|toHaveScreenshot' "$LOG/hg-vis2.log" | tail -20; fi

hr; echo "[docs] keep-current checklist (informational — does not fail the gate)"
cat <<'DOCS'
  Before you call a sprint done, update the docs so the next agent isn't misled:
    [ ] New/changed subsystem?      → docs/SYSTEMS.md (or the feature doc)
    [ ] New cross-cutting pattern
        or a bug that bit you?      → docs/CONVENTIONS.md (add the gotcha)
    [ ] New module / big rewire?    → docs/ARCHITECTURE.md module map + diagram
    [ ] Shipped a feature?          → CLAUDE.md "Current state" line
    [ ] New test suite / counts?    → docs/crime-test-inventory.json
  Stale docs are worse than none. A doc that names a file/flag that no longer
  exists will send the next sprint down a wrong path — treat it like a failing
  test and fix it in the same change.
DOCS

hr; echo "[8/8] SUMMARY"
echo "  tsc | lint(w=$LWARN,e=$LERR) | unit=$UPASS | dist-leak=${LEAK:-?}"
echo "  e2e=$EPASS/$E2E_DEF (f$EFAIL s$ESKIP) | vis1=$V1PASS/$VIS_DEF | vis2=$V2PASS/$VIS_DEF"
hr
if [ "$FAIL" -eq 0 ]; then echo "HARDENING GATE: PASS ✅"; else echo "HARDENING GATE: FAIL ❌"; fi
exit "$FAIL"
