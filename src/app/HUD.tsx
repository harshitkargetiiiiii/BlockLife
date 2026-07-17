import { useEffect, useState } from 'react'
import { useGameStore } from '../game/store/useGameStore'
import { formatClock } from '../game/simulation/timeSystem'
import { getMood, MOOD_ICONS } from '../game/simulation/worldMoodSystem'
import { getWeatherBadge } from '../game/weather/weatherSelectors'
import { getWeaponSnapshot } from '../game/combat/weaponRuntime'
import { getWantedSnapshot } from '../game/crime/wantedRuntime'
import { InteractionPrompt } from './InteractionPrompt'
import { QuestLog } from './QuestLog'
import { SaveControls } from './SaveControls'
import { MissionTracker, MissionBanner } from './MissionTracker'
import { DebugPanel } from './DebugPanel'
import { RecoveryOverlay } from './RecoveryOverlay'

function StatBar({
  label,
  value,
  color,
  testId,
}: {
  label: string
  value: number
  color: string
  testId: string
}) {
  return (
    <div className="stat-bar" data-testid={testId}>
      <span className="stat-bar-label">{label}</span>
      <div className="stat-bar-track">
        <div
          className="stat-bar-fill"
          style={{ width: `${Math.round(value)}%`, background: color }}
        />
      </div>
      <span className="stat-bar-value">{Math.round(value)}</span>
    </div>
  )
}

/**
 * Combat readout (ammo + wanted stars). The weapon/wanted state live in plain
 * runtimes (not the store), so this polls a few times a second instead of
 * re-rendering the whole HUD every frame.
 */
function CombatHud() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1000), 150)
    return () => clearInterval(id)
  }, [])
  void tick
  const weapon = getWeaponSnapshot()
  const wanted = getWantedSnapshot()
  if (!weapon.equipped && wanted.level === 0) return null
  return (
    <div className="hud-chips" data-testid="combat-hud">
      {wanted.level > 0 && (
        <span className="hud-chip" data-testid="wanted-stars" title={`Wanted: ${wanted.status}`}>
          {'★'.repeat(wanted.level)}
          <span style={{ opacity: 0.3 }}>{'★'.repeat(3 - wanted.level)}</span>
        </span>
      )}
      {weapon.equipped && (
        <span
          className="hud-chip"
          data-testid="weapon-ammo"
          title={weapon.pose === 'holstered' ? 'Holstered (F to draw)' : 'Space to fire · R to reload'}
        >
          🔫 {weapon.reloading ? '…' : `${weapon.magazine}/${weapon.reserve}`}
        </span>
      )}
    </div>
  )
}

function Toast() {
  const toast = useGameStore((s) => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast || !visible) return null
  return (
    <div className="toast" data-testid="toast">
      {toast.text}
    </div>
  )
}

export function HUD() {
  const stats = useGameStore((s) => s.stats)
  const weather = useGameStore((s) => s.weather)
  const location = useGameStore((s) => s.location)
  const playerHealth = useGameStore((s) => s.playerHealth)
  const mood = getMood(stats.hour)

  return (
    <div className="hud" data-testid="hud">
      <RecoveryOverlay />
      <div className="hud-top-left panel" data-testid="hud-stats">
        <div className="hud-money" data-testid="stat-money">
          <span className="hud-icon">💰</span>${Math.round(stats.money)}
        </div>
        <StatBar label="Hunger" value={stats.hunger} color="#e07a5f" testId="stat-hunger" />
        <StatBar label="Energy" value={stats.energy} color="#7fd4c1" testId="stat-energy" />
        <StatBar label="Health" value={playerHealth} color="#e8546b" testId="stat-health" />
        <div className="hud-chips">
          <span className="hud-chip" data-testid="stat-reputation" title="Reputation">
            ⭐ {Math.round(stats.reputation)}
          </span>
          <span className="hud-chip" data-testid="stat-strength" title="Strength">
            💪 {stats.strength}
          </span>
        </div>
        <CombatHud />
      </div>

      <div className="hud-top-right">
        <div className="panel hud-clock-panel">
          <div className="hud-clock" data-testid="hud-clock">
            Day <span data-testid="stat-day">{stats.day}</span> ·{' '}
            <span data-testid="stat-hour">{formatClock(stats.hour)}</span>
          </div>
          <div className={`mood-chip mood-${mood}`} data-testid="hud-mood">
            {MOOD_ICONS[mood]} {mood}
          </div>
          <div className="mood-chip weather-chip" data-testid="hud-weather">
            {getWeatherBadge(weather)}
          </div>
          {location === 'apartment' && (
            <div className="mood-chip hud-location-chip" data-testid="hud-location">
              🏠 Apartment
            </div>
          )}
        </div>
        <SaveControls />
      </div>

      <div className="hud-bottom-center">
        <Toast />
        <InteractionPrompt />
      </div>

      <MissionTracker />
      <MissionBanner />
      <QuestLog />

      <div className="hud-bottom-right">
        <div className="controls-hint panel">
          WASD move · Shift run · E interact · Tab/P phone · Esc close
        </div>
        <button
          className="btn btn-small phone-button"
          data-testid="phone-button"
          onClick={() => useGameStore.getState().togglePhone()}
        >
          📱 Phone
        </button>
        <DebugPanel />
      </div>
    </div>
  )
}
