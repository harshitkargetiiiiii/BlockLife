import { useGameStore } from '../../game/store/useGameStore'
import { getWantedLevel } from '../../game/crime/wantedRuntime'
import { allCareers, getCareer, getRank } from '../../game/careers/careerRegistry'
import { checkEligibility, type EligibilityContext } from '../../game/careers/careerApplications'
import { getActiveShift, getCareerState, getNextShift, getPromotionProgress } from '../../game/careers/careerRuntime'
import { shiftTimeWindow } from '../../game/careers/careerScheduling'
import { skillProgress } from '../../game/careers/skills'
import { SKILL_IDS, type SkillId } from '../../game/careers/careerTypes'

const SKILL_LABEL: Record<SkillId, string> = {
  fitness: 'Fitness',
  driving: 'Driving',
  social: 'Social',
  street_smarts: 'Street Smarts',
  work_ethic: 'Work Ethic',
}

function SkillRow({ id, xp }: { id: SkillId; xp: number }) {
  const p = skillProgress(xp)
  const pct = p.atMax ? 100 : p.span > 0 ? Math.round((p.into / p.span) * 100) : 0
  return (
    <div className="career-skill" data-testid={`career-skill-${id}`}>
      <div className="career-skill-head">
        <span>{SKILL_LABEL[id]}</span>
        <span className="career-skill-level">Lv {p.level}</span>
      </div>
      <div className="career-skill-bar">
        <div className="career-skill-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * Phone → Jobs. The career discovery + status surface (issue #15 §12): five skills,
 * the active job + rank + next shift, and every career's eligibility with a readable
 * refusal reason. Consumes the career runtime through `careerVersion` (the runtime
 * lives outside zustand). The world job board reads the SAME state — no second truth.
 */
export function PhoneJobs() {
  useGameStore((s) => s.careerVersion) // re-render on any career mutation
  const stats = useGameStore((s) => s.stats)
  const applyToCareer = useGameStore((s) => s.applyToCareer)
  const quitCareerJob = useGameStore((s) => s.quitCareerJob)
  const startCareerShift = useGameStore((s) => s.startCareerShift)

  const state = getCareerState()
  const activeJob = state.activeJob
  const nextShift = getNextShift()
  const onShift = getActiveShift() !== null
  const nextWindow = nextShift ? shiftTimeWindow(nextShift, stats.day, stats.hour) : null
  const activeCareer = activeJob ? getCareer(activeJob) : undefined
  const activeRank = activeJob ? getRank(activeJob, state.ranks[activeJob] ?? 'trainee') : undefined

  const ctx: EligibilityContext = {
    skills: state.skills,
    reputation: stats.reputation,
    wanted: getWantedLevel(),
    activeJob,
    hasRecommendation: (id) => state.recommendations.includes(id),
  }

  return (
    <div className="phone-app" data-testid="phone-jobs">
      <div className="phone-section-title">Skills</div>
      <div className="career-skills" data-testid="career-skills">
        {SKILL_IDS.map((id) => (
          <SkillRow key={id} id={id} xp={state.skills[id]} />
        ))}
      </div>

      {activeCareer && (
        <>
          <div className="phone-section-title">Your job</div>
          <div className="phone-card career-active" data-testid="career-active">
            <div className="career-active-title">
              💼 {activeCareer.displayName} — <strong>{activeRank?.displayName}</strong>
            </div>
            <div className="career-active-where">{activeCareer.employerDisplayName}</div>
            {onShift ? (
              <div className="career-next-shift" data-testid="career-on-shift">On shift now — see the tracker.</div>
            ) : nextShift ? (
              <div className="career-next-shift" data-testid="career-next-shift">
                <div>
                  Next shift: day {nextShift.scheduledDay} at {String(nextShift.startHour).padStart(2, '0')}:00 · report to {activeCareer.employerDisplayName}
                </div>
                <div className="panel-actions">
                  <button
                    className="btn btn-small btn-social"
                    data-testid={`start-shift-${nextShift.id}`}
                    disabled={!nextWindow?.startable}
                    onClick={() => startCareerShift(nextShift.id)}
                  >
                    Start shift
                  </button>
                  {!nextWindow?.startable && nextWindow?.reason && (
                    <span className="social-action-reason" data-testid="start-shift-reason">
                      {nextWindow.reason}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="career-next-shift phone-muted">No shift scheduled.</div>
            )}
            {(() => {
              const promo = getPromotionProgress(activeJob!)
              if (!promo || !promo.nextRank) return <div className="career-promo phone-muted" data-testid="career-promo">Top rank reached.</div>
              return (
                <div className="career-promo" data-testid="career-promo">
                  <div className="career-promo-head">Promotion to {promo.nextRank.displayName}</div>
                  {promo.rows.map((r) => (
                    <div key={r.label} className={`career-promo-row ${r.ok ? 'ok' : ''}`}>
                      <span>{r.ok ? '✓' : '○'} {r.label}</span>
                      <span>{r.have}/{r.need}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            {state.unlocks.length > 0 && (
              <div className="career-unlocks" data-testid="career-unlocks">
                Unlocked: {activeCareer.ranks.flatMap((rk) => rk.unlocks).filter((u) => state.unlocks.includes(u.id)).map((u) => u.label).join(' · ')}
              </div>
            )}
            <div className="panel-actions">
              <button className="btn btn-small" data-testid="career-quit" onClick={quitCareerJob}>
                Leave job
              </button>
            </div>
          </div>
        </>
      )}

      <div className="phone-section-title">Careers</div>
      <div className="career-list" data-testid="career-list">
        {allCareers().map((career) => {
          const isActive = activeJob === career.id
          const elig = checkEligibility(career, ctx)
          const held = state.ranks[career.id]
          return (
            <div key={career.id} className="phone-card phone-job career-card" data-testid={`career-${career.id}`}>
              <div className="career-card-head">
                <span className="phone-job-title">{career.displayName}</span>
                <span className="career-pay">${career.basePay}/shift</span>
              </div>
              <div className="phone-job-where">{career.employerDisplayName}</div>
              <div className="phone-job-details">{career.description}</div>
              {held && <div className="career-held">Held rank: {getRank(career.id, held)?.displayName}</div>}
              <div className="panel-actions">
                {isActive ? (
                  <span className="career-current" data-testid={`career-current-${career.id}`}>
                    · current job
                  </span>
                ) : elig.ok ? (
                  <button className="btn btn-small btn-social" data-testid={`apply-${career.id}`} onClick={() => applyToCareer(career.id)}>
                    Apply
                  </button>
                ) : (
                  <span className="social-action-reason" data-testid={`career-reason-${career.id}`}>
                    {elig.reason}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="phone-muted">Show up in person — shifts happen at the workplace, on the clock.</div>
    </div>
  )
}
