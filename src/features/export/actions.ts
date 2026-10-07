// Export actions — glue between UI buttons, the viewer registry and the recorder.

import { Cartesian3, Math as CesiumMath } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { samplePose, timelineDuration, timelineProgressToRoute } from '../route/pathMath'
import { useRoute } from '../route/routeStore'
import type { Pose } from '../route/types'
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
      roll: 0,
    },
  })
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

/** Offline video render of the current route. */
export async function renderRouteVideo(): Promise<void> {
  const viewer = getViewer()
  if (!viewer) return

  const store = useExport.getState()
  if (store.status === 'rendering') {
    store.cancel()
    return
  }

  const { route } = useRoute.getState()
  // WYSIWYG: a locked camera exports a locked-camera video (growth still animates)
  const camLocked = useUI.getState().cameraLocked
  if (route.waypoints.length < 2) {
    useExport.getState().finish('航线至少需要 2 个航点')
    return
  }

  useExport.getState().start()
  // freeze playback & user input — the recorder owns the camera now
  useUI.getState().setPlaying(false)
  const controller = viewer.scene.screenSpaceCameraController
  const inputsWereEnabled = controller.enableInputs
  controller.enableInputs = false

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
