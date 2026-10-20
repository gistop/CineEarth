// Scene assets store — metadata for dropped / imported files
// (glTF models, KML overlays, Excel point sheets) and drawn ground lines.
// Pure state: nothing here touches Cesium (assetScene.ts does the loading).

import { create } from 'zustand'

export type AssetStatus = 'loading' | 'ready' | 'error'
export type AssetKind = 'model' | 'kml' | 'points' | 'shapefile' | 'line'

/** extruded cross-sections swept along the drawn path (polyline volumes) */
export type LineSection =
  | 'none'
  | 'circle'
  | 'square'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'

/** style knobs for drawn lines — edited in the expandable row panel */
export interface LineStyle {
  color: string
  width: number
  dashed: boolean
  opacity: number
  clamped: boolean
  /** 'none' = flat polyline; anything else extrudes a volume along the path */
  section: LineSection
  /** cross-section size in metres (diameter / edge / long axis) */
  sectionSize: number
  /** width : height ratio — rectangle & ellipse only */
  sectionAspect: number
  /** lift the whole volume above the sampled ground (metres) */
  lift: number
}

/** native line geometry (no file behind it — url stays empty).
    Heights are the terrain samples captured while drawing — volumes need
    real elevations (they cannot clamp to ground like polylines). */
export interface LineData {
  positions: { lon: number; lat: number; height: number }[]
  style: LineStyle
}

/** amber reads on every theme (light fjord / dark) and echoes GES route yellow */
export const DEFAULT_LINE_STYLE: LineStyle = {
  color: '#f2b544',
  width: 3,
  dashed: false,
  opacity: 1,
  clamped: true,
  section: 'none',
  sectionSize: 6,
  sectionAspect: 2,
  lift: 0,
}

export interface SceneAsset {
  id: string
  name: string
  /** which pipeline owns this asset */
  kind: AssetKind
  /** in-memory blob URL — nothing is written to disk (empty for drawn lines) */
  url: string
  visible: boolean
  status: AssetStatus
  error?: string
  /** present iff kind === 'line' */
  line?: LineData
}

interface AssetState {
  assets: SceneAsset[]
  addAsset: (asset: SceneAsset) => void
  setAssetStatus: (id: string, status: AssetStatus, error?: string) => void
  setAssetVisible: (id: string, visible: boolean) => void
  updateLineStyle: (id: string, patch: Partial<LineStyle>) => void
  dropAsset: (id: string) => void
}

export const useAssets = create<AssetState>((set) => ({
  assets: [],

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  setAssetStatus: (id, status, error) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, status, error } : a)),
    })),

  setAssetVisible: (id, visible) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, visible } : a)),
    })),

  updateLineStyle: (id, patch) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id && a.line ? { ...a, line: { ...a.line, style: { ...a.line.style, ...patch } } } : a,
      ),
    })),

  dropAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
}))

export function createAssetId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
