// Types of maskPaint.mjs (plain JS so the node bridge imports it without a TS step)
export interface MaskSurface { name: string; minX?: number; minZ?: number; step: number; cols: number; rows: number; weights: ArrayLike<number> }
export interface MaskRoad { points: number[]; half: number; edge: number; core: string; side?: string }
export type MaskColours = Record<string, [number, number, number]> | null

export function roadLayers(side: number, mPerPx: number, roads: MaskRoad[]): Map<string, Float32Array>
export function sampler(s: MaskSurface): (x: number, z: number) => number
export function paintMasks(side: number, terrainSize: number, surfaces: MaskSurface[], roads?: MaskRoad[], colours?: MaskColours, blockPx?: number, margin?: number): { names: string[]; bytes: Uint8Array[] }
export function limitPixelBlocks(bytes: Uint8Array[], side: number, blockPx?: number, max?: number, margin?: number, cols?: ([number, number, number] | null)[] | null): void
export function enforcePixelBlocks(bytes: Uint8Array[], side: number, blockPx?: number, max?: number, margin?: number, cols?: ([number, number, number] | null)[] | null, tiny?: number, minShare?: number): void
