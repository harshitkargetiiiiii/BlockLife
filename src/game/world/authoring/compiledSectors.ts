import type { CompiledSectorContent } from './authoringTypes'
import { MAIN_STREET_EAST } from './sectors/mainStreetEast'
import { WATERFRONT_GATEWAY } from './sectors/waterfrontGateway'
import { MAIN_STREET_NORTH } from './sectors/mainStreetNorth'
import { RESIDENTIAL_EAST } from './sectors/residentialEast'
import { INDUSTRIAL_YARD } from './sectors/industrialYard'

/**
 * Every kit-compiled sector in the game. New authored sectors register here;
 * the debug panel, phone map and test API read this list, and validation
 * sweeps it. Order = compile/spread order (stable).
 */
export const COMPILED_SECTORS: CompiledSectorContent[] = [
  MAIN_STREET_EAST,
  WATERFRONT_GATEWAY,
  MAIN_STREET_NORTH,
  RESIDENTIAL_EAST,
  INDUSTRIAL_YARD,
]

export function getCompiledSector(sectorId: string): CompiledSectorContent | undefined {
  return COMPILED_SECTORS.find((c) => c.sectorId === sectorId)
}
