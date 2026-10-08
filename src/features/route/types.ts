// Route domain types — engine-agnostic (ported & adapted from CTEarth roam).
// A waypoint is a slot on the shared time chain; each FIELD GROUP marks which
// keyframe channels have a key at that instant:
//   position group (lon/lat/height) — bundled, all-or-nothing
//   heading / pitch / roll / fov — four independent channels

/** per-key easing — GES 右键菜单: 线性 / 左右缓动 / 缓入 / 缓出 / 跳跃 */
export type EaseMode = 'linear' | 'both' | 'in' | 'out' | 'hold'

/** bezier control point normalized to ONE segment:
 *  x = fraction of the segment DURATION, y = fraction of the value DELTA.
 *  `out` lives on the segment's START key (drawn to its right), `in` on the
 *  END key (drawn to its left) — CSS cubic-bezier semantics. */
export type EaseHandle = { x: number; y: number }

export type EaseSpec = {
  mode: EaseMode
  /** shapes the segment to the NEXT key */
  out?: EaseHandle
  /** shapes the segment from the PREVIOUS key */
  in?: EaseHandle
}

/** channels that can carry their own easing (per attribute, GES-style) */
export type EaseChannel = 'lon' | 'lat' | 'height' | 'heading' | 'pitch' | 'roll' | 'fov'

/** seed control points per mode — handles only exist for the modes that draw
 *  them: 左右缓动 both sides, 缓入 left only, 缓出 right only */
export const EASE_SEED: Record<EaseMode, { in?: EaseHandle; out?: EaseHandle }> = {
  linear: {},
  both: { out: { x: 0.42, y: 0 }, in: { x: 0.58, y: 1 } },
  in: { in: { x: 0.58, y: 1 } },
  out: { out: { x: 0.42, y: 0 } },
  hold: {},
}

export type Waypoint = {
  id: string
  /** degrees — present = the position channel group has a key here */
  lon?: number
  lat?: number
  /** metres above the ellipsoid */
  height?: number
  /** deg, 0 = north, clockwise — present = heading channel has a key here */
  heading?: number
  /** deg, 0 = horizon, negative looks down — pitch channel */
  pitch?: number
  /** deg, 0 = level horizon (camera roll, GES 翻滚) — roll channel */
  roll?: number
  /** deg, vertical field of view (Cesium default 60) — fov channel */
  fov?: number
  /** angles captured IMPLICITLY when a position key is taken from the live
   *  camera (full-pose WYSIWYG): what the framed camera had at insert time.
   *  They join angle sampling at LOWEST priority — an explicit
   *  heading/pitch/roll/fov key always wins — and NEVER render as channel
   *  keys: GES keeps the bundled position insert and the independent
   *  angle inserts visually separate. */
  implicitAngles?: { heading: number; pitch: number; roll: number; fov: number }
  /** seconds to fly to the NEXT waypoint (last one only matters in loop modes) */
  duration: number
  /** per-CHANNEL easing (absent = the legacy smoothstep default) */
  ease?: Partial<Record<EaseChannel, EaseSpec>>
}

export type LoopMode = 'once' | 'loop' | 'pingpong'

/** how segments are (re-)timed when a waypoint is inserted by a map click:
 *  fixed    — every segment keeps the constant DEFAULT_WAYPOINT_DURATION
 *  even     — the timeline length is split evenly across all segments
 *  distance — segments share the timeline length proportionally to their
 *             great-circle ground distance */
export type InsertStrategy = 'fixed' | 'even' | 'distance'

/** which channel group an insert-keyframe action targets: the bundled
 *  position trio, or one independent angle/fov channel */
export type InsertGroup = 'position' | 'heading' | 'pitch' | 'roll' | 'fov'

/** Look-at anchor pinned on the globe — when set, heading/pitch are auto-solved */
export type TargetPoint = {
  lon: number
  lat: number
  /** metres above the ellipsoid */
  height: number
}

export type Route = {
  name: string
  waypoints: Waypoint[]
  fps: number
  loopMode: LoopMode
  /** camera target — null means waypoints' own heading/pitch are used */
  target: TargetPoint | null
  /** timeline length in SECONDS — the ruler / playback domain. Authoritative:
   *  it does NOT follow the waypoints. Content past it is kept (never
   *  destroyed), just out of range until the length grows again. */
  timelineLen: number
  /** segment-timing strategy for map-click inserts — part of the project data
   *  (not editor prefs) so an imported route behaves identically. Switching it
   *  never re-times existing segments. */
  insertStrategy: InsertStrategy
}

/** Camera pose at an instant (degrees / metres) */
export type Pose = {
  lon: number
  lat: number
  height: number
  heading: number
  pitch: number
  roll: number
  /** deg, vertical FOV */
  fov: number
}

export const DEFAULT_WAYPOINT_DURATION = 3
/** default camera pitch — gentle downward framing (used when the pitch
 *  channel has no key at all) */
export const DEFAULT_WP_PITCH = -12
/** default vertical FOV — matches Cesium's PerspectiveFrustum default (π/3) */
export const DEFAULT_FOV = 60
export const DEFAULT_FPS = 30
/** default timeline length for a fresh project (seconds) */
export const DEFAULT_TIMELINE_LEN = 10
/** hard ceiling for camera height — keeps Cesium geometry sane (Earth R ≈ 6.37e6 m) */
export const MAX_WAYPOINT_HEIGHT_M = 100_000

/** position group is bundled: all three or none. Type guard — filtering
 *  with it narrows the optional fields to numbers. */
export function hasPosition(
  w: Waypoint,
): w is Waypoint & { lon: number; lat: number; height: number } {
  return w.lon != null && w.lat != null && w.height != null
}

let seq = 0

export function createWaypointId(): string {
  seq += 1
  return `wp-${Date.now().toString(36)}-${seq}`
}
