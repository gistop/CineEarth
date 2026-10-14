// Imagery source — ONE shared provider instance for every viewport (the main
// globe and every pane alike).
//
// Why this exists: panes used to grab "whatever the main viewer's layer 0 is"
// at construction time. ion World Imagery resolves ASYNC, so a pane created
// during that window captured a stale provider and stayed on it forever, and
// an OSM street-map placeholder made every launch flash "map → satellite".
// Now the source is OWNED here: viewers start bare (baseLayer: false — the
// ink sphere) and subscribe via bindImagery(); a swap (startup → ion, or a
// token change) re-dials everyone at once, regardless of creation order.
// bindImagery ALSO applies an already-resolved source right away (crossfade
// from the ink sphere), so a viewer never depends on "was the provider
// resolved at construction time" — React StrictMode's double mount made that
// race real: the first mount's bootstrap resolved between the two mounts and
// the second viewer was born with the satellite already baked in, skipping
// the ink sphere entirely.
//
// Startup look (正式产品): NO placeholder street map — a quiet INK SPHERE
// (globe.baseColor, ZERO imagery requests) while ion World Imagery resolves
// AND the tile queue drains, then the satellite layer CROSSFADES in on top
// (alpha 0 → 1). The crossfade is held back until the viewer's tile-load
// queue first reaches 0 (imagery + terrain for the current view all resident)
// so the audience never watches the stream refine (blurry → sharp). If ion
// never resolves, the globe stays a calm dark planet — never a jarring map
// flash.

import { Color, type ImageryLayer, type ImageryProvider, type Viewer } from 'cesium'

/** "planet before dawn" — every viewer's baseColor (the pre-imagery look) */
const INK_SPHERE = Color.fromCssColorString('#141a26')

/** how long a swapped-in imagery layer takes to reach full opacity —
 *  ~1.6s sits in classic film-dissolve territory (1–2s): the satellite
 *  "develops" onto the planet instead of snapping in */
const FADE_MS = 1600

/** cap on how long the opening waits for the tile queue to drain — a slow
 *  network must not keep the veil spinning forever (and unveiling at the
 *  cap merely shows the old behavior, not a broken one) */
const READY_TIMEOUT_MS = 10_000

/** null = the ink sphere (ion imagery not resolved yet) */
let current: ImageryProvider | null = null
const listeners = new Set<(p: ImageryProvider) => void>()

/* ── opening veil (orbit ring) ─────────────────────────────——
   Fired ONCE — when the FIRST real imagery starts fading in, which is the
   moment the tile queue first drained (see awaitClear) — so the startup
   veil retires in step with the crossfade. Module-level state: StrictMode's
   double mount fires the catch-up apply too, but only the first one
   announces. */
let veilRetired = false
const veilListeners = new Set<() => void>()

/** subscribe to "the first imagery is arriving" (the veil's exit cue) */
export function onImageryArriving(cb: () => void): () => void {
  veilListeners.add(cb)
  return () => {
    veilListeners.delete(cb)
  }
}

/** hold the crossfade until the viewer is objectively sharp: its tile-load
 *  queue (imagery + terrain combined) must first go non-zero — the camera
 *  has queued real work — and then back to 0 — every queued tile for the
 *  current view is resident, so no blurry placeholder is left to replace.
 *  A zero seen before any load is ignored (the queue has not been built
 *  yet). READY_TIMEOUT_MS forces the unveil regardless: waiting is a
 *  courtesy, not a contract. */
function awaitClear(viewer: Viewer, done: () => void): void {
  const t0 = performance.now()
  let sawLoad = false
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    viewer.scene.globe.tileLoadProgressEvent.removeEventListener(onProgress)
    clearInterval(nudge)
    done()
  }
  const onProgress = (queued: number) => {
    if (queued > 0) sawLoad = true
    else if (sawLoad) finish() /* queue drained for real */
  }
  /* requestRenderMode viewers only re-evaluate the queue when asked to
     render; a gentle nudge keeps the countdown honest in both modes */
  const nudge = setInterval(() => {
    if (viewer.isDestroyed() || performance.now() - t0 > READY_TIMEOUT_MS) finish()
    else viewer.scene.requestRender()
  }, 200)
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(onProgress)
}

/** replace the shared source and re-dial every subscribed viewport */
export function setImageryProvider(next: ImageryProvider): void {
  if (next === current) return
  current = next
  listeners.forEach((cb) => cb(next))
}

/** smoothstep the layer 0 → 1 over FADE_MS, rendering every step so even
 *  requestRenderMode panes show the whole crossfade (a plain alpha set would
 *  paint exactly one frame at each unrelated render trigger). */
function fadeIn(viewer: Viewer, layer: ImageryLayer, done: () => void): void {
  const t0 = performance.now()
  const step = () => {
    if (viewer.isDestroyed()) return
    if (!viewer.imageryLayers.contains(layer)) return
    const k = Math.min(1, (performance.now() - t0) / FADE_MS)
    layer.alpha = k * k * (3 - 2 * k)
    viewer.scene.requestRender()
    if (k < 1) requestAnimationFrame(step)
    else done()
  }
  layer.alpha = 0
  requestAnimationFrame(step)
}

/**
 * Point a viewer at the shared source and keep it in sync.
 *  · paints the ink sphere (baseColor) — the pre-imagery startup look
 *  · a swap adds the new layer ON TOP at alpha 0, holds it there until the
 *    tile queue drains (awaitClear), then crossfades it in; the old imagery
 *    drops only AFTER the fade — never an empty globe, never a hard cut,
 *    never a refine pass in plain sight
 *  · an ALREADY-resolved source is applied the same way right here — every
 *    viewer opens on the ink sphere and watches the satellite fade in, no
 *    matter when the source landed relative to construction
 * Returns the unsubscribe fn.
 */
export function bindImagery(viewer: Viewer): () => void {
  viewer.scene.globe.baseColor = INK_SPHERE
  const listener = (p: ImageryProvider) => {
    if (viewer.isDestroyed()) return
    const layers = viewer.imageryLayers
    const layer = layers.addImageryProvider(p)
    layer.alpha = 0 /* hidden behind the ink sphere until the queue drains —
      fading in early would expose the stream mid-refine (blurry → sharp) */
    awaitClear(viewer, () => {
      if (viewer.isDestroyed()) return
      if (!veilRetired) {
        veilRetired = true
        veilListeners.forEach((cb) => cb()) /* the opening veil retires */
      }
      fadeIn(viewer, layer, () => {
        if (viewer.isDestroyed()) return
        while (layers.length > 1) layers.remove(layers.get(0))
        viewer.scene.requestRender()
      })
    })
  }
  listeners.add(listener)
  if (current) listener(current) /* born before the source landed? catch up */
  return () => {
    listeners.delete(listener)
  }
}
