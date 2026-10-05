// Cesium ion glue — bridges the pure token store to Cesium globals & the live viewer.
// Terrain policy (out of the box):
//  · user token verified   → world terrain on the user's own ion quota
//  · no / failed token     → world terrain on CesiumJS's bundled evaluation token
//  · terrainEnabled off    → smooth ellipsoid
// Imagery: World Imagery (Bing aerial) replaces the OSM placeholder. Terrain AND
// imagery are re-created whenever the active token changes — ion resolves a
// resource's credits (including Cesium's "you are on the default token" notice)
// from the token in play at creation time, so an old resource keeps showing it.
// The bundled token is per-release and shared (HTTP 200 verified for asset 2);
// pasting a personal token lifts the shared quota automatically.

import {
  Ion,
  createWorldImageryAsync,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  IonWorldImageryStyle,
} from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useIon } from './ionTokenStore'

/** asset 2 = Cesium World Imagery (asset 1 = World Terrain); any asset endpoint
    doubles as a token check — it answers 401/403 for a bad key */
const TERRAIN_ASSET = 2

/** CesiumJS ships a shared evaluation token — capture it before any assignment */
const DEFAULT_ION_TOKEN = Ion.defaultAccessToken

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
 * Which token drives terrain right now: the user's (only once verified)
 * or the bundled default. During verification we stay on the default so
 * the globe never flickers flat.
 */
function resolveActiveToken(): string {
  const { token, status } = useIon.getState()
  if (token && status === 'valid') return token
  return DEFAULT_ION_TOKEN
}

let syncSeq = 0
let lastMode = ''
let lastTokenKey = ''

/** Push store state → viewer terrain provider. Safe to call at any time. */
export async function syncTerrain(): Promise<void> {
  const seq = ++syncSeq
  const viewer = getViewer()
  if (!viewer) return

  const { terrainEnabled } = useIon.getState()
  const mode = terrainEnabled ? 'world' : 'ellipsoid'
  const tokenKey = terrainEnabled ? resolveActiveToken() : '-'

  // no-op guard: re-verification / checkbox toggles must not flicker the globe
  if (mode === lastMode && tokenKey === lastTokenKey) return

  try {
    if (mode === 'world') {
      applyIonToken(tokenKey)
      const provider = await createWorldTerrainAsync()
      if (seq !== syncSeq) return // superseded by a newer sync
      viewer.terrainProvider = provider
    } else {
      viewer.terrainProvider = new EllipsoidTerrainProvider()
    }
    lastMode = mode
    lastTokenKey = tokenKey
  } catch (err) {
    console.error('[CineEarth] world terrain failed to load', err)
    if (seq === syncSeq) viewer.terrainProvider = new EllipsoidTerrainProvider()
    lastMode = 'ellipsoid'
    lastTokenKey = '-'
  }
}

let imagerySeq = 0
let lastImageryTokenKey = '\u0000' // sentinel — never equal to a real token key

/**
 * Push store state → viewer imagery layer. Re-created whenever the active token
 * changes: ion derives a resource's credits (including Cesium's "default token"
 * notice) from the token in play when the resource is created, so a layer built
 * with the old token would keep that notice on screen forever.
 * The new layer is added on top of the current one before the old is dropped,
 * so the swap never flashes an empty globe.
 */
export async function syncIonImagery(): Promise<void> {
  const viewer = getViewer()
  if (!viewer) return
  const tokenKey = resolveActiveToken()
  if (tokenKey === lastImageryTokenKey) return

  const seq = ++imagerySeq
  try {
    applyIonToken(tokenKey) // the layer must be requested with the active token
    const provider = await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL })
    if (seq !== imagerySeq || viewer.isDestroyed()) return // superseded / torn down
    const layers = viewer.imageryLayers
    layers.addImageryProvider(provider) // new layer on top…
    while (layers.length > 1) layers.remove(layers.get(0)) // …then drop placeholder + old layer
    lastImageryTokenKey = tokenKey
  } catch (err) {
    console.error('[CineEarth] ion World Imagery failed — keeping the current imagery', err)
  }
}

/** Terrain then imagery — the order matters: terrain sync is what applies the token. */
async function syncIonScene(): Promise<void> {
  await syncTerrain()
  await syncIonImagery()
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
  await syncIonScene()
}

export async function clearIonToken(): Promise<void> {
  useIon.getState().resetToken()
  await syncIonScene()
}

/**
 * App startup: terrain on the bundled token right away, then quietly re-verify a
 * stored token. Imagery is built LAST so it is created with the final token —
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

  await syncIonImagery()
}
