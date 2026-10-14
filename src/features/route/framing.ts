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
import { DEFAULT_FOV, type FreeCam, type Pose } from './types'
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

/** the framing WE last applied programmatically (activation restore, seek
 *  follow). The moveEnd it re-fires carries the PROGRAM's view, not the
 *  user's — GlobeViewport consults isProgrammaticFraming() before recording
 *  a freeCam, so the memory keeps only user-made framings (a seek must not
 *  silently overwrite the shot's saved edit view). Normalized to the six
 *  freeCam channels — sameFraming compares exactly those. */
let lastProgrammatic: FreeCam | null = null

/** the fov (degrees) the last programmatic applyFraming pinned — the BASE the
 *  GES extent pinner (pinOutputExtent) widens from. Never written by the
 *  pinner itself, so repeated frames cannot compound the widening. */
let baseFovDeg = DEFAULT_FOV

/** the framing a PARKED playhead shows for a shot: its saved edit view
 *  (freeCam). This is the exact view the editor window restores on activation,
 *  so a shot looks the SAME whichever of the two windows (editor overlay /
 *  monitor pane) is currently displaying it — winning or losing activation
 *  never re-frames the picture. Shots never framed by hand fall through to
 *  the route pose at the playhead / HOME, same as frameOf. */
export function parkedFramingOf(shot: Shot, progress: number): Pose | FreeCam | null {
  return shot.freeCam ?? frameOf(shot, progress)
}

/** the framing ANY window shows for a shot, given whether the playhead is
 *  parked. Monitors, the editor overlay and the activation restore all resolve
 *  through here, so no two windows can ever disagree about the same shot. */
export function stageFramingOf(
  shot: Shot,
  progress: number,
  parked: boolean,
): Pose | FreeCam | null {
  return parked ? parkedFramingOf(shot, progress) : frameOf(shot, progress)
}

/** point a viewer at a framing; null → HOME. EVERY path pins the fov:
 *  a Pose carries its fov channel, a FreeCam/HOME resets to the default.
 *  fov is viewer-level state that used to LINGER — showing a routed shot in
 *  one window set its frustum to the Pose.fov and nothing ever reset it, so
 *  the same freeCam pose framed a different 地理范围 in the editor vs a
 *  monitor (the "activation changes the picture" report). Pinning it here
 *  makes every viewer's fov depend only on what it is showing, never on its
 *  own history. */
export function applyFraming(viewer: Viewer, f: Pose | FreeCam | null): void {
  const cam = f ?? HOME
  lastProgrammatic = {
    lon: cam.lon,
    lat: cam.lat,
    height: cam.height,
    heading: cam.heading,
    pitch: cam.pitch,
    roll: cam.roll,
  }
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(cam.lon, cam.lat, cam.height),
    orientation: {
      heading: CesiumMath.toRadians(cam.heading),
      pitch: CesiumMath.toRadians(cam.pitch),
      roll: CesiumMath.toRadians(cam.roll),
    },
  })
  const frustum = viewer.camera.frustum
  if (frustum instanceof PerspectiveFrustum) {
    const fovDeg = f != null && 'fov' in f ? f.fov : DEFAULT_FOV
    baseFovDeg = fovDeg
    frustum.fov = CesiumMath.toRadians(fovDeg)
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

/** true when `cam` is the echo of the last programmatic applyFraming —
 *  callers use it to keep that framing out of the freeCam memory */
export function isProgrammaticFraming(cam: FreeCam): boolean {
  return lastProgrammatic != null && sameFraming(lastProgrammatic, cam)
}

/** GES scope extent pinner — install once per viewer to keep the OUTPUT
 *  frame's ground extent invariant while the canvas ratio wanders with the
 *  layout (timeline expand/collapse, drawers, window resize…).
 *
 *  HOW: the frustum aspect stays glued to the canvas (changing it would
 *  STRETCH the picture). Instead, when the canvas is TALLER than the output
 *  frame (A < T), the vertical fov is widened by T/A — the frame's inscribed
 *  rectangle then covers exactly the ground it would at A = T, and the extra
 *  top/bottom strips are pure out-of-frame content for the mask to darken. A
 *  canvas WIDER than the frame needs nothing: the frame spans the full canvas
 *  height, so its extent is already fov-locked (only the side strips grow).
 *
 *  `ratio()` returns the output aspect (outW / outH) while GES scope is ON,
 *  and null while OFF (overlay letterbox / rendering / preview) — OFF restores
 *  the base fov. Returns the remove-listener. */
/** handle returned by pinOutputExtent */
export interface OutputExtentPin {
  /** re-evaluate NOW and ask for a frame — call it when a pin CONDITION
   *  changed (output size, layout mode, preview, pane variant…) */
  refresh: () => void
  off: () => void
}

export function pinOutputExtent(
  viewer: Viewer,
  ratio: () => number | null,
): OutputExtentPin {
  const scene = viewer.scene
  const apply = () => {
    const frustum = viewer.camera.frustum
    if (!(frustum instanceof PerspectiveFrustum)) return
    const t = ratio()
    const w = viewer.canvas.clientWidth
    const h = viewer.canvas.clientHeight
    let target = CesiumMath.toRadians(baseFovDeg)
    if (t != null && t > 0 && w >= 1 && h >= 1) {
      const widen = Math.max(1, t / (w / h))
      target =
        2 * Math.atan(Math.tan(CesiumMath.toRadians(baseFovDeg) / 2) * widen)
    }
    const current = frustum.fov
    if (current == null || Math.abs(current - target) > 1e-12) {
      frustum.fov = target
    }
  }
  const pinAndRender = () => {
    apply()
    if (!viewer.isDestroyed()) scene.requestRender()
  }
  /* every RENDERED frame re-checks — covers Cesium's own resize paths */
  const offRender = scene.preRender.addEventListener(apply)
  /* panes run requestRenderMode: Scene.render SKIPS frames nobody asked for,
     and preRender never fires on a skipped frame. A pure LAYOUT change
     (timeline height, drawers, window resize) requests no frame, so the
     stale fov lingered on a stretched canvas and the frame's ground extent
     visibly moved. The ResizeObserver closes the hole: re-pin the fov the
     instant the canvas resizes and ASK for a fresh frame. */
  const ro = new ResizeObserver(pinAndRender)
  ro.observe(viewer.canvas)
  return {
    refresh: pinAndRender,
    off: () => {
      offRender()
      ro.disconnect()
    },
  }
}
