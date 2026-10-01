import { describe, expect, it } from 'vitest'

import { canWalkTo, walkDirection } from './navigation'

describe('store navigation bounds', () => {
  it('moves in the direction the camera faces after turning', () => {
    expect(walkDirection(Math.PI / 2, 1, 0).x).toBeCloseTo(-1)
    expect(walkDirection(Math.PI / 2, 0, 1).z).toBeCloseTo(-1)
    expect(walkDirection(-Math.PI / 2, 1, 0).x).toBeCloseTo(1)
    expect(walkDirection(0, 1, 0).z).toBeCloseTo(-1)
  })
  it('keeps the player inside the store', () => {
    expect(canWalkTo(0, 4)).toBe(true)
    expect(canWalkTo(0, 4.3)).toBe(false)
    expect(canWalkTo(8.8, 0)).toBe(false)
  })

  it('blocks the gondolas but keeps aisles open', () => {
    expect(canWalkTo(0, 1)).toBe(false)
    expect(canWalkTo(2.7, 1)).toBe(true)
    expect(canWalkTo(0, 2.4)).toBe(true)
  })
})
