#!/usr/bin/env bash
# Honest gate for Crime & Law Enforcement (v1 M7 + hardening M1-M6). pipefail +
# count-vs-DEFINED checks so a truncated/short reporter line can never hide a
# failure. Expected counts are DERIVED from the spec files (grep -c 'test('),
# never hardcoded, so the gate cannot go stale as scenarios are added. Each
# stage captures full output to a log; the summary is derived from parsed
# counts AND exit codes, never from a glanced tail.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v23.3.0/bin:$PATH"
cd /Users/harshitkargeti/GTABrowser || exit 2
LOG="/private/tmp/claude-501/-Users-harshitkargeti-GTABrowser/886c4b54-3f68-4867-90eb-9c94fdab0504/scratchpad"
FAIL=0
hr() { printf -- '----------------------------------------\n'; }

num() { grep -oE "$2" "$1" | grep -oE '[0-9]+' | tail -1; }
# Count runnable `test(` blocks defined in a spec (the DEFINED baseline).
defined() { grep -cE '^\s*test\(' "$1"; }

# Guard: a stray .only silently drops every other test from a run.
if grep -rnE 'test\.only|describe\.only' tests/e2e/crime.spec.ts tests/visual/crime-visuals.spec.ts tests/e2e/crime-soak.spec.ts >/dev/null 2>&1; then
  echo "  GUARD: a .only marker is present — would mask other tests. FAIL"; FAIL=1
fi

E2E_DEF=$(defined tests/e2e/crime.spec.ts)
VIS_DEF=$(defined tests/visual/crime-visuals.spec.ts)
SOAK_DEF=$(defined tests/e2e/crime-soak.spec.ts)
echo "DEFINED: crime E2E=$E2E_DEF, crime visual=$VIS_DEF, soak=$SOAK_DEF"

# `tsc --noEmit` compiles 0 files (root tsconfig is references-only) — always
# passes, checks nothing. `-b --force` is the real typecheck. See hardening-gate.sh.
hr; echo "[1/7] tsc -b --force (typecheck; --noEmit alone checks 0 files)"
if npx tsc -b --force >"$LOG/gate-tsc.log" 2>&1; then echo "  tsc: PASS"; else echo "  tsc: FAIL"; FAIL=1; tail -6 "$LOG/gate-tsc.log"; fi

hr; echo "[2/7] unit tests (vitest run)"
npx vitest run >"$LOG/gate-unit.log" 2>&1; UEXIT=$?
UPASS=$(num "$LOG/gate-unit.log" 'Tests +[0-9]+ passed'); UPASS=${UPASS:-0}
UFAILED=$(grep -cE '[0-9]+ failed' "$LOG/gate-unit.log")
echo "  unit: $UPASS passed (exit $UEXIT, failed-lines $UFAILED)"
if [ "$UEXIT" -ne 0 ] || [ "$UFAILED" -ne 0 ]; then echo "  unit: FAIL"; FAIL=1; tail -8 "$LOG/gate-unit.log"; fi

hr; echo "[3/7] production build + dist leak check"
rm -rf dist
if npm run build >"$LOG/gate-build.log" 2>&1; then
  LEAK=$(grep -rlE 'GAME_TEST_API|spawnPoliceResponse|givePlayerWeapon|firePlayerWeaponAt' dist/ 2>/dev/null | wc -l | tr -d ' ')
  echo "  build: PASS; test-API strings in dist: $LEAK"
  [ "$LEAK" -eq 0 ] || { echo "  dist LEAK: FAIL"; FAIL=1; }
else echo "  build: FAIL"; FAIL=1; tail -8 "$LOG/gate-build.log"; fi

hr; echo "[4/7] crime E2E (expect $E2E_DEF passed == defined, 0 failed)"
npx playwright test tests/e2e/crime.spec.ts --reporter=line >"$LOG/gate-e2e.log" 2>&1; E2EXIT=$?
EPASS=$(num "$LOG/gate-e2e.log" '[0-9]+ passed'); EPASS=${EPASS:-0}
EFAIL=$(num "$LOG/gate-e2e.log" '[0-9]+ failed'); EFAIL=${EFAIL:-0}
echo "  e2e: $EPASS passed, $EFAIL failed (exit $E2EXIT); defined $E2E_DEF"
if [ "$E2EXIT" -ne 0 ] || [ "$EPASS" -ne "$E2E_DEF" ] || [ "$EFAIL" -ne 0 ]; then echo "  e2e: FAIL"; FAIL=1; tail -10 "$LOG/gate-e2e.log"; fi

hr; echo "[5/7] crime visual verify — pass 1 (expect $VIS_DEF passed == defined)"
npx playwright test tests/visual/crime-visuals.spec.ts --reporter=line >"$LOG/gate-vis1.log" 2>&1; V1EXIT=$?
V1PASS=$(num "$LOG/gate-vis1.log" '[0-9]+ passed'); V1PASS=${V1PASS:-0}
echo "  visual pass1: $V1PASS passed (exit $V1EXIT); defined $VIS_DEF"
if [ "$V1EXIT" -ne 0 ] || [ "$V1PASS" -ne "$VIS_DEF" ]; then echo "  visual1: FAIL"; FAIL=1; tail -10 "$LOG/gate-vis1.log"; fi

hr; echo "[6/7] crime visual verify — pass 2 (stability, expect $VIS_DEF passed)"
npx playwright test tests/visual/crime-visuals.spec.ts --reporter=line >"$LOG/gate-vis2.log" 2>&1; V2EXIT=$?
V2PASS=$(num "$LOG/gate-vis2.log" '[0-9]+ passed'); V2PASS=${V2PASS:-0}
echo "  visual pass2: $V2PASS passed (exit $V2EXIT); defined $VIS_DEF"
if [ "$V2EXIT" -ne 0 ] || [ "$V2PASS" -ne "$VIS_DEF" ]; then echo "  visual2: FAIL"; FAIL=1; tail -10 "$LOG/gate-vis2.log"; fi

hr; echo "[7/7] 180-second crime soak (expect $SOAK_DEF passed)"
npx playwright test tests/e2e/crime-soak.spec.ts --reporter=line >"$LOG/gate-soak.log" 2>&1; SKEXIT=$?
SKPASS=$(num "$LOG/gate-soak.log" '[0-9]+ passed'); SKPASS=${SKPASS:-0}
SKFAIL=$(num "$LOG/gate-soak.log" '[0-9]+ failed'); SKFAIL=${SKFAIL:-0}
echo "  soak: $SKPASS passed, $SKFAIL failed (exit $SKEXIT); defined $SOAK_DEF"
if [ "$SKEXIT" -ne 0 ] || [ "$SKPASS" -ne "$SOAK_DEF" ] || [ "$SKFAIL" -ne 0 ]; then echo "  soak: FAIL"; FAIL=1; tail -12 "$LOG/gate-soak.log"; fi

hr
if [ "$FAIL" -eq 0 ]; then echo "GATE: PASS ✅"; else echo "GATE: FAIL ❌"; fi
exit "$FAIL"
