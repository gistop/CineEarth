// Export actions — glue between UI buttons, the viewer registry and the recorder.

import { Cartesian3, Math as CesiumMath, PerspectiveFrustum, type Entity, type Viewer } from 'cesium'
import { getProgramViewer, getViewer, refreshProgramViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { samplePose, timelineDuration, timelineProgressToRoute } from '../route/pathMath'
import { programShotAt, useRoute } from '../route/routeStore'
import { hasPosition, type Pose } from '../route/types'
import { applyFraming, frameOf } from '../route/framing'
import { buildShotRouteEntities } from '../route/routeEntities'
import { useExport } from './exportStore'
import { createStamp, downloadBlob, recordVideo, type RecordPath } from './recorder'

function applyPose(pose: Pose): void {
  const viewer = getViewer()
  if (!viewer) return
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height),
    orientation: {
      heading: CesiumMath.toRadians(pose.heading),
      pitch: CesiumMath.toRadians(pose.pitch),
      roll: CesiumMath.toRadians(pose.roll),
    },
  })
  /* fov channel — deg → radians on the perspective frustum */
  const frustum = viewer.camera.frustum
  if (frustum instanceof PerspectiveFrustum) frustum.fov = CesiumMath.toRadians(pose.fov)
}

/** Screenshot: explicit render, then capture the canvas (UI overlays are DOM — never baked in). */
export function takeScreenshot(): void {
  const viewer = getViewer()
  if (!viewer) return
  viewer.scene.render()
  viewer.canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `cineearth-${createStamp()}.png`)
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

  try {
    const path: RecordPath = {
      begin: () => {
        /* drop the monitor's live entities — the exporter rebuilds them per
           cut, so the two never draw the same decoration twice */
        viewer.entities.removeAll()
        entities = []
        onAirId = null
        syncFrame(0)
      },
      applyProgress: (progress) => syncFrame(progress),
      frameCount: Math.max(2, Math.round(timelineDuration(route) * route.fps)),
      fps: route.fps,
    }

    const blob = await recordVideo({
      canvas: viewer.canvas,
      path,
      waitTilesLoaded: async () => {
        const deadline = performance.now() + 8000 // never hang on missing tiles
        while (!viewer.scene.globe.tilesLoaded && performance.now() < deadline) {
          await new Promise((r) => setTimeout(r, 120))
        }
      },
      renderFrame: () => viewer.scene.render(),
      onProgress: (frame, total) => useExport.getState().setProgress(frame / total),
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

  try {
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
      canvas: viewer.canvas,
      path,
      waitTilesLoaded: async () => {
        const deadline = performance.now() + 8000 // never hang on missing tiles
        while (!viewer.scene.globe.tilesLoaded && performance.now() < deadline) {
          await new Promise((r) => setTimeout(r, 120))
        }
      },
      renderFrame: () => viewer.scene.render(),
      onProgress: (frame, total) => useExport.getState().setProgress(frame / total),
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
    controller.enableInputs = inputsWereEnabled
  }
}
