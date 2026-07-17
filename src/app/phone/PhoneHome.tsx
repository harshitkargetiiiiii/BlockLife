import { useGameStore } from '../../game/store/useGameStore'
import { formatClock } from '../../game/simulation/timeSystem'
import { getMood, MOOD_ICONS } from '../../game/simulation/worldMoodSystem'
import { getApartmentFlavorLine, getFlavorLine } from './phoneUtils'
import { getWeatherBadge, getWeatherFlavor } from '../../game/weather/weatherSelectors'

const ITEM_NAMES: Record<string, string> = {
  coffee: '☕ Coffee',
}

function StatCard({ icon, label, value, testId }: { icon: string; label: string; value: string; testId: string }) {
  return (
    <div className="phone-card phone-stat-card" data-testid={testId}>
      <span className="phone-stat-icon">{icon}</span>
      <span className="phone-stat-value">{value}</span>
      <span className="phone-stat-label">{label}</span>
    </div>
  )
}

export function PhoneHome() {
  const stats = useGameStore((s) => s.stats)
  const questStates = useGameStore((s) => s.questStates)
  const inventory = useGameStore((s) => s.inventory)
  const weather = useGameStore((s) => s.weather)
  const location = useGameStore((s) => s.location)
  const mood = getMood(stats.hour)
  const items = Object.entries(inventory).filter(([, qty]) => qty > 0)

  return (
    <div className="phone-app">
      <div className="phone-home-hero">
        <div className="phone-home-clock">{formatClock(stats.hour)}</div>
        <div className="phone-home-day">
          Day {stats.day} · {MOOD_ICONS[mood]} {mood}
        </div>
        <div className="phone-home-weather" data-testid="phone-weather">
          {getWeatherBadge(weather)}
        </div>
        {location === 'apartment' && (
          <div className="phone-home-weather" data-testid="phone-location">
            🏠 At home
          </div>
        )}
      </div>
      <div className="phone-flavor" data-testid="phone-flavor">
        {getFlavorLine(stats, questStates, mood)}
      </div>
      <div className="phone-flavor phone-weather-flavor" data-testid="phone-weather-flavor">
        {location === 'apartment' ? getApartmentFlavorLine(stats, weather) : getWeatherFlavor(weather)}
      </div>
      <div className="phone-stat-grid">
        <StatCard icon="💰" label="Money" value={`$${Math.round(stats.money)}`} testId="phone-stat-money" />
        <StatCard icon="🍔" label="Hunger" value={`${Math.round(stats.hunger)}`} testId="phone-stat-hunger" />
        <StatCard icon="⚡" label="Energy" value={`${Math.round(stats.energy)}`} testId="phone-stat-energy" />
        <StatCard icon="⭐" label="Rep" value={`${Math.round(stats.reputation)}`} testId="phone-stat-reputation" />
        <StatCard icon="💪" label="Strength" value={`${stats.strength}`} testId="phone-stat-strength" />
      </div>
      <div className="phone-section-title">Bag</div>
      {items.length === 0 ? (
        <div className="phone-muted">Nothing yet — go live a little.</div>
      ) : (
        <ul className="phone-bag" data-testid="phone-bag">
          {items.map(([id, qty]) => (
            <li key={id}>
              {ITEM_NAMES[id] ?? id} × {qty}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
