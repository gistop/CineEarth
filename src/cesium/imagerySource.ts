// Imagery source — ONE shared provider instance for every viewport (the main
// globe and every pane alike).
//
// Why this exists: panes used to grab "whatever the main viewer's layer 0 is"
// at construction time. ion World Imagery resolves ASYNC (OSM placeholder
// first, AERIAL swapped in when the token/asset is ready), so a pane created
// during that window captured the OSM placeholder and stayed on it forever,
// while the main globe switched to satellite — the two stopped matching.
//
// Now the source is OWNED here: consumers read getImageryProvider() and
// subscribe via bindImagery(); a swap (placeholder → ion, or a token change)
// re-dials everyone at once, regardless of creation order.

import { OpenStreetMapImageryProvider, type ImageryProvider, type Viewer } from 'cesium'

const OSM_URL = 'https://tile.openstreetmap.org/'

let current: ImageryProvider = new OpenStreetMapImageryProvider({ url: OSM_URL })
const listeners = new Set<(p: ImageryProvider) => void>()

/** the provider EVERY viewport must use — same instance, one tile pipeline */
export function getImageryProvider(): ImageryProvider {
  return current
}

/** replace the shared source and re-dial every subscribed viewport */
export function setImageryProvider(next: ImageryProvider): void {
  if (next === current) return
  current = next
  listeners.forEach((cb) => cb(next))
}

/**
 * Point a viewer at the shared source and keep it in sync.
 * The new layer is ADDED ON TOP before the old one is dropped, so the swap
 * never flashes an empty globe. Returns the unsubscribe fn.
 * (requestRender keeps requestRenderMode panes honest; on the always-rendering
 * main globe it is a harmless no-op.)
 */
export function bindImagery(viewer: Viewer): () => void {
  const listener = (p: ImageryProvider) => {
    if (viewer.isDestroyed()) return
    const layers = viewer.imageryLayers
    layers.addImageryProvider(p)
    while (layers.length > 1) layers.remove(layers.get(0))
    viewer.scene.requestRender()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
