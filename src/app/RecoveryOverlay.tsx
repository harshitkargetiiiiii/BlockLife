import { useEffect } from 'react'
import { useGameStore } from '../game/store/useGameStore'

/**
 * BUSTED / WASTED overlay. Also the trigger point for incapacitation recovery:
 * when the player's health hits 0, a short "down" beat elapses, then the store
 * resolves the incident (penalty, reset, respawn). The overlay auto-dismisses.
 */
export function RecoveryOverlay() {
  const recovery = useGameStore((s) => s.recovery)
  const incapacitated = useGameStore((s) => s.playerIncapacitated)

  // Health hit zero → brief incapacitated beat → resolve.
  useEffect(() => {
    if (!incapacitated || recovery) return
    const t = setTimeout(
      () => useGameStore.getState().respawnAfterIncident('incapacitation'),
      1000,
    )
    return () => clearTimeout(t)
  }, [incapacitated, recovery])

  // Auto-dismiss the panel.
  useEffect(() => {
    if (!recovery) return
    const t = setTimeout(() => useGameStore.getState().dismissRecovery(), 2600)
    return () => clearTimeout(t)
  }, [recovery])

  if (!recovery) return null
  return (
    <div className="recovery-overlay" data-testid="recovery-overlay" data-kind={recovery.kind}>
      <div className="recovery-title">{recovery.kind === 'arrest' ? 'BUSTED' : 'WASTED'}</div>
      <div className="recovery-sub">{recovery.message}</div>
    </div>
  )
}
