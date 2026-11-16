// 3D view (docs/OPSTRACK_3D_STUDY.md): one terrain mesh from the height grid, the 2D render draped on it,
// instanced buildings and trees, sea and lakes. Loaded with import() only when the user presses "3D".
// Axes: three x = world X (east), y = height, z = -world Z (north is -z, so north is up on screen).
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial,
  MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Shape, ShapeGeometry, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, type Material, type Texture,
} from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { realDrape, type RealLayers } from './drape'
export type { RealLayers } from './drape'

export interface HeightGrid { minX: number; minZ: number; step: number; cols: number; rows: number; heights: ArrayLike<number> } // row 0 = minZ (south)
export interface Box3D { cx: number; cz: number; w: number; d: number; h: number; yaw: number } // yaw: radians, world X/Z
export interface View3DData {
  hm: HeightGrid
  sea: number
  buildings: Box3D[]
  trees: Float32Array // x, z, scale (1 = 12 m) triplets
  treeNeedle?: Uint8Array // 1 = conifer, per tree
  lakes: number[][] // flat X/Z rings
  bridges?: Box3D[] // decks (cz/cx centre, h = thickness), y from the deck height
  bridgeY?: number[]
  target: [number, number] // world X/Z the 2D view looks at
  span: number // metres across the 2D view
}
export interface View3DText {
  back: string; exag: string; reset: string; top: string; trees: string; help: string; grid: string
  drape: string; real: string; map: string; sat: string; genMs: (s: string) => string
  stage: (k: 'mesh' | 'drape' | 'real' | 'objects') => string
}
export interface View3DOptions {
  text: View3DText
  /** draws the 2D map into a square canvas of `size` px covering the drape bounds (x0, z0, side) */
  drape: (size: number) => { canvas: HTMLCanvasElement; x0: number; z0: number; side: number } | null
  /** project data for the realistic drape (default); without it, the map drape only */
  real?: RealLayers
  progress?: (stage: string, i: number, n: number) => void
  /** short notice (render time after a drape switch): shown as a toast by the host */
  notify?: (msg: string) => void
  onClose: (target: [number, number], span: number) => void
}
export interface View3D { refreshDrape(): void; close(): void; stats(): { frames: number; vertices: number; buildings: number; trees: number; drape: string; texture: number } }

const MAX_VERTS = 1_000_000
const TREE_CHUNK = 1024 // m: trees grouped per square; full crowns up to TREE_NEAR, 4-sided cones up to TREE_FAR, beyond: canopy texture only
let TREE_NEAR = 1600
let TREE_FAR = 5000
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export async function open3d(host: HTMLElement, data: View3DData, o: View3DOptions): Promise<View3D> {
  const { hm } = data
  const T = o.text
  const root = document.createElement('div')
  root.className = 'v3d'
  const seg = (v: string, label: string) => `<button type="button" role="radio" data-v="${v}" aria-checked="false">${label}</button>`
  root.innerHTML = `<div class="v3d-bar" role="toolbar">
    <button type="button" class="v3d-back" data-k="back">${T.back}</button>
    <span class="v3d-sep"></span>
    <span class="v3d-lbl">${T.drape}</span>
    <span class="v3d-seg" role="radiogroup" aria-label="${T.drape}" data-k="drape">${o.real ? seg('real', T.real) : ''}${seg('map', T.map)}${o.real?.sat ? seg('sat', T.sat) : ''}</span>
    <span class="v3d-sep"></span>
    <label class="v3d-relief">${T.exag} <input type="range" min="1" max="3" step="0.25" value="1" data-k="exag" aria-label="${T.exag}"><output data-k="exagV">×1</output></label>
    <span class="v3d-sep"></span>
    <label class="v3d-tog"><input type="checkbox" checked data-k="trees"> ${T.trees}</label>
    <label class="v3d-tog"><input type="checkbox" checked data-k="grid"> ${T.grid}</label>
    <span class="grow"></span>
    <button type="button" data-k="reset">${T.reset}</button>
    <button type="button" data-k="top">${T.top}</button>
    </div><div class="v3d-help">${T.help}</div><div class="v3d-north" title="N">N</div>`
  host.appendChild(root)
  const q = <E extends HTMLElement>(k: string) => root.querySelector<E>(`[data-k="${k}"]`)!

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  root.prepend(renderer.domElement)
  const scene = new Scene()
  renderer.toneMappingExposure = 1.0
  scene.background = new Color(0x0c0f1c) // OpsTrack: deep navy void around the terrain block
  const sideW = (hm.cols - 1) * hm.step, sideH = (hm.rows - 1) * hm.step, side = Math.max(sideW, sideH)
  scene.fog = new FogExp2(0x6c7c8c, 0.14 / side) // aerial haze: far ground fades to blue-grey, the background stays dark
  const camera = new PerspectiveCamera(45, 1, 5, side * 8)
  scene.add(new HemisphereLight(0xdfe8f5, 0x5a5040, 1.15), new AmbientLight(0xffffff, 0.15))
  const sun = new DirectionalLight(0xfff4e2, 1.9) // soft high sun: the drape carries the hillshade
  sun.position.set(-0.55, 0.75, 0.58) // south-west, ~40° high (as the baked hillshade of the drape)
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
  const terrainMat = new MeshStandardMaterial({ color: 0x8a8f78, roughness: 1, metalness: 0 })
  // draped km grid (as OpsTrack): lines of constant pixel width from the world position, toggled by a uniform
  const gridU = { value: 1 }
  terrainMat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrid = gridU
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWxz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWxz;\nuniform float uGrid;')
      .replace('#include <opaque_fragment>', `{ vec2 gq = vWxz / 1000.0; vec2 gd = abs(fract(gq - 0.5) - 0.5) / fwidth(gq);
        float gl = (1.0 - min(min(gd.x, gd.y) * 1.4, 1.0)) * uGrid; outgoingLight = mix(outgoingLight, vec3(0.9), gl * 0.3); }
      #include <opaque_fragment>`)
  }
  const terrainMesh = new Mesh(geo, terrainMat)
  const relief = new Group() // scaled in y by the exaggeration: terrain + water
  relief.add(terrainMesh)
  scene.add(relief)

  // --- sea + lakes ---
  const waterMat = new MeshStandardMaterial({ color: 0x1b3f6e, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.8, side: DoubleSide }) // matte navy, shallows show through
  const sea = new Mesh(new PlaneGeometry(sideW, sideH), waterMat) // clipped to the terrain block
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

  // --- skirts: the terrain block's sides, soil below the ground, water above it where the edge is under the sea ---
  {
    let hMin = Infinity
    for (let i = 0; i < hm.heights.length; i++) hMin = Math.min(hMin, hm.heights[i])
    const bottom = Math.min(hMin, data.sea) - Math.max(40, side * 0.012)
    const edge: number[] = [] // vertex indices around the border, closed
    for (let c = 0; c < nc; c++) edge.push(c)
    for (let r = 1; r < nr; r++) edge.push(r * nc + nc - 1)
    for (let c = nc - 2; c >= 0; c--) edge.push((nr - 1) * nc + c)
    for (let r = nr - 2; r >= 0; r--) edge.push(r * nc)
    const sp: number[] = [], sc: number[] = []
    const soil = [0.17, 0.14, 0.11], deep = [0.06, 0.05, 0.045], wat = [0.08, 0.18, 0.34]
    for (let i = 0; i + 1 < edge.length; i++) {
      const a = edge[i], b = edge[i + 1]
      const ax = pos[a * 3], az = pos[a * 3 + 2], ay = pos[a * 3 + 1], bx = pos[b * 3], bz = pos[b * 3 + 2], by = pos[b * 3 + 1]
      // soil: ground to bottom; water: sea level to ground where the ground is under the sea
      sp.push(ax, ay, az, bx, by, bz, ax, bottom, az, bx, by, bz, bx, bottom, bz, ax, bottom, az)
      sc.push(...soil, ...soil, ...deep, ...soil, ...deep, ...deep)
      if (ay < data.sea || by < data.sea) {
        const s0 = data.sea - 0.3
        sp.push(ax, s0, az, bx, s0, bz, ax, Math.min(ay, s0), az, bx, s0, bz, bx, Math.min(by, s0), bz, ax, Math.min(ay, s0), az)
        sc.push(...wat, ...wat, ...wat, ...wat, ...wat, ...wat)
      }
    }
    const sg = new BufferGeometry()
    sg.setAttribute('position', new BufferAttribute(new Float32Array(sp), 3))
    sg.setAttribute('color', new BufferAttribute(new Float32Array(sc), 3))
    sg.computeVertexNormals()
    relief.add(new Mesh(sg, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })))
  }

  // --- drape: realistic (from the data), map (the 2D render without UI) or satellite ---
  let drapeTex: Texture | null = null
  // 8192² for the realistic drape when the GPU takes it and the machine has the memory (256 MB canvas), else 4096²
  const big = renderer.capabilities.maxTextureSize >= 16384 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 4) >= 8
  const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize)
  const realTex = big ? 8192 : maxTex
  let mode: 'real' | 'map' | 'sat' = o.real ? 'real' : 'map'
  let announce = false // render time: a toast when the user switches the drape (the first one is in the opening toast)
  const drape = () => {
    const t0 = performance.now()
    const d = mode !== 'map' && o.real ? realDrape(realTex, hm, data.sea, o.real, data.buildings, mode) : o.drape(maxTex)
    if (!d) return
    if (announce) announce = false, o.notify?.(T.genMs(((performance.now() - t0) / 1000).toFixed(1)))
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
  o.progress?.(T.stage(o.real ? 'real' : 'drape'), 1, 3); await tick()
  drape()

  // --- buildings, bridges, trees (instanced) ---
  o.progress?.(T.stage('objects'), 2, 3); await tick()
  const tmp = new Object3D()
  const boxGeo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const bldMat = new MeshLambertMaterial({ color: 0xc9c2b2 })
  const blds = data.buildings.length ? new InstancedMesh(boxGeo, bldMat, data.buildings.length) : null
  const bridgeMat = new MeshLambertMaterial({ color: 0x8c8c86 })
  const brg = data.bridges?.length ? new InstancedMesh(boxGeo, bridgeMat, data.bridges.length) : null
  // trees: per 1 km square, two kinds (broadleaf crown / conifer cone), two levels of detail sharing the
  // same instance matrices and colours; beyond TREE_FAR the canopy of the drape stands for the forest
  const geos = {
    // rounded crown: subdivided + welded so normals are smooth (no faceted "diamond" look)
    broad: [(() => { const g = mergeVertices(new IcosahedronGeometry(0.5, 1).deleteAttribute('normal').deleteAttribute('uv')); g.computeVertexNormals(); return g.scale(1, 0.8, 1).translate(0, 0.6, 0) })(), new ConeGeometry(0.5, 1, 3, 1, true).translate(0, 0.5, 0)],
    needle: [new ConeGeometry(0.36, 1, 6, 1, true).translate(0, 0.5, 0), new ConeGeometry(0.36, 1, 3, 1, true).translate(0, 0.5, 0)],
  }
  const treeMat = new MeshLambertMaterial({ color: 0xffffff })
  const treeChunks: { lods: InstancedMesh[][]; c: Vector3; list: number[]; kind: 'broad' | 'needle' }[] = []
  // densify: each project tree becomes a small clump (≈1 M instances max) so forests read as a closed canopy
  {
    const n0 = data.trees.length / 3, kc = Math.max(1, Math.min(6, Math.floor(1_000_000 / Math.max(1, n0))))
    if (kc > 1) {
      const tr = new Float32Array(n0 * kc * 3), nd = new Uint8Array(n0 * kc)
      for (let i = 0; i < n0; i++) for (let c = 0; c < kc; c++) {
        const o = i * kc + c, h1 = ((o * 2654435761) >>> 0) / 4294967296, h2 = ((o * 2246822519 + 7) >>> 0) / 4294967296
        const r = c ? 3 + h1 * 5 : 0, a = h2 * 6.283
        tr[o * 3] = data.trees[i * 3] + Math.cos(a) * r; tr[o * 3 + 1] = data.trees[i * 3 + 1] + Math.sin(a) * r
        tr[o * 3 + 2] = data.trees[i * 3 + 2] * (c ? 0.7 + h1 * 0.35 : 1)
        nd[o] = data.treeNeedle?.[i] ?? 0
      }
      data = { ...data, trees: tr, treeNeedle: nd }
    }
  }
  {
    const by = new Map<number, number[]>()
    const tr = data.trees
    for (let i = 0; i + 2 < tr.length; i += 3) {
      const nd = data.treeNeedle?.[i / 3] ? 1 : 0
      const key = (Math.floor((tr[i] - hm.minX) / TREE_CHUNK) * 1000 + Math.floor((tr[i + 1] - hm.minZ) / TREE_CHUNK)) * 2 + nd
      let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(i)
    }
    const col = new Color()
    for (const [key2, list] of by) {
      const kind = key2 % 2 ? 'needle' : 'broad', key = Math.floor(key2 / 2)
      const near = new InstancedMesh(geos[kind][0], treeMat, list.length)
      const far = new InstancedMesh(geos[kind][1], treeMat, list.length)
      list.forEach((i, j) => {
        const t = ((i * 2654435761) >>> 0) / 4294967296
        const u = ((i * 40503 + 977) % 1009) / 1009 // second hash: hue shift independent of brightness
        if (kind === 'needle') col.setRGB(0.12 + t * 0.07, 0.21 + t * 0.1, 0.13 + t * 0.05, SRGBColorSpace)
        else col.setRGB(0.17 + t * 0.12 + u * 0.08, 0.27 + t * 0.14, 0.09 + t * 0.05 + u * 0.03, SRGBColorSpace)
        near.setColorAt(j, col)
      })
      far.instanceMatrix = near.instanceMatrix
      far.instanceColor = near.instanceColor
      const cx = hm.minX + (Math.floor(key / 1000) + 0.5) * TREE_CHUNK, cz = hm.minZ + ((key % 1000) + 0.5) * TREE_CHUNK
      treeChunks.push({ lods: [[near], [far]], c: new Vector3(cx, groundAt(cx, cz), -cz), list, kind })
      scene.add(near, far)
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
    const m4 = new Matrix4(), qn = new Quaternion(), v = new Vector3(), sc = new Vector3(), UP = new Vector3(0, 1, 0)
    for (const ch of treeChunks) {
      const near = ch.lods[0][0], far = ch.lods[1][0]
      ch.list.forEach((i, j) => {
        const x = data.trees[i], z = data.trees[i + 1], f = data.trees[i + 2]
        v.set(x, groundAt(x, z) * ex - 0.8, -z)
        // random yaw + slight size/aspect jitter so neighbouring crowns never line up
        const h = ((i * 2246822519) >>> 0) / 4294967296, k = ((i * 3266489917) >>> 0) / 4294967296
        qn.setFromAxisAngle(UP, h * Math.PI * 2)
        if (ch.kind === 'needle') sc.set(7 * f, (15 + k * 5) * f, 7 * f); else sc.set((9 + k * 3) * f, (11 + h * 4) * f, (9 + h * 3) * f)
        m4.compose(v, qn, sc); near.setMatrixAt(j, m4)
      })
      near.instanceMatrix.needsUpdate = true; near.computeBoundingSphere(); far.boundingSphere = near.boundingSphere
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
    if (tilt) camera.position.set(tx, gy + dist * 0.66, -tz + dist * 0.76) // ~41° from the south, as OpsTrack
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
  let dirty = true, frames = 0, raf = 0, closed = false, qN = 0, qSum = 0, qLast = 0
  TREE_NEAR = 1600; TREE_FAR = 5000
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
    for (const ch of treeChunks) {
      const d = ch.c.distanceTo(camera.position)
      ch.lods[0][0].visible = treesOn && d < TREE_NEAR
      ch.lods[1][0].visible = treesOn && d >= TREE_NEAR && d < TREE_FAR
    }
    // auto quality: the first ~40 frames are timed; a slow GPU gets shorter tree ranges and a lower pixel ratio
    const now = performance.now()
    if (qN < 40) { if (qN++ > 4) qSum += now - qLast; qLast = now; dirty = true }
    else if (qN === 40) {
      qN++
      const ms = qSum / 35
      if (ms > 30) { TREE_NEAR = 700; TREE_FAR = 2200; renderer.setPixelRatio(1); dirty = true }
      else if (ms > 17) { TREE_NEAR = 1100; TREE_FAR = 3500; renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio)); dirty = true }
    }
    // ground target follows the relief so the orbit stays on the ground
    controls.target.y = groundAt(controls.target.x, -controls.target.z) * ex
    renderer.render(scene, camera)
    frames++
    v2.set(controls.target.x - camera.position.x, controls.target.z - camera.position.z)
    north.style.transform = `rotate(${Math.atan2(v2.x, -v2.y) * -1}rad)`
  }
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
  q<HTMLInputElement>('grid').addEventListener('change', (e) => { gridU.value = (e.target as HTMLInputElement).checked ? 1 : 0; dirty = true })
  const segBtns = [...q('drape').querySelectorAll<HTMLButtonElement>('[data-v]')]
  const markSeg = () => segBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === mode)))
  markSeg()
  segBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.v === mode) return
    mode = b.dataset.v as typeof mode; markSeg(); announce = true; drape(); dirty = true
  }))
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
    refreshDrape() { if (!closed && mode === 'map') { drape(); dirty = true } }, // the realistic drape keeps the data it was opened with
    close,
    stats: () => ({ frames, vertices: nc * nr, buildings: data.buildings.length, trees: data.trees.length / 3, drape: mode, texture: mode === 'map' ? maxTex : realTex }),
  }
}
