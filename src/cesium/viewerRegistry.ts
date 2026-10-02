// Viewer registry — decouples feature modules from React tree.
// The globe is an imperative island; features (export, route bridge)
// resolve the live Viewer through this tiny registry instead of prop drilling.

import type { Viewer } from 'cesium'

let viewer: Viewer | null = null

export function setViewer(next: Viewer | null): void {
  viewer = next
}

export function getViewer(): Viewer | null {
  return viewer
}
