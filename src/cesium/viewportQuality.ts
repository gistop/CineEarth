import type { Viewer } from 'cesium'

export type ViewportVariant = 'editor' | 'pane' | 'thumb' | 'program'

const QUALITY: Record<ViewportVariant, { scale: number; sse: number; cache: number; msaa: number }> = {
  editor: { scale: 1, sse: 2, cache: 100, msaa: 4 },
  pane: { scale: 1, sse: 2, cache: 100, msaa: 4 },
  thumb: { scale: 0.55, sse: 5, cache: 40, msaa: 1 },
  program: { scale: 1, sse: 2, cache: 100, msaa: 4 },
}

export function applyViewportQuality(viewer: Viewer, variant: ViewportVariant): void {
  const quality = QUALITY[variant]
  viewer.resolutionScale = quality.scale
  viewer.scene.globe.maximumScreenSpaceError = quality.sse
  viewer.scene.globe.tileCacheSize = quality.cache
  viewer.scene.msaaSamples = quality.msaa
}
