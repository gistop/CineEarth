// Scene assets store — metadata for dropped / imported files
// (glTF models, KML overlays, Excel point sheets).
// Pure state: nothing here touches Cesium (assetScene.ts does the loading).

import { create } from 'zustand'

export type AssetStatus = 'loading' | 'ready' | 'error'
export type AssetKind = 'model' | 'kml' | 'points' | 'shapefile'

export interface SceneAsset {
  id: string
  name: string
  /** which pipeline owns this asset */
  kind: AssetKind
  /** in-memory blob URL — nothing is written to disk */
  url: string
  visible: boolean
  status: AssetStatus
  error?: string
}

interface AssetState {
  assets: SceneAsset[]
  addAsset: (asset: SceneAsset) => void
  setAssetStatus: (id: string, status: AssetStatus, error?: string) => void
  setAssetVisible: (id: string, visible: boolean) => void
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

  dropAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
}))

export function createAssetId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
