// Export actions — glue between UI buttons, the viewer registry and the recorder.

import { type Entity, type Viewer } from 'cesium'
import { getProgramViewer, getViewer, refreshProgramViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { samplePose, timelineDuration, timelineProgressToRoute } from '../route/pathMath'
import { programShotAt, useRoute } from '../route/routeStore'
import { hasPosition, type Pose } from '../route/types'
import { applyFraming, frameOf } from '../route/framing'
import { buildShotRouteEntities } from '../route/routeEntities'
import { prepareAssetViewer } from '../assets/assetScene'
import { useExport } from './exportStore'
import { createStamp, downloadBlob, recordVideo, type RecordPath } from './recorder'

function applyPose(pose: Pose): void {
  const viewer = getViewer()
  if (!viewer) return
  applyFraming(viewer, pose)
}

/** Screenshot: the OUTPUT FRAME, not the editor canvas. The 尺寸 setting
 *  (ui.outW/outH) is the same source the GES mask and the video encode use:
 *  the picture is the canvas' centred aspect-fit rectangle at that ratio —
 *  in push layout exactly the UN-MASKED frame area — rendered at that pixel
 *  count for real (withRenderScale: no fake upscaled 1080p). DOM overlays
 *  are never baked in. */
export function takeScreenshot(): void {
  const viewer = getViewer()
  if (!viewer) return
  const { outW, outH } = useUI.getState()

  /* carry the output's pixel count before we grab (Cesium clamps to 4) */
  const restoreScale = withRenderScale(viewer, outW, outH)
  viewer.scene.render()

  /* centred aspect-fit rect of the OUTPUT ratio — in push layout this is
     exactly the GES editor's un-masked area (same geometry as .ce-frame) */
  const cw = viewer.canvas.width
  const ch = viewer.canvas.height
  const target = outW / outH
  let sx = 0
  let sy = 0
  let sw = cw
  let sh = ch
  if (cw / ch > target) {
    sw = Math.round(ch * target)
    sx = Math.floor((cw - sw) / 2)
  } else {
    sh = Math.round(cw / target)
    sy = Math.floor((ch - sh) / 2)
  }

  /* the offline canvas is decoupled from the viewer the moment drawImage
     returns — safe to restore the scale right here, no torn frame possible */
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (ctx) ctx.drawImage(viewer.canvas, sx, sy, sw, sh, 0, 0, outW, outH)
  restoreScale()

  out.toBlob((blob) => {
    if (blob) downloadBlob(blob, `cineearth-${createStamp()}-${outW}x${outH}.png`)
  }, 'image/png')
}

/** Render video = render the PROGRAM OUT picture (the cut-together 成片), not
 *  the single edited shot. With ≥2 机位 we record the Program Out monitor's
 *  own Viewer frame-by-frame; with a single 机位 the program IS that shot, so
 *  we fall back to the interactive main globe (the only Viewer then). */
export async function renderRouteVideo(): Promise<void> {
  const store = useExport.getState()
  if (store.status === 'rendering') {
    store.cancel()
    return
  }

  const programViewer = getProgramViewer()
  if (programViewer && !programViewer.isDestroyed() && useRoute.getState().shots.length > 1) {
    await renderProgramVideo(programViewer)
    return
  }
  await renderSingleShotVideo()
}

/** off-screen render grade for the recorded Viewer. The recorder rescales
 *  whatever canvas it gets to outputSize — a small monitor cell (~500px)
 *  upscaled into a 1080p file is a soft FAKE 1080p. Raising resolutionScale
 *  makes the canvas itself carry the output's pixel count (Cesium clamps the
 *  scale to 4, plenty for any sane cell). SSE is left untouched: a bigger
 *  canvas automatically pulls finer tiles at the same screen-space error. */
function withRenderScale(viewer: Viewer, outW: number, outH: number): () => void {
  const prev = viewer.resolutionScale
  const dpr = window.devicePixelRatio || 1
  const need = Math.max(
    outW / Math.max(1, viewer.canvas.clientWidth * dpr),
    outH / Math.max(1, viewer.canvas.clientHeight * dpr),
  )
  if (need > prev) {
    viewer.resolutionScale = Math.min(need, 4)
    viewer.scene.requestRender()
  }
  return () => {
    if (viewer.isDestroyed() || viewer.resolutionScale === prev) return
    viewer.resolutionScale = prev
    viewer.scene.requestRender()
  }
}

/** render-time globe grade — sse 1 pulls tiles one LOD level finer than the
 *  interactive sse 2 (≈4× tiles; a seam between neighbouring LOD levels is
 *  what read as "near sharp / far blurry"), a fat cache + sibling/ancestor
 *  preloading keep the warm-up pass's tiles resident through the encode.
 *  Restores the interactive grade on teardown. */
function withRecordQuality(viewer: Viewer): () => void {
  const globe = viewer.scene.globe
  const prev = {
    sse: globe.maximumScreenSpaceError,
    cache: globe.tileCacheSize,
    siblings: globe.preloadSiblings,
    ancestors: globe.preloadAncestors,
  }
  globe.maximumScreenSpaceError = 1
  globe.tileCacheSize = 1000
  globe.preloadSiblings = true
  globe.preloadAncestors = true
  return () => {
    if (viewer.isDestroyed()) return
    viewer.scene.globe.maximumScreenSpaceError = prev.sse
    viewer.scene.globe.tileCacheSize = prev.cache
    viewer.scene.globe.preloadSiblings = prev.siblings
    viewer.scene.globe.preloadAncestors = prev.ancestors
  }
}

/** settle, not just load: tilesLoaded reads true BETWEEN refine waves too —
 *  a single true lets a half-refined globe (placeholder next to refined =
 *  the patchwork frames) pass as ready. Require it to HOLD true for three
 *  consecutive polls. Recording is quality-over-wall-time, so the deadline
 *  is generous; it only exists so a permanently missing tile cannot hang. */
function makeWaitTilesLoaded(viewer: Viewer): () => Promise<void> {
  return async () => {
    const deadline = performance.now() + 60_000
    let settled = 0
    while (settled < 3 && performance.now() < deadline) {
      settled = viewer.scene.globe.tilesLoaded ? settled + 1 : 0
      await new Promise((r) => setTimeout(r, 120))
    }
  }
}

/** the cut-together picture: cross cuts re-target entities AND camera inside
 *  the Program Out Viewer. The exporter OWNS this Viewer for the render — the
 *  monitor's own throttled auto-follow is paused for the duration. */
async function renderProgramVideo(viewer: Viewer): Promise<void> {
  const s = useRoute.getState()
  const route = s.route ?? s.shots[0]?.route
  if (!route) {
    useExport.getState().finish('没有可用的机位航线')
    return
  }
  if (s.program.length === 0) {
    useExport.getState().finish('主输出尚未编排 — 先在时间轴编排切镜')
    return
  }

  useExport.getState().start()
  useUI.getState().setPlaying(false)
  const controller = viewer.scene.screenSpaceCameraController
  const inputsWereEnabled = controller.enableInputs
  controller.enableInputs = false

  const originalProgress = s.progress
  let entities: Entity[] = []
  let onAirId: string | null = null

  const syncFrame = (progress: number) => {
    const st = useRoute.getState()
    const sid = programShotAt(st.program, progress)
    if (sid !== onAirId) {
      entities.forEach((e) => viewer.entities.remove(e))
      entities = []
      onAirId = sid
      if (sid) {
        const shot = st.shots.find((sh) => sh.id === sid)
        if (shot) entities = buildShotRouteEntities(viewer, shot)
      }
    }
    if (sid) {
      const shot = st.shots.find((sh) => sh.id === sid)
      if (shot) applyFraming(viewer, frameOf(shot, progress))
    }
    useRoute.getState().setProgress(progress)
  }

  /* 尺寸 setting: encode size + on-screen frame ratio share this source,
     so the push-layout canvas ratio always matches (pure resize). The scale
     boost below makes the canvas carry these pixels for real. */
  const out = { width: useUI.getState().outW, height: useUI.getState().outH }
  const restoreScale = withRenderScale(viewer, out.width, out.height)
  const restoreQuality = withRecordQuality(viewer)

  try {
    await prepareAssetViewer(viewer)

    const path: RecordPath = {
      begin: () => {
        /* drop the monitor's live entities — the exporter rebuilds them per
           cut, so the two never draw the same decoration twice */
        viewer.entities.removeAll()
        /* the assets (growth line above all) are ALREADY mounted on this
           Viewer — registerAssetViewer keeps every pane sharing them, so the
           recorded picture is exactly the monitor picture */
        entities = []
        onAirId = null
        syncFrame(0)
      },
      applyProgress: (progress) => syncFrame(progress),
      frameCount: Math.max(2, Math.round(timelineDuration(route) * route.fps)),
      fps: route.fps,
    }

    const blob = await recordVideo({
      outputSize: out,
      canvas: viewer.canvas,
      path,
      waitTilesLoaded: makeWaitTilesLoaded(viewer),
      renderFrame: () => viewer.scene.render(),
      warmup: true,
      /* the progress bar spans warm-up (first half) then the encode pass */
      onWarmup: (p) => useExport.getState().setProgress(0.5 * p),
      onProgress: (frame, total) => useExport.getState().setProgress(0.5 + 0.5 * (frame / total)),
      isCancelled: () => useExport.getState().cancelRequested,
    })

    downloadBlob(blob, `cineearth-${createStamp()}.mp4`)
    useExport.getState().finish()
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? null // user cancel — not an error worth surfacing
      : err instanceof Error ? err.message : String(err)
    useExport.getState().finish(message ?? undefined)
  } finally {
    restoreScale()
    restoreQuality()
    controller.enableInputs = inputsWereEnabled
    /* hand the Viewer back: clear the exporter's decoration, restore the
       playhead and force the monitor to rebuild its own route decoration */
    viewer.entities.removeAll()
    useRoute.getState().setProgress(originalProgress)
    refreshProgramViewer()
  }
}

/** single 机位: the program IS that shot — record the interactive main globe
 *  (the only Viewer there is), flying the shot's own route. */
async function renderSingleShotVideo(): Promise<void> {
  const viewer = getViewer()
  if (!viewer) {
    useExport.getState().finish('主视图未就绪')
    return
  }

  const s = useRoute.getState()
  const route = s.route ?? s.shots[0]?.route
  if (!route) {
    useExport.getState().finish('没有可用的机位航线')
    return
  }
  // WYSIWYG: a locked camera exports a locked-camera video (growth still animates)
  const camLocked = useUI.getState().cameraLocked
  /* exporting needs a flyable path: ≥2 positioned waypoints (pose-only
     keys alone cannot drive the camera) */
  if (route.waypoints.filter(hasPosition).length < 2) {
    useExport.getState().finish('航线至少需要 2 个位置关键帧')
    return
  }

  useExport.getState().start()
  useUI.getState().setPlaying(false)
  const controller = viewer.scene.screenSpaceCameraController
  const inputsWereEnabled = controller.enableInputs
  controller.enableInputs = false

  /* push+scope layout keeps the editor canvas FULL-BLEED; rendering makes the
     stage letterbox it to the OUTPUT frame (see ViewportStage). Give React+CSS
     a frame to apply that, then sync the Cesium canvas — the recorder reads
     canvas.width immediately and it must already be the picture, not the
     darkened surround. */
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  viewer.resize()

  /* 尺寸 setting: encode size + on-screen frame ratio share this source,
     so the push-layout canvas ratio always matches (pure resize). The scale
     boost below makes the canvas carry these pixels for real. */
  const out = { width: useUI.getState().outW, height: useUI.getState().outH }
  const restoreScale = withRenderScale(viewer, out.width, out.height)
  const restoreQuality = withRecordQuality(viewer)

  try {
    await prepareAssetViewer(viewer)

    const path: RecordPath = {
      begin: () => {
        const p = samplePose(route, 0)
        if (p && !camLocked) applyPose(p)
        // store progress drives the growth line too (CallbackProperty reads it)
        useRoute.getState().setProgress(0)
      },
      applyProgress: (progress) => {
        /* progress runs over the TIMELINE length — content past the end is
           simply not rendered, and a longer timeline holds the last pose */
        const p = samplePose(route, timelineProgressToRoute(route, progress))
        if (p && !camLocked) applyPose(p)
        useRoute.getState().setProgress(progress)
      },
      frameCount: Math.max(2, Math.round(timelineDuration(route) * route.fps)),
      fps: route.fps,
    }

    const blob = await recordVideo({
      outputSize: out,
      canvas: viewer.canvas,
      path,
      waitTilesLoaded: makeWaitTilesLoaded(viewer),
      renderFrame: () => viewer.scene.render(),
      warmup: true,
      /* the progress bar spans warm-up (first half) then the encode pass */
      onWarmup: (p) => useExport.getState().setProgress(0.5 * p),
      onProgress: (frame, total) => useExport.getState().setProgress(0.5 + 0.5 * (frame / total)),
      isCancelled: () => useExport.getState().cancelRequested,
    })

    downloadBlob(blob, `cineearth-${createStamp()}.mp4`)
    useExport.getState().finish()
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? null // user cancel — not an error worth surfacing
      : err instanceof Error ? err.message : String(err)
    useExport.getState().finish(message ?? undefined)
  } finally {
    restoreScale()
    restoreQuality()
    controller.enableInputs = inputsWereEnabled
  }
}
