/** Arcade driving tuning — velocities set directly, no engine simulation. */
export const VEHICLE_TUNING = {
  maxSpeed: 14,
  maxReverseSpeed: 5,
  /** Forward acceleration, units/s². */
  acceleration: 11,
  /** S while moving forward: braking. S from rest: reverse acceleration. */
  brakeDeceleration: 20,
  reverseAcceleration: 8,
  /** Passive slow-down when coasting with no pedal input. */
  coastDrag: 6,
  /** Radians/second of yaw at full steering and full grip. */
  turnRate: 2.4,
  /** Speed (units/s) at which steering reaches full authority. */
  steerFullSpeed: 4,
}

export interface VehicleRuntimeState {
  speed: number
}
