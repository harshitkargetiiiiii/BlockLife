import { RainEffect } from './RainEffect'
import { FogEffect } from './FogEffect'
import { Puddles } from './Puddles'
import { WetSurfaceController } from './WetSurfaceController'

/** All in-scene weather visuals, mounted once inside the Canvas. */
export function WeatherEffects() {
  return (
    <>
      <FogEffect />
      <RainEffect />
      <Puddles />
      <WetSurfaceController />
    </>
  )
}
