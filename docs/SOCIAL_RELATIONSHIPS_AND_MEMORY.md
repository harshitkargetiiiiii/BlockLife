# Social Life, Relationships & NPC Memory v1 (issue #13)

A staged, **deterministic** social platform: meet a named NPC → interact
meaningfully → create a bounded structured **memory** → update a multidimensional
**relationship** → unlock a visible **consequence** (a contact, an invitation, a
favor, a refusal, a discount, a witness reaction, a follow-up). It is a reusable
life-sandbox layer built **on top of** the existing NPC, phone, mission, inventory,
crime and save stacks — it reimplements none of them.

Everything lives under [`src/game/social/`](../src/game/social/) and mirrors the
repo's two-tier state rule: the **social runtime** is a module singleton (event-
driven, never per-frame — CONVENTIONS §14), and UI reads through accessors + a
`socialVersion` counter on the zustand store that bumps on every social mutation.

## The cast (§1)

Six existing residents are **extended** (not duplicated) with typed social
metadata in [`socialActors.ts`](../src/game/social/socialActors.ts); each entry's
`id` **is** the world / mission / phone / save NPC id (one identity, validated by
tests):

| Actor | Role | Notes |
|---|---|---|
| `npc_ravi_01` Ravi | Your friend | **Coffee-for-Ravi compatible** — likes `coffee`/`snack`; first-meeting contact |
| `npc_maya_01` Maya | Food-truck owner | Loyalty **discount** vendor (economy consequence) |
| `npc_bruno_01` Coach Bruno | Gym trainer | Workout hangouts; dislikes gifts |
| `npc_leo_01` Leo | Courier | Favors / errands |
| `npc_kim_01` Officer Kim | Neighborhood patrol | `crimeSensitivity 95` — reacts hardest to witnessed crime |
| `npc_nisha_01` Nisha | Neighbor | Friendly check-ins |

## Relationships (§2)

[`relationship.ts`](../src/game/social/relationship.ts) — a compact,
**integer-bounded** multidimensional model (no float drift, so deterministic tests
never wobble): `familiarity 0..100`, `affinity −100..100`, `trust −100..100`,
`fear 0..100`, plus `lastMeaningfulInteractionDay`. Tiers (`stranger →
acquaintance → friendly → trusted → close`) and orthogonal `hostile`/`afraid`
flags are **derived**, never hand-assigned. ONE mutation path
(`applyRelationshipDelta`) with a typed `RelationshipReason`; nothing pokes the
numbers directly.

## Memory ledger (§3)

[`memoryLedger.ts`](../src/game/social/memoryLedger.ts) — a **bounded**
(`MEMORY_MAX_PER_NPC = 16`) per-NPC ledger of typed, gameplay-relevant memories
(no dialogue transcripts). Dedupe by stable id, salience-ranked eviction, **derived**
day-based decay (idempotent — decay is subtracted on read, never destructively
applied), and durable **pins** for major moments. `sanitizeMemories` makes load
fail-safe.

## The one pipeline (§4)

[`socialEvents.ts`](../src/game/social/socialEvents.ts) —
`event → exact-once dedupe → memory → relationship effect → unlock eval`. Every
effect is **data** in one table (crime reactions scale with `crimeSensitivity`);
`applySocialEvent` is pure and returns a new state, so replay/reset/load never
double-apply. A bounded FIFO of `appliedEventIds` (`≤256`) is the exact-once guard.

## World interactions + gifts (§ Slice 2)

Opening a conversation with a named actor fires `met` (the first-meeting **contact
unlock**). The dialogue panel then offers a contextual menu
([`socialInteraction.ts`](../src/game/social/socialInteraction.ts)): **talk,
check in, gift, ask favor, apologize, threaten** — each gated by context
(apologize only with a grievance; threaten only while armed — the "where existing
systems permit" gate). **Anti-farming:** every relationship-moving action is
**exactly-once per NPC per day** via a per-day event id; **gifts** consume a real
[item-catalog](../src/game/items/itemCatalog.ts) item through the shared inventory
service (atomic), so they are never free. Dialogue text is deterministic templates
that express state but own no logic
([`socialDialogue.ts`](../src/game/social/socialDialogue.ts)).

## Phone: contacts, messages, invitations, scheduling (§ Slice 3)

Reuses the existing phone. **People** shows the live relationship (tier, memory
nod, hostile/afraid flags, unread badge, Invite). **Chats** shows pending
invitations (accept / decline / **suggest later**) + bounded per-contact threads
(`≤12`, unread count) above the ambient flavor feed.
[`socialScheduling.ts`](../src/game/social/socialScheduling.ts) owns availability
windows, invite gating (relationship + cooldown + mission-busy), a next-slot
proposer, and **deterministic** NPC-outreach eligibility.
[`socialMessaging.ts`](../src/game/social/socialMessaging.ts) owns the bounded
reducers. NPC follow-ups are reconciled **lazily** on phone-open (never per-frame,
never while paused — the commerce-restock pattern), exactly-once per NPC per day.

## Reusable activity templates (§ Slice 4)

[`socialActivities.ts`](../src/game/social/socialActivities.ts) — three reusable
templates: **meet** (go to a destination), **hangout** (coffee / food / shopping /
workout at a real venue), **favor** (carry a real item to / accompany the NPC).
A small linear step machine (`travel → [deliver] → together → done`); completion
fires `activity_completed` (or `favor_completed` for an errand) through the ONE
pipeline. Entry points: accept a phone invitation, or **Offer to help** a friend
in conversation. The active activity is a single bounded, serializable record with
a HUD tracker
([`SocialActivityTracker.tsx`](../src/app/SocialActivityTracker.tsx)). This is a
social feature, **not** a second mission engine (no anchors / cooldowns / money
rewards / multi-instance persistence).

**Coffee-for-Ravi compatibility:** the legacy coffee quest is untouched; a
successful `deliver_coffee` additionally feeds the social system as a gift Ravi
loved, so the old quest now nourishes the new relationship.

## Consequences (§ Slice 5)

[`socialConsequences.ts`](../src/game/social/socialConsequences.ts) — an
**observe-only** bridge that reads existing runtimes and feeds the ONE pipeline;
it owns no crime/economy/world state:

- **Crime / witness + world reaction:** a named NPC near a crime you commit records
  `crime_witnessed` (fear up, trust down — Officer Kim reacts hardest). Their
  fear/hostility then shows on their contact card and gates the apologize path.
- **Economy:** a friendly **Maya** extends a loyalty **discount** at her food
  truck (`vendorDiscountPct` → `discountedPrice`).
- **Crime / arrest:** a public arrest dings the trust of nearby named NPCs.
- **Social access + missions/favors:** contact unlocks, favor **refusals**, and
  favor/activity trust rewards (earlier slices).

## Save migration (§12)

[`socialPersistence.ts`](../src/game/social/socialPersistence.ts) — one additive,
fail-safe `social` slice inside the existing `SaveData`. Old saves lack it and load
as canonical strangers; a malformed social blob is sanitized field-by-field
(relationships clamped, memories/messages/invitations/activity bounded, unknown
actors dropped) and can never corrupt the wider save. Load is idempotent.

## Observability (§13)

`socialSnapshot()` (+ DEV `window.GAME_TEST_API` hooks, all `import.meta.env.DEV`-
guarded → grep to **0** in `dist/`) reports relationships, tiers, memories,
contacts, unread, invitations, the active activity, applied-event count and bounded
sizes.

## Determinism + bounds

No `Math.random()`, no per-frame social writes, integer dimensions, derived decay,
exact-once ids. The **bounded social lifecycle soak**
([`socialSoak.test.ts`](../src/game/social/socialSoak.test.ts)) runs the whole cast
through the whole platform over 200 game-days and asserts every hard bound holds
(memory ≤16, messages ≤12, invitations ≤16, applied ids ≤256, dims in range) with
full cast coverage.

## Files

`socialTypes · relationship · memoryLedger · socialActors · socialEvents ·
socialRuntime · socialInteraction · socialDialogue · socialScheduling ·
socialMessaging · socialActivities · socialConsequences · socialPersistence`
(+ tests) under `src/game/social/`; UI in `src/app/` (`DialoguePanel`,
`SocialActivityTracker`, `phone/PhoneContacts`, `phone/PhoneMessages`, `phone/Phone`).
