// Data-source glue — bridges the pure stores (ion token + service pickers)
// to Cesium globals & the live viewer. One place decides WHAT the globe is
// made of; every viewport just subscribes (imagerySource / terrainSource).
//
// Imagery services:
//  · ion  — Cesium World Imagery (Bing aerial) via ion. Works on CesiumJS's
//           bundled evaluation token; a verified personal token lifts quota
//           (token flow identical to before — see ionTokenStore)
//  · esri — ArcGIS World Imagery, public service, no key
//  · tdt  — Tianditu WMTS satellite + Chinese label overlay, free key required
// Terrain services:
//  · ion      — Cesium World Terrain (same token story as ion imagery)
//  · arcgis   — Esri WorldElevation3D/Terrain3D, public, no key, has bathymetry
//  · ellipsoid— flat sphere, zero network
//
// ion resources are re-created whenever the active token changes — ion
// resolves a resource's credits (including the "default token" notice) from
// the token in play at creation time, so an old resource keeps showing it.

import {
  ArcGisMapServerImageryProvider,
  ArcGISTiledElevationTerrainProvider,
  EllipsoidTerrainProvider,
  Ion,
  IonWorldImageryStyle,
  WebMapTileServiceImageryProvider,
  createWorldImageryAsync,
  createWorldTerrainAsync,
  type ImageryProvider,
} from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { setImageryProviders } from '../../cesium/imagerySource'
import { setTerrainProvider } from '../../cesium/terrainSource'
import { useIon } from './ionTokenStore'
import { useDataSource } from './dataSourceStore'

/** asset 2 = Cesium World Imagery (asset 1 = World Terrain); any asset endpoint
    doubles as a token check — it answers 401/403 for a bad key */
const TERRAIN_ASSET = 2

/** CesiumJS ships a shared evaluation token — capture it before any assignment */
const DEFAULT_ION_TOKEN = Ion.defaultAccessToken

/* ── keyless public services ────────────────────────────────
   server.arcgisonline.com is the SAME service as services.arcgisonline.com;
   the old host is kept because the new one is unreachable on some networks. */
const ESRI_WORLD_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
const ESRI_WORLD_ELEVATION_URL =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'

const TIANDITU_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

/** Tianditu WMTS layer — img = satellite tiles, cia = Chinese label overlay */
function tiandituLayer(layer: 'img' | 'cia', key: string): ImageryProvider {
  return new WebMapTileServiceImageryProvider({
    url: `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?service=wmts&request=GetTile&version=1.0.0&LAYER=${layer}&tileMatrixSet=w&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}&style=default&format=tiles&tk=${encodeURIComponent(key)}`,
    subdomains: TIANDITU_SUBDOMAINS,
    layer,
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    maximumLevel: 18,
  })
}

export function applyIonToken(token: string): void {
  Ion.defaultAccessToken = token
}

export async function verifyIonToken(token: string): Promise<'valid' | 'invalid' | 'unknown'> {
  try {
    const res = await fetch(
      `https://api.cesium.com/v1/assets/${TERRAIN_ASSET}/endpoint?access_token=${encodeURIComponent(token)}`,
    )
    if (res.ok) return 'valid'
    if (res.status === 401 || res.status === 403) return 'invalid'
    return 'unknown'
  } catch {
    return 'unknown' // network blocked — cannot conclude
  }
}

/**
 * Which token drives ion right now: the user's (only once verified)
 * or the bundled default. During verification we stay on the default so
 * the globe never flickers flat.
 */
function resolveActiveToken(): string {
  const { token, status } = useIon.getState()
  if (token && status === 'valid') return token
  return DEFAULT_ION_TOKEN
}

let terrainSeq = 0
let lastTerrainMode = ''
let lastTerrainKey = ''

/** Push store state → viewer terrain provider. Safe to call at any time. */
export async function syncTerrain(): Promise<void> {
  const seq = ++terrainSeq
  const viewer = getViewer()
  if (!viewer) return

  const { terrain } = useDataSource.getState()
  const ds = useDataSource.getState()
  const tokenKey = terrain === 'ion' ? resolveActiveToken() : '-'

  // no-op guard: re-verification / re-picks must not flicker the globe
  if (terrain === lastTerrainMode && tokenKey === lastTerrainKey) return
  ds.setTerrainState('loading')

  try {
    if (terrain === 'ion') {
      applyIonToken(tokenKey)
      const provider = await createWorldTerrainAsync()
      if (seq !== terrainSeq) return // superseded by a newer sync
      setTerrainProvider(provider)
    } else if (terrain === 'arcgis') {
      const provider = await ArcGISTiledElevationTerrainProvider.fromUrl(ESRI_WORLD_ELEVATION_URL)
      if (seq !== terrainSeq) return
      setTerrainProvider(provider)
    } else {
      setTerrainProvider(new EllipsoidTerrainProvider())
    }
    if (seq !== terrainSeq) return
    lastTerrainMode = terrain
    lastTerrainKey = tokenKey
    ds.setTerrainState('idle')
  } catch (err) {
    console.error('[CineEarth] terrain source failed — keeping the current terrain', err)
    if (seq === terrainSeq) ds.setTerrainState('failed')
  }
}

let imagerySeq = 0
let lastImageryKey = '\u0000' // sentinel — never equal to a real key

/**
 * Push store state → the SHARED imagery source (see cesium/imagerySource).
 * The provider stack goes through setImageryProviders(), which re-dials
 * EVERY viewport (main globe + panes) — panes never capture a stale source
 * just because they were created before the service resolved.
 */
export async function syncImagery(): Promise<void> {
  const { imagery, tdtKey } = useDataSource.getState()
  // a key-requiring service without its key switches nothing — the panel
  // shows the key input and this stays a no-op until one is saved
  const identity = imagery === 'tdt' ? `tdt:${tdtKey}` : imagery === 'ion' ? `ion:${resolveActiveToken()}` : imagery
  if (identity === lastImageryKey) return

  const ds = useDataSource.getState()
  if (imagery === 'tdt' && !tdtKey) {
    ds.setImageryState('missing-key')
    return
  }

  const seq = ++imagerySeq
  ds.setImageryState('loading')
  try {
    let providers: ImageryProvider[]
    if (imagery === 'tdt') {
      providers = [tiandituLayer('img', tdtKey), tiandituLayer('cia', tdtKey)]
    } else if (imagery === 'esri') {
      providers = [await ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY_URL)]
    } else {
      applyIonToken(resolveActiveToken()) // the layer must be requested with the active token
      providers = [await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL })]
    }
    if (seq !== imagerySeq) return // superseded by a newer sync
    /* broadcast: viewports not yet created read it on construction */
    setImageryProviders(providers)
    lastImageryKey = identity
    ds.setImageryState('idle')
  } catch (err) {
    console.error('[CineEarth] imagery source failed — keeping the current imagery', err)
    if (seq === imagerySeq) ds.setImageryState('failed')
  }
}

/** Save the Tianditu key, then re-dial imagery (the only service using it). */
export async function saveTdtKey(raw: string): Promise<void> {
  useDataSource.getState().setTdtKey(raw.trim())
  await syncImagery()
}

/** Terrain then imagery — the order matters: terrain sync is what applies the token. */
async function syncDataSources(): Promise<void> {
  await syncTerrain()
  await syncImagery()
}

/** Save button flow: persist → verify → (terrain switches quota on success). */
export async function saveIonToken(raw: string): Promise<void> {
  const token = raw.trim()
  if (!token) {
    await clearIonToken()
    return
  }
  useIon.getState().setToken(token)
  const verdict = await verifyIonToken(token)
  useIon.getState().setStatus(verdict)
  await syncDataSources()
}

export async function clearIonToken(): Promise<void> {
  useIon.getState().resetToken()
  await syncDataSources()
}

/**
 * App startup: terrain on the bundled token right away, then quietly re-verify
 * a stored token. Imagery is built LAST so it is created with the final token —
 * building it first would bake the default-token notice into the layer.
 */
export async function bootstrapIonSettings(): Promise<void> {
  await syncTerrain()

  const { token } = useIon.getState()
  if (token) {
    useIon.getState().setStatus('checking')
    const verdict = await verifyIonToken(token)
    useIon.getState().setStatus(verdict)
    await syncTerrain()
  }

  await syncImagery()
}
