// Route ⇄ Cesium bridge — renders nothing itself.
// Pattern ported from CTEarth RoamSceneBridge: pure stores in, imperative scene out.
//  · playback loop: rAF advances the playhead & drives the camera
//  · route entities: smooth spline polyline + waypoint points on the globe

import { useEffect, useRef } from 'react'
import { Cartesian3, Color, Entity, PolylineGlowMaterialProperty } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { samplePath, samplePose, totalDuration } from './pathMath'
import { useRoute } from './routeStore'
import { useExport } from '../export/exportStore'

const ACCENT = Color.fromCssColorString('#38618c')
const INK = Color.fromCssColorString('#fbfbfa')

function poseToDestination(pose: { lon: number; lat: number; height: number }) {
  return Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height)
}

export default function RouteSceneBridge() {
  const route = useRoute((s) => s.route)

  /* ---- route entities: spline polyline + waypoint points ---- */
  useEffect(() => {
    const viewer = getViewer()
    if (!viewer) return

    const entities: Entity[] = []
    const poses = samplePath(route, 160)

    if (poses.length > 1) {
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: poses.map(poseToDestination),
            width: 3,
            material: new PolylineGlowMaterialProperty({
              glowPower: 0.25,
              color: ACCENT.withAlpha(0.9),
            }),
          },
        }),
      )
    }

    route.waypoints.forEach((w) => {
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(w.lon, w.lat, w.height),
          point: {
            pixelSize: 7,
            color: INK,
            outlineColor: ACCENT,
            outlineWidth: 2,
          },
        }),
      )
    })

    /* camera target anchor — translucent halo + ring */
    if (route.target) {
      const t = route.target
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(t.lon, t.lat, t.height),
          point: {
            pixelSize: 14,
            color: ACCENT.withAlpha(0.25),
            outlineColor: ACCENT,
            outlineWidth: 2,
          },
        }),
      )
    }

    // Cleanup must re-resolve the registry: by the time this runs, GlobeViewport's
    // cleanup may already have destroyed the captured viewer (StrictMode double-invoke,
    // tree teardown). Touching a destroyed Viewer throws deep inside Cesium getters.
    return () => {
      const live = getViewer()
      if (live !== viewer || viewer.isDestroyed()) return
      entities.forEach((e) => viewer.entities.remove(e))
    }
  }, [route])

  /* ---- playback loop: advance playhead, drive the camera ---- */
  const t0Ref = useRef(0)

  const applyPose = (progress: number) => {
    const pose = samplePose(useRoute.getState().route, progress)
    const viewer = getViewer()
    if (pose && viewer) {
      viewer.camera.setView({
        destination: poseToDestination(pose),
        orientation: {
          heading: (pose.heading * Math.PI) / 180,
          pitch: (pose.pitch * Math.PI) / 180,
          roll: 0,
        },
      })
    }
  }

  /* pause → resume (and scrub end → resume) must restart from the current
     playhead, not a stale clock */
  useEffect(
    () =>
      useUI.subscribe((s, prev) => {
        if (s.playing !== prev.playing || s.scrubbing !== prev.scrubbing) {
          t0Ref.current = 0
        }
      }),
    [],
  )

  /* scrubbing (or seeking while paused) drives the camera directly — without
     this the globe ignores playhead moves until playback resumes */
  useEffect(
    () =>
      useRoute.subscribe((s, prev) => {
        if (s.progress === prev.progress) return
        const ui = useUI.getState()
        if (useExport.getState().status === 'rendering') return
        if (!ui.playing || ui.scrubbing) applyPose(s.progress)
      }),
    [],
  )

  useEffect(() => {
    let raf = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)

      // the offline renderer owns the camera while exporting
      if (useExport.getState().status === 'rendering') return
      // user owns the playhead while scrubbing — don't advance, don't overwrite
      if (useUI.getState().scrubbing) return
      if (!useUI.getState().playing) return

      const s = useRoute.getState()
      const total = totalDuration(s.route)
      if (total <= 0) return

      if (t0Ref.current === 0) t0Ref.current = now - s.progress * total * 1000
      const progress = (((now - t0Ref.current) / (total * 1000)) % 1 + 1) % 1
      s.setProgress(progress)
      applyPose(progress)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}
