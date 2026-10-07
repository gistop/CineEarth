// Route domain types — engine-agnostic (ported & adapted from CTEarth roam).
// A waypoint IS a camera keyframe: position + pose + duration to the next one.

export type Waypoint = {
  id: string
  /** degrees */
  lon: number
  lat: number
  /** metres above the ellipsoid */
  height: number
  /** deg, 0 = north, clockwise */
  heading: number
  /** deg, 0 = horizon, negative looks down */
  pitch: number
  /** seconds to fly to the NEXT waypoint (last one only matters in loop modes) */
  duration: number
}

export type LoopMode = 'once' | 'loop' | 'pingpong'

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
}

/** Camera pose at an instant (degrees / metres) */
export type Pose = {
  lon: number
  lat: number
  height: number
  heading: number
  pitch: number
}

export const DEFAULT_WAYPOINT_DURATION = 3
export const DEFAULT_FPS = 30
/** default timeline length for a fresh project (seconds) */
export const DEFAULT_TIMELINE_LEN = 10
/** hard ceiling for camera height — keeps Cesium geometry sane (Earth R ≈ 6.37e6 m) */
export const MAX_WAYPOINT_HEIGHT_M = 100_000

let seq = 0

export function createWaypointId(): string {
  seq += 1
  return `wp-${Date.now().toString(36)}-${seq}`
}
