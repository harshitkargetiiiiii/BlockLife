import { useGameStore } from '../../game/store/useGameStore'
import { PHONE_BUILD_LABEL } from './phoneTypes'

export function PhoneSettings() {
  const saveNow = useGameStore((s) => s.saveNow)
  const loadNow = useGameStore((s) => s.loadNow)
  const resetSave = useGameStore((s) => s.resetSave)
  const toggleAudio = useGameStore((s) => s.toggleAudio)
  const audioEnabled = useGameStore((s) => s.audioEnabled)

  return (
    <div className="phone-app">
      <div className="phone-section-title">Settings</div>
      <div className="phone-settings">
        <button className="btn phone-settings-btn" data-testid="phone-save" onClick={() => void saveNow()}>
          💾 Save game
        </button>
        <button className="btn phone-settings-btn" data-testid="phone-load" onClick={() => void loadNow()}>
          📂 Load game
        </button>
        <button
          className="btn phone-settings-btn btn-danger"
          data-testid="phone-reset"
          onClick={() => void resetSave()}
        >
          🗑 Reset save
        </button>
        <button
          className={`btn phone-settings-btn ${audioEnabled ? 'btn-toggled' : ''}`}
          data-testid="phone-audio"
          onClick={toggleAudio}
        >
          {audioEnabled ? '🔊 Audio on' : '🔇 Start audio'}
        </button>
      </div>
      <div className="phone-muted phone-version" data-testid="phone-version">
        {PHONE_BUILD_LABEL}
      </div>
    </div>
  )
}
