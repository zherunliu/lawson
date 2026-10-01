import type { Camera, Scene, WebGLRenderer } from 'three'

/** Separate world/product depth buffers without disabling product self-occlusion. */
export function renderInspectionFrame(
  renderer: WebGLRenderer,
  world: Scene,
  inspection: Scene,
  camera: Camera,
) {
  const autoClear = renderer.autoClear
  const autoReset = renderer.info.autoReset
  try {
    renderer.info.autoReset = false
    renderer.info.reset()
    renderer.autoClear = true
    renderer.render(world, camera)
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(inspection, camera)
  } finally {
    renderer.autoClear = autoClear
    renderer.info.autoReset = autoReset
  }
}
