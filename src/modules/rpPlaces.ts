// RP places (Life / roleplay servers): the generator itself lays the places a Life server hooks onto, built from
// VANILLA prefabs only (the map stays vanilla). Source of the role list: Life Framework (LF_Workplace m_sJob values
// POLICE, MEDIC, LUMBERJACK, MINER, FARMER, FISHER, DELIVERY, FUEL_DELIVERY, PARCEL, TAXI) and the LF_Everon1989
// "Place_saint-philippe_*" layers (police, clinic, bank, market, carlot, garage, fuel, harbour, sawmill, farm, parked
// cars, bus/taxi). LF re-uses existing Everon buildings and only adds its own props: so each role below is a real
// Everon building (GUIDs from library/prefabs-catalogue.json), stamped as a small vanilla-site zone tagged `rpRole`.
// Hospital / town hall / bank have no dedicated vanilla prefab: Office_E_01 and large town houses stand in, as in LF.

import type { Grid } from './island'
import type { Road } from './roads'
import { roadHalf, isPaved } from './roads'
import { makeVanillaSite, makeLibraryParcel, zoneDisc, type ZoneItem } from './zones'
import { pickParcel, parcelTemplate } from '../library/parcelLib'
import type { VanillaTemplate, VanillaObject } from './vanillaSites'
import { SITE_RADIUS, type Site } from './network'
import { mulberry } from './vegLayers'
import { toWorld } from './gen-common'

export type RpRole =
  | 'police' | 'clinic' | 'town_hall' | 'bank' | 'market' | 'shop' | 'pub' | 'garage' | 'car_dealer' | 'bus_stop'
  | 'fuel' | 'fuel_depot' | 'sawmill' | 'lumber' | 'mine' | 'furnace' | 'fishing' | 'depot' | 'farm'
  | 'orchard' | 'beehive' | 'juicer' | 'distillery' | 'sell_point'

export const RP_ROLES: readonly RpRole[] = ['police', 'clinic', 'town_hall', 'bank', 'market', 'shop', 'pub', 'garage', 'car_dealer', 'bus_stop', 'fuel', 'fuel_depot', 'sawmill', 'lumber', 'mine', 'furnace', 'fishing', 'depot', 'farm', 'orchard', 'beehive', 'juicer', 'distillery', 'sell_point']

const P = {
  police: '{151CFDB2968ADB77}Prefabs/Structures/Houses/Villa/Villa_E_2I01/Villa_E_2I01_Police.et',
  office: '{51F233A0BA73532A}Prefabs/Structures/Industrial/Houses/Office_E_01/Office_E_01.et',
  townA: '{E7EC0E80F0645DFE}Prefabs/Structures/Houses/Town/House_Town_E_2I03/House_Town_E_2I03.et',
  townB: '{54F1C704EB440885}Prefabs/Structures/Houses/Town/House_Town_E_2I02/House_Town_E_2I02.et',
  townC: '{38A5F3E4578087AB}Prefabs/Structures/Houses/Town/House_Town_E_2I01/House_Town_E_2I01.et',
  shop: '{CFE8511B2B7E8AAA}Prefabs/Structures/Commercial/Shops/ShopModern_E_01/ShopModern_E_01.et',
  drug: '{FF48B5059EB0AC65}Prefabs/Structures/Commercial/Shops/ShopHouse_E_2l01/ShopHouse_E_2I01t_drugstore.et',
  pub: '{1B68F3EE279C97A1}Prefabs/Structures/Commercial/Pubs/PubVillage_E_2L01/PubVillage_E_2L01_V1.et',
  garageBig: '{80A5B37A1472B084}Prefabs/Structures/Industrial/Garages/Garage_E_02/Garage_E_02.et',
  garage: '{A548C1C5370D0734}Prefabs/Structures/Houses/Garage/Garage_E_01/Garage_E_01.et',
  workshop: '{BE70E3BA6C1911A9}Prefabs/Structures/Industrial/Houses/Warehouse_01/Warehouse_01_Workshop.et',
  warehouse: '{12310677867A85D4}Prefabs/Structures/Industrial/Houses/Warehouse_01/Warehouse_01.et',
  sawmill: '{1A18A755842DCA36}Prefabs/Structures/Industrial/Houses/Sawmill_E_01/Sawmill_E_01.et',
  woodPile: '{13FD3EC5D111AD6D}Prefabs/Props/Forest/WoodPile/WoodPile_01_A.et',
  plankPile: '{67B5336A6D63CCA4}Prefabs/Props/Construction/PlankPile/PlankPile_01_Medium.et',
  // CartSawmill_01_log is a rail log cart (vanilla: once, on SawmillRail_01 at Kolguyev): no longer laid on bare grass
  logEnd: '{2AE32F7E8BCF68EE}Prefabs/Props/Forest/WoodPile/WoodPile_01_End_A.et',
  log: '{5E317DC74EA1F1A4}Prefabs/Props/Forest/WoodPile/WoodLog_01_B.et',
  logScatter: '{1D1BBD7F52F71839}Prefabs/Props/Forest/WoodPile/WoodPile_02_scattered.et',
  tippler: '{8CBA9D089278A4D7}Prefabs/Structures/Industrial/CoalMineShaft_01/CoalMineShaft_USSR_01_tippler.et',
  shaftEnd: '{02128ED43CA97BCF}Prefabs/Structures/Industrial/CoalMineShaft_01/CoalMineShaft_USSR_01_end_buried.et',
  gravelL: '{19A3C48FC2665A3F}Prefabs/Props/Construction/GravelPile_01/GravelPile_01_large.et',
  gravelM: '{086E85DB687EA38F}Prefabs/Props/Construction/GravelPile_01/GravelPile_01_medium.et',
  sand: '{DEB57429CD49782D}Prefabs/Props/Construction/GravelPile_01/SandPile_01.et',
  stall: '{D8B83A318AE3611E}Prefabs/Props/Commercial/MarketStand_01.et',
  stallU: '{2DAC8D663D5F3E2E}Prefabs/Props/Commercial/MarketStand_01_Umbrella.et',
  column: '{F0E03780C850866F}Prefabs/Structures/Commercial/PosterColumn_01.et',
  bench: '{5BAA975FE04E94EF}Prefabs/Props/Civilian/BenchStreet/StreetBench_01/BenchStreet_01_green.et',
  lamp: '{0E3533EE196F01EC}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_01/LampStreet_E_01_6m.et',
  busShed: '{97380F89AA02D20B}Prefabs/Structures/Infrastructure/Bus/BusShed_E_01/BusShed_E_01_blue.et',
  kerb: '{59886E834739DCA2}Prefabs/Structures/Infrastructure/Pavements/ConcreteKerb_01/ConcreteKerb_01_2m_v2.et',
  pallet: '{1112756E8A13445B}Prefabs/Props/Industrial/Pallets/Pallet_01_Pile.et',
  apple: '{1C6F9AD2669C17F9}Prefabs/Vegetation/Tree/t_malus_domestica/t_malus_domestica_2s.et',
  plum: '{CEFEBF266E7040A9}Prefabs/Vegetation/Tree/t_prunus_domestica/t_prunus_domestica_2s.et',
  hive: '{8ED9082B6DDF1815}Prefabs/Props/Agriculture/Beehive_01/Beehive_01_yellow.et',
  hiveB: '{E3A2574E3BC3935C}Prefabs/Props/Agriculture/Beehive_01/Beehive_01_blue.et',
  hiveStack: '{49E2D1A3DE5ED007}Prefabs/Props/Agriculture/Beehive_01/Beehive_01_stack.et',
  barnOpen: '{66F1A0049CC2F5BD}Prefabs/Structures/Agriculture/Barn/Barn_E_03/Barn_E_03_open.et',
  barn: '{F5A2DC0597B53E19}Prefabs/Structures/Agriculture/Barn/Barn_E_02/Barn_E_02.et',
  stoveInd: '{1D8BBCA16BD4FAEC}Prefabs/Props/Industrial/StoveIndustrial_01/StoveIndustrial_01.et',
} as const

const o = (p: string, dx: number, dz: number, yaw = 0): VanillaObject => ({ p, dx, dz, yaw })
/** parking bays: kerb rows (2 m kerbs) across the lot, +Z = road side */
function bays(dx0: number, dz0: number, rows: number, len: number): VanillaObject[] {
  const out: VanillaObject[] = []
  for (let r = 0; r < rows; r++) for (let k = 0; k < len / 2; k++) out.push(o(P.kerb, dx0 + k * 2 - len / 2 + 1, dz0 - r * 6, 0))
  return out
}

// local frame of vanilla_sites.json: +Z towards the access road, buildings set back (dz < 0); radius = footprint disc
const COMPOSE: Record<string, { radius: number; objects: VanillaObject[] }> = {
  police: { radius: 16, objects: [o(P.police, 0, -4), o(P.garage, 12, -4, 90), o(P.lamp, -8, 9)] },
  clinic: { radius: 15, objects: [o(P.office, 0, -4), o(P.bench, -7, 6), o(P.lamp, 7, 9)] },
  town_hall: { radius: 15, objects: [o(P.townA, 0, -3), o(P.column, 8, 8), o(P.bench, -6, 7), o(P.bench, -2, 7)] },
  bank: { radius: 13, objects: [o(P.townB, 0, -3), o(P.lamp, 8, 8)] },
  market: { radius: 16, objects: [o(P.stall, -9, 0), o(P.stallU, -4.5, 0), o(P.stall, 0, 0), o(P.stallU, 4.5, 0), o(P.stall, 9, 0), o(P.stallU, -6, -7, 180), o(P.stall, 0, -7, 180), o(P.stallU, 6, -7, 180), o(P.column, 12, 8), o(P.bench, -12, 8), o(P.lamp, 12, -10), o(P.lamp, -12, -10)] },
  shop: { radius: 15, objects: [o(P.shop, 0, -5), ...bays(0, 9, 1, 12)] },
  pub: { radius: 12, objects: [o(P.pub, 0, -2), o(P.bench, 9, 8)] },
  garage: { radius: 18, objects: [o(P.garageBig, 0, -5), ...bays(0, 11, 1, 16)] },
  car_dealer: { radius: 18, objects: [o(P.workshop, -10, -9), o(P.garage, 2, -9, 90), ...bays(4, 8, 3, 18)] },
  bus_stop: { radius: 4, objects: [o(P.busShed, 0, 0)] },
  sawmill: { radius: 26, objects: [o(P.sawmill, 0, -6), o(P.woodPile, -20, 6, 90), o(P.woodPile, -20, -4, 90), o(P.plankPile, 18, 6), o(P.plankPile, 18, -2), o(P.logEnd, 10, 14), o(P.log, 13, 14)] }, // fallback when the library has no vanilla sawmill
  mine: { radius: 22, objects: [o(P.tippler, 0, -10), o(P.shaftEnd, 0, -18), o(P.gravelL, -12, 2), o(P.gravelM, 10, 3), o(P.sand, 12, -8), o(P.workshop, -12, -12)] },
  lumber: { radius: 12, objects: [o(P.woodPile, -6, 0, 90), o(P.woodPile, -2, 0, 90), o(P.woodPile, 2, 0, 90), o(P.logEnd, 7, 4, 90), o(P.log, 7, 0), o(P.logScatter, -1, 5)] },
  furnace: { radius: 9, objects: [o(P.workshop, 0, -2), o(P.stoveInd, 0, 6), o(P.gravelM, -6, 5)] },
  orchard: { radius: 19, objects: [...[-14, -7, 0, 7, 14].flatMap((dx, i) => [-12, -5, 2, 9].map((dz, j) => o((i + j) % 3 ? P.apple : P.plum, dx, dz, (i * 47 + j * 83) % 360)))] },
  beehive: { radius: 8, objects: [o(P.hive, -4, 0), o(P.hiveB, -1.5, 0), o(P.hive, 1, 0), o(P.hiveB, 3.5, 0), o(P.hiveStack, 0, -4)] },
  juicer: { radius: 12, objects: [o(P.barnOpen, 0, -3), o(P.pallet, 7, 6), o(P.pallet, 9, 6)] },
  distillery: { radius: 12, objects: [o(P.barn, 0, -3), o(P.stoveInd, 7, 6)] },
  sell_point: { radius: 7, objects: [o(P.stallU, -2.5, 0), o(P.stall, 2.5, 0), o(P.column, 5, 4)] },
  depot: { radius: 24, objects: [o(P.warehouse, 0, -8), o(P.pallet, -14, 8), o(P.pallet, -11, 8), o(P.pallet, 12, 8), ...bays(0, 14, 1, 14)] },
}

/** template from a composition: same shape as data/templates/vanilla_sites.json so zones.makeVanillaSite stamps it */
export function rpTemplate(role: string): VanillaTemplate | null {
  const c = COMPOSE[role]
  if (!c) return null
  return { id: `rp_${role}`, map: 'rp', x: 0, z: 0, axisYaw: 0, roadDist: 0, roadType: '', radius: c.radius, slope: 0, objects: c.objects } as unknown as VanillaTemplate
}
export const rpPrefabs = (): string[] => [...new Set(Object.values(COMPOSE).flatMap((c) => c.objects.map((q) => q.p)))]

/** how many of each role a settlement / the map gets (relative rules) */
export function rpCounts(towns: number, villages: number, landKm2: number, industry: number) {
  const perMap = (km2: number) => Math.max(1, Math.round(landKm2 / km2))
  return {
    town: ['police', 'clinic', 'town_hall', 'bank', 'market', 'shop', 'garage', 'car_dealer', 'bus_stop'] as RpRole[], // each town
    village: ['pub', 'bus_stop'] as RpRole[], // each village (shop/pub = general store)
    sawmill: perMap(60), mine: perMap(90), depot: Math.max(1, Math.min(industry || 1, perMap(50))),
    // a map with no town still needs one police / clinic / garage: they go to the biggest village
    fallback: towns === 0 && villages > 0,
  }
}

export interface RpContext {
  heights: number[]
  g: Grid
  sites: Site[]
  zones: ZoneItem[]
  roads: Road[]
  isWater: (x: number, z: number) => boolean
  seed: number
  landKm2: number
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}
/** distance from a point to the road's edge (negative = on the carriageway) */
export function roadClearance(x: number, z: number, roads: Road[]): number {
  let best = Infinity
  for (const r of roads) {
    const h = roadHalf(r), p = r.pts
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.abs(p[i] - x) > 400 && Math.abs(p[i + 2] - x) > 400) continue
      best = Math.min(best, segDist(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]) - h)
    }
  }
  return best
}

/** tags the RP role of the zones other stages made (vanilla gas stations, ports, bus stops, fuel depots) */
export function tagExistingRp(zones: ZoneItem[]): void {
  for (const zn of zones) {
    if (zn.rpRole) continue
    const s = zn.sub ?? ''
    if (s.startsWith('vanilla:gas_station')) zn.rpRole = 'fuel'
    else if (s.startsWith('vanilla:port')) zn.rpRole = 'fishing'
    else if (s.startsWith('vanilla:bus_stop')) zn.rpRole = 'bus_stop'
    else if (s.startsWith('vanilla:fuel_depot')) zn.rpRole = 'fuel_depot'
  }
}

/** lays every missing RP place; returns the new zones (the caller pushes them before the villages so lots avoid them) */
export function placeRpPlaces(c: RpContext): ZoneItem[] {
  const { g, sites, roads, isWater } = c
  tagExistingRp(c.zones)
  const out: ZoneItem[] = []
  const all = () => [...c.zones, ...out]
  const lines = roads.filter((r) => r.pts.length >= 4)
  const paved = lines.filter((r) => isPaved(r.type))
  const discs = () => all().map((zn) => zoneDisc(zn))
  const slopeAt = (x: number, z: number) => {
    const cc = Math.round((x - g.minX) / g.step), rr = Math.round((z - g.minZ) / g.step)
    if (cc < 1 || rr < 1 || cc >= g.cols - 1 || rr >= g.rows - 1) return 0
    const h = c.heights, i = rr * g.cols + cc
    return Math.hypot(h[i + 1] - h[i - 1], h[i + g.cols] - h[i - g.cols]) / (2 * g.step)
  }
  const ok = (x: number, z: number, r: number, gapOwn = 6) => {
    for (let a = 0; a < 8; a++) { const q = (a / 8) * Math.PI * 2; if (isWater(x + Math.cos(q) * r, z + Math.sin(q) * r)) return false }
    if (isWater(x, z) || c.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)] <= 0.5) return false
    if (discs().some((d) => Math.hypot(d.x - x, d.z - z) < d.r + r + gapOwn)) return false
    return roadClearance(x, z, roads) > r * 0.9 // the whole footprint disc stays off every carriageway
  }
  const count: Record<string, number> = {}
  const place = (role: RpRole, list: Road[], seed: number, accept: (x: number, z: number) => boolean, score?: (x: number, z: number) => number): ZoneItem | null => {
    // sawmill: a whole vanilla sawmill yard of the parcel library (industrial/sawmill, harvested from Everon and
    // Kolguyev: mill, log piles, plank stacks, rails, fences, crates) laid as a box, its entrance (+Z) on the road
    const parcel = role === 'sawmill' ? pickParcel('industrial', { subtype: 'sawmill', seed }) : null
    const tpl = parcel ? parcelTemplate(parcel) : rpTemplate(role)
    if (!tpl || !list.length) return null
    const hw = parcel ? parcel.size.w / 2 : tpl.radius, hd = parcel ? parcel.size.d / 2 : tpl.radius
    const okBox = (x: number, z: number, yaw: number) => { // the whole yard box: dry land, off every carriageway, clear of other zones
      if (discs().some((d) => Math.hypot(d.x - x, d.z - z) < d.r + Math.max(hw, hd) + 8)) return false
      if (c.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)] <= 0.5) return false
      for (let u = -hw; u <= hw + 0.1; u += Math.max(4, hw / 6)) for (let v = -hd; v <= hd + 0.1; v += Math.max(4, hd / 6)) {
        const [px, pz] = toWorld(x, z, yaw, u, v)
        if (isWater(px, pz) || roadClearance(px, pz, roads) < 1.5) return false
      }
      return true
    }
    const fits = (x: number, z: number, yaw: number) => (parcel ? okBox(x, z, yaw) : ok(x, z, tpl.radius))
    const rnd = mulberry(seed)
    let best: { x: number; z: number; yaw: number; s: number } | null = null
    const tries = score ? 400 : 160
    for (let t = 0; t < tries; t++) {
      const rd = list[Math.floor(rnd() * list.length)]
      const i = Math.floor(rnd() * (rd.pts.length / 2 - 1)) * 2
      const ax = rd.pts[i], az = rd.pts[i + 1], dx = rd.pts[i + 2] - ax, dz = rd.pts[i + 3] - az, len = Math.hypot(dx, dz)
      if (len < 1) continue
      const side = rnd() < 0.5 ? 1 : -1, nx = (-dz / len) * side, nz = (dx / len) * side, f = rnd()
      const off = roadHalf(rd) + hd + 3 // footprint edge 3 m off the verge: reached straight from the road
      const x = ax + dx * f + nx * off, z = az + dz * f + nz * off
      const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI // +Z of the template towards the road
      if (!accept(x, z) || !fits(x, z, yaw)) continue
      const s = score ? score(x, z) : 0
      if (!best || s > best.s) best = { x, z, yaw, s }
      if (!score) break
    }
    if (!best) return null
    count[role] = (count[role] ?? 0) + 1
    const id = `RP_${role.toUpperCase()}_${count[role]}`
    const zn = parcel ? makeLibraryParcel(c.heights, g, { id, parcel, x: best.x, z: best.z, yaw: best.yaw, seed }) // flat yard on the box
      : makeVanillaSite(c.heights, g, { id, type: 'rp', x: best.x, z: best.z, yaw: best.yaw, seed, template: tpl })
    if (!zn) return null
    zn.sub = `rp:${role}`
    zn.rpRole = role
    out.push(zn)
    return zn
  }
  const ring = (s: Site, r0: number, r1: number) => (x: number, z: number) => { const d = Math.hypot(x - s.x, z - s.z); return d >= r0 && d <= r1 }
  const near = (s: Site, R: number) => lines.filter((r) => { for (let i = 0; i < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - s.x, r.pts[i + 1] - s.z) < R) return true; return false })
  const towns = sites.filter((s) => s.kind === 'town'), villages = sites.filter((s) => s.kind === 'village' && !s.id.startsWith('FARM_'))
  const n = rpCounts(towns.length, villages.length, c.landKm2, c.zones.filter((z) => z.kind === 'industrial').length)
  let k = 0
  const townSet = (s: Site, roles: RpRole[], R: number) => {
    const rl = near(s, R + 200)
    for (const role of roles) {
      // in-town roles first on the inner ring (the town layout then builds around them), else on the edge
      place(role, rl, c.seed + 31 * ++k, ring(s, R * 0.35, R + 60)) ?? place(role, rl, c.seed + 31 * ++k, ring(s, R * 0.2, R + 180))
    }
  }
  for (const s of towns) townSet(s, n.town, SITE_RADIUS.town)
  if (n.fallback) {
    const big = villages[0]
    if (big) townSet(big, ['police', 'clinic', 'garage', 'market'], SITE_RADIUS.village)
  }
  for (const s of villages) {
    const R = SITE_RADIUS.village
    for (const role of n.village) {
      if (role === 'bus_stop' && all().some((z) => z.rpRole === 'bus_stop' && Math.hypot(z.x - s.x, z.z - s.z) < R + 150)) continue
      place(role, near(s, R + 150), c.seed + 31 * ++k, ring(s, R * 0.3, R + 120))
    }
  }
  // countryside: far from places; sawmill where it is wooded-looking (moderate slope, away from towns),
  // mine on the steepest reachable road side, depot by an industrial zone (else a town's outskirts), fuel on main roads
  const awayFromPlaces = (m: number) => (x: number, z: number) => !sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS[s.kind] + m)
  const rough = (x: number, z: number) => { let s = 0; for (let a = 0; a < 6; a++) { const q = (a / 6) * Math.PI * 2; s += slopeAt(x + Math.cos(q) * 40, z + Math.sin(q) * 40) } return s }
  for (let i = 0; i < n.sawmill; i++) place('sawmill', lines, c.seed + 7001 + i, awayFromPlaces(250), (x, z) => -Math.abs(rough(x, z) / 6 - 0.08)) // gently sloped ground (forest country)
  for (let i = 0; i < n.mine; i++) place('mine', lines, c.seed + 8001 + i, awayFromPlaces(400), (x, z) => rough(x, z) + slopeAt(x, z) * 2)
  const ind = c.zones.filter((z) => z.kind === 'industrial')
  for (let i = 0; i < n.depot; i++) {
    const anchor = ind[i % Math.max(1, ind.length)] ?? towns[i % Math.max(1, towns.length)] ?? sites[0]
    if (!anchor) break
    const R = ind.length ? zoneDisc(anchor as ZoneItem).r : SITE_RADIUS.town
    place('depot', lines, c.seed + 9001 + i, (x, z) => { const d = Math.hypot(x - anchor.x, z - anchor.z); return d > R * 0.5 && d < R + 400 })
  }
  // ores: the mines cycle iron / copper / gold (zone.sub rp:mine:<ore>); a furnace near each mine
  const mines = out.filter((z) => z.rpRole === 'mine')
  mines.forEach((m, i) => { m.sub = 'rp:mine:' + ['iron', 'copper', 'gold'][i % 3] })
  mines.forEach((m, i) => place('furnace', lines, c.seed + 8501 + i, (x, z) => { const d = Math.hypot(x - m.x, z - m.z); return d > 30 && d < 500 }))
  // lumber camps on the remote road sides (the forests grow there after this stage, the camp is kept clear)
  for (let i = 0; i < n.sawmill + 1; i++) place('lumber', lines, c.seed + 7501 + i, awayFromPlaces(350))
  // village economy: an orchard + beehives + a juicer per few villages, a distillery per town, a sell point per village
  villages.forEach((s, i) => {
    const R = SITE_RADIUS.village, rl = near(s, R + 400), rim = ring(s, R + 20, R + 380)
    if (i % 2 === 0) { place('orchard', rl, c.seed + 9501 + i, rim); place('beehive', rl, c.seed + 9601 + i, rim) }
    if (i % 3 === 0) place('juicer', rl, c.seed + 9701 + i, rim)
    place('sell_point', near(s, R + 150), c.seed + 9801 + i, ring(s, R * 0.3, R + 120))
  })
  towns.forEach((s, i) => { place('distillery', near(s, SITE_RADIUS.town + 400), c.seed + 9901 + i, ring(s, SITE_RADIUS.town * 0.6, SITE_RADIUS.town + 300)); place('sell_point', near(s, SITE_RADIUS.town + 200), c.seed + 9951 + i, ring(s, SITE_RADIUS.town * 0.35, SITE_RADIUS.town + 60)) })
  if (!all().some((z) => z.rpRole === 'orchard')) for (const s of [...villages, ...towns].slice(0, 1)) { place('orchard', near(s, 600), c.seed + 9991, ring(s, SITE_RADIUS[s.kind] + 20, SITE_RADIUS[s.kind] + 450)); place('beehive', near(s, 600), c.seed + 9992, ring(s, SITE_RADIUS[s.kind] + 20, SITE_RADIUS[s.kind] + 450)) }
  if (!all().some((z) => z.rpRole === 'fuel')) { // no vanilla gas station stage: one stamped Bohemia station on a main road
    const fn = Math.max(1, Math.round(c.landKm2 / 40))
    for (let i = 0; i < fn; i++) {
      const tplSeed = c.seed + 6001 + i
      const rnd = mulberry(tplSeed), list = paved.length ? paved : lines
      for (let t = 0; t < 200 && list.length; t++) {
        const rd = list[Math.floor(rnd() * list.length)], j = Math.floor(rnd() * (rd.pts.length / 2 - 1)) * 2
        const ax = rd.pts[j], az = rd.pts[j + 1], dx = rd.pts[j + 2] - ax, dz = rd.pts[j + 3] - az, len = Math.hypot(dx, dz)
        if (len < 1) continue
        const side = rnd() < 0.5 ? 1 : -1, nx = (-dz / len) * side, nz = (dx / len) * side, off = roadHalf(rd) + 20
        const x = ax + dx * 0.5 + nx * off, z = az + dz * 0.5 + nz * off
        if (!awayFromPlaces(80)(x, z) || !ok(x, z, 18, 200)) continue
        const zn = makeVanillaSite(c.heights, g, { id: `RP_FUEL_${i + 1}`, type: 'gas_station', x, z, yaw: (Math.atan2(-nx, -nz) * 180) / Math.PI, seed: tplSeed, fit: (q) => q.radius <= 32 })
        if (!zn) break
        zn.sub = 'rp:fuel'; zn.rpRole = 'fuel'; out.push(zn)
        break
      }
    }
  }
  // farms: FARM_ sites of the settlement stage (farmyards + fields) are the FARMER places; parking: every lot with bays
  return out
}

/** every RP place of a world: zones with rpRole + the farm sites */
export function rpPlacesOf(w: { zones: ZoneItem[]; sites: Site[] }): { role: RpRole; id: string; x: number; z: number; r: number }[] {
  const out = w.zones.filter((z) => z.rpRole).map((z) => ({ role: z.rpRole as RpRole, id: z.id, x: z.x, z: z.z, r: zoneDisc(z).r }))
  for (const s of w.sites) if (s.id.startsWith('FARM_')) out.push({ role: 'farm', id: s.id, x: s.x, z: s.z, r: SITE_RADIUS[s.kind] })
  return out
}
