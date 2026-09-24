import { PROPS } from '../world/cityLayout'
import type { PropDef } from '../world/worldTypes'

/**
 * TEST-ONLY: the `PROPS` export exactly as the placement contracts pinned it, before issue #34
 * Track B deliberately moved three props.
 *
 * Six contracts assert "every other prop is unchanged" by hashing `PROPS` whole. Track B relocated the
 * `warehouse` front-detail crate outward (`templates.ts`, `out` 1.6 → 2.5) because its footprint
 * straddled the door anchor's doorstep line and stalled the yard commuter. That legitimately changes
 * three props, so those gates fail — correctly.
 *
 * Re-pinning each digest to the new export would have been the easy fix and the wrong one: the gates
 * would then accept ANY future prop change as silently as this one. Instead they hash this baseline,
 * which restores each crate to its old position ONLY IF it sits EXACTLY at its documented new
 * position. A crate that drifts anywhere else is left alone, so the digest breaks and the gate keeps
 * its full detection power. `yardWorkerDoorApproach.test.ts` separately asserts that exactly these
 * three props differ, only outward, by exactly 0.9.
 */
export const TRACK_B_RELOCATED_CRATES: Readonly<Record<string, { before: [number, number]; after: [number, number] }>> = {
  's-1_-2_w1_front_0': { before: [-79.2, -238.4], after: [-79.2, -237.5] },
  's-1_-2_w3_front_0': { before: [-121.3, -238.4], after: [-121.3, -237.5] },
  's-1_-2_w5_front_0': { before: [-163.4, -238.4], after: [-163.4, -237.5] },
}

export function propsAtContractBaseline(): PropDef[] {
  return PROPS.map((p) => {
    const moved = TRACK_B_RELOCATED_CRATES[p.id]
    if (!moved) return p
    if (p.position[0] !== moved.after[0] || p.position[1] !== moved.after[1]) return p
    // Spread keeps the original key order, so JSON of the restored prop is byte-identical to before.
    return { ...p, position: [moved.before[0], moved.before[1]] }
  })
}
