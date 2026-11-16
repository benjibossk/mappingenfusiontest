// 3D view (docs/OPSTRACK_3D_STUDY.md): one terrain mesh from the height grid, the 2D render draped on it,
// instanced buildings and trees, sea and lakes. Loaded with import() only when the user presses "3D".
// Axes: three x = world X (east), y = height, z = -world Z (north is -z, so north is up on screen).
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial,
  MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Shape, ShapeGeometry, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, type Material, type Texture,
} from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'

export interface HeightGrid { minX: number; minZ: number; step: number; cols: number; rows: number; heights: ArrayLike<number> } // row 0 = minZ (south)
export interface Box3D { cx: number; cz: number; w: number; d: number; h: number; yaw: number } // yaw: radians, world X/Z
export interface View3DData {
  hm: HeightGrid
  sea: number
  buildings: Box3D[]
  trees: Float32Array // x, z, scale (1 = 12 m) triplets
  lakes: number[][] // flat X/Z rings
  bridges?: Box3D[] // decks (cz/cx centre, h = thickness), y from the deck height
  bridgeY?: number[]
  target: [number, number] // world X/Z the 2D view looks at
  span: number // metres across the 2D view
}
export interface View3DText { back: string; exag: string; reset: string; top: string; trees: string; help: string; stage: (k: 'mesh' | 'drape' | 'objects') => string }
export interface View3DOptions {
  text: View3DText
  /** draws the 2D map into a square canvas of `size` px covering the drape bounds (x0, z0, side) */
  drape: (size: number) => { canvas: HTMLCanvasElement; x0: number; z0: number; side: number } | null
  progress?: (stage: string, i: number, n: number) => void
  onClose: (target: [number, number], span: number) => void
}
export interface View3D { refreshDrape(): void; close(): void; stats(): { frames: number; vertices: number; buildings: number; trees: number } }

const MAX_VERTS = 1_000_000
const TREE_CHUNK = 1024 // m: trees grouped per square, hidden beyond TREE_FAR from the camera
const TREE_FAR = 3500
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export async function open3d(host: HTMLElement, data: View3DData, o: View3DOptions): Promise<View3D> {
  const { hm } = data
  const T = o.text
  const root = document.createElement('div')
  root.className = 'v3d'
  root.innerHTML = `<div class="v3d-bar">
    <button type="button" class="v3d-back" data-k="back">${T.back}</button>
    <label>${T.exag} <input type="range" min="1" max="3" step="0.25" value="1" data-k="exag"><output data-k="exagV">×1</output></label>
    <button type="button" data-k="reset">${T.reset}</button>
    <button type="button" data-k="top">${T.top}</button>
    <label class="check"><input type="checkbox" checked data-k="trees"> ${T.trees}</label>
    <span class="v3d-help">${T.help}</span></div><div class="v3d-north" title="N">N</div>`
  host.appendChild(root)
  const q = <E extends HTMLElement>(k: string) => root.querySelector<E>(`[data-k="${k}"]`)!

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  root.prepend(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color(0x0d1014)
  const sideW = (hm.cols - 1) * hm.step, sideH = (hm.rows - 1) * hm.step, side = Math.max(sideW, sideH)
  scene.fog = new FogExp2(0x0d1014, 0.9 / side)
  const camera = new PerspectiveCamera(50, 1, 5, side * 8)
  scene.add(new HemisphereLight(0xdfe8ff, 0x3a3226, 0.9), new AmbientLight(0xffffff, 0.25))
  const sun = new DirectionalLight(0xfff1dc, 2.2)
  sun.position.set(-0.6, 0.8, -0.35)
  scene.add(sun)

  // --- terrain mesh (decimated to ≤ 1 M vertices) ---
  o.progress?.(T.stage('mesh'), 0, 3); await tick()
  const s = Math.max(1, Math.ceil(Math.sqrt((hm.cols * hm.rows) / MAX_VERTS)))
  const nc = Math.floor((hm.cols - 1) / s) + 1, nr = Math.floor((hm.rows - 1) / s) + 1
  const H = (c: number, r: number) => hm.heights[Math.min(hm.rows - 1, r) * hm.cols + Math.min(hm.cols - 1, c)]
  const pos = new Float32Array(nc * nr * 3), uv = new Float32Array(nc * nr * 2), nor = new Float32Array(nc * nr * 3)
  let dx0 = hm.minX, dz0 = hm.minZ, dside = side // drape bounds (set again when the drape is drawn)
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const i = r * nc + c
    pos[i * 3] = hm.minX + c * s * hm.step
    pos[i * 3 + 1] = H(c * s, r * s)
    pos[i * 3 + 2] = -(hm.minZ + r * s * hm.step) // row 0 = south: z grows toward the viewer
  }
  const setUV = () => {
    for (let i = 0; i < nc * nr; i++) { uv[i * 2] = (pos[i * 3] - dx0) / dside; uv[i * 2 + 1] = (-pos[i * 3 + 2] - dz0) / dside }
  }
  setUV()
  const idx = new Uint32Array((nc - 1) * (nr - 1) * 6)
  let k = 0
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1
    idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = b; idx[k++] = e; idx[k++] = d // counter-clockwise seen from above (z flipped)
  }
  const cell = s * hm.step
  const normals = (ex: number) => { // finite differences, exaggeration included
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      const hx = (pos[(r * nc + Math.min(nc - 1, c + 1)) * 3 + 1] - pos[(r * nc + Math.max(0, c - 1)) * 3 + 1]) * ex
      const hz = (pos[(Math.min(nr - 1, r + 1) * nc + c) * 3 + 1] - pos[(Math.max(0, r - 1) * nc + c) * 3 + 1]) * ex
      // dh/dx along +x, dh/dZ along world +Z = three -z
      let x = -hx / (2 * cell), y = 1, z = hz / (2 * cell)
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l
      const i = (r * nc + c) * 3
      nor[i] = x; nor[i + 1] = y; nor[i + 2] = z
    }
  }
  normals(1)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nor, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setIndex(new BufferAttribute(idx, 1))
  geo.computeBoundingSphere()
  const terrainMat = new MeshStandardMaterial({ color: 0x8a8f78, roughness: 0.95, metalness: 0 })
  const terrainMesh = new Mesh(geo, terrainMat)
  const relief = new Group() // scaled in y by the exaggeration: terrain + water
  relief.add(terrainMesh)
  scene.add(relief)

  // --- sea + lakes ---
  const waterMat = new MeshStandardMaterial({ color: 0x1d4a66, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.82, side: DoubleSide })
  const sea = new Mesh(new PlaneGeometry(side * 4, side * 4), waterMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.set(hm.minX + sideW / 2, data.sea - 0.3, -(hm.minZ + sideH / 2))
  relief.add(sea)
  const groundAt = (x: number, z: number) => {
    const c = Math.max(0, Math.min(hm.cols - 1, Math.round((x - hm.minX) / hm.step)))
    const r = Math.max(0, Math.min(hm.rows - 1, Math.round((z - hm.minZ) / hm.step)))
    return hm.heights[r * hm.cols + c]
  }
  for (const ring of data.lakes) {
    if (ring.length < 6) continue
    const sh = new Shape()
    let lvl = Infinity
    for (let i = 0; i + 1 < ring.length; i += 2) {
      lvl = Math.min(lvl, groundAt(ring[i], ring[i + 1]))
      if (i) sh.lineTo(ring[i], ring[i + 1]); else sh.moveTo(ring[i], ring[i + 1])
    }
    const lake = new Mesh(new ShapeGeometry(sh), waterMat)
    lake.rotation.x = -Math.PI / 2 // shape x/y → x/-z: world Z maps onto -z as everywhere else
    lake.position.y = lvl + 0.4
    relief.add(lake)
  }

  // --- drape: the 2D render ---
  let drapeTex: Texture | null = null
  const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize)
  const drape = () => {
    const d = o.drape(maxTex)
    if (!d) return
    dx0 = d.x0; dz0 = d.z0; dside = d.side
    setUV(); geo.attributes.uv.needsUpdate = true
    const tex = new CanvasTexture(d.canvas)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    drapeTex?.dispose()
    drapeTex = tex
    terrainMat.map = tex
    terrainMat.color.set(0xffffff)
    terrainMat.needsUpdate = true
  }
  o.progress?.(T.stage('drape'), 1, 3); await tick()
  drape()

  // --- buildings, bridges, trees (instanced) ---
  o.progress?.(T.stage('objects'), 2, 3); await tick()
  const tmp = new Object3D()
  const boxGeo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const bldMat = new MeshLambertMaterial({ color: 0xc9c2b2 })
  const blds = data.buildings.length ? new InstancedMesh(boxGeo, bldMat, data.buildings.length) : null
  const bridgeMat = new MeshLambertMaterial({ color: 0x8c8c86 })
  const brg = data.bridges?.length ? new InstancedMesh(boxGeo, bridgeMat, data.bridges.length) : null
  const coneGeo = new ConeGeometry(0.35, 1, 6).translate(0, 0.5, 0)
  const treeMat = new MeshLambertMaterial({ color: 0x2f4a26 })
  const treeChunks: { mesh: InstancedMesh; c: Vector3 }[] = []
  {
    const by = new Map<number, number[]>()
    const tr = data.trees
    for (let i = 0; i + 2 < tr.length; i += 3) {
      const key = Math.floor((tr[i] - hm.minX) / TREE_CHUNK) * 1000 + Math.floor((tr[i + 1] - hm.minZ) / TREE_CHUNK)
      let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(i)
    }
    for (const [key, list] of by) {
      const m = new InstancedMesh(coneGeo, treeMat, list.length)
      const cx = hm.minX + (Math.floor(key / 1000) + 0.5) * TREE_CHUNK, cz = hm.minZ + ((key % 1000) + 0.5) * TREE_CHUNK
      m.userData.list = list
      treeChunks.push({ mesh: m, c: new Vector3(cx, 0, -cz) })
      scene.add(m)
    }
  }
  let ex = 1
  const place = () => {
    if (blds) {
      data.buildings.forEach((b, i) => {
        tmp.position.set(b.cx, groundAt(b.cx, b.cz) * ex - 0.5, -b.cz)
        tmp.rotation.set(0, b.yaw, 0)
        tmp.scale.set(b.w, b.h + 0.5, b.d)
        tmp.updateMatrix(); blds.setMatrixAt(i, tmp.matrix)
      })
      blds.instanceMatrix.needsUpdate = true; blds.computeBoundingSphere()
    }
    if (brg && data.bridges) {
      data.bridges.forEach((b, i) => {
        tmp.position.set(b.cx, (data.bridgeY?.[i] ?? groundAt(b.cx, b.cz)) * ex - b.h, -b.cz)
        tmp.rotation.set(0, b.yaw, 0); tmp.scale.set(b.w, b.h, b.d)
        tmp.updateMatrix(); brg.setMatrixAt(i, tmp.matrix)
      })
      brg.instanceMatrix.needsUpdate = true; brg.computeBoundingSphere()
    }
    const m4 = new Matrix4(), qn = new Quaternion(), v = new Vector3(), sc = new Vector3()
    for (const ch of treeChunks) {
      const list = ch.mesh.userData.list as number[]
      list.forEach((i, j) => {
        const x = data.trees[i], z = data.trees[i + 1], f = data.trees[i + 2]
        v.set(x, groundAt(x, z) * ex - 0.5, -z)
        sc.set(9 * f, 14 * f, 9 * f)
        m4.compose(v, qn, sc); ch.mesh.setMatrixAt(j, m4)
      })
      ch.mesh.instanceMatrix.needsUpdate = true; ch.mesh.computeBoundingSphere()
    }
  }
  place()
  if (blds) scene.add(blds)
  if (brg) scene.add(brg)

  // --- camera ---
  const controls = new MapControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.maxPolarAngle = Math.PI * 0.47
  controls.minDistance = 30
  controls.maxDistance = side * 2.5
  controls.screenSpacePanning = false
  const look = (tx: number, tz: number, span: number, tilt: boolean) => {
    const gy = groundAt(tx, tz) * ex
    const dist = Math.max(200, span * 0.9)
    controls.target.set(tx, gy, -tz)
    if (tilt) camera.position.set(tx, gy + dist * 0.7, -tz + dist * 0.7)
    else camera.position.set(tx, gy + dist, -tz + 0.01)
    controls.update()
  }
  look(data.target[0], data.target[1], data.span, true)

  const resize = () => {
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h; camera.updateProjectionMatrix()
    dirty = true
  }
  let dirty = true, frames = 0, raf = 0, closed = false
  const ro = new ResizeObserver(resize)
  ro.observe(root)
  controls.addEventListener('change', () => { dirty = true })
  const north = root.querySelector<HTMLDivElement>('.v3d-north')!
  const v2 = new Vector2()
  const loop = () => {
    if (closed) return
    raf = requestAnimationFrame(loop)
    controls.update()
    if (!dirty) return
    dirty = false
    for (const ch of treeChunks) ch.mesh.visible = treesOn && ch.c.distanceTo(v.set(camera.position.x, 0, camera.position.z)) < TREE_FAR
    // ground target follows the relief so the orbit stays on the ground
    controls.target.y = groundAt(controls.target.x, -controls.target.z) * ex
    renderer.render(scene, camera)
    frames++
    v2.set(controls.target.x - camera.position.x, controls.target.z - camera.position.z)
    north.style.transform = `rotate(${Math.atan2(v2.x, -v2.y) * -1}rad)`
  }
  const v = new Vector3()
  let treesOn = true
  resize()
  loop()

  // --- toolbar ---
  q<HTMLInputElement>('exag').addEventListener('input', (e) => {
    ex = Number((e.target as HTMLInputElement).value)
    q('exagV').textContent = '×' + ex
    relief.scale.y = ex
    normals(ex); geo.attributes.normal.needsUpdate = true
    place(); dirty = true
  })
  q('reset').addEventListener('click', () => look(hm.minX + sideW / 2, hm.minZ + sideH / 2, side, true))
  q('top').addEventListener('click', () => look(controls.target.x, -controls.target.z, camera.position.distanceTo(controls.target), false))
  q<HTMLInputElement>('trees').addEventListener('change', (e) => { treesOn = (e.target as HTMLInputElement).checked; dirty = true })
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) { e.stopPropagation(); close() } }
  window.addEventListener('keydown', onKey, true)
  q('back').addEventListener('click', () => close())

  function close() {
    if (closed) return
    closed = true
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey, true)
    ro.disconnect()
    controls.dispose()
    const mats = new Set<Material>()
    scene.traverse((ob) => {
      const m = ob as Mesh
      if (m.geometry) m.geometry.dispose()
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x))
      if ((ob as InstancedMesh).isInstancedMesh) (ob as InstancedMesh).dispose()
    })
    mats.forEach((m) => m.dispose())
    drapeTex?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    root.remove()
    o.onClose([controls.target.x, -controls.target.z], camera.position.distanceTo(controls.target) / 0.9)
  }
  return {
    refreshDrape() { if (!closed) { drape(); dirty = true } },
    close,
    stats: () => ({ frames, vertices: nc * nr, buildings: data.buildings.length, trees: data.trees.length / 3 }),
  }
}
