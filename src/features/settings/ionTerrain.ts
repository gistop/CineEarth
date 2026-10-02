// Cesium ion glue — bridges the pure token store to Cesium globals & the live viewer.
// Terrain policy (out of the box):
//  · user token verified   → world terrain on the user's own ion quota
//  · no / failed token     → world terrain on CesiumJS's bundled evaluation token
//  · terrainEnabled off    → smooth ellipsoid
// The bundled token is per-release and shared (HTTP 200 verified for asset 2);
// pasting a personal token lifts the shared quota automatically.

import { Ion, createWorldTerrainAsync, EllipsoidTerrainProvider } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useIon } from './ionTokenStore'

/** ion asset id 2 = Cesium World Terrain; its endpoint doubles as a token check */
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
  await syncTerrain()
}

export async function clearIonToken(): Promise<void> {
  useIon.getState().resetToken()
  await syncTerrain()
}

/** App startup: terrain on immediately (default token), then quietly re-verify stored token. */
export async function bootstrapIonSettings(): Promise<void> {
  await syncTerrain()

  const { token } = useIon.getState()
  if (!token) return
  useIon.getState().setStatus('checking')
  const verdict = await verifyIonToken(token)
  useIon.getState().setStatus(verdict)
  await syncTerrain()
}
