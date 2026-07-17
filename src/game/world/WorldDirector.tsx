import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { registry } from './runtimeRegistry'
import { HOURS_PER_REAL_SECOND } from '../simulation/timeSystem'
import { getLampGlow } from '../simulation/worldMoodSystem'
import { updateGlowMaterials } from './materials'
import { useNearbyInteractable } from '../interactables/useNearbyInteractable'
import { audioManager } from '../audio/AudioManager'
import { trafficRuntime } from '../traffic/trafficRuntime'
import {
  getBlendedModifiers,
  snapWeatherForPause,
  stepWeather,
  weatherRuntime,
} from '../weather/weatherSystem'

const TICK_INTERVAL = 0.25 // seconds of real time between store commits

/**
 * The heartbeat of the simulation: advances the clock in batched store
 * commits, drives the night-glow materials, scans for nearby interactables
 * and feeds the engine audio. Runs inside the Canvas loop.
 */
export function WorldDirector() {
  const acc = useRef(0)
  useNearbyInteractable()

  useFrame((_, dt) => {
    registry.frameCount++
    if (!registry.gameReady && registry.playerBody && registry.frameCount > 5) {
      registry.gameReady = true
    }

    const store = useGameStore.getState()

    // Deterministic traffic-signal clock: runs on unpaused real seconds and
    // snaps to the cycle start whenever the world pauses (stable snapshots).
    if (store.worldPaused) {
      if (trafficRuntime.signal.pauseSeq !== registry.pauseSeq) {
        trafficRuntime.signal.pauseSeq = registry.pauseSeq
        // A dev/test pin survives the snap (photographing a chosen phase);
        // otherwise realign to the cycle start.
        trafficRuntime.signal.elapsed = trafficRuntime.signal.pinned ?? 0
      }
    } else {
      trafficRuntime.signal.elapsed += dt
    }

    // Weather: crossfades + wetness advance in real time; on pause the fade
    // completes instantly so screenshots are deterministic.
    if (store.worldPaused) {
      if (weatherRuntime.pauseSeq !== registry.pauseSeq) {
        weatherRuntime.pauseSeq = registry.pauseSeq
        snapWeatherForPause(weatherRuntime)
      }
    } else {
      stepWeather(weatherRuntime, dt, { day: store.stats.day, hour: store.stats.hour })
      if (weatherRuntime.kind === weatherRuntime.targetKind && store.weather !== weatherRuntime.kind) {
        useGameStore.setState({ weather: weatherRuntime.kind })
      }
    }

    if (!store.worldPaused && store.timeScale > 0) {
      acc.current += dt * store.timeScale
      if (acc.current >= TICK_INTERVAL) {
        store.tick(acc.current * HOURS_PER_REAL_SECOND)
        acc.current = 0
      }
    }

    // Weather multiplies the night glow and can lift it above zero even by
    // day (lit windows in rain/fog), never below the plain day/night value.
    const mods = getBlendedModifiers(weatherRuntime)
    const baseGlow = getLampGlow(store.stats.hour)
    updateGlowMaterials(Math.min(1, Math.max(mods.glowFloor, baseGlow * mods.glowBoost)))

    const speed = Math.abs(registry.flags.drivingSpeed)
    audioManager.setEngine(store.mode === 'driving' ? Math.min(1, speed / 13) : 0)
    audioManager.setRain(mods.rainStrength)
  })

  return null
}
