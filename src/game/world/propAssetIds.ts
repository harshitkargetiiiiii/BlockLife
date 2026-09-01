import type { PropDef } from './worldTypes'

/**
 * Prop TYPE → reusable asset archetype id.
 *
 * A prop type is authored once and placed many times; each PLACEMENT keeps its own
 * `def.id` collider and its type-based PROP_SOLIDITY entry, so a missing or broken GLB
 * can never remove a collider. Lives in data (not in Props.tsx) so both the renderer and
 * the manifest/layout invariant tests read the SAME mapping.
 */
export const STREET_PROP_ASSET_IDS: Partial<Record<PropDef['type'], string>> = {
  // Issue #38 Wave 0: the bench GLB projects onto the EXISTING `bench` prop type. Every
  // placement, solidity entry and collider stays in cityLayout/PROP_SOLIDITY, and the
  // procedural <Bench /> remains the LandmarkAsset fallback child — no duplicate prop.
  bench: 'prop_park_bench_01',
  ac_unit: 'prop_ac_unit_01',
  bollard: 'prop_bollard_01',
  street_planter: 'prop_street_planter_01',
  manhole: 'prop_manhole_01',
  drain: 'prop_drain_01',
}
