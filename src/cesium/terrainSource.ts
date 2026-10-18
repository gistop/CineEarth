import { EllipsoidTerrainProvider, type TerrainProvider, type Viewer } from 'cesium'

let current: TerrainProvider = new EllipsoidTerrainProvider()
const listeners = new Set<(provider: TerrainProvider) => void>()

export function setTerrainProvider(next: TerrainProvider): void {
  if (next === current) return
  current = next
  listeners.forEach((listener) => listener(next))
}

export function bindTerrain(viewer: Viewer): () => void {
  viewer.terrainProvider = current
  const listener = (provider: TerrainProvider) => {
    if (viewer.isDestroyed()) return
    viewer.terrainProvider = provider
    viewer.scene.requestRender()
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** current terrain provider without touching a viewer (e.g. profile sampling) */
export function getTerrainProvider(): TerrainProvider {
  return current
}

/**
 * subscribe to provider swaps; the callback also fires immediately with the
 * current provider so callers can bootstrap without a separate first read.
 */
export function onTerrainProvider(fn: (provider: TerrainProvider) => void): () => void {
  listeners.add(fn)
  fn(current)
  return () => listeners.delete(fn)
}
