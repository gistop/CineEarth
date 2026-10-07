// Route ⇄ Cesium bridge — renders nothing itself.
// Pattern ported from CTEarth RoamSceneBridge: pure stores in, imperative scene out.
//  · playback loop: rAF advances the playhead & drives the camera
//  · route entities: smooth spline polyline + waypoint points on the globe

import { useEffect, useRef } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CallbackProperty,
  Color,
  CornerType,
  Entity,
  PolylineGlowMaterialProperty,
  sampleTerrainMostDetailed,
} from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import {
  haversineM,
  samplePath,
  samplePose,
  timelineDuration,
  timelineProgressToRoute,
} from './pathMath'
import { evalReveal, useReveal } from './revealStore'
import { useRoute } from './routeStore'
import { useExport } from '../export/exportStore'

const ACCENT = Color.fromCssColorString('#38618c')
const INK = Color.fromCssColorString('#fbfbfa')
const GROWTH_GREEN = Color.fromCssColorString('#4ade80')

function poseToDestination(pose: { lon: number; lat: number; height: number }) {
  return Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height)
}

export default function RouteSceneBridge() {
  const route = useRoute((s) => s.route)
  const growthLine = useReveal((s) => s.growthLine)

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
      /* selection-aware style: CallbackProperty re-reads the store each frame,
         so globe highlights stay in sync with top/side views without rebuilds */
      const isSelected = () => useRoute.getState().selectedWaypointId === w.id
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(w.lon, w.lat, w.height),
          point: {
            pixelSize: new CallbackProperty(() => (isSelected() ? 11 : 7), false),
            color: new CallbackProperty(() => (isSelected() ? ACCENT : INK), false),
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

  /* ---- growth line: thick spline revealed by the AE-style keyframe track ----
     positions = CallbackProperty → re-evaluated every render frame:
     reveal% = evalReveal(keys, playhead), arc-length-trimmed to keep growth
     visually uniform (spline parameter t is NOT uniform in length). */
  useEffect(() => {
    const viewer = getViewer()
    if (!viewer || !growthLine) return

    const poses = samplePath(route, 160)
    if (poses.length < 2) return

    const cum: number[] = [0]
    for (let i = 1; i < poses.length; i += 1) {
      cum.push(
        cum[i - 1] + haversineM(poses[i - 1].lon, poses[i - 1].lat, poses[i].lon, poses[i].lat),
      )
    }

    /* ground track for the 3D beam: it follows TERRAIN, not waypoint/camera heights.
       Terrain is sampled async — until it resolves the beam rides the ellipsoid,
       then settles onto the real surface (+halfH so the bottom face sits on it). */
    const totalLen = cum[cum.length - 1]
    const halfW = Math.min(9000, Math.max(80, totalLen * 0.003))
    const halfH = halfW * 0.5
    const groundPoses = poses.map((p) => ({ lon: p.lon, lat: p.lat, height: halfH }))
    const provider = viewer.terrainProvider
    if (provider.availability) {
      const cartos = poses.map((p) => Cartographic.fromDegrees(p.lon, p.lat))
      void sampleTerrainMostDetailed(provider, cartos).then(() => {
        if (viewer.isDestroyed()) return
        cartos.forEach((c, i) => {
          if (Number.isFinite(c.height)) groundPoses[i].height = c.height + halfH
        })
      })
    }

    // base layer: dim full-length guide — visible the instant the button is pressed,
    // even at reveal 0% (otherwise a playhead at t=0 shows nothing and the toggle looks dead)
    const entities: Entity[] = [
      viewer.entities.add({
        polyline: {
          positions: poses.map(poseToDestination),
          width: 10,
          clampToGround: true,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: GROWTH_GREEN.withAlpha(0.18),
          }),
        },
      }),
      // growth layer: solid rectangular beam riding the GROUND (terrain-sampled
      // heights), revealed by the keyframe track at the playhead
      viewer.entities.add({
        polylineVolume: {
          positions: new CallbackProperty(() => {
            const reveal = evalReveal(useReveal.getState().keys, useRoute.getState().progress) / 100
            return cutPathByLength(groundPoses, cum, reveal)
          }, false),
          shape: [
            new Cartesian2(-halfW, -halfH),
            new Cartesian2(halfW, -halfH),
            new Cartesian2(halfW, halfH),
            new Cartesian2(-halfW, halfH),
          ],
          cornerType: CornerType.BEVELED,
          material: GROWTH_GREEN,
        },
      }),
    ]

    return () => {
      const live = getViewer()
      if (live !== viewer || viewer.isDestroyed()) return
      entities.forEach((e) => viewer.entities.remove(e))
    }
  }, [growthLine, route])

  /* ---- playback loop: advance playhead, drive the camera ---- */
  const t0Ref = useRef(0)

  const applyPose = (progress: number) => {
    /* progress is a TIMELINE fraction; the pose is a CONTENT position — a
       timeline longer than the content holds the final pose, a shorter one
       truncates the flight (identity when both are equal) */
    const route = useRoute.getState().route
    const pose = samplePose(route, timelineProgressToRoute(route, progress))
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
        // unlock → snap the camera back onto the playhead pose immediately
        if (prev.cameraLocked && !s.cameraLocked) {
          applyPose(useRoute.getState().progress)
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
        if ((!ui.playing || ui.scrubbing) && !ui.cameraLocked) applyPose(s.progress)
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
      /* playback clock runs the full TIMELINE (so a length longer than the
         content plays out its hold, and a shorter one ends at the cut) */
      const total = timelineDuration(s.route)
      if (total <= 0) return

      if (t0Ref.current === 0) t0Ref.current = now - s.progress * total * 1000
      const progress = (((now - t0Ref.current) / (total * 1000)) % 1 + 1) % 1
      s.setProgress(progress)
      // locked camera: playhead advances (growth keeps growing), viewpoint holds
      if (!useUI.getState().cameraLocked) applyPose(progress)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}

/** trim dense spline samples to the first `frac` (0..1) of total arc length */
function cutPathByLength(
  poses: { lon: number; lat: number; height: number }[],
  cum: number[],
  frac: number,
): Cartesian3[] {
  if (frac <= 0.001) {
    // degenerate two-point segment at the start — invisible but safe for Cesium
    const p = poseToDestination(poses[0])
    return [p, p.clone()]
  }
  if (frac >= 0.999) return poses.map(poseToDestination)

  const target = cum[cum.length - 1] * frac
  let i = 1
  while (i < cum.length - 1 && cum[i] < target) i += 1
  const span = cum[i] - cum[i - 1]
  const local = span > 0 ? (target - cum[i - 1]) / span : 1
  const a = poses[i - 1]
  const b = poses[i]

  const out = poses.slice(0, i).map(poseToDestination)
  out.push(
    Cartesian3.fromDegrees(
      a.lon + (b.lon - a.lon) * local,
      a.lat + (b.lat - a.lat) * local,
      a.height + (b.height - a.height) * local,
    ),
  )
  return out
}
