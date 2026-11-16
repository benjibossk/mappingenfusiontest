// 3D view (docs/OPSTRACK_3D_STUDY.md): one terrain mesh from the height grid, the 2D render draped on it,
// instanced buildings and trees, sea and lakes. Loaded with import() only when the user presses "3D".
// Axes: three x = world X (east), y = height, z = -world Z (north is -z, so north is up on screen).
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  DirectionalLight, DoubleSide, Group, IcosahedronGeometry, OctahedronGeometry, Points, PointsMaterial, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial,
  MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Shape, ShapeGeometry, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, InstancedBufferAttribute, type Material, type Texture,
} from 'three'
import { MOUSE } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
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
  treeTint?: { needle: number[]; broad: number[]; bush: number[] } // biome multipliers on the crown colours (absent = Everon)
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
// trees as OpsTrack (measured in its GameMap3D chunk): low-poly instanced meshes per 512 m cell up to TREE_NEAR,
// and one point per tree everywhere, faded in from 0.4·TREE_NEAR to 0.87·TREE_NEAR (a speckled far canopy, not a flat carpet)
const TREE_CHUNK = 512
let TREE_NEAR = 3000
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
  scene.background = new Color(0x0d1117) // OpsTrack: dark void, no fog, no sky
  const sideW = (hm.cols - 1) * hm.step, sideH = (hm.rows - 1) * hm.step, side = Math.max(sideW, sideH)
  const camera = new PerspectiveCamera(55, 1, 5, side * 10)
  // OpsTrack lighting: white ambient 0.75 + one white sun 1.6 from the south-west at ~39°, no shadows, ACES
  scene.add(new AmbientLight(0xffffff, 0.75))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(-8000, 9000, 8000)
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
  const bldMat = new MeshStandardMaterial({ color: 0x8d8578, roughness: 0.9, metalness: 0 }) // OpsTrack building grey-beige
  const blds = data.buildings.length ? new InstancedMesh(boxGeo, bldMat, data.buildings.length) : null
  const bridgeMat = new MeshLambertMaterial({ color: 0x8c8c86 })
  const brg = data.bridges?.length ? new InstancedMesh(boxGeo, bridgeMat, data.bridges.length) : null
  const geos = { // OpsTrack: open 6-sided cone (conifer), faceted icosahedron (broadleaf), octahedron (bush); Lambert, flat shading
    needle: new ConeGeometry(0.5, 1, 6, 1, true).translate(0, 0.5, 0),
    broad: new IcosahedronGeometry(0.5, 0).translate(0, 0.65, 0),
    bush: new OctahedronGeometry(0.5, 0).translate(0, 0.5, 0),
  }
  type Kind = keyof typeof geos
  const KCOL: Record<Kind, number[]> = { needle: [0.13, 0.25, 0.13], broad: [0.2, 0.34, 0.14], bush: [0.28, 0.33, 0.16] } // OpsTrack linear tints; × 0.5–0.75 here (their sun reaches the forest at a grazing angle, ours is higher)
  const treeMat = new MeshLambertMaterial({ color: 0xffffff })
  const treeChunks: { mesh: InstancedMesh; c: Vector3; list: number[]; kind: Kind }[] = []
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
  const nTree = data.trees.length / 3
  const kindOf = (t: number): Kind => {
    if (data.treeNeedle?.[t]) return 'needle'
    return ((t * 374761393) >>> 0) % 100 < 12 ? 'bush' : 'broad' // some undergrowth among broadleaves
  }
  if (data.treeTint) { const tt = data.treeTint; for (const k of ['needle', 'broad', 'bush'] as Kind[]) KCOL[k] = KCOL[k].map((v, i) => Math.min(1, v * tt[k][i])) }
  const tcol = new Float32Array(nTree * 3)
  for (let t = 0; t < nTree; t++) {
    const kc = KCOL[kindOf(t)], m = (0.8 + (((t * 2654435761) >>> 0) / 4294967296) * 0.4) * 0.62
    tcol[t * 3] = kc[0] * m; tcol[t * 3 + 1] = kc[1] * m; tcol[t * 3 + 2] = kc[2] * m
  }
  // far canopy: one lit-less point per tree, size in metres, faded in where the meshes stop
  const ptsGeo = new BufferGeometry()
  ptsGeo.setAttribute('position', new BufferAttribute(new Float32Array(nTree * 3), 3))
  ptsGeo.setAttribute('color', new BufferAttribute(tcol, 3))
  const ptsMat = new PointsMaterial({ size: 9, sizeAttenuation: true, vertexColors: true })
  ptsMat.color.setScalar(0.35 / 0.62) // OpsTrack: points at 0.35 of the tint (undo our mesh darkening)
  const fadeU = { value: new Vector2(0.4 * TREE_NEAR, 0.87 * TREE_NEAR) }
  ptsMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = fadeU
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uFade;')
      .replace('#include <logdepthbuf_vertex>', `float otFade = smoothstep(uFade.x, uFade.y, -mvPosition.z);
        gl_PointSize *= otFade;
        if (otFade < 1.0 && gl_PointSize < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <logdepthbuf_vertex>`)
  }
  const pts = new Points(ptsGeo, ptsMat)
  pts.frustumCulled = false
  scene.add(pts)
  {
    const by = new Map<number, number[]>()
    const tr = data.trees
    const KI: Kind[] = ['broad', 'needle', 'bush']
    for (let t = 0; t < nTree; t++) {
      const key = (Math.floor((tr[t * 3] - hm.minX) / TREE_CHUNK) * 1000 + Math.floor((tr[t * 3 + 1] - hm.minZ) / TREE_CHUNK)) * 3 + KI.indexOf(kindOf(t))
      let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(t * 3)
    }
    for (const [key3, list] of by) {
      const kind = KI[key3 % 3], key = Math.floor(key3 / 3)
      const mesh = new InstancedMesh(geos[kind], treeMat, list.length)
      const ic = new Float32Array(list.length * 3)
      list.forEach((i, j) => { ic[j * 3] = tcol[i]; ic[j * 3 + 1] = tcol[i + 1]; ic[j * 3 + 2] = tcol[i + 2] })
      mesh.instanceColor = new InstancedBufferAttribute(ic, 3)
      const cx = hm.minX + (Math.floor(key / 1000) + 0.5) * TREE_CHUNK, cz = hm.minZ + ((key % 1000) + 0.5) * TREE_CHUNK
      treeChunks.push({ mesh, c: new Vector3(cx, groundAt(cx, cz), -cz), list, kind })
      scene.add(mesh)
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
    const pp = ptsGeo.attributes.position.array as Float32Array
    for (const ch of treeChunks) {
      ch.list.forEach((i, j) => {
        const x = data.trees[i], z = data.trees[i + 1], f = data.trees[i + 2], gy = groundAt(x, z) * ex
        // per-tree height / crown radius jitter (OpsTrack carries real ones), random yaw so facets never line up
        const h = ((i * 2246822519) >>> 0) / 4294967296, k = ((i * 3266489917) >>> 0) / 4294967296
        let ht: number, rd: number
        if (ch.kind === 'needle') { ht = (16 + k * 8) * f; rd = (2.6 + h * 1.2) * f } else if (ch.kind === 'bush') { ht = (3 + k * 3) * f; rd = (2 + h * 1.5) * f } else { ht = (13 + k * 6) * f * 0.87; rd = (3.6 + h * 1.8) * f }
        v.set(x, gy - 0.5, -z)
        qn.setFromAxisAngle(UP, h * Math.PI * 2)
        sc.set(rd * 2, ht, rd * 2)
        m4.compose(v, qn, sc); ch.mesh.setMatrixAt(j, m4)
        const t = i / 3
        pp[t * 3] = x; pp[t * 3 + 1] = gy + ht * 0.6; pp[t * 3 + 2] = -z
      })
      ch.mesh.instanceMatrix.needsUpdate = true; ch.mesh.computeBoundingSphere()
    }
    ptsGeo.attributes.position.needsUpdate = true
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
  // Workbench-style: right button is free-look (handled below), middle drag orbits, left drag pans the map
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.ROTATE, RIGHT: null as unknown as MOUSE }
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
  TREE_NEAR = 3000; fadeU.value.set(0.4 * TREE_NEAR, 0.87 * TREE_NEAR)
  const ro = new ResizeObserver(resize)
  ro.observe(root)
  controls.addEventListener('change', () => { dirty = true })
  const north = root.querySelector<HTMLDivElement>('.v3d-north')!
  const v2 = new Vector2()
  // keyboard flight: physical key positions (e.code), so ZQSD on AZERTY and WASD on QWERTY both work.
  // Arrows too; A/E (AZERTY) = Q/E (QWERTY) rotate; R/F up/down; Shift = faster.
  const held = new Set<string>()
  let lastT = performance.now()
  const fwd = new Vector3(), rgt = new Vector3()
  // free-look (World Editor style): hold the right button, move the mouse = turn the camera in place;
  // while held, WASD flies along the view direction, Q/E down/up, the wheel sets the speed.
  let looking = false, speedMul = 1, lookMoved = false
  const camDir = new Vector3()
  const aimTarget = (yaw: number, pitch: number) => {
    pitch = Math.max(-1.55, Math.min(-0.06, pitch))
    camDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    const gy = groundAt(camera.position.x, -camera.position.z) * ex
    const h = Math.max(5, camera.position.y - gy)
    const d = Math.min(controls.maxDistance * 0.9, Math.max(controls.minDistance + 1, h / -camDir.y))
    controls.target.copy(camera.position).addScaledVector(camDir, d)
    camera.lookAt(controls.target)
  }
  const yawPitch = () => {
    camera.getWorldDirection(camDir)
    return [Math.atan2(camDir.x, -camDir.z), Math.asin(Math.max(-1, Math.min(1, camDir.y)))]
  }
  const fly = (dt: number) => {
    if (!held.size) return
    const k = (c: string) => held.has(c)
    const gy = groundAt(camera.position.x, -camera.position.z) * ex
    const alt = Math.max(20, camera.position.y - gy)
    const base = looking ? Math.max(30, alt * 1.2) * speedMul : Math.max(40, camera.position.distanceTo(controls.target) * 0.9)
    const sp = base * (k('ShiftLeft') || k('ShiftRight') ? 3 : 1) * dt
    camera.getWorldDirection(fwd)
    if (!looking) { fwd.y = 0; fwd.normalize() }
    rgt.set(-fwd.z, 0, fwd.x).normalize()
    const mv = new Vector3()
    if (k('KeyW') || k('ArrowUp')) mv.add(fwd)
    if (k('KeyS') || k('ArrowDown')) mv.sub(fwd)
    if (k('KeyD') || k('ArrowRight')) mv.add(rgt)
    if (k('KeyA') || k('ArrowLeft')) mv.sub(rgt)
    if (looking) mv.y += (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0)
    mv.y += (k('KeyR') ? 1 : 0) - (k('KeyF') ? 1 : 0)
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); camera.position.add(mv); controls.target.add(mv) }
    if (!looking) {
      const rot = (k('KeyQ') ? 1 : 0) - (k('KeyE') ? 1 : 0)
      if (rot) { const a = rot * 1.2 * dt, o = camera.position.clone().sub(controls.target); o.applyAxisAngle(new Vector3(0, 1, 0), a); camera.position.copy(controls.target).add(o) }
    } else { const [y, p] = yawPitch(); aimTarget(y, p) }
    dirty = true
  }
  const cvs = renderer.domElement
  const onPDown = (e: PointerEvent) => {
    if (e.button !== 2) return
    looking = true; lookMoved = false; speedMul = 1
    try { cvs.setPointerCapture(e.pointerId) } catch { /* */ }
    try { void (cvs.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}) } catch { /* */ }
  }
  const onPMove = (e: PointerEvent) => {
    if (!looking || !(e.buttons & 2)) { if (looking && !(e.buttons & 2)) endLook(); return }
    if (!e.movementX && !e.movementY) return
    lookMoved = true
    const [y, p] = yawPitch()
    aimTarget(y + e.movementX * 0.0035, p - e.movementY * 0.0035)
    dirty = true
  }
  const endLook = () => { if (!looking) return; looking = false; if (document.pointerLockElement === cvs) document.exitPointerLock() }
  const onPUp = (e: PointerEvent) => { if (e.button === 2) endLook() }
  const onWheel = (e: WheelEvent) => {
    if (!looking) return // plain wheel = MapControls zoom
    e.preventDefault(); e.stopImmediatePropagation()
    speedMul = Math.max(0.1, Math.min(10, speedMul * (e.deltaY < 0 ? 1.25 : 0.8)))
  }
  const onCtx = (e: Event) => e.preventDefault()
  cvs.addEventListener('pointerdown', onPDown); window.addEventListener('pointermove', onPMove); window.addEventListener('pointerup', onPUp)
  cvs.addEventListener('wheel', onWheel, { capture: true, passive: false }); cvs.addEventListener('contextmenu', onCtx)
  void lookMoved
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return
    if (/^(Key[WASDQERF]|Arrow\w+|Shift\w+)$/.test(e.code)) { held.add(e.code); if (!e.code.startsWith('Shift')) e.preventDefault() }
  }
  const onKeyUp = (e: KeyboardEvent) => { held.delete(e.code) }
  const onBlur = () => { held.clear(); endLook() }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur)
  const loop = () => {
    if (closed) return
    raf = requestAnimationFrame(loop)
    const tNow = performance.now(); fly(Math.min(0.1, (tNow - lastT) / 1000)); lastT = tNow
    if (!looking) controls.update()
    { const g = groundAt(camera.position.x, -camera.position.z) * ex + 8; if (camera.position.y < g) { camera.position.y = g; dirty = true } }
    if (!dirty) return
    dirty = false
    const rr = TREE_NEAR + TREE_CHUNK * 0.71 + 120
    for (const ch of treeChunks) ch.mesh.visible = treesOn && ch.c.distanceToSquared(camera.position) < rr * rr
    pts.visible = treesOn
    // auto quality: the first ~40 frames are timed; a slow GPU gets shorter tree ranges and a lower pixel ratio
    const now = performance.now()
    if (qN < 40) { if (qN++ > 4) qSum += now - qLast; qLast = now; dirty = true }
    else if (qN === 40) {
      qN++
      const ms = qSum / 35
      if (ms > 30) { TREE_NEAR = 1200; renderer.setPixelRatio(1); dirty = true }
      else if (ms > 17) { TREE_NEAR = 2000; renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio)); dirty = true }
      fadeU.value.set(0.4 * TREE_NEAR, 0.87 * TREE_NEAR)
    }
    // ground target follows the relief so the orbit stays on the ground
    if (!looking) controls.target.y = groundAt(controls.target.x, -controls.target.z) * ex
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
    cvs.removeEventListener('pointerdown', onPDown); window.removeEventListener('pointermove', onPMove); window.removeEventListener('pointerup', onPUp)
    cvs.removeEventListener('wheel', onWheel, true); cvs.removeEventListener('contextmenu', onCtx); endLook()
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur)
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
