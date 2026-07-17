import { useEffect, useState } from 'react'
import { useGameStore } from '../game/store/useGameStore'

/**
 * Compact HUD mission tracker (top-right, below the clock) + a centered result
 * banner. Reads only the UI-reactive `missionView` mirror — never the runtime.
 * Kept small so it never obscures health, wanted, ammo or the clock.
 */
export function MissionTracker() {
  const view = useGameStore((s) => s.missionView)
  if (!view.activeMissionId) return null
  const dist = view.objectiveDistance
  return (
    <div className="mission-tracker panel" data-testid="mission-tracker">
      <div className="mission-tracker-eyebrow">
        <span className={`mission-cat mission-cat-${view.category}`}>
          {view.category === 'criminal' ? '⚠ Job' : '📦 Job'}
        </span>
        <span className="mission-step" data-testid="mission-step">
          {Math.min(view.objectiveIndex + 1, view.objectiveCount)}/{view.objectiveCount}
        </span>
      </div>
      <div className="mission-tracker-title" data-testid="mission-title">{view.title}</div>
      <div className="mission-tracker-objective" data-testid="mission-objective">
        {view.objectiveText}
      </div>
      {dist !== null && dist > 3 && (
        <div className="mission-tracker-dist" data-testid="mission-distance">
          {dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}
        </div>
      )}
    </div>
  )
}

/** A short-lived COMPLETE / FAILED banner shown on a terminal mission result. */
export function MissionBanner() {
  const result = useGameStore((s) => s.missionView.result)
  const [shownSeq, setShownSeq] = useState(-1)

  useEffect(() => {
    if (!result || result.seq === shownSeq) return
    setShownSeq(result.seq)
    const t = setTimeout(() => useGameStore.getState().dismissMissionResult(), 4200)
    return () => clearTimeout(t)
  }, [result, shownSeq])

  if (!result) return null
  const label =
    result.outcome === 'completed'
      ? 'Job Complete'
      : result.outcome === 'failed'
        ? 'Job Failed'
        : 'Job Cancelled'
  const reasonText: Record<string, string> = {
    player_arrested: 'Busted by the police',
    player_incapacitated: 'You were hospitalized',
    target_vehicle_disabled: 'The vehicle was wrecked',
    target_vehicle_lost: 'The vehicle was lost',
    mission_cancelled: 'Cancelled',
  }
  return (
    <div className={`mission-banner mission-banner-${result.outcome}`} data-testid="mission-banner">
      <div className="mission-banner-label">{label}</div>
      <div className="mission-banner-title">{result.title}</div>
      {result.reason && result.outcome === 'failed' && (
        <div className="mission-banner-reason">{reasonText[result.reason] ?? result.reason}</div>
      )}
    </div>
  )
}
