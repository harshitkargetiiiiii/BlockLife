import { useGameStore } from '../game/store/useGameStore'

/** Save / Load / Reset + the browser-required audio unlock button. */
export function SaveControls() {
  const saveNow = useGameStore((s) => s.saveNow)
  const loadNow = useGameStore((s) => s.loadNow)
  const resetSave = useGameStore((s) => s.resetSave)
  const toggleAudio = useGameStore((s) => s.toggleAudio)
  const audioEnabled = useGameStore((s) => s.audioEnabled)

  return (
    <div className="save-controls panel">
      <button className="btn btn-small" data-testid="save-btn" onClick={() => void saveNow()}>
        💾 Save
      </button>
      <button className="btn btn-small" data-testid="load-btn" onClick={() => void loadNow()}>
        📂 Load
      </button>
      <button
        className="btn btn-small btn-danger"
        data-testid="reset-btn"
        onClick={() => void resetSave()}
      >
        🗑 Reset
      </button>
      <button
        className={`btn btn-small ${audioEnabled ? 'btn-toggled' : ''}`}
        data-testid="audio-btn"
        onClick={toggleAudio}
      >
        {audioEnabled ? '🔊 On' : '🔇 Audio'}
      </button>
    </div>
  )
}
