import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import { getFollowTargetPosition } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { PLAYER_SPAWN } from '../player/playerTypes'
import { dampFactor } from '../utils/math'
import { CAMERA_OFFSET } from './cameraGeometry'

// Classic diorama angle: up-right-back from the target, never rotating. The numbers live in
// `cameraGeometry` because the world-height invariants every asset gate enforces are DERIVED
// from them (issue #46 §2) — a body taller than this offset contains the camera.
const OFFSET_VEC = new THREE.Vector3(...CAMERA_OFFSET)
const UP = new THREE.Vector3(0, 1, 0) // Y axis for the DEV review-orbit
const MIN_ZOOM = 20
const MAX_ZOOM = 60

// The expanded city reads better slightly wider while driving; on foot the
// framing stays intimate. Mouse wheel applies an offset on top of the base.
const ZOOM_WALKING = 34
const ZOOM_DRIVING = 28
// The studio apartment is small — pull in closer so it fills the frame.
const ZOOM_APARTMENT = 52

// The camera leads the subject slightly in its direction of travel so the
// player sees more of where they're going — more when driving, where speed
// makes forward context matter.
const LOOKAHEAD_WALK = 0.35
const LOOKAHEAD_DRIVE = 0.75
const LOOKAHEAD_MAX = 6

// Follow tightness (exponential damping rate). The car is faster, so the
// camera tracks it harder to keep it framed.
const FOLLOW_RATE_WALK = 4.5
const FOLLOW_RATE_DRIVE = 6

// Reused every frame.
const focus = new THREE.Vector3()
const lastTarget = new THREE.Vector3()
const targetVel = new THREE.Vector3()

/**
 * Fixed-angle orthographic camera that smoothly follows the player on foot
 * or the car while driving. Mouse wheel adjusts zoom within gentle limits.
 */
export function FollowCamera() {
  const cameraRef = useRef<THREE.OrthographicCamera>(null)
  const smoothed = useRef(new THREE.Vector3(...PLAYER_SPAWN))
  const zoomOffset = useRef(0)
  const initialized = useRef(false)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomOffset.current = THREE.MathUtils.clamp(
        zoomOffset.current - e.deltaY * 0.04,
        MIN_ZOOM - ZOOM_WALKING,
        MAX_ZOOM - ZOOM_WALKING,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])

  useFrame((_, rawDt) => {
    const cam = cameraRef.current
    if (!cam) return
    const dt = Math.min(rawDt, 0.1)
    const driving = useGameStore.getState().mode === 'driving'
    const target = getFollowTargetPosition(driving ? 'driving' : 'walking')

    if (!initialized.current) {
      initialized.current = true
      lastTarget.copy(target)
      smoothed.current.copy(target)
    }

    // Estimate subject velocity to build the look-ahead point. Teleports
    // produce absurd velocities for one frame — ignore those.
    if (dt > 0) {
      targetVel.subVectors(target, lastTarget).divideScalar(dt)
      if (targetVel.lengthSq() > 40 * 40) targetVel.set(0, 0, 0)
    }
    lastTarget.copy(target)

    const lead = driving ? LOOKAHEAD_DRIVE : LOOKAHEAD_WALK
    focus.copy(targetVel).multiplyScalar(lead)
    if (focus.length() > LOOKAHEAD_MAX) focus.setLength(LOOKAHEAD_MAX)
    focus.y = 0
    focus.add(target)

    const k = dampFactor(driving ? FOLLOW_RATE_DRIVE : FOLLOW_RATE_WALK, dt)
    smoothed.current.lerp(focus, k)
    // DEV/test only (issue #27 H0): orbit the fixed offset around the target for drift-free
    // front/side/rear/profile review shots. No effect at the default azimuth 0.
    let offset = OFFSET_VEC
    let lookY = 0
    if (import.meta.env.DEV) {
      const az = useGameStore.getState().debugCameraAzimuth
      if (az !== 0) offset = OFFSET_VEC.clone().applyAxisAngle(UP, az)
      lookY = useGameStore.getState().debugCameraLookY
    }
    cam.position.copy(smoothed.current).add(offset)
    cam.lookAt(smoothed.current.x, smoothed.current.y + lookY, smoothed.current.z)

    // Mode-based zoom (wider while driving, tighter indoors), eased so
    // transitions read well.
    const indoors = useGameStore.getState().location === 'apartment'
    const baseZoom = indoors ? ZOOM_APARTMENT : driving ? ZOOM_DRIVING : ZOOM_WALKING
    let targetZoom = THREE.MathUtils.clamp(
      baseZoom + zoomOffset.current,
      MIN_ZOOM,
      indoors ? ZOOM_APARTMENT + 10 : MAX_ZOOM,
    )
    // DEV/test only (issue #27 H0 Calibration): a zoom multiplier that overrides the cap so a
    // static candidate can be inspected up close. No effect at the default 1.
    if (import.meta.env.DEV) {
      const mul = useGameStore.getState().debugCameraZoomMul
      if (mul !== 1) targetZoom = baseZoom * mul
    }
    if (Math.abs(cam.zoom - targetZoom) > 0.01) {
      cam.zoom += (targetZoom - cam.zoom) * dampFactor(3, dt)
      cam.updateProjectionMatrix()
    }
  })

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={[
        PLAYER_SPAWN[0] + CAMERA_OFFSET[0],
        PLAYER_SPAWN[1] + CAMERA_OFFSET[1],
        PLAYER_SPAWN[2] + CAMERA_OFFSET[2],
      ]}
      zoom={34}
      // Negative near: with an orthographic diorama the camera plane can sit
      // INSIDE a tall building that stands between it and the player; a
      // positive near then slices the building open (hollow "cutaway" roofs).
      // Rendering geometry behind the camera plane eliminates that entirely.
      near={-200}
      far={400}
    />
  )
}
