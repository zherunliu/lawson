import type { Object3D } from 'three'

import type { ProductInfo } from '../state/game-store'

export interface StockNode extends Object3D {
  userData: {
    sku?: string
    instance_id?: string
    product_name?: string
    brand?: string
    price?: number
    zone?: string
    shelf_level?: number
    shelf_side?: number
    facing_index?: number
    depth_index?: number
    [key: string]: unknown
  }
}

export function findStockNode(object: Object3D | null): StockNode | null {
  let current = object as StockNode | null
  while (current) {
    if (current.userData?.sku && current.userData?.instance_id) return current
    current = current.parent as StockNode | null
  }
  return null
}

export function productInfo(node: StockNode): ProductInfo {
  return {
    instanceId: String(node.userData.instance_id),
    sku: String(node.userData.sku),
    name: String(node.userData.product_name ?? node.userData.sku),
    brand: String(node.userData.brand ?? ''),
    price: Number(node.userData.price ?? 0),
  }
}

export function stackKey(node: StockNode): string {
  return [
    node.userData.zone,
    node.userData.shelf_level,
    node.userData.shelf_side,
    node.userData.facing_index,
  ].join(':')
}
