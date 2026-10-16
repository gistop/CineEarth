// Data-source store — WHICH imagery/terrain service feeds every viewport.
// Pure state, localStorage-persisted, same privacy contract as ionTokenStore
// (keys never leave the browser except directly to their own service).
//  · imagery: 'ion'  — Cesium World Imagery (Bing aerial) via ion;
//                     shared evaluation token works, a personal one lifts quota
//             'esri' — ArcGIS World Imagery, public, no key
//             'tdt'  — Tianditu satellite + Chinese labels, free key REQUIRED
//  · terrain: 'ion'      — Cesium World Terrain (same token story as above)
//             'arcgis'   — Esri WorldElevation3D/Terrain3D, no key, has bathymetry
//             'ellipsoid'— flat sphere, zero network
// Glue lives in ionTerrain.ts — nothing here imports Cesium.

import { create } from 'zustand'

export type ImagerySource = 'ion' | 'esri' | 'tdt'
export type TerrainSource = 'ion' | 'arcgis' | 'ellipsoid'
export type SourceState = 'idle' | 'loading' | 'missing-key' | 'failed'

const IMAGERY_KEY = 'cineearth.imagerySource'
const TERRAIN_KEY = 'cineearth.terrainSource'
const TDT_KEY = 'cineearth.tdtKey'
/** pre-picker legacy key — "terrain off" used to be a bare checkbox */
const OLD_TERRAIN_ENABLED_KEY = 'cineearth.terrainEnabled'

interface DataSourceState {
  imagery: ImagerySource
  terrain: TerrainSource
  tdtKey: string
  imageryState: SourceState
  terrainState: SourceState

  setImagery: (s: ImagerySource) => void
  setTerrain: (s: TerrainSource) => void
  setTdtKey: (k: string) => void
  setImageryState: (s: SourceState) => void
  setTerrainState: (s: SourceState) => void
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback // private mode / storage disabled
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — keep it in-memory only */
  }
}

const IMAGERY_IDS: ImagerySource[] = ['ion', 'esri', 'tdt']
const TERRAIN_IDS: TerrainSource[] = ['ion', 'arcgis', 'ellipsoid']

function initialImagery(): ImagerySource {
  const v = readStored(IMAGERY_KEY, 'ion')
  return IMAGERY_IDS.includes(v as ImagerySource) ? (v as ImagerySource) : 'ion'
}

function initialTerrain(): TerrainSource {
  const v = readStored(TERRAIN_KEY, '')
  if (TERRAIN_IDS.includes(v as TerrainSource)) return v as TerrainSource
  /* migrate the old checkbox: explicit "off" meant a flat ellipsoid */
  return readStored(OLD_TERRAIN_ENABLED_KEY, '1') === '0' ? 'ellipsoid' : 'ion'
}

export const useDataSource = create<DataSourceState>((set) => ({
  imagery: initialImagery(),
  terrain: initialTerrain(),
  tdtKey: readStored(TDT_KEY, ''),
  imageryState: 'idle',
  terrainState: 'idle',

  setImagery: (imagery) => {
    writeStored(IMAGERY_KEY, imagery)
    set({ imagery })
  },
  setTerrain: (terrain) => {
    writeStored(TERRAIN_KEY, terrain)
    set({ terrain })
  },
  setTdtKey: (tdtKey) => {
    writeStored(TDT_KEY, tdtKey)
    set({ tdtKey })
  },
  setImageryState: (imageryState) => set({ imageryState }),
  setTerrainState: (terrainState) => set({ terrainState }),
}))
