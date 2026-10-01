export interface FridgeDoor {
  id: string
  x: number
  z: number
  width: number
  angle: number
}

// Only runtime poses live here; UI targets live in the game store.
export const fridgeDoors = new Map<string, FridgeDoor>()
export const OPEN_ANGLE = -Math.PI * 0.55

export function doorDistance(door: FridgeDoor, x: number, z: number, angle = door.angle) {
  const dx = Math.cos(angle) * door.width, dz = -Math.sin(angle) * door.width
  const t = Math.max(0, Math.min(1, ((x - door.x) * dx + (z - door.z) * dz) / (door.width ** 2)))
  return Math.hypot(x - door.x - t * dx, z - door.z - t * dz)
}

export function canPassDoors(x: number, z: number) {
  return ![...fridgeDoors.values()].some((door) => doorDistance(door, x, z) < 0.29)
}

export function canReachProduct(x: number, y: number, z: number, camera: { x: number; y: number; z: number }) {
  if (Math.hypot(x - camera.x, y - camera.y, z - camera.z) > 2.15) return false
  const door = [...fridgeDoors.values()].find((item) =>
    x >= item.x - 0.01 && x <= item.x + item.width + 0.03 && z < item.z && z > item.z - 1.1)
  return !door || door.angle < -1.0
}

export function safeDoorStep(door: FridgeDoor, target: number, delta: number, camera: { x: number; z: number }, reducedMotion = false) {
  const next = reducedMotion ? target : door.angle + (target - door.angle) * (1 - Math.exp(-Math.min(delta, 0.05) * 7))
  // Sample the sweep too, so large/reduced-motion steps cannot jump through us.
  for (let i = 1; i <= 16; i++) {
    const angle = door.angle + (next - door.angle) * i / 16
    if (doorDistance(door, camera.x, camera.z, angle) < 0.30) return door.angle
  }
  return Math.abs(next - target) < 0.002 ? target : next
}
