import { afterEach, describe, expect, it } from 'vitest'
import { canPassDoors, canReachProduct, doorDistance, fridgeDoors, OPEN_ANGLE, safeDoorStep, type FridgeDoor } from './fridge-doors'

const closed: FridgeDoor = { id: 'C4_GLASS_DOOR_1', x: 4.515, z: -3.53, width: 0.91, angle: 0 }
afterEach(() => fridgeDoors.clear())

describe('fridge interaction geometry', () => {
  it('requires an open door and a reachable product', () => {
    const door = { ...closed }; fridgeDoors.set(door.id, door)
    const camera = { x: 5, y: 1.5, z: -2.7 }
    expect(canReachProduct(5, 1.4, -3.9, camera)).toBe(false)
    door.angle = OPEN_ANGLE
    expect(canReachProduct(5, 1.4, -3.9, camera)).toBe(true)
    expect(canReachProduct(5, 1.4, -3.9, { ...camera, z: 0 })).toBe(false)
    expect(canReachProduct(3, 1.4, -3.9, { x: 3, y: 1.5, z: -2.7 })).toBe(true)
  })
  it('blocks walking through an open door', () => {
    fridgeDoors.set(closed.id, { ...closed, angle: -Math.PI / 2 })
    expect(canPassDoors(4.55, -2.9)).toBe(false)
    expect(canPassDoors(5.1, -2.9)).toBe(true)
    expect(doorDistance(closed, 5, -3.53)).toBeCloseTo(0)
  })
  it('stops the swing before it passes through the player, including reduced motion', () => {
    const door = { ...closed }
    const camera = { x: 5.0, z: -3.1 }
    for (let i = 0; i < 100; i++) {
      door.angle = safeDoorStep(door, OPEN_ANGLE, 1 / 60, camera)
      expect(doorDistance(door, camera.x, camera.z)).toBeGreaterThanOrEqual(0.30)
    }
    expect(door.angle).toBeGreaterThan(OPEN_ANGLE)
    expect(safeDoorStep(closed, OPEN_ANGLE, 1, camera, true)).toBe(0)
    expect(safeDoorStep(closed, OPEN_ANGLE, 1, { x: 5.5, z: -2 }, true)).toBe(OPEN_ANGLE)
  })
})
