import { useEffect, useState } from 'react'
import { useGameStore } from '../../game/store/useGameStore'
import { registry } from '../../game/world/runtimeRegistry'
import { INTERACTABLE_BY_ID, STATIC_INTERACTABLES } from '../../data/interactables'
import {
  CONNECTORS,
  GATEWAY,
  INDUSTRIAL,
  INDUSTRIAL_NORTH,
  PARK,
  PARKING_LOT,
  RESIDENTIAL,
  RESIDENTIAL_SOUTH,
  RESIDENTIAL_WEST,
} from '../../game/world/cityLayout'
import { COFFEE_QUEST_ID } from '../../data/quests'
import { COMPILED_SECTORS } from '../../game/world/authoring/compiledSectors'
import { worldSizeToMap, worldToMap } from './phoneUtils'

interface Marker {
  id: string
  icon: string
  label: string
  x: number
  z: number
  kind: 'place' | 'player' | 'car' | 'npc' | 'future'
}

/** Future-use landmarks: visible on the map, visually locked, no gameplay. */
const FUTURE_MARKERS: Omit<Marker, 'kind'>[] = [
  { id: 'future_townhomes', icon: '🏗️', label: 'Townhomes — coming soon', x: 20, z: -54 },
  { id: 'future_warehouse', icon: '📦', label: 'Warehouse — coming soon', x: 59, z: -6 },
  { id: 'future_garage', icon: '🔧', label: 'Garage — coming soon', x: 58, z: 8 },
]

const DISTRICT_LABELS = [
  { id: 'central', label: 'Central', x: -8, z: 14 },
  { id: 'residential', label: 'Residential', x: -12, z: -57 },
  { id: 'industrial', label: 'Market', x: 46, z: 24.5 },
  { id: 'residential_west', label: 'Westside', x: -55, z: -18 },
  { id: 'residential_south', label: 'Southside', x: -2, z: 59 },
  { id: 'industrial_north', label: 'Freight', x: 60, z: -50 },
  { id: 'downtown_gateway', label: 'Gateway', x: 32, z: -92 },
  // Kit-compiled sectors label themselves from their map metadata.
  ...COMPILED_SECTORS.map((c) => ({
    id: `sector_${c.sectorId}`,
    label: c.map.label,
    x: c.map.labelAnchor[0],
    z: c.map.labelAnchor[1],
  })),
]

/**
 * Live marker positions. The player can't move while the phone is open, but
 * NPCs keep walking — a slow interval (only while the map is mounted) keeps
 * Ravi's dot honest without per-frame work.
 */
function useMarkers(): Marker[] {
  const questState = useGameStore((s) => s.questStates[COFFEE_QUEST_ID])
  const mode = useGameStore((s) => s.mode)
  const location = useGameStore((s) => s.location)
  const [dynamic, setDynamic] = useState(() => readDynamic())

  function readDynamic() {
    const ravi = registry.npcPositions.get('npc_ravi_01')
    return {
      player: { x: registry.playerPosition.x, z: registry.playerPosition.z },
      car: { x: registry.vehiclePosition.x, z: registry.vehiclePosition.z },
      ravi: ravi ? { x: ravi.x, z: ravi.z } : null,
    }
  }

  useEffect(() => {
    const interval = setInterval(() => setDynamic(readDynamic()), 1500)
    return () => clearInterval(interval)
  }, [])

  const markers: Marker[] = STATIC_INTERACTABLES.map((def) => ({
    id: def.id,
    icon: def.icon ?? '📍',
    label: def.name,
    x: def.position?.[0] ?? 0,
    z: def.position?.[2] ?? 0,
    kind: 'place' as const,
  }))
  markers.push(...FUTURE_MARKERS.map((m) => ({ ...m, kind: 'future' as const })))
  // Kit-compiled landmarks (Pier Kiosk, North Exchange, …) — data-driven.
  markers.push(
    ...COMPILED_SECTORS.flatMap((c) =>
      c.map.landmarks.map((l) => ({
        id: l.id,
        icon: l.icon,
        label: l.label,
        x: l.position[0],
        z: l.position[1],
        kind: 'place' as const,
      })),
    ),
  )

  if (mode === 'walking') {
    markers.push({ id: 'car', icon: '🚗', label: 'Your car', ...dynamic.car, kind: 'car' })
  }
  if (dynamic.ravi && questState !== 'completed') {
    markers.push({
      id: 'ravi',
      icon: '❗',
      label: questState === 'has_coffee' ? 'Ravi (deliver the coffee!)' : 'Ravi',
      ...dynamic.ravi,
      kind: 'npc',
    })
  }
  // Inside the apartment the raw position is off-map (the interior sits far
  // outside CITY_BOUNDS) — pin the marker to the apartment entrance instead.
  const apartmentDoor = INTERACTABLE_BY_ID['apartment']?.position
  const playerAt =
    location === 'apartment' && apartmentDoor
      ? { x: apartmentDoor[0], z: apartmentDoor[2] }
      : dynamic.player
  markers.push({
    id: 'player',
    icon: mode === 'driving' ? '🚙' : '🙂',
    label:
      location === 'apartment' ? 'You (inside your apartment)' : mode === 'driving' ? 'You (driving)' : 'You',
    ...playerAt,
    kind: 'player',
  })
  return markers
}

/** Positioned rectangle helper (world rect → absolute map style). */
function rectStyle(minX: number, minZ: number, w: number, d: number) {
  const pos = worldToMap(minX, minZ)
  const size = worldSizeToMap(w, d)
  return {
    left: `${pos.left}%`,
    top: `${pos.top}%`,
    width: `${size.width}%`,
    height: `${size.height}%`,
  }
}

export function PhoneMap() {
  const markers = useMarkers()
  const [selected, setSelected] = useState<string | null>(null)
  const selectedMarker = markers.find((m) => m.id === selected)

  const park = rectStyle(
    PARK.center[0] - PARK.size[0] / 2,
    PARK.center[1] - PARK.size[1] / 2,
    PARK.size[0],
    PARK.size[1],
  )
  const lot = rectStyle(
    PARKING_LOT.center[0] - PARKING_LOT.size[0] / 2,
    PARKING_LOT.center[1] - PARKING_LOT.size[1] / 2,
    PARKING_LOT.size[0],
    PARKING_LOT.size[1],
  )

  return (
    <div className="phone-app">
      <div className="phone-section-title">The City</div>
      <div className="phone-map" data-testid="phone-map">
        {/* Central ring road */}
        <div className="phone-map-road phone-map-ring" style={rectStyle(-29, -29, 58, 58)} />
        {/* Downtown Gateway avenue (Large City Foundation v1) */}
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            GATEWAY.road.minX,
            GATEWAY.road.minZ,
            GATEWAY.road.maxX - GATEWAY.road.minX,
            GATEWAY.road.maxZ - GATEWAY.road.minZ,
          )}
        />
        {/* Kit-compiled sectors: roads + water straight from map metadata */}
        {COMPILED_SECTORS.flatMap((c) =>
          c.map.roadStrips.map((strip, i) => (
            <div
              key={`${c.sectorId}-road-${i}`}
              className="phone-map-road-strip"
              style={rectStyle(strip.minX, strip.minZ, strip.maxX - strip.minX, strip.maxZ - strip.minZ)}
            />
          )),
        )}
        {COMPILED_SECTORS.flatMap((c) =>
          c.map.waterStrips.map((strip, i) => (
            <div
              key={`${c.sectorId}-water-${i}`}
              className="phone-map-water"
              data-testid={`map-water-${c.sectorId}`}
              style={rectStyle(strip.minX, strip.minZ, strip.maxX - strip.minX, strip.maxZ - strip.minZ)}
            />
          )),
        )}
        {/* District roads + connectors */}
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            RESIDENTIAL.roadMinX,
            RESIDENTIAL.roadCenterZ - RESIDENTIAL.roadHalfWidth,
            RESIDENTIAL.roadMaxX - RESIDENTIAL.roadMinX,
            RESIDENTIAL.roadHalfWidth * 2,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            CONNECTORS.north.centerX - CONNECTORS.north.halfWidth,
            CONNECTORS.north.fromZ,
            CONNECTORS.north.halfWidth * 2,
            CONNECTORS.north.toZ - CONNECTORS.north.fromZ,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            INDUSTRIAL.roadCenterX - INDUSTRIAL.roadHalfWidth,
            INDUSTRIAL.roadMinZ,
            INDUSTRIAL.roadHalfWidth * 2,
            INDUSTRIAL.roadMaxZ - INDUSTRIAL.roadMinZ,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            CONNECTORS.east.fromX,
            CONNECTORS.east.centerZ - CONNECTORS.east.halfWidth,
            CONNECTORS.east.toX - CONNECTORS.east.fromX,
            CONNECTORS.east.halfWidth * 2,
          )}
        />
        {/* City Expansion v2 roads */}
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            RESIDENTIAL_WEST.roadCenterX - RESIDENTIAL_WEST.roadHalfWidth,
            RESIDENTIAL_WEST.roadMinZ,
            RESIDENTIAL_WEST.roadHalfWidth * 2,
            RESIDENTIAL_WEST.roadMaxZ - RESIDENTIAL_WEST.roadMinZ,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            RESIDENTIAL_SOUTH.roadMinX,
            RESIDENTIAL_SOUTH.roadCenterZ - RESIDENTIAL_SOUTH.roadHalfWidth,
            RESIDENTIAL_SOUTH.roadMaxX - RESIDENTIAL_SOUTH.roadMinX,
            RESIDENTIAL_SOUTH.roadHalfWidth * 2,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            INDUSTRIAL_NORTH.roadCenterX - INDUSTRIAL_NORTH.roadHalfWidth,
            INDUSTRIAL_NORTH.roadMinZ,
            INDUSTRIAL_NORTH.roadHalfWidth * 2,
            INDUSTRIAL_NORTH.roadMaxZ - INDUSTRIAL_NORTH.roadMinZ,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            CONNECTORS.west.fromX,
            CONNECTORS.west.centerZ - CONNECTORS.west.halfWidth,
            CONNECTORS.west.toX - CONNECTORS.west.fromX,
            CONNECTORS.west.halfWidth * 2,
          )}
        />
        <div
          className="phone-map-road-strip"
          style={rectStyle(
            CONNECTORS.south.centerX - CONNECTORS.south.halfWidth,
            CONNECTORS.south.fromZ,
            CONNECTORS.south.halfWidth * 2,
            CONNECTORS.south.toZ - CONNECTORS.south.fromZ,
          )}
        />
        {/* Park + parking lot */}
        <div className="phone-map-park" style={park} />
        <div className="phone-map-lot" style={lot} />
        {/* District labels */}
        {DISTRICT_LABELS.map((d) => {
          const pos = worldToMap(d.x, d.z)
          return (
            <span
              key={d.id}
              className="phone-map-district-label"
              data-testid={`map-district-${d.id}`}
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            >
              {d.label}
            </span>
          )
        })}
        {markers.map((m) => {
          const pos = worldToMap(m.x, m.z)
          return (
            <button
              key={m.id}
              className={`phone-map-marker phone-map-${m.kind} ${
                selected === m.id ? 'phone-map-selected' : ''
              }`}
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
              data-testid={`map-marker-${m.id}`}
              title={m.label}
              onClick={() => setSelected(selected === m.id ? null : m.id)}
            >
              {m.icon}
            </button>
          )
        })}
      </div>
      <div className="phone-map-caption" data-testid="phone-map-caption">
        {selectedMarker ? selectedMarker.label : 'Tap a marker for details.'}
      </div>
    </div>
  )
}
