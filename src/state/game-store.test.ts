import { beforeEach, describe, expect, it } from 'vitest'

import { type ProductInfo, useGameStore } from './game-store'

const product: ProductInfo = {
  instanceId: 'A1 / test / depth-0',
  sku: 'test-sku',
  name: '测试商品',
  brand: 'LAWSON',
  price: 168,
}

beforeEach(() => {
  useGameStore.setState({
    viewMode: 'exterior',
    hovered: null,
    selectedId: null,
    selectedProduct: null,
    removedIds: [],
    cart: [],
    doorTargets: {},
    doorHint: null,
    inspectExit: null,
    telemetry: { calls: 0, triangles: 0, fps: 0 },
  })
})

describe('game store', () => {
  it('restores a held item and closes doors on leaving the store', () => {
    useGameStore.getState().finishEntering()
    useGameStore.getState().toggleDoor('C1_GLASS_DOOR_1')
    useGameStore.getState().inspect(product)
    useGameStore.getState().returnOutside()
    expect(useGameStore.getState()).toMatchObject({ removedIds: [], selectedId: null, doorTargets: {}, inspectExit: null })
  })
  it('waits for the return animation and ignores duplicate exit requests', () => {
    useGameStore.getState().inspect(product)
    useGameStore.getState().requestInspectExit('return')
    useGameStore.getState().requestInspectExit('cart')
    expect(useGameStore.getState()).toMatchObject({ selectedId: product.instanceId, inspectExit: 'return' })
    useGameStore.getState().returnSelected()
    expect(useGameStore.getState().inspectExit).toBe(null)
  })
  it('does not allow duplicate cart submissions or switching held objects', () => {
    useGameStore.getState().inspect(product)
    useGameStore.getState().inspect({ ...product, instanceId: 'another' })
    expect(useGameStore.getState().selectedId).toBe(product.instanceId)
    useGameStore.getState().addSelectedToCart(product)
    useGameStore.getState().addSelectedToCart(product)
    expect(useGameStore.getState().cart).toHaveLength(1)
  })
  it('temporarily removes an inspected product and restores it on return', () => {
    useGameStore.getState().inspect(product)

    expect(useGameStore.getState()).toMatchObject({
      selectedId: product.instanceId,
      selectedProduct: product,
      removedIds: [product.instanceId],
    })

    useGameStore.getState().returnSelected()

    expect(useGameStore.getState()).toMatchObject({
      selectedId: null,
      selectedProduct: null,
      removedIds: [],
    })
  })

  it('keeps a purchased product removed and records it in the cart', () => {
    useGameStore.getState().inspect(product)
    useGameStore.getState().addSelectedToCart(product)

    expect(useGameStore.getState()).toMatchObject({
      selectedId: null,
      removedIds: [product.instanceId],
      cart: [product],
    })
  })

  it('moves through the exterior entry sequence', () => {
    useGameStore.getState().enterStore()
    expect(useGameStore.getState().viewMode).toBe('entering')

    useGameStore.getState().finishEntering()
    expect(useGameStore.getState().viewMode).toBe('interior')

    useGameStore.getState().returnOutside()
    expect(useGameStore.getState().viewMode).toBe('exterior')
  })
})
