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
