import { useProgress } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'

import { FullStore } from './scene/FullStore'
import { useGameStore } from './state/game-store'

function LoadingOverlay() {
  const { active, progress } = useProgress()
  if (!active || progress >= 100) return null
  return (
    <div className="loader" role="status" aria-live="polite">
      <span>Loading</span>
      <strong>{Math.round(progress)}%</strong>
    </div>
  )
}

function Interface() {
  const hovered = useGameStore((state) => state.hovered)
  const viewMode = useGameStore((state) => state.viewMode)
  const selectedId = useGameStore((state) => state.selectedId)
  const selectedProduct = useGameStore((state) => state.selectedProduct)
  const cart = useGameStore((state) => state.cart)
  const telemetry = useGameStore((state) => state.telemetry)
  const requestInspectExit = useGameStore((state) => state.requestInspectExit)
  const inspectExit = useGameStore((state) => state.inspectExit)
  const doorHint = useGameStore((state) => state.doorHint)
  const toggleDoor = useGameStore((state) => state.toggleDoor)
  const enterStore = useGameStore((state) => state.enterStore)
  const returnOutside = useGameStore((state) => state.returnOutside)

  const total = cart.reduce((sum, item) => sum + item.price, 0)

  return (
    <div className="ui-shell">
      <header className="masthead">
        <div className="telemetry" aria-label="Render stats">
          <span>{telemetry.fps || '—'} FPS</span>
          <span>{telemetry.calls} draws</span>
          <span>{Math.round(telemetry.triangles / 1000)}k triangles</span>
        </div>
      </header>

      {viewMode === 'exterior' ? (
        <section className="entrance-card" aria-label="Store entrance">
          <span>24 HOURS · SELF SERVICE</span>
          <button type="button" onClick={enterStore}>Enter store</button>
        </section>
      ) : null}

      {viewMode === 'entering' ? (
        <div className="entry-status" role="status">Entering…</div>
      ) : null}

      {viewMode === 'interior' && !selectedId ? <div className="reticle" aria-hidden="true" /> : null}

      {viewMode === 'interior' && !selectedId && doorHint ? (
        <div className="door-prompt">
          <button type="button" onClick={() => toggleDoor(doorHint.id)}>
            <kbd>E</kbd> {doorHint.open ? 'Close door' : 'Open door'}
          </button>
          {doorHint.blocked ? <span role="status">Step aside</span> : null}
        </div>
      ) : null}

      {viewMode === 'interior' && hovered && !selectedId ? (
        <section className="product-peek" aria-live="polite">
          <span>{hovered.brand || 'LAWSON'}</span>
          <strong>{hovered.name}</strong>
          <small>¥{hovered.price} · Click to pick up</small>
        </section>
      ) : null}

      {selectedId && selectedProduct ? (
        <section className="inspect-controls" aria-label="Inspect item">
          <div>
            <span>{selectedProduct.brand || 'LAWSON'}</span>
            <strong>{selectedProduct.name}</strong>
          </div>
          <div className="inspect-details">
            <small>{inspectExit === 'return' ? 'Returning…' : inspectExit === 'cart' ? 'Adding…' : 'Drag to rotate · Esc to return'}</small>
            <b>¥{selectedProduct.price}</b>
          </div>
          <div className="action-row">
            <button type="button" className="secondary" disabled={!!inspectExit} onClick={() => requestInspectExit('return')}>
              Put back
            </button>
            <button type="button" disabled={!!inspectExit} onClick={() => requestInspectExit('cart')}>
              Add to basket
            </button>
          </div>
        </section>
      ) : null}

      <aside className={`receipt ${viewMode === 'exterior' ? 'is-outside' : ''}`} aria-label="Basket">
        <div className="receipt-handle">
          <span>Basket</span>
          <b>{cart.length}</b>
        </div>
        {cart.length ? (
          <div className="receipt-body">
            {cart.slice(-3).map((item) => (
              <div key={item.instanceId}>
                <span>{item.name}</span>
                <b>¥{item.price}</b>
              </div>
            ))}
            <div className="receipt-total">
              <span>Total</span>
              <b>¥{total}</b>
            </div>
          </div>
        ) : null}
      </aside>

      {viewMode === 'interior' ? (
        <footer className="hint">
          {!selectedId ? <span>WASD to move · Drag to look</span> : null}
          <button type="button" onClick={returnOutside}>Leave store</button>
        </footer>
      ) : null}
    </div>
  )
}

export function App() {
  const selectedId = useGameStore((state) => state.selectedId)

  return (
    <main className="app">
      <Canvas
        dpr={selectedId ? 2 : [1.5, 2]}
        camera={{ position: [12.5, 7.2, 15.5], fov: 68, near: 0.05, far: 300 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <FullStore />
        </Suspense>
      </Canvas>
      <LoadingOverlay />
      <Interface />
    </main>
  )
}
