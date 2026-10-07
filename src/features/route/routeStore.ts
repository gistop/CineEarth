// Route store — single source of truth for route data, selection & playhead.
// Pure state: nothing here touches Cesium (the scene bridge subscribes).

import { create } from 'zustand'
import {
  bearingDeg,
  clamp,
  retimeOnInsert,
  sampleAngleChannel,
  samplePose,
  timelineDuration,
  timelineProgressToRoute,
  totalDuration,
  waypointFractions,
} from './pathMath'
import {
  DEFAULT_FPS,
  DEFAULT_TIMELINE_LEN,
  DEFAULT_WP_PITCH,
  DEFAULT_WAYPOINT_DURATION,
  MAX_WAYPOINT_HEIGHT_M,
  createWaypointId,
  hasPosition,
  type InsertGroup,
  type InsertStrategy,
  type Pose,
  type Route,
  type TargetPoint,
  type Waypoint,
} from './types'

/** default camera height for the first clicked waypoint (metres) */
const DEFAULT_WP_HEIGHT_M = 3000
/** hard floor for the timeline length (seconds) */
const MIN_TIMELINE_LEN = 0.1
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** routes from disk / the demo may predate a field — fill the gaps */
function normalizeRoute(route: Route): Route {
  const content = totalDuration(route)
  return {
    ...route,
    fps: route.fps > 0 ? route.fps : DEFAULT_FPS,
    insertStrategy: route.insertStrategy ?? 'fixed',
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
  /** delete a waypoint by id. A middle key merges its segment into the
   *  predecessor (content timing and every later key's time preserved);
   *  first/last keys just drop out (the last one's duration was the
   *  never-flown tail). */
  removeWaypoint: (id: string) => void
  /**
   * Insert a keyframe for ONE channel group at the playhead (GES-style
   * add-key): 'position' keys lon/lat/height together (bundled group),
   * each angle channel keys independently. The value is WYSIWYG — the live
   * camera pose when available, else the group's current value at the
   * playhead; a position key from the live camera also stores the framed
   * angles as implicitAngles (sampled at lowest priority, never rendered
   * as channel keys). A waypoint already sitting at the playhead simply
   * carries the new group's field; otherwise a fresh waypoint is spliced
   * in (splitting the segment, 0.1 s floor). Cold start (0/1 keys) seeds
   * or appends instead. No-op when the group already has a key there.
   */
  insertKeyframeAtPlayhead: (group: InsertGroup, seedPose?: Pose | null) => void
  setFps: (fps: number) => void
  /**
   * Switch the insert strategy (固定 / 均分 / 距离). Editor preference for
   * FUTURE inserts only — existing segment timings are never rewritten.
   */
  setInsertStrategy: (strategy: InsertStrategy) => void
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
    insertStrategy: 'fixed',
  },
  selectedWaypointId: null,
  progress: 0,

  setRoute: (route) =>
    set({ route: normalizeRoute(route), selectedWaypointId: null, progress: 0 }),
  addWaypoint: (lon, lat) =>
    set((s) => {
      /* inherit height from the previous waypoint, face along the travel
         direction (a pose-only waypoint has no position to inherit/bear) */
      const prev = s.route.waypoints[s.route.waypoints.length - 1]
      const prevPlaced = prev != null && hasPosition(prev)
      const waypoint: Waypoint = {
        id: createWaypointId(),
        lon,
        lat,
        height: prevPlaced ? prev!.height! : DEFAULT_WP_HEIGHT_M,
        heading: prevPlaced ? bearingDeg(prev!.lon!, prev!.lat!, lon, lat) : 0,
        pitch: DEFAULT_WP_PITCH,
        roll: 0,
        duration: DEFAULT_WAYPOINT_DURATION,
      }
      const waypoints = [...s.route.waypoints, waypoint]
      /* 均分 / 距离 strategies re-time every segment around the AUTHORITATIVE
         timeline length on each insert, so the content end always lands
         exactly on the ruler end; 'fixed' keeps the constant default */
      const retimed = retimeOnInsert(
        waypoints,
        timelineDuration({ ...s.route, waypoints }),
        s.route.loopMode,
        s.route.insertStrategy,
      )
      return {
        route: {
          ...s.route,
          waypoints: retimed
            ? waypoints.map((w, i) => ({ ...w, duration: retimed[i] }))
            : waypoints,
        },
      }
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
  removeWaypoint: (id) =>
    set((s) => {
      const { waypoints } = s.route
      const i = waypoints.findIndex((w) => w.id === id)
      if (i === -1) return {}
      const next = [...waypoints]
      const [removed] = next.splice(i, 1)
      /* middle key: the predecessor absorbs its segment so the total
         content timing (and all later key times) stay put */
      if (i > 0 && i < waypoints.length - 1) {
        next[i - 1] = {
          ...next[i - 1],
          duration: round3(next[i - 1].duration + removed.duration),
        }
      }
      return {
        route: { ...s.route, waypoints: next },
        selectedWaypointId: s.selectedWaypointId === id ? null : s.selectedWaypointId,
      }
    }),
  insertKeyframeAtPlayhead: (group, seedPose) =>
    set((s) => {
      const { route, progress } = s
      const { waypoints } = route
      const routeProg = timelineProgressToRoute(route, progress)

      /* the VALUE the new key carries: WYSIWYG — the live camera when there
         is one, else the group's current value at the playhead (a key that
         merely pins the interpolated value); nothing to draw from → no-op */
      let patch: Partial<Omit<Waypoint, 'id'>>
      if (group === 'position') {
        const src = seedPose ?? samplePose(route, routeProg)
        if (!src) return {}
        patch = { lon: src.lon, lat: src.lat, height: src.height }
      } else {
        const v = seedPose?.[group] ?? sampleAngleChannel(route, routeProg, group)
        if (v == null) return {}
        patch =
          group === 'heading'
            ? { heading: v }
            : group === 'pitch'
              ? { pitch: v }
              : group === 'roll'
                ? { roll: v }
                : { fov: v }
      }
      const carries = (w: Waypoint) =>
        group === 'position' ? hasPosition(w) : w[group] != null

      /* full-pose capture (A): a position key written from the LIVE camera
         also records the angles the framed camera had — as IMPLICIT angles
         on the waypoint, never as channel keys. Sampling treats them as the
         lowest-priority source (explicit heading/pitch/roll keys win), so
         the scrub preview equals the framed camera instead of snapping to
         the angle-channel defaults (heading 0 / default pitch), while the
         angle tracks stay untouched — GES keeps the bundled position insert
         and the independent angle inserts separate. The sampled fallback
         (no viewer) records nothing: pinning interpolated angles would bake
         the defaults as keys. */
      const seedImplicit =
        group === 'position' && seedPose
          ? { heading: seedPose.heading, pitch: seedPose.pitch, roll: seedPose.roll, fov: seedPose.fov }
          : null
      const withImplicit = (w: Waypoint): Waypoint =>
        seedImplicit ? { ...w, implicitAngles: seedImplicit } : w

      /* cold start, 0 keys: the first waypoint carries ONLY this group */
      if (waypoints.length === 0) {
        const waypoint: Waypoint = withImplicit({
          id: createWaypointId(),
          ...patch,
          duration: DEFAULT_WAYPOINT_DURATION,
        })
        return { route: { ...route, waypoints: [waypoint] }, selectedWaypointId: waypoint.id }
      }

      /* cold start, 1 key: playhead ON the lone key → same dedup/patch rule
         as the multi-key path below (carries → no-op, else just add the
         field, no timing change). Playhead anywhere past it → append a
         second key AT the playhead time (0.1 s out at least), again only
         this group */
      if (waypoints.length === 1) {
        const tPlay = clamp(progress, 0, 1) * timelineDuration(route)
        if (tPlay < 0.05) {
          if (carries(waypoints[0])) return {}
          return {
            route: { ...route, waypoints: [withImplicit({ ...waypoints[0], ...patch })] },
            selectedWaypointId: waypoints[0].id,
          }
        }
        const firstDur = round3(Math.max(0.1, tPlay))
        const waypoint: Waypoint = withImplicit({
          id: createWaypointId(),
          ...patch,
          duration: DEFAULT_WAYPOINT_DURATION,
        })
        return {
          route: {
            ...route,
            waypoints: [{ ...waypoints[0], duration: firstDur }, waypoint],
          },
          selectedWaypointId: waypoint.id,
        }
      }

      const total = totalDuration(route)
      const times = waypointFractions(route).map((f) => f * total)
      /* insert time = the playhead's absolute TIMELINE second. Inside the
         content this equals the route second 1:1, but past the last key it
         keeps growing instead of clamping onto it — route progress clamps
         at 1 (= the last key), which silently deduped every past-the-end
         playhead into a no-op and made appending keys past the last one
         impossible (the append branch below was unreachable) */
      const T = clamp(progress, 0, 1) * timelineDuration(route)

      /* a waypoint already sits at the playhead → this group either already
         has its key there (nothing to add) or the waypoint just carries
         the new group's field (no timing change at all) */
      const k = times.findIndex((t) => Math.abs(t - T) < 0.05)
      if (k !== -1) {
        if (carries(waypoints[k])) return {}
        const next = [...waypoints]
        next[k] = withImplicit({ ...waypoints[k], ...patch })
        return { route: { ...route, waypoints: next }, selectedWaypointId: waypoints[k].id }
      }

      /* splice index: first key strictly after the playhead; past the last
         key = append at the end */
      const after = times.findIndex((t) => t > T)
      const at = after === -1 ? waypoints.length : after

      /* split timing: the predecessor owns T - its start, the new key owns
         the rest of the original segment (0.1 s minimum, as key dragging) */
      const prevDur = round3(T - times[at - 1])
      const nextDur =
        after < waypoints.length ? round3(times[after] - T) : DEFAULT_WAYPOINT_DURATION
      if (prevDur < 0.1 || nextDur < 0.1) return {}

      const waypoint: Waypoint = withImplicit({ id: createWaypointId(), ...patch, duration: nextDur })
      const next = [...waypoints]
      next[at - 1] = { ...waypoints[at - 1], duration: prevDur }
      next.splice(at, 0, waypoint)
      return {
        route: { ...route, waypoints: next },
        selectedWaypointId: waypoint.id,
      }
    }),
  setFps: (fps) => set((s) => ({ route: { ...s.route, fps } })),
  setInsertStrategy: (insertStrategy) => set((s) => ({ route: { ...s.route, insertStrategy } })),
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
