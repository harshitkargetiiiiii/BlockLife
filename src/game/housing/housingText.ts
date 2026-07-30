/**
 * Readable player-facing copy for housing refusals (issue #17 §6). Kept separate
 * so the store, UI, and DEV surfaces render the SAME message for a given reason.
 */
import type { HostingRefusalReason, PlacementRefusalReason } from './housingTypes'

export function placementRefusalText(reason: PlacementRefusalReason): string {
  switch (reason) {
    case 'not_home':
      return 'You can only furnish your own home.'
    case 'unknown_slot':
      return 'That spot isn’t available.'
    case 'unknown_asset':
      return 'That piece is gone.'
    case 'slot_occupied':
      return 'Something is already there — store or replace it first.'
    case 'incompatible_category':
      return 'That piece doesn’t fit this spot.'
    case 'incompatible_size':
      return 'That piece is too big for this spot.'
    case 'not_owned':
      return 'You don’t own that piece.'
    case 'asset_placed_elsewhere':
      return 'That piece is already placed somewhere else.'
    case 'fixture_slot':
      return 'That’s a built-in fixture.'
  }
}

export function hostingRefusalText(reason: HostingRefusalReason | undefined): string {
  switch (reason) {
    case 'no_lease':
      return 'You need a home in good standing to host.'
    case 'delinquent':
      return 'Settle your rent before hosting guests.'
    case 'missing_furniture':
      return 'Your home isn’t set up for that yet — add the right furniture + seating.'
    case 'low_trust':
      return 'They aren’t close enough to come over yet.'
    case 'not_home':
      return 'Be inside your own home to host.'
    case 'wanted':
      return 'Not while the police are after you!'
    case 'incapacitated':
      return 'You’re in no state to host.'
    case 'busy':
      return 'Finish what you’re doing first.'
    case 'schedule_conflict':
      return 'That clashes with another plan.'
    case 'hosting_full':
      return 'Your home is already full.'
    case 'unknown_guest':
      return 'You can’t invite them.'
    default:
      return 'You can’t host that right now.'
  }
}
