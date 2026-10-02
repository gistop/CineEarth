// Pure route math — no engine, no React (ported from CTEarth roamPath).
// Catmull-Rom position smoothing + shortest-arc angle blending + track stats.

import {
  DEFAULT_WAYPOINT_DURATION,
  type Pose,
  type Route,
  type TargetPoint,
  type Waypoint,
} from './types'

const EARTH_RADIUS_M = 6371008.8

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

export function normalizeAngleDeg(value: number): number {
  return ((value % 360) + 360) % 360
}

/** shortest signed angle from `from` to `to`, in -180..180 */
export function angleDeltaDeg(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/** great-circle distance in metres */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ---------------------------------------------------------------------------
// sampling
// ---------------------------------------------------------------------------

type SegmentInfo = { startIndex: number; endTime: number }

function buildSegments(waypoints: Waypoint[]): { segments: SegmentInfo[]; total: number } {
  const segments: SegmentInfo[] = []
  let time = 0
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    time += Math.max(0.1, waypoints[i].duration || DEFAULT_WAYPOINT_DURATION)
    segments.push({ startIndex: i, endTime: time })
  }
  return { segments, total: time }
}

/** Catmull-Rom 1-D interpolation (end points clamped) */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/** great-circle initial bearing from (lon1,lat1) toward (lon2,lat2), degrees */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180
  const p1 = lat1 * toRad
  const p2 = lat2 * toRad
  const dLon = (lon2 - lon1) * toRad
  const y = Math.sin(dLon) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon)
  return normalizeAngleDeg((Math.atan2(y, x) * 180) / Math.PI)
}

/** re-aim a pose at the route target — heading/pitch solved from the current position */
function aimAtTarget(pose: Pose, target: TargetPoint): void {
  const ground = haversineM(pose.lon, pose.lat, target.lon, target.lat)
  if (ground < 1) {
    pose.pitch = pose.height >= target.height ? -89.9 : 89.9
    return // directly overhead — bearing undefined, keep the spline heading
  }
  pose.heading = bearingDeg(pose.lon, pose.lat, target.lon, target.lat)
  pose.pitch = clamp(
    -(Math.atan2(pose.height - target.height, ground) * 180) / Math.PI,
    -89.9,
    89.9,
  )
}

/**
 * Sample the camera pose at progress ∈ [0,1].
 * Position (lon/lat/height) via Catmull-Rom, angles via shortest-arc lerp,
 * local segment time eased with smoothstep (no pose snapping at waypoints).
 */
export function samplePose(route: Route, progress: number): Pose | null {
  const { waypoints } = route
  if (waypoints.length === 0) return null
  if (waypoints.length === 1) {
    const w = waypoints[0]
    return { lon: w.lon, lat: w.lat, height: w.height, heading: w.heading, pitch: w.pitch }
  }

  const { segments, total } = buildSegments(waypoints)
  const time = clamp(progress, 0, 1) * total
  let segment = segments[segments.length - 1]
  for (const candidate of segments) {
    if (time <= candidate.endTime || candidate === segments[segments.length - 1]) {
      segment = candidate
      break
    }
  }

  const previous = segments[segments.indexOf(segment) - 1]
  const segStart = previous ? previous.endTime : 0
  const rawLocal = segment.endTime > segStart ? (time - segStart) / (segment.endTime - segStart) : 1
  const eased = (() => {
    const local = clamp(rawLocal, 0, 1)
    return local * local * (3 - 2 * local)
  })()

  const i = segment.startIndex
  const at = (offset: number) => waypoints[clamp(i + offset, 0, waypoints.length - 1)]
  const a = at(-1)
  const b = at(0)
  const c = at(1)
  const d = at(2)

  const pose: Pose = {
    lon: catmullRom(a.lon, b.lon, c.lon, d.lon, eased),
    lat: catmullRom(a.lat, b.lat, c.lat, d.lat, eased),
    height: Math.max(0, catmullRom(a.height, b.height, c.height, d.height, eased)),
    heading: normalizeAngleDeg(b.heading + angleDeltaDeg(b.heading, c.heading) * eased),
    pitch: b.pitch + (c.pitch - b.pitch) * eased,
  }
  if (route.target) aimAtTarget(pose, route.target)
  return pose
}

/** total route duration in seconds */
export function totalDuration(route: Route): number {
  return buildSegments(route.waypoints).total
}

/** total frames for offline rendering (min 2) */
export function frameCount(route: Route): number {
  return Math.max(2, Math.round(totalDuration(route) * route.fps))
}

/** cumulative-time fraction of each waypoint — used to place keys on the timeline */
export function waypointFractions(route: Route): number[] {
  const { waypoints } = route
  if (waypoints.length < 2) return waypoints.map(() => 0)
  const { segments, total } = buildSegments(waypoints)
  const out = [0]
  segments.forEach((s) => out.push(s.endTime / total))
  return out
}

/** 0..2 → 0..1..0 */
export function pingpongProgress(t: number): number {
  const cycled = t % 2
  return cycled <= 1 ? cycled : 2 - cycled
}

// ---------------------------------------------------------------------------
// track stats (for the mini top/side views)
// ---------------------------------------------------------------------------

export type TrackPoint = {
  lon: number
  lat: number
  height: number
  /** metre offsets relative to the first waypoint */
  east: number
  north: number
  /** cumulative along-track distance */
  cumulative: number
}

export function buildTrack(route: Route): TrackPoint[] {
  const points: TrackPoint[] = []
  const origin = route.waypoints[0]
  if (!origin) return points

  const metersPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180
  const originCosLat = Math.cos((origin.lat * Math.PI) / 180)
  let cumulative = 0

  route.waypoints.forEach((w, index) => {
    if (index > 0) {
      const prev = route.waypoints[index - 1]
      cumulative += haversineM(prev.lon, prev.lat, w.lon, w.lat)
    }
    points.push({
      lon: w.lon,
      lat: w.lat,
      height: w.height,
      east: (w.lon - origin.lon) * metersPerDegLat * originCosLat,
      north: (w.lat - origin.lat) * metersPerDegLat,
      cumulative,
    })
  })

  return points
}

/** dense polyline sampled from the spline, for drawing the smooth path */
export function samplePath(route: Route, steps = 120): Pose[] {
  const out: Pose[] = []
  for (let i = 0; i <= steps; i += 1) {
    const pose = samplePose(route, i / steps)
    if (pose) out.push(pose)
  }
  return out
}
