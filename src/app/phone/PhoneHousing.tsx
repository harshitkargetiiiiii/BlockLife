import { useGameStore } from '../../game/store/useGameStore'
import { PROPERTY_DEFS, getProperty } from '../../game/housing/propertyRegistry'
import { getHomeMetrics, getHousingState, getOwnedAssets, isDiscovered, isToured } from '../../game/housing/housingRuntime'
import { daysUntilDue, isDelinquent, leaseStatusLabel } from '../../game/housing/leaseModel'
import { housingEligibility } from '../../game/housing/housingCareer'
import { HOME_ACTIVITY_DEFS, tierAtLeast } from '../../game/housing/housingSocial'
import { hostingRefusalText } from '../../game/housing/housingText'
import { SOCIAL_ACTORS } from '../../game/social/socialActors'
import { getDerivedRelationship, hasMet } from '../../game/social/socialRuntime'
import type { PropertyId } from '../../game/housing/housingTypes'

/**
 * The canonical Home phone app (issue #17 §11). Shows the current residence + rent
 * status with a Pay Now action, and the property listings with exact costs, the
 * first unmet requirement, discovered/toured state, and Tour / Lease actions. It
 * re-renders on `housingVersion` (the housing runtime lives outside zustand). The
 * furniture / metrics / preset surfaces are added by the later housing slices.
 */
export function PhoneHousing() {
  // Subscribe so the app re-renders when housing OR the clock/money changes.
  useGameStore((s) => s.housingVersion)
  const day = useGameStore((s) => s.stats.day)
  const money = useGameStore((s) => s.stats.money)
  const guideTour = useGameStore((s) => s.guideToPropertyTour)
  const lease = useGameStore((s) => s.leaseHousingProperty)
  const payRent = useGameStore((s) => s.payHousingRent)
  const invite = useGameStore((s) => s.sendPlayerInvite)
  const canHostHome = useGameStore((s) => s.canHostHomeActivity)
  useGameStore((s) => s.socialVersion) // hosting eligibility depends on relationships

  const state = getHousingState()
  const current = getProperty(state.currentPropertyId)
  const lease0 = state.lease
  const due = daysUntilDue(lease0, day)
  const metrics = getHomeMetrics()
  const ownedCount = getOwnedAssets().length
  const placedCount = Object.keys(state.placements).length

  return (
    <div className="phone-app" data-testid="phone-housing">
      <div className="phone-section-title">Your home</div>
      <div className="phone-card" data-testid="housing-current">
        <div className="phone-job-title">{current?.displayName ?? 'No home'}</div>
        <div className="phone-job-where">{current?.district}</div>
        <div className="phone-job-details" data-testid="housing-rent">
          Rent ${current?.rent} / {current?.rentPeriodDays} days · {leaseStatusLabel(lease0)}
          {lease0.debt <= 0 && <> · due in {Math.max(0, due)}d</>}
        </div>
        {lease0.depositHeld > 0 && <div className="phone-muted">Deposit held: ${lease0.depositHeld}</div>}
        {isDelinquent(lease0) && (
          <div className="panel-actions">
            <button className="btn btn-small" data-testid="housing-pay-rent" onClick={() => payRent()}>
              Pay Now (${lease0.debt})
            </button>
          </div>
        )}
      </div>

      <div className="phone-section-title">Home metrics</div>
      <div className="phone-card" data-testid="housing-metrics">
        <div className="housing-metric-row"><span>Comfort</span><span data-testid="housing-metric-comfort">{metrics.comfort}/100</span></div>
        <div className="housing-metric-row"><span>Style</span><span data-testid="housing-metric-style">{metrics.style}/100</span></div>
        <div className="housing-metric-row"><span>Storage</span><span data-testid="housing-metric-storage">{metrics.storageCapacity} slots</span></div>
        <div className="housing-metric-row"><span>Sleep Quality</span><span data-testid="housing-metric-sleep">{metrics.sleepQuality}/100</span></div>
        <div className="housing-metric-row"><span>Hosting</span><span data-testid="housing-metric-hosting">{metrics.hostingCapacity} guests</span></div>
        <div className="phone-muted" data-testid="housing-next-upgrade">{metrics.nextUpgrade}</div>
        <details className="housing-breakdown">
          <summary>Contribution breakdown</summary>
          {metrics.contributions.map((c, i) => (
            <div key={i} className="housing-metric-row phone-muted">
              <span>{c.source}</span>
              <span>+{c.comfort}c · +{c.style}s{c.storage ? ` · +${c.storage} slots` : ''}</span>
            </div>
          ))}
        </details>
      </div>

      <div className="phone-section-title">Furniture</div>
      <div className="phone-card" data-testid="housing-furniture">
        <div className="phone-job-details">{ownedCount} owned · {placedCount} placed</div>
        <div className="phone-muted">Furnish at the 🛋️ station inside your home.</div>
      </div>

      <div className="phone-section-title">Home Hosting</div>
      {HOME_ACTIVITY_DEFS.map((adef) => {
        // The ONE shared gate (review #3): kind-level + wanted/incap/shift/mission/robbery.
        const host = canHostHome(adef.kind)
        const guests = SOCIAL_ACTORS.filter((a) => hasMet(a.id) && tierAtLeast(getDerivedRelationship(a.id).tier, adef.minTier))
        return (
          <div key={adef.kind} className="phone-card" data-testid={`hosting-${adef.kind}`}>
            <span className="phone-job-title">{adef.displayName}</span>
            <div className="phone-job-details">{adef.description}</div>
            {host.ok ? (
              guests.length === 0 ? (
                <div className="phone-muted" data-testid={`hosting-ready-${adef.kind}`}>Ready — but no close friends to invite yet.</div>
              ) : (
                <div className="panel-actions" data-testid={`hosting-ready-${adef.kind}`}>
                  {guests.slice(0, 3).map((g) => (
                    <button key={g.id} className="btn btn-tiny btn-social" data-testid={`hosting-invite-${adef.kind}-${g.id}`} onClick={() => invite(g.id, adef.invitationKind)}>
                      Invite {g.displayName}
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="phone-muted" data-testid={`hosting-blocked-${adef.kind}`}>{hostingRefusalText(host.reason)}</div>
            )}
          </div>
        )
      })}

      <div className="phone-section-title">Listings</div>
      {PROPERTY_DEFS.map((p) => {
        const isCurrent = p.id === state.currentPropertyId
        const discovered = isDiscovered(p.id)
        const toured = isToured(p.id)
        const elig = housingEligibility(p.id as PropertyId, day)
        const canAfford = money + lease0.depositHeld >= p.deposit + p.rent
        return (
          <div key={p.id} className="phone-card phone-job" data-testid={`housing-listing-${p.id}`}>
            <span className="phone-job-title">{p.displayName}</span>
            <div className="phone-job-where">
              {p.district} · {p.tier}
            </div>
            <div className="phone-job-details">{p.listingCopy}</div>
            <div className="phone-job-details">
              Deposit ${p.deposit} · Rent ${p.rent}/{p.rentPeriodDays}d
            </div>
            {isCurrent ? (
              <div className="phone-muted">You live here.</div>
            ) : (
              <>
                {!elig.eligible && (
                  <div className="phone-muted" data-testid={`housing-reason-${p.id}`}>
                    {elig.firstUnmetReason}
                  </div>
                )}
                {elig.eligible && !canAfford && (
                  <div className="phone-muted" data-testid={`housing-reason-${p.id}`}>
                    Not enough to cover the deposit and first rent.
                  </div>
                )}
                <div className="panel-actions">
                  <button
                    className="btn btn-small"
                    data-testid={`housing-tour-${p.id}`}
                    onClick={() => guideTour(p.id as PropertyId)}
                  >
                    {toured ? 'Tour again' : 'Tour'}
                  </button>
                  <button
                    className="btn btn-small btn-social"
                    data-testid={`housing-lease-${p.id}`}
                    disabled={!elig.eligible || !canAfford}
                    onClick={() => lease(p.id as PropertyId)}
                  >
                    Lease / Move
                  </button>
                </div>
                {discovered && !toured && p.tourRequired && (
                  <div className="phone-muted">Tour required before leasing.</div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
