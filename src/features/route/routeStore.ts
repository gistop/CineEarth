// Route store — single source of truth for route data, selection & playhead.
// Pure state: nothing here touches Cesium (the scene bridge subscribes).

import { create } from 'zustand'
import { bearingDeg, timelineDuration, totalDuration } from './pathMath'
import {
  DEFAULT_FPS,
  DEFAULT_TIMELINE_LEN,
  DEFAULT_WAYPOINT_DURATION,
  MAX_WAYPOINT_HEIGHT_M,
  createWaypointId,
  type Route,
  type TargetPoint,
  type Waypoint,
} from './types'

/** default camera height for the first clicked waypoint (metres) */
const DEFAULT_WP_HEIGHT_M = 3000
/** default camera pitch — gentle downward framing */
const DEFAULT_WP_PITCH = -12
/** hard floor for the timeline length (seconds) */
const MIN_TIMELINE_LEN = 0.1
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** routes from disk / the demo may predate a field — fill the gaps */
function normalizeRoute(route: Route): Route {
  const content = totalDuration(route)
  return {
    ...route,
    fps: route.fps > 0 ? route.fps : DEFAULT_FPS,
    /* a LOADED route keeps its content visible: fit the length to it unless
       the route carries its own (the 10 s default is for a fresh project) */
    timelineLen:
      route.timelineLen > 0
        ? route.timelineLen
        : Math.max(DEFAULT_TIMELINE_LEN, round3(content)),
  }
}

interface RouteState {
  route: Route
  selectedWaypointId: string | null
  /** playhead as a fraction of the TIMELINE LENGTH (not of the content), 0..1 */
  progress: number

  setRoute: (route: Route) => void
  addWaypoint: (lon: number, lat: number) => void
  setTarget: (target: TargetPoint | null) => void
  selectWaypoint: (id: string | null) => void
  setProgress: (p: number) => void
  updateWaypoint: (id: string, patch: Partial<Omit<Waypoint, 'id'>>) => void
  setFps: (fps: number) => void
  /**
   * Set the timeline length. `scaleKeys` also multiplies every segment
   * duration by newLength/oldLength (GES "等比缩放"), so the whole route is
   * re-timed into the new length. Without it the keys keep their absolute
   * times — content past the new end is KEPT, just out of range.
   */
  setTimelineLen: (len: number, scaleKeys: boolean) => void
  /** pull the timeline length back onto the content end (never touches keys) */
  fitTimeline: () => void
}

export const useRoute = create<RouteState>((set) => ({
  /* start empty — waypoints are authored by clicking the top view;
     the demo route is available via the drawer's "Load demo" button */
  route: {
    name: 'Untitled route',
    waypoints: [],
    fps: DEFAULT_FPS,
    loopMode: 'once',
    target: null,
    timelineLen: DEFAULT_TIMELINE_LEN,
  },
  selectedWaypointId: null,
  progress: 0,

  setRoute: (route) =>
    set({ route: normalizeRoute(route), selectedWaypointId: null, progress: 0 }),
  addWaypoint: (lon, lat) =>
    set((s) => {
      /* inherit height from the previous waypoint, face along the travel direction */
      const prev = s.route.waypoints[s.route.waypoints.length - 1]
      const waypoint: Waypoint = {
        id: createWaypointId(),
        lon,
        lat,
        height: prev ? prev.height : DEFAULT_WP_HEIGHT_M,
        heading: prev ? bearingDeg(prev.lon, prev.lat, lon, lat) : 0,
        pitch: DEFAULT_WP_PITCH,
        duration: DEFAULT_WAYPOINT_DURATION,
      }
      return { route: { ...s.route, waypoints: [...s.route.waypoints, waypoint] } }
    }),
  setTarget: (target) => set((s) => ({ route: { ...s.route, target } })),
  selectWaypoint: (id) => set({ selectedWaypointId: id }),
  setProgress: (progress) =>
    set({ progress: Math.min(1, Math.max(0, progress)) }),
  updateWaypoint: (id, patch) =>
    set((s) => ({
      route: {
        ...s.route,
        waypoints: s.route.waypoints.map((w) => {
          if (w.id !== id) return w
          const next = { ...w, ...patch }
          if (typeof patch.height === 'number') {
            next.height = Math.min(Math.max(0, patch.height), MAX_WAYPOINT_HEIGHT_M)
          }
          return next
        }),
      },
    })),
  setFps: (fps) => set((s) => ({ route: { ...s.route, fps } })),
  setTimelineLen: (len, scaleKeys) =>
    set((s) => {
      const prev = timelineDuration(s.route)
      const next = Math.max(MIN_TIMELINE_LEN, round3(len))
      if (!scaleKeys) return { route: { ...s.route, timelineLen: next } }
      /* 等比缩放: re-time every segment by newLength/oldLength (GES semantics) */
      const factor = next / prev
      return {
        route: {
          ...s.route,
          timelineLen: next,
          waypoints: s.route.waypoints.map((w) => ({
            ...w,
            duration: Math.max(0.1, round3((w.duration || DEFAULT_WAYPOINT_DURATION) * factor)),
          })),
        },
      }
    }),
  fitTimeline: () =>
    set((s) => {
      const content = totalDuration(s.route)
      if (content <= 0) return {}
      return { route: { ...s.route, timelineLen: round3(Math.max(MIN_TIMELINE_LEN, content)) } }
    }),
}))
