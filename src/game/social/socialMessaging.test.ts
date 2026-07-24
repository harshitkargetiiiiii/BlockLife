import { describe, expect, it } from 'vitest'
import {
  addInvitation,
  isOpen,
  markThreadRead,
  openInvitationWith,
  pendingForPlayer,
  pushMessage,
  setInvitationStatus,
  threadHas,
  totalUnread,
  unreadCount,
} from './socialMessaging'
import type { SocialInvitation, SocialMessage } from './socialTypes'

const msg = (over: Partial<SocialMessage>): SocialMessage => ({
  id: over.id ?? 'm1', actorId: over.actorId ?? 'npc_ravi_01', dir: over.dir ?? 'in', token: over.token ?? 'reach_out_generic',
  gameDay: over.gameDay ?? 1, gameHour: over.gameHour ?? 10, read: over.read ?? false, ...over,
})
const inv = (over: Partial<SocialInvitation>): SocialInvitation => ({
  id: over.id ?? 'i1', actorId: over.actorId ?? 'npc_ravi_01', source: over.source ?? 'npc', activityKind: over.activityKind ?? 'coffee',
  proposedDay: over.proposedDay ?? 2, proposedHour: over.proposedHour ?? 10, status: over.status ?? 'pending', createdDay: over.createdDay ?? 1, ...over,
})

describe('message thread reducers (§ bounded messages)', () => {
  it('appends and trims to the bound', () => {
    let thread: SocialMessage[] = []
    for (let i = 0; i < 20; i++) thread = pushMessage(thread, msg({ id: `m${i}` }), 12)
    expect(thread).toHaveLength(12)
    expect(thread[0].id).toBe('m8') // oldest 8 trimmed
    expect(thread[11].id).toBe('m19')
  })

  it('threadHas detects an existing id (idempotent outreach guard)', () => {
    const thread = [msg({ id: 'out:npc_ravi_01:3' })]
    expect(threadHas(thread, 'out:npc_ravi_01:3')).toBe(true)
    expect(threadHas(thread, 'other')).toBe(false)
    expect(threadHas(undefined, 'x')).toBe(false)
  })

  it('counts + clears unread inbound only', () => {
    const thread = [msg({ id: 'a', dir: 'in', read: false }), msg({ id: 'b', dir: 'out', read: false }), msg({ id: 'c', dir: 'in', read: true })]
    expect(unreadCount(thread)).toBe(1)
    const read = markThreadRead(thread)
    expect(unreadCount(read)).toBe(0)
    expect(read.find((m) => m.id === 'b')!.read).toBe(false) // outbound untouched
  })

  it('totalUnread sums across threads', () => {
    expect(totalUnread({ npc_ravi_01: [msg({ id: 'a', dir: 'in' })], npc_maya_01: [msg({ id: 'b', dir: 'in' }), msg({ id: 'c', dir: 'in' })] })).toBe(3)
  })
})

describe('invitation reducers (§ invitations)', () => {
  it('open = pending or suggested_later', () => {
    expect(isOpen(inv({ status: 'pending' }))).toBe(true)
    expect(isOpen(inv({ status: 'suggested_later' }))).toBe(true)
    expect(isOpen(inv({ status: 'accepted' }))).toBe(false)
  })

  it('openInvitationWith + pendingForPlayer filter correctly', () => {
    const list = [inv({ id: 'a', actorId: 'npc_ravi_01', source: 'npc', status: 'pending' }), inv({ id: 'b', actorId: 'npc_maya_01', source: 'player', status: 'accepted' })]
    expect(openInvitationWith(list, 'npc_ravi_01')?.id).toBe('a')
    expect(openInvitationWith(list, 'npc_maya_01')).toBeUndefined()
    expect(pendingForPlayer(list).map((i) => i.id)).toEqual(['a'])
  })

  it('addInvitation drops the oldest RESOLVED first when full', () => {
    const base = [inv({ id: 'r0', status: 'accepted' }), inv({ id: 'p1', status: 'pending' }), inv({ id: 'p2', status: 'pending' })]
    const out = addInvitation(base, inv({ id: 'p3', status: 'pending' }), 3)
    expect(out.map((i) => i.id)).toEqual(['p1', 'p2', 'p3']) // resolved r0 evicted, pendings kept
  })

  it('setInvitationStatus resolves or reschedules', () => {
    const list = [inv({ id: 'a', status: 'pending', proposedDay: 2 })]
    expect(setInvitationStatus(list, 'a', 'accepted')[0].status).toBe('accepted')
    const later = setInvitationStatus(list, 'a', 'suggested_later', { day: 5, hour: 9 })[0]
    expect(later.status).toBe('suggested_later')
    expect(later.proposedDay).toBe(5)
    expect(later.proposedHour).toBe(9)
  })
})
