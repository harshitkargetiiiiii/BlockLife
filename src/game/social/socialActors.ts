/**
 * The ONE canonical named-social-actor registry (issue #13 §1). Each entry
 * EXTENDS an existing named NPC (`src/data/npcs.ts`) with typed social metadata —
 * its `id` IS the world/mission/phone/save NPC id, so there is a single stable
 * identity across systems (validated by `socialActors.test.ts`). Data-only +
 * deterministic; no logic lives here.
 */
import { NPC_DEFS } from '../../data/npcs'
import { defaultRelationship } from './relationship'
import type { Relationship, SocialActor, SocialActorId } from './socialTypes'

/** Small tweak helper so the cast reads as deltas off the neutral default. */
function rel(over: Partial<Relationship>): Relationship {
  return { ...defaultRelationship(), ...over }
}

/**
 * v1 cast — six existing residents. Ravi stays compatible with Coffee for Ravi
 * (he likes `coffee`). Officer Kim carries the highest crime sensitivity.
 */
export const SOCIAL_ACTORS: readonly SocialActor[] = [
  {
    id: 'npc_ravi_01',
    npcId: 'npc_ravi_01',
    displayName: 'Ravi',
    role: 'Your friend',
    profile: 'An easy-going friend who is always up for a coffee and a chat.',
    availability: [[6, 22]],
    traits: ['friendly', 'chatty'],
    preferredCategories: ['conversation', 'gift', 'invite'],
    dislikedCategories: [],
    defaultRelationship: rel({ familiarity: 20, affinity: 25 }),
    contactUnlock: { kind: 'first_meeting' },
    giftLikes: ['coffee', 'snack'],
    giftDislikes: ['ammo_box'],
    crimeSensitivity: 40,
    sourceRef: 'socialActors.SOCIAL_ACTORS[ravi]',
  },
  {
    id: 'npc_maya_01',
    npcId: 'npc_maya_01',
    displayName: 'Maya',
    role: 'Food truck owner',
    profile: 'Runs the food truck; warms up fast to regulars who buy and are kind.',
    availability: [[10, 20]],
    traits: ['entrepreneurial', 'warm'],
    preferredCategories: ['commerce', 'gift', 'conversation'],
    dislikedCategories: ['favor'],
    defaultRelationship: rel({}),
    contactUnlock: { kind: 'familiarity', min: 20 },
    giftLikes: ['meal', 'snack'],
    giftDislikes: ['ammo_box'],
    crimeSensitivity: 55,
    sourceRef: 'socialActors.SOCIAL_ACTORS[maya]',
  },
  {
    id: 'npc_bruno_01',
    npcId: 'npc_bruno_01',
    displayName: 'Coach Bruno',
    role: 'Gym trainer',
    profile: 'The gym coach; respects effort and consistency over small talk.',
    availability: [[7, 19]],
    traits: ['disciplined', 'gruff'],
    preferredCategories: ['fitness', 'favor', 'conversation'],
    dislikedCategories: ['gift'],
    defaultRelationship: rel({}),
    contactUnlock: { kind: 'familiarity', min: 25 },
    giftLikes: ['energy_drink'],
    giftDislikes: ['coffee'],
    crimeSensitivity: 50,
    sourceRef: 'socialActors.SOCIAL_ACTORS[bruno]',
  },
  {
    id: 'npc_leo_01',
    npcId: 'npc_leo_01',
    displayName: 'Leo',
    role: 'Delivery guy',
    profile: 'A courier who trades favors for favors and remembers who helps out.',
    availability: [[8, 21]],
    traits: ['practical', 'transactional'],
    preferredCategories: ['delivery', 'favor', 'gift'],
    dislikedCategories: [],
    defaultRelationship: rel({ familiarity: 10 }),
    contactUnlock: { kind: 'familiarity', min: 20 },
    giftLikes: ['snack', 'coffee'],
    giftDislikes: [],
    crimeSensitivity: 45,
    sourceRef: 'socialActors.SOCIAL_ACTORS[leo]',
  },
  {
    id: 'npc_kim_01',
    npcId: 'npc_kim_01',
    displayName: 'Officer Kim',
    role: 'Neighborhood patrol',
    profile: 'The neighborhood officer; trust is earned slowly and lost fast.',
    availability: [[6, 18]],
    traits: ['vigilant', 'by-the-book'],
    preferredCategories: ['conversation'],
    dislikedCategories: ['favor'],
    defaultRelationship: rel({ trust: 5 }),
    contactUnlock: { kind: 'familiarity', min: 30 },
    giftLikes: ['coffee'],
    giftDislikes: ['ammo_box'],
    crimeSensitivity: 95,
    sourceRef: 'socialActors.SOCIAL_ACTORS[kim]',
  },
  {
    id: 'npc_nisha_01',
    npcId: 'npc_nisha_01',
    displayName: 'Nisha',
    role: 'Your neighbor',
    profile: 'Your next-door neighbor; friendly check-ins go a long way.',
    availability: [[6, 23]],
    traits: ['neighborly', 'observant'],
    preferredCategories: ['conversation', 'gift', 'invite'],
    dislikedCategories: [],
    defaultRelationship: rel({ familiarity: 15 }),
    contactUnlock: { kind: 'first_meeting' },
    giftLikes: ['coffee', 'snack'],
    giftDislikes: [],
    crimeSensitivity: 70,
    sourceRef: 'socialActors.SOCIAL_ACTORS[nisha]',
  },
]

const BY_ID = new Map<SocialActorId, SocialActor>(SOCIAL_ACTORS.map((a) => [a.id, a]))

export function getSocialActor(id: SocialActorId): SocialActor | undefined {
  return BY_ID.get(id)
}
export function isSocialActor(id: string): boolean {
  return BY_ID.has(id)
}
export function allSocialActorIds(): SocialActorId[] {
  return SOCIAL_ACTORS.map((a) => a.id)
}
/** A fresh copy of an actor's default relationship (never share references). */
export function defaultRelationshipFor(id: SocialActorId): Relationship {
  const a = BY_ID.get(id)
  return a ? { ...a.defaultRelationship } : defaultRelationship()
}
/** Every social actor id must resolve to a real named NPC (identity mapping §1). */
export function socialActorNpcIds(): Set<string> {
  return new Set(NPC_DEFS.map((n) => n.id))
}
