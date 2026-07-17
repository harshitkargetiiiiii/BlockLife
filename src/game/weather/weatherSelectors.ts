import { WEATHER_FLAVOR } from './weatherData'
import { WEATHER_ICONS, WEATHER_LABELS, type WeatherKind } from './weatherTypes'

/** "☀️ Clear" — HUD badge / debug panel text. */
export function getWeatherBadge(kind: WeatherKind): string {
  return `${WEATHER_ICONS[kind]} ${WEATHER_LABELS[kind]}`
}

/** One-line phone-home flavor for the current weather. */
export function getWeatherFlavor(kind: WeatherKind): string {
  return WEATHER_FLAVOR[kind]
}
