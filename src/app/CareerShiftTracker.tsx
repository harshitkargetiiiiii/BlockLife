import { useGameStore } from '../game/store/useGameStore'
import { getActiveShift } from '../game/careers/careerRuntime'
import { currentStep } from '../game/careers/careerShifts'

/**
 * On-shift HUD tracker (issue #15 §12). Shows the active shift's current objective +
 * progress, gates the advance button on being AT the objective's real workplace/
 * destination (reusing the live proximity scanner), and offers the bonus objective +
 * a quit. Reads the career runtime via `careerVersion` (runtime lives outside zustand).
 */
export function CareerShiftTracker() {
  useGameStore((s) => s.careerVersion) // re-render on career mutations
  const activeInteractableId = useGameStore((s) => s.activeInteractableId)
  const advanceCareerShift = useGameStore((s) => s.advanceCareerShift)
  const cancelCareerShift = useGameStore((s) => s.cancelCareerShift)
  const completeCareerShiftBonus = useGameStore((s) => s.completeCareerShiftBonus)

  const shift = getActiveShift()
  if (!shift || !shift.objectives) return null

  const step = currentStep(shift.objectives)
  const required = shift.objectives.filter((o) => !o.optional)
  const requiredDone = required.filter((o) => o.done).length
  const bonus = shift.objectives.find((o) => o.optional)
  const target = step ? step.anchorId ?? shift.workplaceInteractableId : null
  const atTarget = target === null || activeInteractableId === target

  return (
    <div className="social-activity-tracker career-shift-tracker" data-testid="career-shift-tracker">
      <div className="sat-title">
        On shift · {requiredDone}/{required.length}
      </div>
      {step ? (
        <>
          <div className="sat-step" data-testid="cst-step">
            {step.description}
          </div>
          <div className="panel-actions">
            <button className="btn btn-small btn-social" data-testid="cst-advance" disabled={!atTarget} onClick={advanceCareerShift}>
              {step.kind === 'report' ? 'Clock in' : step.kind === 'collect' ? 'Load up' : step.kind === 'wrap' ? 'Clock out' : "I'm on it"}
            </button>
            {bonus && !bonus.done && (
              <button className="btn btn-small" data-testid="cst-bonus" onClick={completeCareerShiftBonus}>
                Bonus
              </button>
            )}
          </div>
          {!atTarget && (
            <span className="sat-reason" data-testid="cst-reason">
              Head to the workplace/stop first.
            </span>
          )}
        </>
      ) : (
        <div className="panel-actions">
          <button className="btn btn-small btn-social" data-testid="cst-finish" onClick={advanceCareerShift}>
            Finish shift
          </button>
        </div>
      )}
      <button className="btn btn-tiny cst-quit" data-testid="cst-quit" onClick={cancelCareerShift}>
        Quit shift
      </button>
    </div>
  )
}
