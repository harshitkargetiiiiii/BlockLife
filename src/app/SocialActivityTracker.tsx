import { useGameStore } from '../game/store/useGameStore'
import { getActiveActivity } from '../game/social/socialRuntime'
import { getSocialActor } from '../game/social/socialActors'
import { activityPrompt } from '../game/social/socialActivities'

/**
 * A small HUD card for the single in-progress social activity (Slice 4): the
 * current step's prompt, a Continue button (advances / hands over a favor item /
 * completes) and a Cancel. Reads the social runtime; re-renders via socialVersion.
 */
export function SocialActivityTracker() {
  useGameStore((s) => s.socialVersion)
  const advance = useGameStore((s) => s.advanceSocialActivity)
  const cancel = useGameStore((s) => s.cancelSocialActivity)

  const activity = getActiveActivity()
  if (!activity) return null
  const name = getSocialActor(activity.actorId)?.displayName ?? 'them'

  return (
    <div className="social-activity-tracker" data-testid="social-activity-tracker">
      <div className="sat-title">🤝 {activity.template === 'favor' ? 'Favor' : 'Hangout'} · {name}</div>
      <div className="sat-prompt" data-testid="sat-prompt">
        {activityPrompt(activity, name)}
      </div>
      <div className="sat-actions">
        <button className="btn btn-small btn-primary" data-testid="sat-continue" onClick={advance}>
          {activity.step === 'together' ? 'Wrap up' : activity.step === 'deliver' ? 'Hand over' : 'I’m here'}
        </button>
        <button className="btn btn-small btn-ghost" data-testid="sat-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
