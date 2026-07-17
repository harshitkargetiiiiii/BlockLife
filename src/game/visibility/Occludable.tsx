import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { OccluderDescriptor } from './visibilityTypes'
import { registerOccluder, unregisterOccluder } from './visibilityRuntime'

/**
 * Marks a visual group as fade-capable for the occlusion system.
 *
 * Registration is descriptor-driven (bounds derive from layout data — see
 * occluderData.ts); the wrapped children are whatever should fade together:
 * a procedural building, a GLB clone, its window overlays. Colliders live
 * elsewhere and are never affected.
 */
export function Occludable({
  descriptor,
  children,
}: {
  descriptor: OccluderDescriptor
  children: ReactNode
}) {
  const ref = useRef<THREE.Group>(null)

  useEffect(() => {
    if (!ref.current) return
    registerOccluder(descriptor, ref.current)
    return () => unregisterOccluder(descriptor.id)
    // Descriptors are static layout data; id identity is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.id])

  return <group ref={ref}>{children}</group>
}
