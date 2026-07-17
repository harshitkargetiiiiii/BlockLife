export interface PlayerStats {
  money: number
  hunger: number
  energy: number
  reputation: number
  strength: number
  day: number
  /** Fractional hour of day, 0 <= hour < 24 */
  hour: number
}

export const INITIAL_STATS: PlayerStats = {
  money: 50,
  hunger: 20,
  energy: 100,
  reputation: 0,
  strength: 1,
  day: 1,
  hour: 8,
}

export const PLAYER_SPAWN: [number, number, number] = [-11, 1.2, -7]

export const PLAYER_MAX_HEALTH = 100

export const WALK_SPEED = 4.2
export const RUN_SPEED = 7.2
