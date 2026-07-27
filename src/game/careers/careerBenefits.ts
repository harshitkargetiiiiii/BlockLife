/**
 * ONE source of truth for how earned career unlocks change everyday interactions
 * (issue #15 §8, R4). Both the display (ActivityPanel builds its buttons) and the
 * execution (the store's `performActivityAction`) read THIS — so a menu price can
 * never disagree with the amount charged, and the gym Train button can never be
 * disabled while free access actually waives the gate.
 */
import { vendorDiscountPct } from '../social/socialConsequences'
import { hasUnlock } from './careerRuntime'

export interface ActivityBenefits {
  /** Food-truck discount fraction (0–1): Maya's loyalty discount + the Café staff
   *  discount unlock, capped. Applied to buy_meal / buy_coffee at her counter. */
  foodDiscountPct: number
  /** Gym Trainer's "train off the clock" unlock — waives the Train energy gate. */
  gymFreeAccess: boolean
}

/** Resolve the current activity benefits from the career + social runtimes. Pure read. */
export function careerActivityBenefits(): ActivityBenefits {
  const cafeStaffDiscount = hasUnlock('cafe_staff_discount') ? 0.1 : 0
  return {
    foodDiscountPct: Math.min(0.6, vendorDiscountPct('npc_maya_01') + cafeStaffDiscount),
    gymFreeAccess: hasUnlock('gym_free_access'),
  }
}
