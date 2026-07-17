import { describe, expect, it } from 'vitest'
import { questTransition } from './questMachine'

describe('questMachine — Coffee for Ravi', () => {
  it('not_started → active on ACCEPT', () => {
    expect(questTransition('not_started', 'ACCEPT')).toBe('active')
  })

  it('active → has_coffee on GET_COFFEE', () => {
    expect(questTransition('active', 'GET_COFFEE')).toBe('has_coffee')
  })

  it('has_coffee → completed on DELIVER', () => {
    expect(questTransition('has_coffee', 'DELIVER')).toBe('completed')
  })

  it('ignores invalid transitions', () => {
    expect(questTransition('not_started', 'DELIVER')).toBe('not_started')
    expect(questTransition('not_started', 'GET_COFFEE')).toBe('not_started')
    expect(questTransition('active', 'ACCEPT')).toBe('active')
    expect(questTransition('active', 'DELIVER')).toBe('active')
    expect(questTransition('completed', 'ACCEPT')).toBe('completed')
  })
})
