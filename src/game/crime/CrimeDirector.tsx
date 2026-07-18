import { useFrame } from '@react-three/fiber'
import { ambientCitizenRuntime } from '../citizens/AmbientCitizens'
import { useGameStore } from '../store/useGameStore'
import { isRaining, weatherRuntime } from '../weather/weatherSystem'
import { anyPoliceSeesSuspect } from '../police/policeRuntime'
import { stepCrimeDirector } from './crimeStep'
import { getCrimeGameTime } from './crimeSystem'
import type { WitnessCandidate } from './witnessTypes'

/**
 * Drives the per-frame crime loop with live citizen data. Zero React state,
 * pooled candidate objects (no per-frame allocation), pause-aware (the game
 * clock freezes on pause, so crime timing stays deterministic for tests).
 */

const pool: WitnessCandidate[] = []
const liveCandidates: WitnessCandidate[] = []

function isNightHour(hour: number): boolean {
  return hour >= 20 || hour < 6
}

export function CrimeDirector() {
  useFrame((_, rawDt) => {
    const store = useGameStore.getState()
    if (store.worldPaused) return
    const dt = Math.min(rawDt, 0.05)

    liveCandidates.length = 0
    let n = 0
    for (const rec of ambientCitizenRuntime.values()) {
      if (rec.state === 'hidden') continue // dormant / off-duty — can't witness
      let c = pool[n]
      if (!c) {
        c = { id: rec.id, position: [rec.x, rec.z], capable: true }
        pool[n] = c
      } else {
        c.id = rec.id
        c.position[0] = rec.x
        c.position[1] = rec.z
        c.capable = true
      }
      liveCandidates.push(c)
      n++
    }

    stepCrimeDirector({
      gameTime: getCrimeGameTime(),
      dt,
      ctx: { raining: isRaining(weatherRuntime), isNight: isNightHour(store.stats.hour) },
      candidates: liveCandidates,
      capableOf: (id) => {
        const rec = ambientCitizenRuntime.get(id)
        return rec !== undefined && rec.state !== 'hidden'
      },
      // Block wanted DECAY while inside a store interior, exactly as if an
      // officer still had eyes on the suspect. This is the anti-exploit: ducking
      // into a robbable store (which police don't enter in v1) can never be used
      // to melt an active pursuit. The robbery code never touches wanted itself.
      hasPoliceLOS: anyPoliceSeesSuspect() || store.location === 'store',
    })
  })
  return null
}
