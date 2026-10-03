// Route store — single source of truth for route data, selection & playhead.
// Pure state: nothing here touches Cesium (the scene bridge subscribes).

import { create } from 'zustand'
import { bearingDeg } from './pathMath'
import {
  DEFAULT_FPS,
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

interface RouteState {
  route: Route
  selectedWaypointId: string | null
  /** playhead as fraction of total duration, 0..1 */
  progress: number

  setRoute: (route: Route) => void
  addWaypoint: (lon: number, lat: number) => void
  setTarget: (target: TargetPoint | null) => void
  selectWaypoint: (id: string | null) => void
  setProgress: (p: number) => void
  updateWaypoint: (id: string, patch: Partial<Omit<Waypoint, 'id'>>) => void
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
  },
  selectedWaypointId: null,
  progress: 0,

  setRoute: (route) => set({ route, selectedWaypointId: null, progress: 0 }),
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
}))
