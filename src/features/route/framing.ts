// Framing — per-机位 view state: resolve & apply.
// 取景优先级 (the ONE rule every viewport obeys, main globe and panes alike):
//   1. 航点位姿 — samplePose at the playhead: a shot WITH waypoints is framed
//      by its route content (all multi-view monitors sit at the playhead)
//   2. freeCam — the shot's free-navigation memory (no waypoints yet)
//   3. HOME — the Matterhorn opening view (never raw space)
// The old bug: camera state was ONE global thing, so activating a fresh shot
// inherited the previous shot's framing and empty panes fell to Cesium's
// default space view. Framing now BELONGS to the shot.

import { Cartesian3, Math as CesiumMath, PerspectiveFrustum, type Viewer } from 'cesium'
import { samplePose, timelineProgressToRoute } from './pathMath'
import type { FreeCam, Pose } from './types'
import type { Shot } from './routeStore'

/** the project's opening framing — mirrors GlobeViewport's original view */
export const HOME: FreeCam = {
  lon: 7.6586,
  lat: 45.9763,
  height: 60_000,
  heading: 0,
  pitch: -90,
  roll: 0,
}

/** a shot's framing at the playhead: route pose → freeCam → null (HOME) */
export function frameOf(shot: Shot, progress: number): Pose | FreeCam | null {
  const pose = samplePose(shot.route, timelineProgressToRoute(shot.route, progress))
  if (pose) return pose
  return shot.freeCam ?? null
}

/** point a viewer at a framing; null → HOME. A Pose also sets the fov channel,
 *  a FreeCam leaves the frustum alone (default 60°). */
export function applyFraming(viewer: Viewer, f: Pose | FreeCam | null): void {
  const cam = f ?? HOME
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(cam.lon, cam.lat, cam.height),
    orientation: {
      heading: CesiumMath.toRadians(cam.heading),
      pitch: CesiumMath.toRadians(cam.pitch),
      roll: CesiumMath.toRadians(cam.roll),
    },
  })
  if (f != null && 'fov' in f) {
    const frustum = viewer.camera.frustum
    if (frustum instanceof PerspectiveFrustum) frustum.fov = CesiumMath.toRadians(f.fov)
  }
}

/** read the live main-globe camera back as a freeCam record */
export function currentCameraAsFreeCam(viewer: Viewer): FreeCam {
  const c = viewer.camera
  const carto = c.positionCartographic
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    height: carto.height,
    heading: CesiumMath.toDegrees(c.heading),
    pitch: CesiumMath.toDegrees(c.pitch),
    roll: CesiumMath.toDegrees(c.roll),
  }
}

/** epsilon compare — avoids re-writing the store on echo moveEnds (a restore
 *  setView re-fires moveEnd with the very same numbers) */
export function sameFraming(a: FreeCam | null, b: FreeCam | null): boolean {
  if (a == null || b == null) return a === b
  return (
    Math.abs(a.lon - b.lon) < 1e-9 &&
    Math.abs(a.lat - b.lat) < 1e-9 &&
    Math.abs(a.height - b.height) < 0.01 &&
    Math.abs(a.heading - b.heading) < 1e-9 &&
    Math.abs(a.pitch - b.pitch) < 1e-9 &&
    Math.abs(a.roll - b.roll) < 1e-9
  )
}
