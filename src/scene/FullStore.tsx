import { OrbitControls, useGLTF } from '@react-three/drei'
import { createPortal, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'

import { useGameStore } from '../state/game-store'
import {
  productInfo,
  stackKey,
  type StockNode,
} from './product-data'
import { canWalkTo, walkDirection } from './navigation'
import { renderInspectionFrame } from './inspection-render'
import { canPassDoors, canReachProduct, fridgeDoors, OPEN_ANGLE, safeDoorStep, type FridgeDoor } from './fridge-doors'
import { useReducedMotion } from './use-reduced-motion'

const PRINT_REVISION = 'print-v6-20260928-final'
const GEOMETRY_REVISION = 'interactive-v9-20261001'
const STOCK_URL = `/full-stock-web.glb?v=${GEOMETRY_REVISION}`
const STATIC_URL = `/store-static-web.glb?v=${GEOMETRY_REVISION}`
const ROOF_URL = `/store-roof-web.glb?v=${GEOMETRY_REVISION}`
let didDragCamera = false
let isDraggingCamera = false
function prepareScene(source: Object3D): Object3D {
  const scene = source.clone(true)
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = false
    mesh.receiveShadow = true
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material: Material) => {
      material.transparent = material.transparent || material.opacity < 1
    })
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
  })
  scene.updateMatrixWorld(true)
  return scene
}

function StoreEnvironment() {
  const { scene } = useGLTF(STATIC_URL)
  const environment = useMemo(() => prepareScene(scene), [scene])
  const { camera } = useThree()
  const reducedMotion = useReducedMotion()
  const doors = useMemo(() => {
    const entries: Array<{ object: Object3D; pose: FridgeDoor }> = []
    environment.traverse((object) => {
      if (!object.userData.door_id) return
      const position = object.getWorldPosition(new Vector3())
      entries.push({ object, pose: { id: String(object.userData.door_id), x: position.x,
        z: position.z, width: Number(object.userData.door_width), angle: 0 } })
    })
    for (const entry of entries) environment.remove(entry.object)
    return entries
  }, [environment])
  useEffect(() => {
    for (const { pose } of doors) fridgeDoors.set(pose.id, pose)
    return () => { for (const { pose } of doors) fridgeDoors.delete(pose.id) }
  }, [doors])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.code !== 'KeyE' && event.key.toLowerCase() !== 'e') || event.repeat || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable=true]'))) return
      const state = useGameStore.getState()
      if (state.doorHint && !isDraggingCamera) { event.preventDefault(); state.toggleDoor(state.doorHint.id) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useFrame((_, delta) => {
    const state = useGameStore.getState()
    let best: { id: string; open: boolean; blocked: boolean } | null = null
    let score = Infinity
    const forward = camera.getWorldDirection(new Vector3())
    for (const { object, pose } of doors) {
      const target = state.doorTargets[pose.id] ? OPEN_ANGLE : 0
      const next = state.viewMode === 'exterior' ? 0 : safeDoorStep(pose, target, delta, camera.position, reducedMotion)
      const blocked = Math.abs(target - next) > 0.03 && next === pose.angle
      pose.angle = next
      object.rotation.y = next
      const offset = new Vector3(pose.x + pose.width / 2, 1.2, pose.z).sub(camera.position)
      const distance = offset.length(), alignment = offset.normalize().dot(forward)
      const rank = distance + (1 - alignment) * 3
      if (state.viewMode === 'interior' && !state.selectedId && distance < 2.4 && alignment > 0.35 && rank < score) {
        score = rank; best = { id: pose.id, open: !!state.doorTargets[pose.id], blocked }
      }
    }
    if (JSON.stringify(state.doorHint) !== JSON.stringify(best)) state.setDoorHint(best)
  })
  return <>
    <primitive object={environment} />
    {doors.map(({ object, pose }) => <primitive key={pose.id} object={object}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        if (isDraggingCamera || useGameStore.getState().selectedId) return
        event.stopPropagation()
        useGameStore.getState().setHovered(null)
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        if (didDragCamera || isDraggingCamera) return
        if (Math.hypot(camera.position.x - pose.x - pose.width / 2, camera.position.z - pose.z) > 2.4) return
        useGameStore.getState().toggleDoor(pose.id)
      }} />)}
  </>
}

function withinReach(source: StockNode, camera: Object3D) {
  const p = source.getWorldPosition(new Vector3())
  return canReachProduct(p.x, p.y, p.z, camera.position)
}

function StoreRoof() {
  const { scene } = useGLTF(ROOF_URL)
  const roof = useMemo(() => prepareScene(scene), [scene])
  return <primitive object={roof} />
}

interface StockIndex {
  nodes: Map<string, StockNode>
  stacks: Map<string, StockNode[]>
}

function buildStockIndex(scene: Object3D): StockIndex {
  const nodes = new Map<string, StockNode>()
  const stacks = new Map<string, StockNode[]>()
  scene.traverse((object) => {
    const node = object as StockNode
    if (!node.userData?.instance_id || !node.userData?.sku) return
    const id = String(node.userData.instance_id)
    nodes.set(id, node)
    const key = stackKey(node)
    const values = stacks.get(key) ?? []
    values.push(node)
    stacks.set(key, values)
  })
  stacks.forEach((values) => {
    values.sort(
      (left, right) =>
        Number(left.userData.depth_index ?? 0) -
        Number(right.userData.depth_index ?? 0),
    )
  })
  return { nodes, stacks }
}

function HeldProduct({ source, shelf = false, onReady }: {
  source: StockNode
  shelf?: boolean
  onReady?: (ready: boolean) => void
}) {
  const holder = useRef<Group>(null)
  const [ready, setReady] = useState(false)
  const orientation = useRef(new Quaternion())
  const { camera, gl } = useThree()
  const reducedMotion = useReducedMotion()
  const liftTime = useRef(0)
  const exitTime = useRef(0)
  const exitPose = useRef<{ position: Vector3; rotation: Quaternion; scale: number } | null>(null)

  useEffect(() => {
    if (shelf) return
    orientation.current.identity()
    const canvas = gl.domElement
    let pointerId: number | null = null
    let x = 0
    let y = 0
    const axis = new Vector3()
    const step = new Quaternion()
    const stop = () => {
      const captured = pointerId
      pointerId = null
      if (captured !== null && canvas.hasPointerCapture(captured)) {
        canvas.releasePointerCapture(captured)
      }
      canvas.classList.remove('is-inspecting')
    }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || pointerId !== null || useGameStore.getState().inspectExit) return
      pointerId = event.pointerId
      x = event.clientX
      y = event.clientY
      canvas.setPointerCapture(pointerId)
      canvas.classList.add('is-inspecting')
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      const dx = event.clientX - x
      const dy = event.clientY - y
      x = event.clientX
      y = event.clientY
      const distance = Math.hypot(dx, dy)
      if (!distance) return
      // Rotate around screen-space axes so dragging stays natural at any angle.
      axis.set(dy, dx, 0).normalize()
      step.setFromAxisAngle(axis, distance * Math.PI * 2 / Math.max(canvas.clientHeight, 1))
      orientation.current.premultiply(step).normalize()
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointerId) stop()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) {
        event.preventDefault()
        useGameStore.getState().requestInspectExit('return')
      }
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    canvas.addEventListener('lostpointercapture', up)
    window.addEventListener('blur', stop)
    window.addEventListener('keydown', key)
    return () => {
      stop()
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      canvas.removeEventListener('lostpointercapture', up)
      window.removeEventListener('blur', stop)
      window.removeEventListener('keydown', key)
    }
  }, [gl, shelf, source])

  const prepared = useMemo(() => {
    const clone = source.clone(true)
    clone.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.geometry = mesh.geometry.clone()
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone()
    })
    if (shelf) {
      source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale)
    } else {
      clone.position.set(0, 0, 0)
      clone.quaternion.identity()
      clone.scale.setScalar(1)
    }
    clone.updateMatrixWorld(true)
    const box = new Box3().setFromObject(clone)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = 0.42 / Math.max(size.x, size.y, size.z)
    return { clone, center, scale }
  }, [source, shelf])

  useEffect(() => () => {
    prepared.clone.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => material.dispose())
    })
  }, [prepared])

  useEffect(() => {
    const sku = String(source.userData.sku ?? '')
    if (!sku) return
    const loader = new TextureLoader()
    const loaded: Texture[] = []
    let cancelled = false
    const targets: Array<{
      material: MeshStandardMaterial
      side: 'front' | 'back'
      sourceMap: Texture | null
    }> = []

    prepared.clone.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((candidate) => {
        const material = candidate as MeshStandardMaterial
        const match = material.name.match(/\/ product (front|back) atlas$/)
        if (!match || !material.isMeshStandardMaterial) return
        targets.push({
          material,
          side: match[1] as 'front' | 'back',
          sourceMap: material.map,
        })
      })
    })

    void Promise.all(
      targets.map(async (target) => ({
        target,
        texture: await loader.loadAsync(
          `/product-textures/${encodeURIComponent(sku)}-${target.side}${shelf ? '-near' : ''}.webp?v=${PRINT_REVISION}`,
        ),
      })),
    ).then((results) => {
      if (cancelled) {
        results.forEach(({ texture }) => texture.dispose())
        return
      }

      const atlasWidth = Number(source.userData.atlas_width)
      const atlasHeight = Number(source.userData.atlas_height)
      const atlasInnerSize = Number(source.userData.atlas_inner_size)
      const atlasX = Number(source.userData.atlas_x)
      const atlasY = Number(source.userData.atlas_y)
      if (atlasWidth && atlasHeight && atlasInnerSize) {
        prepared.clone.traverse((object) => {
          const mesh = object as Mesh
          if (!mesh.isMesh) return
          const geometry = mesh.geometry
          const sourceUV = geometry.getAttribute('uv') as BufferAttribute | undefined
          if (!sourceUV) return
          // Meshopt UVs may be normalized integers. The atlas inverse can
          // produce a tiny negative value at an edge; integer writes wrap it
          // to the opposite side. Keep restored coordinates as floats.
          const coordinates = new Float32Array(sourceUV.count * 2)
          for (let vertex = 0; vertex < sourceUV.count; vertex += 1) {
            coordinates[vertex * 2] = sourceUV.getX(vertex)
            coordinates[vertex * 2 + 1] = sourceUV.getY(vertex)
          }
          const uv = new BufferAttribute(coordinates, 2)
          geometry.setAttribute('uv', uv)
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const atlasMaterials = new Set(
            materials.flatMap((material, index) =>
              /\/ product (front|back) atlas$/.test(material.name) ? [index] : [],
            ),
          )
          const index = geometry.getIndex()
          const indexCount = index?.count ?? uv.count
          const groups = geometry.groups.length
            ? geometry.groups
            : [{ start: 0, count: indexCount, materialIndex: 0 }]
          const vertices = new Set<number>()
          groups.forEach((group) => {
            if (!atlasMaterials.has(group.materialIndex ?? 0)) return
            const end = Math.min(group.start + group.count, indexCount)
            for (let cursor = group.start; cursor < end; cursor += 1) {
              vertices.add(index ? index.getX(cursor) : cursor)
            }
          })
          vertices.forEach((vertex) => {
            uv.setXY(
              vertex,
              (uv.getX(vertex) * atlasWidth - atlasX) / atlasInnerSize,
              (uv.getY(vertex) * atlasHeight - atlasY) / atlasInnerSize,
            )
          })
          uv.needsUpdate = true
        })
      }

      results.forEach(({ target, texture }) => {
        texture.colorSpace = SRGBColorSpace
        texture.flipY = target.sourceMap?.flipY ?? false
        texture.wrapS = ClampToEdgeWrapping
        texture.wrapT = ClampToEdgeWrapping
        texture.magFilter = LinearFilter
        texture.minFilter = LinearMipmapLinearFilter
        texture.generateMipmaps = true
        texture.anisotropy = gl.capabilities.getMaxAnisotropy()
        texture.needsUpdate = true
        target.material.map = texture
        target.material.needsUpdate = true
        loaded.push(texture)
      })
      setReady(true)
      onReady?.(true)
    }).catch((error) => console.warn('Product texture failed to load', sku, error))

    return () => {
      cancelled = true
      loaded.forEach((texture) => texture.dispose())
      onReady?.(false)
    }
  }, [gl, prepared, source.userData.sku, shelf])

  useFrame((_, delta) => {
    if (shelf || !holder.current) return
    const state = useGameStore.getState()
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const lift = new Vector3(0, 0.16, 0).applyQuaternion(camera.quaternion)
    const target = camera.position.clone().addScaledVector(forward, 0.84).add(lift)
    const shelfPosition = prepared.center.clone().applyMatrix4(source.matrixWorld)
    const shelfRotation = source.getWorldQuaternion(new Quaternion())
    const shelfScale = source.getWorldScale(new Vector3()).x
    const ease = (t: number) => t * t * (3 - 2 * t)
    if (state.inspectExit) {
      exitPose.current ??= { position: holder.current.position.clone(), rotation: holder.current.quaternion.clone(), scale: holder.current.scale.x }
      exitTime.current = reducedMotion ? 1 : Math.min(1, exitTime.current + Math.min(delta, 0.05) / 0.28)
      const t = ease(exitTime.current)
      const destination = state.inspectExit === 'return' ? shelfPosition
        : target.clone().add(new Vector3(0.32, -0.4, 0).applyQuaternion(camera.quaternion))
      holder.current.position.copy(exitPose.current.position).lerp(destination, t)
      holder.current.quaternion.copy(exitPose.current.rotation).slerp(shelfRotation, t)
      holder.current.scale.setScalar(MathUtils.lerp(exitPose.current.scale, state.inspectExit === 'return' ? shelfScale : 0.01, t))
      if (exitTime.current >= 1) {
        if (state.inspectExit === 'return') state.returnSelected()
        else if (state.selectedProduct) state.addSelectedToCart(state.selectedProduct)
      }
      return
    }
    liftTime.current = reducedMotion ? 1 : Math.min(1, liftTime.current + Math.min(delta, 0.05) / 0.34)
    const t = ease(liftTime.current)
    holder.current.position.copy(shelfPosition).lerp(target, t)
    holder.current.quaternion.copy(shelfRotation).slerp(camera.quaternion.clone().multiply(orientation.current), t)
    holder.current.scale.setScalar(MathUtils.lerp(shelfScale, prepared.scale, t))
  })

  if (shelf) {
    return ready ? <primitive
      object={prepared.clone}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        const state = useGameStore.getState()
        if (isDraggingCamera || state.selectedId || state.viewMode !== 'interior' || !withinReach(source, camera)) return
        event.stopPropagation()
        state.setHovered(productInfo(source))
      }}
      onPointerOut={() => {
        if (!isDraggingCamera) useGameStore.getState().setHovered(null)
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        const state = useGameStore.getState()
        if (didDragCamera || state.selectedId || state.viewMode !== 'interior' || !withinReach(source, camera)) return
        event.stopPropagation()
        state.inspect(productInfo(source))
      }}
    /> : null
  }

  return (
    <group ref={holder} renderOrder={20}>
      <group>
        <group position={prepared.center.clone().multiplyScalar(-1)}>
          <primitive object={prepared.clone} />
        </group>
      </group>
    </group>
  )
}

function StoreLights() {
  return <>
    <ambientLight intensity={0.9} />
    <directionalLight intensity={1.75} position={[-8, 14, 10]} />
  </>
}

function ProductInspection({ source }: { source: StockNode }) {
  const inspectionScene = useMemo(() => new Scene(), [])
  // Inspection is a separate depth layer, not a physical object 84 cm away
  // inside the shelf. Keep depth testing within the product itself.
  useFrame(({ gl, scene, camera }) => {
    renderInspectionFrame(gl, scene, inspectionScene, camera)
  }, 1)
  return createPortal(<>
    <StoreLights />
    <HeldProduct key={String(source.userData.instance_id)} source={source} />
  </>, inspectionScene)
}

function FullStoreStock() {
  const { camera } = useThree()
  const { scene: sourceScene } = useGLTF(STOCK_URL)
  const batched = useMemo(() => buildBatchedStock(sourceScene), [sourceScene])

  const selectedId = useGameStore((state) => state.selectedId)
  const removedIds = useGameStore((state) => state.removedIds)
  const setHovered = useGameStore((state) => state.setHovered)
  const inspect = useGameStore((state) => state.inspect)
  const viewMode = useGameStore((state) => state.viewMode)
  const removed = useMemo(() => new Set(removedIds), [removedIds])
  const [nearIds, setNearIds] = useState<string[]>([])
  const [detailedIds, setDetailedIds] = useState<Set<string>>(new Set())
  const detailClock = useRef(0)
  const positions = useMemo(() => new Map(
    [...batched.index.nodes].map(([id, node]) => [id, node.getWorldPosition(new Vector3())]),
  ), [batched])

  useFrame((_, delta) => {
    detailClock.current += delta
    if (detailClock.current < 0.35) return
    detailClock.current = 0
    if (viewMode !== 'interior') {
      setNearIds((current) => current.length ? [] : current)
      return
    }
    if (selectedId) return
    const forward = camera.getWorldDirection(new Vector3())
    const offset = new Vector3()
    const candidates: Array<{ id: string; distance: number }> = []
    batched.index.stacks.forEach((stack) => {
      const node = stack.find((item) => !removed.has(String(item.userData.instance_id)))
      if (!node) return
      const id = String(node.userData.instance_id)
      const position = positions.get(id)
      if (!position) return
      offset.copy(position).sub(camera.position)
      const distance = offset.length()
      if (distance < 1.8 && offset.normalize().dot(forward) > 0.5) candidates.push({ id, distance })
    })
    candidates.sort((a, b) => a.distance - b.distance)
    const next = candidates.slice(0, 16).map((item) => item.id)
    setNearIds((current) => current.join('|') === next.join('|') ? current : next)
  })

  useEffect(() => {
    batched.instancesByStock.forEach((instances, id) => {
      instances.forEach(({ batch, batchId }) => {
        batch.setVisibleAt(batchId, !removed.has(id) && !detailedIds.has(id))
      })
    })
  }, [batched, removed, detailedIds])

  const isAvailable = (node: StockNode) => {
    const stack = batched.index.stacks.get(stackKey(node)) ?? []
    return stack.find((candidate) => !removed.has(String(candidate.userData.instance_id))) === node
  }

  const resolve = (event: ThreeEvent<PointerEvent>) => {
    const batchId = (event as ThreeEvent<PointerEvent> & { batchId?: number }).batchId
    if (batchId === undefined) return null
    const node = batched.lookups.get(event.object.uuid)?.get(batchId) ?? null
    return node && isAvailable(node) && withinReach(node, camera) ? node : null
  }

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    if (isDraggingCamera || selectedId || viewMode !== 'interior') return
    const node = resolve(event)
    const next = node ? productInfo(node) : null
    const current = useGameStore.getState().hovered
    if (current?.instanceId !== next?.instanceId) setHovered(next)
    if (node) event.stopPropagation()
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedId || viewMode !== 'interior') return
    if (didDragCamera) return
    const node = resolve(event as unknown as ThreeEvent<PointerEvent>)
    if (!node) return
    event.stopPropagation()
    inspect(productInfo(node))
  }

  const selected = selectedId ? batched.index.nodes.get(selectedId) : null

  return (
    <>
      <primitive
        object={batched.group}
        visible={viewMode !== 'exterior'}
        onPointerMove={handleMove}
        onPointerOut={() => {
          if (!isDraggingCamera && useGameStore.getState().hovered) setHovered(null)
        }}
        onClick={handleClick}
      />
      {nearIds.filter((id) => !removed.has(id)).map((id) => {
        const source = batched.index.nodes.get(id)
        return source ? <HeldProduct key={id} source={source} shelf onReady={(ready) => {
          setDetailedIds((current) => {
            const next = new Set(current)
            if (ready) next.add(id)
            else next.delete(id)
            return next
          })
        }} /> : null
      })}
      {selected ? <ProductInspection source={selected} /> : null}
    </>
  )
}

interface BatchInstance {
  batch: BatchedMesh
  batchId: number
}

interface BatchedStock {
  group: Group
  index: StockIndex
  lookups: Map<string, Map<number, StockNode>>
  instancesByStock: Map<string, BatchInstance[]>
}

interface PrimitiveEntry {
  geometryKey: string
  geometry: BufferGeometry
  matrix: Matrix4
  node: StockNode
}

interface MaterialBatchDefinition {
  material: Material
  zone: string
  entries: PrimitiveEntry[]
  geometries: Map<string, BufferGeometry>
}

function primitiveGeometry(source: BufferGeometry, start: number, count: number) {
  const geometry = source.clone()
  geometry.clearGroups()
  const sourceIndex = source.getIndex()
  if (sourceIndex) {
    const ArrayType = sourceIndex.array.constructor as new (length: number) =>
      | Uint16Array
      | Uint32Array
      | Uint8Array
    const values = new ArrayType(count)
    for (let index = 0; index < count; index += 1) {
      values[index] = sourceIndex.getX(start + index)
    }
    geometry.setIndex(new BufferAttribute(values, 1))
  } else {
    geometry.setDrawRange(start, count)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildBatchedStock(sourceScene: Object3D): BatchedStock {
  sourceScene.updateMatrixWorld(true)
  const index = buildStockIndex(sourceScene)
  const definitions = new Map<string, MaterialBatchDefinition>()

  index.nodes.forEach((stockNode) => {
    stockNode.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const indexCount = mesh.geometry.getIndex()?.count
        ?? mesh.geometry.getAttribute('position').count
      const groups = mesh.geometry.groups.length
        ? mesh.geometry.groups
        : [{ start: 0, count: indexCount, materialIndex: 0 }]

      groups.forEach((primitive, primitiveIndex) => {
        const material = materials[primitive.materialIndex ?? 0]
        const zone = String(stockNode.userData.zone ?? 'unassigned')
        const batchKey = `${material.uuid}:${zone}`
        const definition = definitions.get(batchKey) ?? {
          material,
          zone,
          entries: [],
          geometries: new Map<string, BufferGeometry>(),
        }
        const geometryKey = `${mesh.geometry.uuid}:${primitiveIndex}`
        let geometry = definition.geometries.get(geometryKey)
        if (!geometry) {
          geometry = primitiveGeometry(mesh.geometry, primitive.start, primitive.count)
          definition.geometries.set(geometryKey, geometry)
        }
        definition.entries.push({
          geometryKey,
          geometry,
          matrix: mesh.matrixWorld.clone(),
          node: stockNode,
        })
        definitions.set(batchKey, definition)
      })
    })
  })

  const group = new Group()
  group.name = 'FULL STORE / batched pickable stock'
  const lookups = new Map<string, Map<number, StockNode>>()
  const instancesByStock = new Map<string, BatchInstance[]>()

  definitions.forEach((definition) => {
    const maxVertexCount = [...definition.geometries.values()].reduce(
      (total, geometry) => total + geometry.getAttribute('position').count,
      0,
    )
    const maxIndexCount = [...definition.geometries.values()].reduce(
      (total, geometry) => total + (geometry.getIndex()?.count ?? 0),
      0,
    )
    const batch = new BatchedMesh(
      definition.entries.length,
      maxVertexCount,
      maxIndexCount,
      definition.material,
    )
    batch.name = `FULL STORE / ${definition.zone} / ${definition.material.name || 'stock material'}`
    batch.castShadow = false
    batch.receiveShadow = false
    const baseRaycast = batch.raycast.bind(batch)
    batch.raycast = (raycaster, intersections) => {
      if (isDraggingCamera) return
      baseRaycast(raycaster, intersections)
    }

    const geometryIds = new Map<string, number>()
    definition.geometries.forEach((geometry, key) => {
      geometryIds.set(key, batch.addGeometry(geometry))
    })

    const lookup = new Map<number, StockNode>()
    definition.entries.forEach(({ geometryKey, matrix, node }) => {
      const geometryId = geometryIds.get(geometryKey)
      if (geometryId === undefined) return
      const batchId = batch.addInstance(geometryId)
      batch.setMatrixAt(batchId, matrix)
      lookup.set(batchId, node)

      const stockId = String(node.userData.instance_id)
      const instances = instancesByStock.get(stockId) ?? []
      instances.push({ batch, batchId })
      instancesByStock.set(stockId, instances)
    })

    batch.computeBoundingBox()
    batch.computeBoundingSphere()
    lookups.set(batch.uuid, lookup)
    group.add(batch)
  })

  return { group, index, lookups, instancesByStock }
}

function FirstPersonController() {
  const { camera, gl } = useThree()
  const viewMode = useGameStore((state) => state.viewMode)
  const selectedId = useGameStore((state) => state.selectedId)
  const keys = useRef(new Set<string>())
  const dragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const pressOrigin = useRef({ x: 0, y: 0 })
  const yaw = useRef(0)
  const pitch = useRef(-0.02)
  const velocity = useRef(new Vector3())

  useEffect(() => {
    if (viewMode === 'interior') {
      yaw.current = 0
      pitch.current = -0.02
    } else {
      keys.current.clear()
      velocity.current.set(0, 0, 0)
    }
  }, [viewMode])

  useEffect(() => {
    const canvas = gl.domElement
    const onKeyDown = (event: KeyboardEvent) => {
      if (viewMode !== 'interior' || selectedId) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault()
        keys.current.add(event.code)
        if (!event.repeat) {
          const forward = event.code === 'KeyW' || event.code === 'ArrowUp'
            ? 1
            : event.code === 'KeyS' || event.code === 'ArrowDown' ? -1 : 0
          const side = event.code === 'KeyD' || event.code === 'ArrowRight'
            ? 1
            : event.code === 'KeyA' || event.code === 'ArrowLeft' ? -1 : 0
          const direction = walkDirection(yaw.current, forward, side)
          const stepX = direction.x * 0.075
          const stepZ = direction.z * 0.075
          if (canWalkTo(camera.position.x + stepX, camera.position.z) && canPassDoors(camera.position.x + stepX, camera.position.z)) camera.position.x += stepX
          if (canWalkTo(camera.position.x, camera.position.z + stepZ) && canPassDoors(camera.position.x, camera.position.z + stepZ)) camera.position.z += stepZ
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.code)
    const onPointerDown = (event: PointerEvent) => {
      if (viewMode !== 'interior' || selectedId || event.button !== 0) return
      dragging.current = true
      didDragCamera = false
      lastPointer.current = { x: event.clientX, y: event.clientY }
      pressOrigin.current = { x: event.clientX, y: event.clientY }
      canvas.classList.add('is-looking')
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      const deltaX = event.clientX - lastPointer.current.x
      const deltaY = event.clientY - lastPointer.current.y
      if (Math.hypot(event.clientX - pressOrigin.current.x, event.clientY - pressOrigin.current.y) > 4) {
        didDragCamera = true
        isDraggingCamera = true
        useGameStore.getState().setHovered(null)
      }
      lastPointer.current = { x: event.clientX, y: event.clientY }
      if (!isDraggingCamera) return
      yaw.current -= deltaX * 0.0032
      pitch.current = MathUtils.clamp(pitch.current - deltaY * 0.0026, -0.85, 0.7)
    }
    const onPointerUp = () => {
      dragging.current = false
      canvas.classList.remove('is-looking')
      if (!didDragCamera) {
        isDraggingCamera = false
        return
      }
      window.setTimeout(() => {
        didDragCamera = false
        isDraggingCamera = false
      }, 0)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    window.addEventListener('blur', onPointerUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      window.removeEventListener('blur', onPointerUp, true)
      isDraggingCamera = false
    }
  }, [camera, gl, selectedId, viewMode])

  useFrame((_, delta) => {
    if (viewMode !== 'interior' || selectedId) return
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitch.current, yaw.current, 0)

    const forwardInput = Number(keys.current.has('KeyW') || keys.current.has('ArrowUp'))
      - Number(keys.current.has('KeyS') || keys.current.has('ArrowDown'))
    const sideInput = Number(keys.current.has('KeyD') || keys.current.has('ArrowRight'))
      - Number(keys.current.has('KeyA') || keys.current.has('ArrowLeft'))
    const direction = new Vector3()
    if (forwardInput || sideInput) {
      const movement = walkDirection(yaw.current, forwardInput, sideInput)
      direction.set(
        movement.x,
        0,
        movement.z,
      ).normalize().multiplyScalar(2)
    }
    velocity.current.lerp(direction, 1 - Math.exp(-delta * 10))

    const nextX = camera.position.x + velocity.current.x * delta
    const nextZ = camera.position.z + velocity.current.z * delta
    if (canWalkTo(nextX, camera.position.z) && canPassDoors(nextX, camera.position.z)) camera.position.x = nextX
    if (canWalkTo(camera.position.x, nextZ) && canPassDoors(camera.position.x, nextZ)) camera.position.z = nextZ
    camera.position.y = 1.5
  })

  return null
}

function SceneDirector() {
  const { camera } = useThree()
  const viewMode = useGameStore((state) => state.viewMode)
  const finishEntering = useGameStore((state) => state.finishEntering)
  const lookTarget = useMemo(() => camera.clone(), [camera])
  const interiorPosition = useMemo(() => new Vector3(2.6, 1.5, 3.65), [])

  useEffect(() => {
    if (viewMode !== 'exterior') return
    camera.position.set(12.5, 7.2, 15.5)
    camera.lookAt(0, 1.15, 0)
  }, [camera, viewMode])

  useFrame((_, delta) => {
    if (viewMode !== 'entering') return
    const amount = 1 - Math.exp(-delta * 2.7)
    camera.position.lerp(interiorPosition, amount)
    lookTarget.position.copy(camera.position)
    lookTarget.lookAt(2.6, 1.35, -0.8)
    camera.quaternion.slerp(lookTarget.quaternion, amount)
    if (camera.position.distanceTo(interiorPosition) < 0.035) {
      camera.position.copy(interiorPosition)
      camera.lookAt(2.6, 1.35, -0.8)
      finishEntering()
    }
  })

  return (
    <OrbitControls
      enabled={viewMode === 'exterior'}
      makeDefault
      target={[0, 1.15, 0]}
      minDistance={12}
      maxDistance={28}
      minPolarAngle={Math.PI * 0.16}
      maxPolarAngle={Math.PI * 0.48}
    />
  )
}

function RenderTelemetry() {
  const renderer = useThree((state) => state.gl)
  const setTelemetry = useGameStore((state) => state.setTelemetry)
  const last = useRef({ time: performance.now(), frames: 0 })

  useFrame(() => {
    last.current.frames += 1
    const now = performance.now()
    const elapsed = now - last.current.time
    if (elapsed < 750) return
    setTelemetry({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      fps: Math.round((last.current.frames * 1000) / elapsed),
    })
    last.current = { time: now, frames: 0 }
  })
  return null
}

export function FullStore() {
  const clearHover = useGameStore((state) => state.setHovered)

  return (
    <>
      <color attach="background" args={['#dceef2']} />
      <fog attach="fog" args={['#dceef2', 28, 180]} />
      <StoreLights />
      <group onPointerMissed={() => clearHover(null)}>
        <StoreEnvironment />
        <StoreRoof />
        <FullStoreStock />
      </group>
      <SceneDirector />
      <FirstPersonController />
      <RenderTelemetry />
    </>
  )
}

useGLTF.preload(STOCK_URL)
useGLTF.preload(STATIC_URL)
useGLTF.preload(ROOF_URL)
