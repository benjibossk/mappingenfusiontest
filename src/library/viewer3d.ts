// Standalone 3D preview of one asset or one parcel (no game meshes: boxes / trunks + cones / fence
// strips sized from the footprints). Lazy-load it: `const { createViewer } = await import('./viewer3d')`.
// Axes as src/view3d: three x = world X, y = up, z = -world Z.

import {
  AmbientLight, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, Mesh,
  MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer, type Object3D,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Biome } from '../data/biomes.ts'
import type { Asset, AssetKind } from './schema.ts'
import type { Parcel3D, PlacedAsset } from '../biomes/parcel.ts'

const KIND_COL: Record<AssetKind, string> = {
  house: '#e8dcc4', farm: '#c9a27a', annex: '#b8a58c', shed: '#8f7a5e', civic: '#d9b38c', religious: '#f0efe8', block: '#c8c8c8',
  industrial: '#9aa3ab', military: '#6b7350', fence: '#7a5a3a', wall: '#9a948a', tree: '#3f6a2e', bush: '#4f7a36', prop: '#c9a640',
}
const ROOF = '#8a3b2a'

export interface Viewer { showAsset(a: Asset, b: Biome): void; showParcel(p: Parcel3D, b: Biome): void; dispose(): void }

function mat(c: string) { return new MeshLambertMaterial({ color: new Color(c) }) }

function assetMesh(a: { kind: AssetKind; footprint: Asset['footprint'] }): Object3D {
  const f = a.footprint
  const g = new Group()
  const w = f.maxX - f.minX, d = f.maxZ - f.minZ
  const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2
  if (a.kind === 'tree' || a.kind === 'bush') {
    const r = Math.max(w, d) / 2
    if (a.kind === 'tree') {
      const trunk = new Mesh(new CylinderGeometry(0.25, 0.35, f.h * 0.35, 8), mat('#5a4030'))
      trunk.position.y = f.h * 0.175; g.add(trunk)
      const crown = new Mesh(new ConeGeometry(r, f.h * 0.7, 10), mat(KIND_COL.tree))
      crown.position.y = f.h * 0.6; g.add(crown)
    } else {
      const bush = new Mesh(new ConeGeometry(r, f.h, 8), mat(KIND_COL.bush))
      bush.position.y = f.h / 2; g.add(bush)
    }
  } else {
    const roofed = ['house', 'farm', 'annex', 'civic', 'religious'].includes(a.kind)
    const body = roofed ? f.h * 0.65 : f.h
    const box = new Mesh(new BoxGeometry(w, body, d), mat(KIND_COL[a.kind]))
    box.position.set(cx, body / 2, -cz); g.add(box)
    if (roofed) {
      // square pyramid (cone, 4 sides, turned 45° inside) stretched to the w×d box by its parent
      const cone = new Mesh(new ConeGeometry(Math.SQRT1_2, 1, 4, 1), mat(ROOF))
      cone.rotation.y = Math.PI / 4
      const roof = new Group(); roof.add(cone)
      roof.scale.set(w * 1.05, f.h - body, d * 1.05)
      roof.position.set(cx, body + (f.h - body) / 2, -cz); g.add(roof)
    }
    // front marker (+Z model = street side)
    const door = new Mesh(new BoxGeometry(Math.min(1.2, w / 3), Math.min(2.1, body * 0.8), 0.2), mat('#3a2a20'))
    door.position.set(cx, Math.min(2.1, body * 0.8) / 2, -f.maxZ - 0.1); g.add(door)
  }
  return g
}

const place = (o: Object3D, it: PlacedAsset) => { o.position.set(it.x, 0, -it.z); o.rotation.y = (-it.yaw * Math.PI) / 180; return o }

export function createViewer(host: HTMLElement): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  host.appendChild(renderer.domElement)
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 1, 0.1, 2000)
  scene.add(new AmbientLight(0xffffff, 0.75))
  const sun = new DirectionalLight(0xffffff, 1.6); sun.position.set(40, 80, 30); scene.add(sun)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.autoRotate = true; controls.autoRotateSpeed = 1.2; controls.enableDamping = true
  controls.maxPolarAngle = Math.PI * 0.48
  let content = new Group(); scene.add(content)

  const resize = () => {
    const w = host.clientWidth || 400, h = host.clientHeight || 300
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'
    camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize()
  let raf = 0
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera) }
  loop()

  const reset = (b: Biome, size: number) => {
    scene.remove(content); content.traverse((o) => { const m = o as Mesh; m.geometry?.dispose?.() })
    content = new Group(); scene.add(content)
    scene.background = new Color(b.id === 'winter_tundra' ? '#cfd8e0' : '#bcd3e6')
    const ground = new Mesh(new PlaneGeometry(size * 3, size * 3), mat(b.drape.ground))
    ground.rotation.x = -Math.PI / 2; content.add(ground)
    camera.position.set(size * 0.9, size * 0.7, size * 0.9); controls.target.set(0, 2, 0)
  }

  return {
    showAsset(a, b) {
      const f = a.footprint
      reset(b, Math.max(8, f.maxX - f.minX, f.maxZ - f.minZ, f.h) * 1.4)
      content.add(assetMesh(a))
    },
    showParcel(p, b) {
      const xs = p.corners.filter((_, i) => i % 2 === 0), zs = p.corners.filter((_, i) => i % 2 === 1)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
      reset(b, size)
      const g = new Group(); g.position.set(-cx, 0, cz); content.add(g)
      // lot surface (garden), slightly above the biome ground
      const lot = new Mesh(new PlaneGeometry(1, 1), mat(new Color(b.drape.ground).offsetHSL(0, 0.05, 0.06).getStyle()))
      lot.rotation.x = -Math.PI / 2; lot.position.set(cx, 0.02, -cz)
      lot.scale.set(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1); g.add(lot)
      for (const it of p.items) g.add(place(assetMesh(it), it))
      for (const f of p.fences) for (let i = 0; i + 3 < f.pts.length; i += 2) {
        const [x0, z0, x1, z1] = [f.pts[i], f.pts[i + 1], f.pts[i + 2], f.pts[i + 3]]
        const len = Math.hypot(x1 - x0, z1 - z0)
        const wall = /Stone|Brick|Tin|Concrete/.test(f.guid)
        const m = new Mesh(new BoxGeometry(len, wall ? 1.4 : 1.1, wall ? 0.4 : 0.12), mat(wall ? KIND_COL.wall : KIND_COL.fence))
        m.position.set((x0 + x1) / 2, wall ? 0.7 : 0.55, -(z0 + z1) / 2)
        m.rotation.y = Math.atan2(z1 - z0, x1 - x0); g.add(m)
      }
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove() },
  }
}
