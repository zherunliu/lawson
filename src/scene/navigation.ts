const WALK_BLOCKS = [
  { minX: -7.55, maxX: -3.25, minZ: -2.15, maxZ: -0.75 },
  { minX: -2.15, maxX: 2.15, minZ: -2.15, maxZ: -0.75 },
  { minX: 3.25, maxX: 7.55, minZ: -2.15, maxZ: -0.75 },
  { minX: -7.55, maxX: -3.25, minZ: 0.35, maxZ: 1.8 },
  { minX: -2.15, maxX: 2.15, minZ: 0.35, maxZ: 1.8 },
  { minX: 3.25, maxX: 7.55, minZ: 0.35, maxZ: 1.8 },
]

export function walkDirection(yaw: number, forward: number, side: number) {
  return {
    x: -Math.sin(yaw) * forward + Math.cos(yaw) * side,
    z: -Math.cos(yaw) * forward - Math.sin(yaw) * side,
  }
}

export function canWalkTo(x: number, z: number) {
  const radius = 0.27
  if (x < -8.55 || x > 8.55 || z < -3.25 || z > 4.15) return false
  return !WALK_BLOCKS.some(
    (block) =>
      x > block.minX - radius
      && x < block.maxX + radius
      && z > block.minZ - radius
      && z < block.maxZ + radius,
  )
}
