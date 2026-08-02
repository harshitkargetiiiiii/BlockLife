/**
 * Deterministic dialogue TEMPLATES (issue #13 §2 "deterministic dialogue that
 * expresses relationship state but never owns business logic"). These functions
 * are pure string builders keyed off already-decided state — a relationship tier,
 * a response token, a memory's summary token. They never branch on gameplay rules,
 * mutate anything, or decide an outcome; the resolver (`socialInteraction.ts`) and
 * the pipeline (`socialEvents.ts`) own all of that. Variety is deterministic
 * (indexed by game day), never random, so visual/E2E snapshots stay stable.
 */
import type { SocialResponseToken } from './socialInteraction'
import type { DerivedRelationship, InvitationActivityKind, MemoryEntry, SocialActor } from './socialTypes'

/** Deterministic pick from a non-empty list (by game day — stable, not random). */
function pick(lines: string[], gameDay: number): string {
  return lines[Math.abs(Math.trunc(gameDay)) % lines.length]
}

/**
 * A tier-aware greeting line for a contact card / conversation header. Expresses
 * warmth + any fear, and nods to the most salient memory when there is one. Pure.
 */
export function socialGreeting(
  actor: SocialActor,
  derived: DerivedRelationship,
  topMemory: MemoryEntry | undefined,
  gameDay: number,
): string {
  const name = actor.displayName
  if (derived.hostile) return pick([`${name} glares and keeps their distance.`, `${name} won't even look at you.`], gameDay)
  if (derived.afraid) return pick([`${name} shifts nervously as you approach.`, `${name} keeps a wary eye on you.`], gameDay)

  const memoryNod = topMemory ? memoryNods[topMemory.summaryToken] : undefined
  const byTier: Record<DerivedRelationship['tier'], string[]> = {
    stranger: [`${name} gives you a polite nod.`, `${name} glances over, unsure who you are.`],
    acquaintance: [`"Oh, hey — good to see you again."`, `${name} recognizes you and waves.`],
    friendly: [`"Hey, friend! Always good to run into you."`, `${name} lights up when they spot you.`],
    trusted: [`"There you are — I was hoping I'd see you."`, `"Good to see a face I can count on."`],
    close: [`"My favorite person! What's going on?"`, `"Hey, you. It's always better when you're around."`],
  }
  const base = pick(byTier[derived.tier], gameDay)
  return memoryNod ? `${base} ${memoryNod}` : base
}

/** Short nods to a remembered moment, keyed by a memory summary token. */
const memoryNods: Record<string, string> = {
  gift_liked: 'Thanks again for that gift.',
  gift_disliked: '...still not sure about that thing you gave me.',
  favor_done: "I haven't forgotten you came through for me.",
  favor_failed: "I'm still a little sore about last time.",
  hung_out: 'That was fun, hanging out.',
  protected: 'You had my back — I remember that.',
  saw_crime: "I saw what you did out there.",
  threatened: "I remember what you did.",
  sorry_ok: 'Water under the bridge.',
}

/** Human phrase for a memory summary token (phone ledger + DEV observability). */
export function memorySummary(token: string): string {
  return memoryPhrases[token] ?? token
}

const memoryPhrases: Record<string, string> = {
  first_meeting: 'You first met',
  talked: 'You chatted',
  checked_in: 'You checked in',
  gift_liked: 'You gave a gift they loved',
  gift_ok: 'You gave a gift',
  gift_disliked: 'You gave a gift they disliked',
  favor_done: 'You did them a favor',
  favor_failed: 'You let them down on a favor',
  inv_yes: 'They accepted an invitation',
  inv_no: 'They declined an invitation',
  hung_out: 'You spent time together',
  no_show: 'You stood them up',
  bought: 'You were a good customer',
  saw_crime: 'They saw you commit a crime',
  saw_arrest: 'They saw you arrested',
  harmed: 'You hurt them',
  threatened: 'You threatened them',
  protected: 'You protected them',
  sorry_ok: 'You apologized and they forgave you',
  sorry_no: 'You apologized but they refused',
}

/**
 * The NPC's spoken response to a just-performed action, by response token. Uses
 * the actor's display name/traits for a little colour, deterministic per day.
 */
export function socialActionResponse(actor: SocialActor, token: SocialResponseToken, gameDay: number): string {
  const name = actor.displayName
  switch (token) {
    case 'talk':
      return pick([`"Always nice to chat with you."`, `${name} shares a bit of neighborhood gossip.`, `"Good to catch up!"`], gameDay)
    case 'check_in':
      return pick([`"Thanks for checking in on me — means a lot."`, `"You always know when to stop by."`], gameDay)
    case 'gift_liked':
      return pick([`"For me? You're the best — I love this!"`, `${name} beams. "This is perfect, thank you!"`], gameDay)
    case 'gift_neutral':
      return pick([`"Oh — thanks, I guess. That's thoughtful."`, `${name} accepts it with a polite smile.`], gameDay)
    case 'gift_disliked':
      return pick([`"Uh... this really isn't my thing."`, `${name} frowns. "Why would you give me this?"`], gameDay)
    case 'favor_accepted':
      return pick([`"For you? Sure, I can help with that."`, `"Anything you need — you've earned it."`], gameDay)
    case 'favor_refused':
      return pick([`"Sorry, I don't know you well enough for that."`, `"Ask me again when we're on better terms."`], gameDay)
    case 'apology_accepted':
      return pick([`"...Okay. Apology accepted. Let's move on."`, `"I appreciate you saying that. We're alright."`], gameDay)
    case 'apology_rejected':
      return pick([`"Sorry doesn't cut it. Stay away from me."`, `"You think that fixes anything? No."`], gameDay)
    case 'threatened':
      return pick([`${name} backs away, hands raised. "Okay — okay! Please!"`, `"Whatever you want — just don't hurt me!"`], gameDay)
    case 'unavailable':
      return pick([`"Maybe another time."`, `${name} doesn't respond to that right now.`], gameDay)
  }
}

// ---- phone message + invitation templates (Slice 3) ----------------------

/** Short human label for an invitation's activity (the phone card + prompt). */
export function invitationLabel(activityKind: InvitationActivityKind): string {
  switch (activityKind) {
    case 'coffee':
      return 'grab a coffee'
    case 'food':
      return 'get some food'
    case 'workout':
      return 'hit the gym'
    case 'hangout':
      return 'hang out'
    case 'walk':
      return 'take a walk'
    case 'coffee_home':
      return 'come over for coffee'
    case 'movie_night':
      return 'come over for movie night'
    case 'dinner_home':
      return 'come over for dinner'
    case 'drive_around':
      return 'go for a drive'
  }
}

/**
 * Render a phone message from its token (no free text is ever stored). Invitation
 * tokens embed the activity as `invite_<kind>`; everything else is a fixed line.
 */
export function messageText(token: string, actor: SocialActor, gameDay: number): string {
  if (token.startsWith('invite_')) {
    const kind = token.slice('invite_'.length) as InvitationActivityKind
    return pick([`hey, want to ${invitationLabel(kind)} sometime? 🙂`, `free later? we should ${invitationLabel(kind)}!`], gameDay)
  }
  const name = actor.displayName
  const lines: Record<string, string[]> = {
    reach_out_generic: [`hey! haven't seen you around lately — how are you?`, `${name} here. it's been a minute! all good?`],
    reach_out_thanks_gift: [`still thinking about that gift you gave me — thanks again 🙏`, `you spoiled me last time! let's catch up soon`],
    reach_out_thanks_favor: [`i owe you one after that favor. drinks on me?`, `you really came through for me. let's hang!`],
    reach_out_again: [`that was fun last time — let's do it again!`, `miss hanging out. you around this week?`],
    player_hello: [`hey ${name}, it's me 👋`],
    accept: [`sounds great, i'm in! 🎉`],
    decline: [`can't make it this time, sorry.`],
    later: [`rain check? let's find another time.`],
    followup_favor: [`thanks again for the help — i really owe you one 🙏`, `you came through for me. i won't forget it!`],
    followup_hangout: [`that was fun! we should do it again soon 😊`, `good hanging out with you today.`],
    followup_noshow: [`waited a while… guess something came up. maybe next time.`, `you didn't show 😕 everything okay?`],
    // Career employer messages (issue #15 §10).
    job_hired: [`welcome aboard! your first shift is on the schedule.`, `glad to have you on the team — check the schedule for your shift.`],
    job_promoted: [`great work — you've earned a promotion! more pay, more responsibility.`, `you've been promoted. keep it up! 💪`],
    job_good_shift: [`solid shift today — the customers noticed. nice work.`, `you crushed that shift. see you next time!`],
    job_missed_shift: [`you missed your shift today — that's not like you. everything okay?`, `we needed you on the floor and you were a no-show 😕`],
    job_failed_shift: [`heard your shift got cut short — get yourself sorted and we'll talk.`, `rough one out there today. take care of yourself, then come back.`],
    job_recommendation: [`i put in a good word for you — go talk to them, they're expecting you.`, `told them you're solid. the job's yours if you want it.`],
    // Housing recommendation (issue #17 §10, PR#18 review #1) — a trusted friend vouches
    // for a place so you can skip the tour. Never relaxes rank/income/money gates.
    housing_recommend: [`i know the landlord — told them you're good for it. you can skip the tour.`, `put in a word for you on that place. no need to tour, just go sign 🙌`],
  }
  return pick(lines[token] ?? [`…`], gameDay)
}
