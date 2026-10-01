import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import { renderInspectionFrame } from './inspection-render'

describe('isolated product inspection', () => {
  it('renders world then clears only depth, retaining self-depth and counting both passes', () => {
    const world = new Scene(), inspection = new Scene(), camera = new PerspectiveCamera()
    const events: string[] = []
    const renderer = {
      autoClear: true,
      info: { autoReset: true, reset: () => events.push('reset') },
      clearDepth: () => events.push('clear-depth'),
      render: (scene: Scene) => {
        expect(renderer.info.autoReset).toBe(false)
        expect(renderer.autoClear).toBe(scene === world)
        events.push(scene === world ? 'world' : 'product')
      },
    }
    renderInspectionFrame(renderer as unknown as WebGLRenderer, world, inspection, camera)
    expect(events).toEqual(['reset', 'world', 'clear-depth', 'product'])
    expect(renderer.autoClear).toBe(true)
    expect(renderer.info.autoReset).toBe(true)
  })

  it('restores renderer flags even when a render fails', () => {
    const renderer = {
      autoClear: false,
      info: { autoReset: true, reset: vi.fn() },
      clearDepth: vi.fn(),
      render: () => { throw new Error('render failed') },
    }
    expect(() => renderInspectionFrame(renderer as unknown as WebGLRenderer,
      new Scene(), new Scene(), new PerspectiveCamera())).toThrow('render failed')
    expect(renderer.autoClear).toBe(false)
    expect(renderer.info.autoReset).toBe(true)
  })
})
