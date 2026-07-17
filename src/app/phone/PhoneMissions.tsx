import { useGameStore } from '../../game/store/useGameStore'
import { MISSION_DEFINITIONS, getMissionDefinition } from '../../game/missions/missionDefinitions'
import { missionRuntime } from '../../game/missions/missionRuntime'
import { getMissionAvailability } from '../../game/missions/missionSelectors'
import type { MissionDefinition, MissionStatus } from '../../game/missions/missionTypes'

/**
 * Phone "Jobs+" surface (Mission & Activity Framework v1). Lists every mission
 * grouped by Available / Active / Completed / Cooldown with accept + cancel
 * controls. It reads the reactive `missionView` (re-render trigger) and the
 * clock, then computes availability from the mission runtime via the pure
 * selectors — no per-frame work.
 */
function rewardText(def: MissionDefinition): string {
  return def.rewards
    .map((r) => (r.kind === 'money' ? `$${r.amount}` : `${r.quantity}× ${r.itemId}`))
    .join(' · ')
}

export function PhoneMissions() {
  // Re-render on mission-list changes + clock ticks (cooldown countdown).
  useGameStore((s) => s.missionView.listSeq)
  const stats = useGameStore((s) => s.stats)
  const gameHours = stats.day * 24 + stats.hour

  const ctx = {
    gameHours,
    activeMissionId: missionRuntime.active?.missionId ?? null,
    discovered: missionRuntime.discovered,
    cooldownReadyAt: Object.fromEntries(
      Object.values(missionRuntime.cooldowns).map((c) => [c.missionId, c.readyAtGameHours]),
    ),
  }

  const rows = MISSION_DEFINITIONS.map((def) => ({ def, status: getMissionAvailability(def, ctx) }))
  const active = rows.filter((r) => r.status === 'active')
  const available = rows.filter((r) => r.status === 'available')
  const cooldown = rows.filter((r) => r.status === 'cooldown')
  const locked = rows.filter((r) => r.status === 'locked')
  const completed = MISSION_DEFINITIONS.filter((d) => (missionRuntime.history[d.id]?.completions ?? 0) > 0)

  return (
    <div className="phone-app" data-testid="phone-missions">
      <div className="phone-section-title">Jobs Board</div>

      <Section title="Active" show={active.length > 0}>
        {active.map(({ def }) => (
          <ActiveCard key={def.id} def={def} />
        ))}
      </Section>

      <Section title="Available" show={available.length > 0}>
        {available.map(({ def }) => (
          <OfferCard key={def.id} def={def} status="available" gameHours={gameHours} />
        ))}
      </Section>

      <Section title="On Cooldown" show={cooldown.length > 0}>
        {cooldown.map(({ def }) => (
          <OfferCard key={def.id} def={def} status="cooldown" gameHours={gameHours} />
        ))}
      </Section>

      <Section title="Completed" show={completed.length > 0}>
        {completed.map((def) => {
          const h = missionRuntime.history[def.id]
          return (
            <div key={def.id} className="phone-card phone-mission" data-testid={`mission-completed-${def.id}`}>
              <div className="phone-mission-title">{def.title}</div>
              <div className="phone-mission-meta">
                ✓ {h.completions}× · earned ${h.totalEarned}
              </div>
            </div>
          )
        })}
      </Section>

      {/* Undiscovered work still hints at itself, so the board is never a dead
          end and the player knows where to look for off-the-books jobs. */}
      {locked.length > 0 && (
        <div className="phone-muted" data-testid="phone-missions-locked-hint">
          Word is there&rsquo;s work off the books around the Industrial Yard — go find the fixer.
        </div>
      )}
    </div>
  )
}

function Section({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null
  return (
    <div className="phone-mission-section">
      <div className="phone-mission-section-title">{title}</div>
      {children}
    </div>
  )
}

function ActiveCard({ def }: { def: MissionDefinition }) {
  const view = useGameStore((s) => s.missionView)
  const objDef = getMissionDefinition(def.id)?.objectives[view.objectiveIndex]
  return (
    <div className="phone-card phone-mission phone-mission-active" data-testid={`mission-active-${def.id}`}>
      <div className="phone-mission-head">
        <span className="phone-mission-title">{def.title}</span>
        <span className={`phone-mission-cat phone-mission-cat-${def.category}`}>{def.category}</span>
      </div>
      <div className="phone-mission-objective">▸ {objDef?.description ?? view.objectiveText}</div>
      <div className="phone-mission-actions">
        <button
          className="btn btn-small btn-danger"
          data-testid={`mission-cancel-${def.id}`}
          onClick={() => useGameStore.getState().cancelActiveMission()}
        >
          Cancel job
        </button>
      </div>
    </div>
  )
}

function OfferCard({
  def,
  status,
  gameHours,
}: {
  def: MissionDefinition
  status: MissionStatus
  gameHours: number
}) {
  const onCooldown = status === 'cooldown'
  const remaining = onCooldown
    ? Math.max(0, Math.ceil((missionRuntime.cooldowns[def.id]?.readyAtGameHours ?? 0) - gameHours))
    : 0
  return (
    <div className="phone-card phone-mission" data-testid={`mission-offer-${def.id}`}>
      <div className="phone-mission-head">
        <span className="phone-mission-title">{def.title}</span>
        <span className={`phone-mission-cat phone-mission-cat-${def.category}`}>{def.category}</span>
      </div>
      <div className="phone-mission-desc">{def.description}</div>
      <div className="phone-mission-meta">Pays {rewardText(def)}</div>
      <div className="phone-mission-actions">
        {onCooldown ? (
          <span className="phone-mission-cooldown" data-testid={`mission-cooldown-${def.id}`}>
            Available in {remaining}h
          </span>
        ) : (
          <button
            className="btn btn-small"
            data-testid={`mission-accept-${def.id}`}
            onClick={() => useGameStore.getState().acceptMissionById(def.id)}
          >
            Accept
          </button>
        )}
      </div>
    </div>
  )
}
