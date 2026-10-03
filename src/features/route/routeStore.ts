// Route store — single source of truth for route data, selection & playhead.
// Pure state: nothing here touches Cesium (the scene bridge subscribes).

import { create } from 'zustand'
import { createDemoRoute } from './demoRoute'
import { MAX_WAYPOINT_HEIGHT_M, type Route, type TargetPoint, type Waypoint } from './types'

interface RouteState {
  route: Route
  selectedWaypointId: string | null
  /** playhead as fraction of total duration, 0..1 */
  progress: number

  setRoute: (route: Route) => void
  setTarget: (target: TargetPoint | null) => void
  selectWaypoint: (id: string | null) => void
  setProgress: (p: number) => void
  updateWaypoint: (id: string, patch: Partial<Omit<Waypoint, 'id'>>) => void
}

export const useRoute = create<RouteState>((set) => ({
  route: createDemoRoute(),
  selectedWaypointId: null,
  progress: 0,

  setRoute: (route) => set({ route, selectedWaypointId: null, progress: 0 }),
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
