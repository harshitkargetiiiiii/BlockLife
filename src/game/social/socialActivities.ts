/**
 * Reusable social ACTIVITY templates (issue #13 §activities). A social activity is
 * a short, structured hangout that ends in a relationship event through the ONE
 * social pipeline — it is NOT a second mission engine: it has no money rewards,
 * cooldowns, offer/anchor graph, failure rules, or multi-instance persistence.
 * It reuses the invitation entry point (Slice 3), the real inventory service for
 * favor cargo (Slice 2), and existing world venues as meeting spots.
 *
 * Three templates cover the brief:
 *   • `meet`   — meet at a destination (a walk / catch-up).
 *   • `hangout`— coffee / food / shopping / workout at a venue.
 *   • `favor`  — deliver a real item to / accompany the NPC (the "errand").
 *
 * Pure + deterministic: a small linear step machine, no randomness, no per-frame
 * state. The runtime owns the single active activity; this file owns the shapes
 * + transitions only.
 */
import type {
  InvitationActivityKind,
  SocialActivity,
  SocialActivityStep,
  SocialActivityTemplate,
  SocialActorId,
} from './socialTypes'

export type { SocialActivity, SocialActivityStep, SocialActivityTemplate }

/** A meeting venue: an EXISTING world location reused as the hangout spot. */
interface Venue {
  id: string
  label: string
}

/** Map an invitation flavour → template + venue (reusing real world locations). */
const KIND_PLAN: Record<InvitationActivityKind, { template: SocialActivityTemplate; venue: Venue }> = {
  coffee: { template: 'hangout', venue: { id: 'food_truck_01', label: "Maya's food truck" } },
  food: { template: 'hangout', venue: { id: 'food_truck_01', label: "Maya's food truck" } },
  workout: { template: 'hangout', venue: { id: 'gym', label: 'the Block Gym' } },
  hangout: { template: 'meet', venue: { id: 'job_board', label: 'the plaza' } },
  walk: { template: 'meet', venue: { id: 'apartment', label: 'the park path' } },
}

/** The ordered steps a template runs through (favors add a delivery beat). */
export function templateSteps(template: SocialActivityTemplate): SocialActivityStep[] {
  return template === 'favor' ? ['travel', 'deliver', 'together', 'done'] : ['travel', 'together', 'done']
}

/** Build the active activity for an accepted invitation. */
export function activityFromInvitation(
  invitationId: string,
  actorId: SocialActorId,
  activityKind: InvitationActivityKind,
  startedDay: number,
): SocialActivity {
  const plan = KIND_PLAN[activityKind]
  return {
    id: `act:${invitationId}`,
    actorId,
    template: plan.template,
    activityKind,
    venueId: plan.venue.id,
    venueLabel: plan.venue.label,
    invitationId,
    step: 'travel',
    startedDay: Math.trunc(startedDay),
  }
}

/** Build a favor (errand) activity: carry a real item to the NPC. */
export function favorActivity(
  actorId: SocialActorId,
  requiredItemId: string,
  venue: { id: string; label: string },
  startedDay: number,
  seq: number,
): SocialActivity {
  return {
    id: `favor:${actorId}:${Math.trunc(startedDay)}:${seq}`,
    actorId,
    template: 'favor',
    activityKind: 'hangout',
    venueId: venue.id,
    venueLabel: venue.label,
    requiredItemId,
    step: 'travel',
    startedDay: Math.trunc(startedDay),
  }
}

/** The next step after the current one for this template (idempotent at `done`). */
export function nextStep(activity: SocialActivity): SocialActivityStep {
  const steps = templateSteps(activity.template)
  const i = steps.indexOf(activity.step)
  return i < 0 || i >= steps.length - 1 ? 'done' : steps[i + 1]
}

/** Advance the activity one step (returns a NEW activity; never mutates). */
export function advanceActivity(activity: SocialActivity): SocialActivity {
  return { ...activity, step: nextStep(activity) }
}

export function isComplete(activity: SocialActivity): boolean {
  return activity.step === 'done'
}

/** A short player-facing prompt for the current step. */
export function activityPrompt(activity: SocialActivity, displayName: string): string {
  switch (activity.step) {
    case 'travel':
      return `Head to ${activity.venueLabel} to meet ${displayName}`
    case 'deliver':
      return `Hand ${displayName} the ${activity.requiredItemId ?? 'item'}`
    case 'together':
      return activity.template === 'favor' ? `Wrap up with ${displayName}` : `Enjoy ${activity.activityKind} with ${displayName}`
    case 'done':
      return `You spent time with ${displayName}`
  }
}
