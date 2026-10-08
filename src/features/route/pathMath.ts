// Pure route math — no engine, no React (ported from CTEarth roamPath).
// Catmull-Rom position smoothing + shortest-arc angle blending + track stats.

import {
  DEFAULT_FOV,
  DEFAULT_WP_PITCH,
  DEFAULT_WAYPOINT_DURATION,
  hasPosition,
  type EaseChannel,
  type EaseSpec,
  type InsertStrategy,
  type LoopMode,
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

/** absolute on-chain time of each waypoint, index-aligned (times[i] = when
 *  waypoint i sits). Shared by sampling & key placement. */
function waypointTimes(waypoints: Waypoint[]): { times: number[]; total: number } {
  const times = [0]
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    total += Math.max(0.1, waypoints[i].duration || DEFAULT_WAYPOINT_DURATION)
    times.push(total)
  }
  return { times, total }
}

const smoothstep = (local: number) => {
  const c = clamp(local, 0, 1)
  return c * c * (3 - 2 * c)
}

/* ---------------------------------------------------------------------------
 * per-key easing (GES 缓动)
 * ------------------------------------------------------------------------- */

/** identity control corners: cubic-bezier(1/3,1/3,2/3,2/3) IS a straight line,
 *  so a side without a handle contributes no easing on its own。A key that
 *  EXPLICITLY eases (线性/缓入/缓出) leaves its other side straight — that is
 *  the AE semantics, keep it. */
const IDENT_OUT = { x: 1 / 3, y: 1 / 3 }
const IDENT_IN = { x: 2 / 3, y: 2 / 3 }

/** GES auto corners: a key that carries NO ease data at all still has the
 *  editor's default smooth (flat) tangent — control on the key's own value.
 *  Falling back to the STRAIGHT corners there (1/3,1/3) injects the chord's
 *  slope into the segment, and a handle dragged on the other side then fights
 *  it: the curve folds into an extra peak GES never shows (峰-谷-上升). Same
 *  comment stands for the seed of 左右缓动 in EASE_SEED. */
const SMOOTH_OUT = { x: 0.42, y: 0 }
const SMOOTH_IN = { x: 0.58, y: 1 }

/** CSS-style cubic bezier — y at time fraction x (Newton, bisection fallback) */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bx = (t: number) => {
    const u = 1 - t
    return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
  }
  const by = (t: number) => {
    const u = 1 - t
    return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
  }
  const dx = (t: number) => {
    const u = 1 - t
    return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2)
  }
  let t = x
  for (let i = 0; i < 8; i += 1) {
    const d = bx(t) - x
    if (Math.abs(d) < 1e-5) return by(t)
    const g = dx(t)
    if (Math.abs(g) < 1e-6) break
    t -= d / g
  }
  /* degenerate / inverted handles — bisection always lands an answer */
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    t = (lo + hi) / 2
    if (bx(t) < x) lo = t
    else hi = t
  }
  return by(t)
}

/**
 * Eased local parameter (0..1) for one segment, straight from the two keys'
 * ease specs — the single source of truth for the interpolation curve (used
 * by easeParam below AND by the timeline graph, which draws exactly this).
 *   no ease data at either end → smoothstep (the legacy default: routes
 *     authored before easing existed interpolate exactly as before)
 *   hold on either end → 0: the segment holds its START value and steps at
 *     its end (跳跃)
 *   otherwise a cubic bezier fed by a's `out` handle and b's `in` handle;
 *     a side without a handle falls back to the key's own default tangent —
 *     straight for a key with an explicit spec (线性/缓入/缓出), GES-smooth
 *     (flat) for a key that was never eased
 * The returned value may leave 0..1: an eased key whose handle sits past the
 * segment's own value bracket describes an OVERSHOOT, and both callers treat
 * it as one.
 */
export function easeFraction(local: number, ea?: EaseSpec, eb?: EaseSpec): number {
  if (ea?.mode === 'hold' || eb?.mode === 'hold') return 0
  const ho = ea?.out
  const hi = eb?.in
  if (!ho && !hi) {
    if (ea?.mode === 'linear' || eb?.mode === 'linear') return clamp(local, 0, 1)
    return smoothstep(local)
  }
  /* a key with an explicit spec but no handle on that side stays straight;
     a key with no spec at all is GES-smooth (flat tangent) */
  const p1 = ho ?? (ea ? IDENT_OUT : SMOOTH_OUT)
  const p2 = hi ?? (eb ? IDENT_IN : SMOOTH_IN)
  /* x stays PAIRED WITH ITS OWN y — an out handle dragged past the partner's
     x used to get its y moved onto the partner's corner (min/max sorting) and
     bent the segment at the wrong time. Ordering only needs x1 ≤ x2 for the
     solver below. */
  const x1 = clamp(p1.x, 0, 1)
  const x2 = Math.max(clamp(p2.x, 0, 1), x1)
  return cubicBezier(x1, p1.y, x2, p2.y, clamp(local, 0, 1))
}

/** Waypoint-level wrapper — same math, ease specs read off the two keys */
function easeParam(local: number, ch: EaseChannel, a?: Waypoint, b?: Waypoint): number {
  return easeFraction(local, a?.ease?.[ch], b?.ease?.[ch])
}

type AngleChannel = 'heading' | 'pitch' | 'roll' | 'fov'

/** an angle channel evaluated at an absolute chain time over its own key
 *  subchain (heading shortest-arc, pitch/roll/fov linear, ends held); a
 *  waypoint's sample value is its EXPLICIT key, else its implicitAngles
 *  capture (position-key full-pose). Null when neither exists anywhere */
function channelValueAt(
  waypoints: Waypoint[],
  times: number[],
  time: number,
  channel: AngleChannel,
): number | null {
  const keys = waypoints
    .map((w, i) => ({ v: w[channel] ?? w.implicitAngles?.[channel], t: times[i], w }))
    .filter((k): k is { v: number; t: number; w: Waypoint } => k.v != null)
  if (keys.length === 0) return null
  if (keys.length === 1 || time <= keys[0].t) return keys[0].v
  if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  let i = 1
  while (i < keys.length && keys[i].t < time) i += 1
  const a = keys[i - 1]
  const b = keys[i]
  const eased = easeParam((time - a.t) / Math.max(b.t - a.t, 1e-6), channel, a.w, b.w)
  const delta = channel === 'heading' ? angleDeltaDeg(a.v, b.v) : b.v - a.v
  return a.v + delta * eased
}

/** heading/pitch/roll at route progress, independent of the position group —
 *  null when that channel has no keys anywhere */
export function sampleAngleChannel(
  route: Route,
  progress: number,
  channel: AngleChannel,
): number | null {
  const { waypoints } = route
  if (waypoints.length === 0) return null
  const { times, total } = waypointTimes(waypoints)
  return channelValueAt(waypoints, times, clamp(progress, 0, 1) * total, channel)
}

/**
 * Sample the camera pose at progress ∈ [0,1]. Each channel group interpolates
 * over ITS OWN key subchain (waypoints carrying that field):
 *   position group — Catmull-Rom over the positioned waypoints (none → null)
 *   heading / pitch / roll / fov — independent shortest-arc / linear
 *   blends; a channel with no keys anywhere falls back to its default
 * Outside the first/last key of a subchain the end value is held. Time
 * inside a subchain segment is eased with smoothstep, exactly as the
 * original bundled model (identical output when every waypoint is full).
 */
export function samplePose(route: Route, progress: number): Pose | null {
  const { waypoints } = route
  if (waypoints.length === 0) return null

  const { times, total } = waypointTimes(waypoints)
  const time = clamp(progress, 0, 1) * total

  /* ---- position group ---- */
  const pos = waypoints
    .map((w, i) => ({ w, t: times[i] }))
    .filter((k) => hasPosition(k.w))
  if (pos.length === 0) return null

  const pick = (k: { w: Waypoint }) => ({ lon: k.w.lon!, lat: k.w.lat!, height: k.w.height! })
  let place: { lon: number; lat: number; height: number }
  if (pos.length === 1 || time <= pos[0].t) {
    place = pick(pos[0])
  } else if (time >= pos[pos.length - 1].t) {
    place = pick(pos[pos.length - 1])
  } else {
    let i = 1
    while (i < pos.length && pos[i].t < time) i += 1
    const b = pos[i - 1]
    const c = pos[i]
    const local = (time - b.t) / Math.max(c.t - b.t, 1e-6)
    const a = pos[i - 2] ?? b
    const d = pos[i + 1] ?? c
    /* each position axis carries its OWN easing (GES keeps 经度/纬度/海拔 as
       separate attribute keys even though they share the waypoint slot) */
    place = {
      lon: catmullRom(
        a.w.lon!,
        b.w.lon!,
        c.w.lon!,
        d.w.lon!,
        easeParam(local, 'lon', b.w, c.w),
      ),
      lat: catmullRom(
        a.w.lat!,
        b.w.lat!,
        c.w.lat!,
        d.w.lat!,
        easeParam(local, 'lat', b.w, c.w),
      ),
      height: Math.max(
        0,
        catmullRom(
          a.w.height!,
          b.w.height!,
          c.w.height!,
          d.w.height!,
          easeParam(local, 'height', b.w, c.w),
        ),
      ),
    }
  }

  /* ---- independent angle channels ---- */
  const pose: Pose = {
    ...place,
    heading: channelValueAt(waypoints, times, time, 'heading') ?? 0,
    pitch: channelValueAt(waypoints, times, time, 'pitch') ?? DEFAULT_WP_PITCH,
    roll: channelValueAt(waypoints, times, time, 'roll') ?? 0,
    fov: channelValueAt(waypoints, times, time, 'fov') ?? DEFAULT_FOV,
  }
  if (route.target) aimAtTarget(pose, route.target)
  return pose
}

/** total CONTENT duration in seconds (sum of the waypoint segments) */
export function totalDuration(route: Route): number {
  return buildSegments(route.waypoints).total
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** number of TIMED segments for a route: 'once' never flies the last
 *  waypoint's segment (its duration is a don't-care); loop modes close the
 *  circle back to the first waypoint, so every waypoint carries one */
function timedSegments(n: number, loopMode: LoopMode): number {
  return loopMode === 'once' ? Math.max(0, n - 1) : n
}

/**
 * Fresh durations for every waypoint AFTER a new one was appended, per the
 * insert strategy ('fixed' returns null — the new segment just keeps the
 * constant default). Pure; the store applies the result.
 *   even     — timelineLen / segments: the last key always lands exactly on
 *              the ruler end, existing manual timings are flattened
 *   distance — segments share the timeline length proportionally to their
 *              great-circle ground distance (loop modes include the closing
 *              last → first segment); degenerates to even when points coincide
 * The don't-care tail (last waypoint in 'once') still gets the even value so
 * the field never holds a stale number.
 */
export function retimeOnInsert(
  waypoints: Waypoint[],
  timelineLen: number,
  loopMode: LoopMode,
  strategy: InsertStrategy,
): number[] | null {
  const n = waypoints.length
  const segs = timedSegments(n, loopMode)
  if (strategy === 'fixed' || segs <= 0) return null

  const even = Math.max(0.1, round3(timelineLen / segs))
  if (strategy !== 'distance') return waypoints.map(() => even)

  const segDist: number[] = []
  /* pose-only waypoints have no ground distance — those segments count as 0
     (the even split covers them once the total degenerates) */
  for (let i = 0; i < n - 1; i += 1) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    segDist.push(
      a.lon != null && a.lat != null && b.lon != null && b.lat != null
        ? haversineM(a.lon, a.lat, b.lon, b.lat)
        : 0,
    )
  }
  if (loopMode !== 'once') {
    const first = waypoints[0]
    const last = waypoints[n - 1]
    segDist.push(
      first.lon != null && first.lat != null && last.lon != null && last.lat != null
        ? haversineM(last.lon, last.lat, first.lon, first.lat)
        : 0,
    )
  }
  const total = segDist.reduce((sum, d) => sum + d, 0)
  if (total <= 0) return waypoints.map(() => even)

  const out = waypoints.map(() => even)
  for (let i = 0; i < segs; i += 1) {
    out[i] = Math.max(0.1, round3((timelineLen * segDist[i]) / total))
  }
  return out
}

/** timeline length in seconds — the ruler / playback domain. Falls back to the
 *  content length for routes authored before the field existed. */
export function timelineDuration(route: Route): number {
  const len = route.timelineLen
  return Math.max(0.1, Number.isFinite(len) && len > 0 ? len : totalDuration(route))
}

/**
 * timeline progress (0..1 of the TIMELINE length) → route progress (0..1 of the
 * CONTENT). A timeline longer than the content therefore holds the final pose
 * for the leftover time instead of stretching the flight; a shorter one
 * truncates it. Identity whenever timeline length == content length.
 */
export function timelineProgressToRoute(route: Route, progress: number): number {
  const content = totalDuration(route)
  if (content <= 0) return 0
  return clamp((clamp(progress, 0, 1) * timelineDuration(route)) / content, 0, 1)
}

/** total frames for offline rendering — the TIMELINE length, min 2 */
export function frameCount(route: Route): number {
  return Math.max(2, Math.round(timelineDuration(route) * route.fps))
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
  /* only waypoints with a position key draw a track */
  const positioned = route.waypoints.filter(hasPosition)
  const origin = positioned[0]
  if (!origin) return points

  const metersPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180
  const originCosLat = Math.cos((origin.lat * Math.PI) / 180)
  let cumulative = 0

  positioned.forEach((w, index) => {
    if (index > 0) {
      const prev = positioned[index - 1]
      cumulative += haversineM(prev.lon!, prev.lat!, w.lon!, w.lat!)
    }
    points.push({
      lon: w.lon!,
      lat: w.lat!,
      height: w.height!,
      east: (w.lon! - origin.lon!) * metersPerDegLat * originCosLat,
      north: (w.lat! - origin.lat!) * metersPerDegLat,
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
