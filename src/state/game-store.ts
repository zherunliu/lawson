import { create } from 'zustand'

export interface ProductInfo {
  instanceId: string
  sku: string
  name: string
  brand: string
  price: number
}

interface RenderTelemetry {
  calls: number
  triangles: number
  fps: number
}

export type ViewMode = 'exterior' | 'entering' | 'interior'

interface GameState {
  doorTargets: Record<string, boolean>
  doorHint: { id: string; open: boolean; blocked: boolean } | null
  inspectExit: 'return' | 'cart' | null
  toggleDoor: (id: string) => void
  setDoorHint: (hint: GameState['doorHint']) => void
  requestInspectExit: (exit: 'return' | 'cart') => void
  viewMode: ViewMode
  hovered: ProductInfo | null
  selectedId: string | null
  selectedProduct: ProductInfo | null
  removedIds: string[]
  cart: ProductInfo[]
  telemetry: RenderTelemetry
  setHovered: (product: ProductInfo | null) => void
  inspect: (product: ProductInfo) => void
  returnSelected: () => void
  addSelectedToCart: (product: ProductInfo) => void
  setTelemetry: (telemetry: RenderTelemetry) => void
  enterStore: () => void
  finishEntering: () => void
  returnOutside: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  doorTargets: {},
  doorHint: null,
  inspectExit: null,
  toggleDoor: (id) => {
    if (get().selectedId || get().viewMode !== 'interior') return
    set((state) => ({ doorTargets: { ...state.doorTargets, [id]: !state.doorTargets[id] }, hovered: null }))
  },
  setDoorHint: (doorHint) => set({ doorHint }),
  requestInspectExit: (inspectExit) => { if (get().selectedId && !get().inspectExit) set({ inspectExit }) },
  viewMode: 'exterior',
  hovered: null,
  selectedId: null,
  selectedProduct: null,
  removedIds: [],
  cart: [],
  telemetry: { calls: 0, triangles: 0, fps: 0 },
  setHovered: (hovered) => set({ hovered }),
  inspect: (product) => {
    if (get().selectedId || get().removedIds.includes(product.instanceId)) return
    const removedIds = get().removedIds
    set({
      selectedId: product.instanceId,
      inspectExit: null,
      doorHint: null,
      selectedProduct: product,
      hovered: null,
      removedIds: removedIds.includes(product.instanceId)
        ? removedIds
        : [...removedIds, product.instanceId],
    })
  },
  returnSelected: () => {
    const selectedId = get().selectedId
    if (!selectedId) return
    set((state) => ({
      selectedId: null,
      inspectExit: null,
      selectedProduct: null,
      removedIds: state.removedIds.filter((id) => id !== selectedId),
    }))
  },
  addSelectedToCart: (product) => {
    if (get().selectedId !== product.instanceId) return
    set((state) => ({
      selectedId: null,
      inspectExit: null,
      selectedProduct: null,
      cart: [...state.cart, product],
    }))
  },
  setTelemetry: (telemetry) => set({ telemetry }),
  enterStore: () => set({ viewMode: 'entering', hovered: null }),
  finishEntering: () => set({ viewMode: 'interior' }),
  returnOutside: () => set((state) => ({
    viewMode: 'exterior',
    hovered: null,
    selectedId: null,
    selectedProduct: null,
    inspectExit: null,
    doorHint: null,
    doorTargets: {},
    removedIds: state.selectedId ? state.removedIds.filter((id) => id !== state.selectedId) : state.removedIds,
  })),
}))
