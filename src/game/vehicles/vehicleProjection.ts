/**
 * One-shell vehicle projection (issue #19 §6). BlockLife keeps its ORIGINAL single physical
 * driving shell (`vehicle_compact_car_01` / PLAYER_CAR_ID) — one rigid body, one arcade
 * controller. This pure accessor answers the only question the refactor introduces: "which
 * vehicle does that one shell currently embody?" so the driving controller, mesh, footprint and
 * exit logic read ONE source of truth instead of forking into per-vehicle bodies.
 *
 * Safety by construction: with NO active owned vehicle — the legacy single car, a stolen car
 * (its identity lives in `vehicleCrimeState`, never here), or a pre-ownership/pre-migration save
 * — this returns EXACTLY the legacy Compact constants (`VEHICLE_TUNING` + `CAR_HALF_*`), so all
 * existing driving/traffic/visual behaviour is preserved byte-for-byte. Only an explicitly
 * ACTIVATED owned vehicle changes the projection, and then its effective tuning is the class
 * tuning scaled by persistent condition (identity at condition 100) — always within the same
 * streaming-safe bounds `validateVehicleRegistry` enforces.
 */
import { VEHICLE_TUNING } from './vehicleTypes'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../traffic/vehicleObstacles'
import { getActiveVehicle } from './vehicleOwnershipRuntime'
import { isPlayerCarStolen } from './vehicleCrimeState'
import { getWheelStyle, performanceDelta, DEFAULT_WHEEL_STYLE } from './vehicleCustomization'
import { getVehicleDef, MIGRATION_VEHICLE_DEF_ID, type VehicleDef, type VehicleTuning } from './vehicleRegistry'
import type { OwnedVehicle } from './vehicleOwnershipTypes'

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Whether the ONE physical driving shell should be present + enterable (§3). True only when an
 * owned vehicle is active OR a stolen identity is projected onto the shell. On a new game — no
 * owned vehicle and not stolen — this is false: the shell stays hidden/inactive and there is NO
 * free legacy car in the new-game loop. The shell body, its mesh, and its "enter" interactable are
 * all gated on this.
 */
export function isDrivingShellActive(): boolean {
  return getActiveVehicle() != null || isPlayerCarStolen()
}

export interface VehicleProjection {
  /** Owned asset id projected onto the shell, or null (legacy/stolen/pre-ownership default). */
  ownedId: string | null
  /** The definition the shell embodies — always a real def; the Compact when unowned. */
  defId: string
  /** Canonical GLB asset id for the active class (issue #21 §5), or null → CarMesh. */
  assetId: string | null
  /** Effective arcade tuning the controller reads (class tuning × condition wear). */
  tuning: VehicleTuning
  halfLength: number
  halfWidth: number
  /** Physics collider half-extents [halfWidth, halfHeight, halfLength] the shell adopts. */
  collider: readonly [number, number, number]
  /** Rigid-body mass the shell adopts. */
  bodyMass: number
  /** Current paint (customization) — the mesh adapter tints the shell with this. */
  paint: string
  /** Resolved wheel-style render (hub colour + relative radius) for the mesh adapter (§9). */
  wheelHub: string
  wheelScale: number
  /** Disabled by condition ≤ 0 (no acceleration); the controller ORs this with the crime wreck. */
  conditionDisabled: boolean
  /** Local-space exit offset (right, forward) for stepping out, mirrored per side. */
  exitOffset: [number, number]
}

/**
 * Persistent condition scales performance (§7): identity at 100, floored so even a barely-alive
 * car still crawls (condition 0 is separately `disabled`, so the floor only shapes the ramp).
 */
const CONDITION_WEAR_FLOOR = 0.75
export function conditionWear(condition: number): number {
  return CONDITION_WEAR_FLOOR + (1 - CONDITION_WEAR_FLOOR) * clamp01(condition / 100)
}

function effectiveTuning(def: VehicleDef, asset: OwnedVehicle): VehicleTuning {
  const wear = conditionWear(asset.condition)
  // Installed performance upgrades raise base top-speed / acceleration BEFORE condition wear.
  // The registry validates that base + the max performance delta stays streaming-safe (§9/§14).
  const perf = performanceDelta(asset)
  // Only speed + acceleration change; handling/braking stay predictable. At condition 100 with no
  // upgrades, wear == 1 and perf == 0, so a pristine stock class drives exactly to its authored tuning.
  return {
    ...def.tuning,
    maxSpeed: (def.tuning.maxSpeed + perf.maxSpeed) * wear,
    acceleration: (def.tuning.acceleration + perf.acceleration) * wear,
  }
}

/** The exact legacy baseline: an unowned shell IS today's Compact car. */
function baseline(): VehicleProjection {
  const def = getVehicleDef(MIGRATION_VEHICLE_DEF_ID)
  return {
    ownedId: null,
    defId: MIGRATION_VEHICLE_DEF_ID,
    assetId: def?.assetId ?? null,
    // veh_compact.tuning === { ...VEHICLE_TUNING, mass: 3 } and its footprint === CAR_HALF_*.
    tuning: def ? def.tuning : { ...VEHICLE_TUNING, mass: 3 },
    halfLength: def?.halfLength ?? CAR_HALF_LENGTH,
    halfWidth: def?.halfWidth ?? CAR_HALF_WIDTH,
    collider: def?.collider ?? [1, 0.55, 2],
    bodyMass: def?.bodyMass ?? 60,
    paint: def?.baseColor ?? '#d7e6ee',
    wheelHub: getWheelStyle(DEFAULT_WHEEL_STYLE)?.hubColor ?? '#26262c',
    wheelScale: 1,
    conditionDisabled: false,
    exitOffset: def?.exitOffset ?? [1.6, 0],
  }
}

/**
 * The vehicle the one physical shell currently embodies. Reads the ownership runtime's active
 * asset; falls back to the safe Compact baseline whenever there is none (or the asset's def id
 * is somehow unknown — corruption never drives an undefined shell).
 */
export function getActiveVehicleProjection(): VehicleProjection {
  const active = getActiveVehicle()
  if (!active) return baseline()
  const def = getVehicleDef(active.defId)
  if (!def) return baseline()
  return {
    ownedId: active.id,
    defId: def.id,
    assetId: def.assetId ?? null,
    tuning: effectiveTuning(def, active),
    halfLength: def.halfLength,
    halfWidth: def.halfWidth,
    collider: def.collider,
    bodyMass: def.bodyMass,
    paint: active.customization.paint || def.baseColor,
    wheelHub: (getWheelStyle(active.customization.wheels) ?? getWheelStyle(DEFAULT_WHEEL_STYLE))?.hubColor ?? '#26262c',
    wheelScale: (getWheelStyle(active.customization.wheels) ?? getWheelStyle(DEFAULT_WHEEL_STYLE))?.radiusScale ?? 1,
    conditionDisabled: active.condition <= 0,
    exitOffset: def.exitOffset,
  }
}
