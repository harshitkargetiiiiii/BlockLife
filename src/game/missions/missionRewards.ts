import type { MissionRewardDefinition } from './missionTypes'
import { missionRuntime } from './missionRuntime'

/**
 * Transaction-safe reward resolution. A reward is bound to an ATTEMPT id and
 * recorded as a one-time receipt, so it can never be granted twice — not by a
 * repeated handoff interaction, a completion panel re-render, a mission reset,
 * or a load. The engine calls this exactly once on successful completion; the
 * live driver applies the returned rewards through the store's economy actions
 * (never mutating money from renderer code).
 */
export interface RewardClaim {
  alreadyClaimed: boolean
  rewards: MissionRewardDefinition[]
  moneyTotal: number
}

export function claimMissionReward(
  missionId: string,
  attemptId: string,
  rewards: readonly MissionRewardDefinition[],
  gameHours: number,
): RewardClaim {
  if (missionRuntime.receipts[attemptId]) {
    return { alreadyClaimed: true, rewards: [], moneyTotal: 0 }
  }
  missionRuntime.receipts[attemptId] = { attemptId, missionId, grantedAtGameHours: gameHours }
  const list = [...rewards]
  const moneyTotal = list.reduce((sum, r) => (r.kind === 'money' ? sum + r.amount : sum), 0)
  return { alreadyClaimed: false, rewards: list, moneyTotal }
}
