import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../game/store/useGameStore'
import { audioManager } from '../game/audio/AudioManager'

/**
 * Compact criminal-activity HUD (Store Robbery v1 + Getaway Polish v1). Reads
 * ONLY the UI-reactive `activityView` mirror, never the runtime. Non-overlapping
 * pieces: an unsecured-cash badge (top-left, under the stats), a contextual
 * robbery prompt (threat meter / register / alarm), a police containment/breach
 * warning, and a centered result banner. Kept clear of health, wanted, ammo,
 * vehicle and mission info.
 */

export function RobberyHUD() {
  const view = useGameStore((s) => s.activityView)
  const showThreat = view.phase === 'threatening' && view.threatProgress > 0.02
  const active = view.phase === 'threatening' || view.phase === 'demanding'

  return (
    <>
      <ContainmentWarning phase={view.containmentPhase} breachSeconds={view.breachSeconds} />
      {/* Unsecured criminal cash — a warning-tinted badge. */}
      {view.unsecuredProceeds > 0 && (
        <div className="robbery-proceeds panel" data-testid="robbery-proceeds">
          <span className="robbery-proceeds-icon">💰</span>
          <span className="robbery-proceeds-amt" data-testid="robbery-proceeds-amount">
            ${view.unsecuredProceeds}
          </span>
          <span className="robbery-proceeds-label">
            {view.canSecure ? 'secure at the fixer' : 'unsecured'}
          </span>
        </div>
      )}

      {/* Robbery prompt: threat progress, comply/loot, alarm. */}
      {(active || view.canLoot) && (
        <div className="robbery-prompt panel" data-testid="robbery-prompt">
          <div className="robbery-prompt-title">
            ⚠ {view.storeTitle ?? 'Robbery'}
          </div>
          {showThreat && (
            <div className="robbery-threat-bar">
              <div
                className="robbery-threat-fill"
                data-testid="robbery-threat"
                style={{ width: `${Math.round(view.threatProgress * 100)}%` }}
              />
            </div>
          )}
          <div className="robbery-prompt-line" data-testid="robbery-prompt-line">
            {view.canLoot
              ? 'Press E — empty the register'
              : view.phase === 'demanding'
                ? 'Cashier complying — reach the register'
                : view.cashierPhase === 'fled'
                  ? 'The cashier bolted!'
                  : view.cashierPhase === 'refused'
                    ? 'The cashier refuses…'
                    : 'Keep the cashier covered'}
          </div>
          {view.alarmArmed && <div className="robbery-alarm" data-testid="robbery-alarm">SILENT ALARM</div>}
        </div>
      )}

      <RobberyBanner />
    </>
  )
}

/**
 * Police-response + containment/breach warning. Reads only the projected phase +
 * countdown. Plays a one-shot siren when police start responding and an alert as
 * the breach warning opens (audio self-guards until the player enables sound).
 */
function ContainmentWarning({
  phase,
  breachSeconds,
}: {
  phase: 'none' | 'responding' | 'contained' | 'warning' | 'breached'
  breachSeconds: number | null
}) {
  const prev = useRef(phase)
  useEffect(() => {
    if (phase !== prev.current) {
      if (phase === 'responding') audioManager.playSiren()
      else if (phase === 'warning') audioManager.playAlert()
      prev.current = phase
    }
  }, [phase])

  if (phase === 'none' || phase === 'breached') return null
  const warning = phase === 'warning'
  return (
    <div
      className={`robbery-containment panel${warning ? ' robbery-containment-warning' : ''}`}
      data-testid="robbery-containment"
    >
      <div className="robbery-containment-title">🚨 Police {phase === 'responding' ? 'responding' : 'containment'}</div>
      <div className="robbery-containment-line" data-testid="robbery-containment-line">
        {phase === 'responding'
          ? 'Units inbound — get out before they lock it down'
          : warning
            ? `They're coming in — ${Math.max(1, Math.ceil(breachSeconds ?? 0))}s`
            : "Exit's covered — find your moment"}
      </div>
    </div>
  )
}

/** Centered success/failure banner, auto-dismissed after a moment. */
function RobberyBanner() {
  const result = useGameStore((s) => s.activityView.result)
  const dismiss = useGameStore((s) => s.dismissRobberyResult)
  const [shown, setShown] = useState<typeof result>(null)

  useEffect(() => {
    if (!result) return
    setShown(result)
    audioManager.playChime(result.outcome === 'secured')
    const t = setTimeout(() => {
      setShown(null)
      dismiss()
    }, 3200)
    return () => clearTimeout(t)
  }, [result, dismiss])

  if (!shown) return null
  const secured = shown.outcome === 'secured'
  return (
    <div
      className={`robbery-banner ${secured ? 'robbery-banner-ok' : 'robbery-banner-bad'}`}
      data-testid="robbery-banner"
    >
      <div className="robbery-banner-title">
        {secured ? 'CASH SECURED' : shown.outcome === 'busted' ? 'PROCEEDS LOST' : 'JOB ABANDONED'}
      </div>
      {shown.amount > 0 && <div className="robbery-banner-amt">${shown.amount}</div>}
    </div>
  )
}
