// Route store — single source of truth for route data, selection & playhead.
// Pure state: nothing here touches Cesium (the scene bridge subscribes).
//
// N 机位: the project owns a LIST of shots (each = one camera setup with its
// own route + growth curve). Every consumer keeps reading the derived `route`
// field (the ACTIVE shot's route), so the scene bridge, views, timeline and
// export all follow the edited 机位 with zero changes. Shot switching mirrors
// the active id into the reveal store (per-shot growth keys).

import { create } from 'zustand'
import { useUI } from '../../store/ui'
import { useReveal } from './revealStore'
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
  type FreeCam,
  type Pose,
  type ProgramCut,
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

/** one 机位 (camera setup): a route plus its editing identity */
export type Shot = {
  id: string
  name: string
  route: Route
  /** framing memory for free navigation — see FreeCam. Not part of `route`:
   *  writing it never touches the derived field, so entity effects stay quiet */
  freeCam: FreeCam | null
}

let shotSeq = 0
function createShotId(): string {
  shotSeq += 1
  return `shot-${Date.now().toString(36)}-${shotSeq}`
}

/** fresh empty route for a newly created 机位 (same seed as project start) */
function freshRoute(): Route {
  return {
    name: 'Untitled route',
    waypoints: [],
    fps: DEFAULT_FPS,
    loopMode: 'once',
    target: null,
    timelineLen: DEFAULT_TIMELINE_LEN,
    insertStrategy: 'fixed',
  }
}

/** program invariant: sorted by t and never two CONSECUTIVE cuts on the
 *  same shot — a redundant boundary is invisible in the edit, so it goes */
function mergeCuts(cuts: ProgramCut[]): ProgramCut[] {
  const sorted = [...cuts].sort((a, b) => a.t - b.t)
  return sorted.filter((c, i) => i === 0 || sorted[i - 1].shotId !== c.shotId)
}

/** WHICH 机位 is on the program at this playhead fraction (null = nothing
 *  编排 yet). The Program Out monitor renders exactly this shot's framing —
 *  the same lookup the exporter will use. */
export function programShotAt(program: ProgramCut[], progress: number): string | null {
  let on: string | null = null
  for (const c of program) {
    if (c.t <= progress + 1e-6) on = c.shotId
    else break
  }
  return on
}


interface RouteState {
  /** every 机位 — the timeline shows one accordion group per shot */
  shots: Shot[]
  /** the shot being edited (single-open accordion). `null` = nothing is being
   *  edited right now (e.g. after collapsing the active 机位 — see
   *  toggleMinimizedShot). The whole app must tolerate this state. */
  activeShotId: string | null
  /** DERIVED compat: the ACTIVE shot's route, kept in sync by every action —
   *  the whole app (scene bridge, views, export, settings) reads only this
   *  and automatically follows the edited 机位. Never set it directly.
   *  `null` whenever activeShotId is null. */
  route: Route | null
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

  setActiveShot: (id: string | null) => void
  /** create a fresh 机位 right after the active one and start editing it */
  addShot: () => void
  /** delete a 机位 (never the last one); deleting the active one activates a
   *  neighbour — keyframe/growth data of the shot goes with it */
  removeShot: (id: string) => void
  renameShot: (id: string, name: string) => void

  /** record the main globe's free-navigation camera onto a shot (framing
   *  memory — see FreeCam). Never touches `route`, so the derived field and
   *  the entity effects stay quiet. */
  setFreeCam: (shotId: string, cam: FreeCam) => void

  /** collapsed-to-rail shots (small thumbs on the right); empty = 等分 (every
   *  shot tiles the main grid). FULLY decoupled from activeShotId: the shot
   *  being edited may itself be collapsed — its editor view is the appended
   *  main-globe slot (see ViewportStage) */
  minimizedShotIds: string[]
  /** double-click anywhere (pane slot / rail thumb): move THIS shot between
   *  the main grid and the rail — never affects any other shot */
  toggleMinimizedShot: (id: string) => void

  /** 主输出 (program) — the edit-decision list: which 机位 is on the program
   *  from which playhead moment. Sorted by t; the last cut holds to the end.
   *  An empty program means nothing is 编排 yet. */
  program: ProgramCut[]
  /** 轨道锁 (the padlock on the 主输出 header): ON refuses EVERY program
   *  write — boundary drags, keyboard edits, drag-drop creation AND the
   *  cut-link activation cut (a linked activation still switches the edit
   *  target, it just doesn't cut). Browsing stays free. */
  programLocked: boolean
  /** the selected SEGMENT (index into `program`: cut i owns [t_i, t_i+1)).
   *  The keyboard & dblclick commands address this segment; null = none. */
  programSelection: number | null
  /** program edit history — snapshots taken BEFORE each committed edit */
  programPast: ProgramCut[][]
  programFuture: ProgramCut[][]

  /** drag a boundary (rail handle) to a new playhead fraction */
  moveProgramCut: (index: number, t: number) => void
  /** remove a boundary — its segment merges back into the previous one */
  removeProgramCut: (index: number) => void
  /** snapshot before a GESTURE edit series (boundary drag): the moves
   *  themselves don't push, so one gesture = one undo step */
  beginProgramEdit: () => void
  /** add / replace a cut at t (drag-drop from a 机位 header, `P` at the
   *  playhead) and select the new segment */
  insertProgramCut: (shotId: string, t: number) => void
  /** blade at t: split the owning segment in two (same 机位) and select the
   *  tail, ready to relink via 数字键 / the dblclick menu */
  splitProgramAt: (t: number) => void
  /** magnetic delete: segment i's duration is removed and every later cut
   *  shifts left (the program shrinks; nothing plays the deleted 机位) */
  deleteProgramSeg: (index: number) => void
  /** relink segment i to another 机位 (数字键 1-9 / the dblclick menu) */
  setProgramSegShot: (index: number, shotId: string) => void
  /** magnetic reorder: the boundary slots stay, the 机位 order swaps (the
   *  segment's duration travels with its shot) */
  reorderProgramSeg: (from: number, to: number) => void
  selectProgramSeg: (index: number | null) => void
  setProgramLocked: (on?: boolean) => void
  undoProgram: () => void
  redoProgram: () => void
}

export const useRoute = create<RouteState>((set) => {
  /** every route write goes through this: patch the ACTIVE shot inside
   *  shots[] AND refresh the derived compat field `route` in the same set()
   *  — the two can never drift apart. With NO active shot there is nothing
   *  to write (and `route` must stay null), so it no-ops. */
  const patch = (s: RouteState, route: Route): Partial<RouteState> =>
    s.activeShotId == null
      ? {}
      : {
          route,
          shots: s.shots.map((sh) => (sh.id === s.activeShotId ? { ...sh, route } : sh)),
        }

  /** history wrapper — every COMMITTED program write goes through here
   *  (discrete edits and the cut-link activation cut; gesture moves push
   *  once via beginProgramEdit instead). 50-deep, branch-clearing. */
  const commit = (s: RouteState, next: ProgramCut[]): Partial<RouteState> => ({
    programPast: [...s.programPast.slice(-49), s.program],
    programFuture: [],
    program: next,
  })

  const initialShot: Shot = {
    id: createShotId(),
    name: '机位 1',
    route: freshRoute(),
    freeCam: null,
  }

  return {
  /* start empty — waypoints are authored by clicking the top view;
     the demo route is available via the drawer's "Load demo" button */
  shots: [initialShot],
  activeShotId: initialShot.id,
  route: initialShot.route,
  selectedWaypointId: null,
  progress: 0,
  minimizedShotIds: [],
  program: [],
  programLocked: false,
  programSelection: null,
  programPast: [],
  programFuture: [],

  setRoute: (route) =>
    set((s) => ({ ...patch(s, normalizeRoute(route)), selectedWaypointId: null, progress: 0 })),
  addWaypoint: (lon, lat) =>
    set((s) => {
      if (!s.route) return {}
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
      return patch(s, {
        ...s.route,
        waypoints: retimed
          ? waypoints.map((w, i) => ({ ...w, duration: retimed[i] }))
          : waypoints,
      })
    }),
  setTarget: (target) => set((s) => (s.route ? patch(s, { ...s.route, target }) : {})),
  selectWaypoint: (id) => set({ selectedWaypointId: id }),
  setProgress: (progress) =>
    set({ progress: Math.min(1, Math.max(0, progress)) }),
  updateWaypoint: (id, patch_wp) =>
    set((s) => {
      if (!s.route) return {}
      return patch(s, {
        ...s.route,
        waypoints: s.route.waypoints.map((w) => {
          if (w.id !== id) return w
          const next = { ...w, ...patch_wp }
          if (typeof patch_wp.height === 'number') {
            next.height = Math.min(Math.max(0, patch_wp.height), MAX_WAYPOINT_HEIGHT_M)
          }
          return next
        }),
      })
    }),
  removeWaypoint: (id) =>
    set((s) => {
      if (!s.route) return {}
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
        ...patch(s, { ...s.route, waypoints: next }),
        selectedWaypointId: s.selectedWaypointId === id ? null : s.selectedWaypointId,
      }
    }),
  insertKeyframeAtPlayhead: (group, seedPose) =>
    set((s) => {
      const route = s.route
      if (!route) return {}
      const { progress } = s
      const { waypoints } = route
      const routeProg = timelineProgressToRoute(route, progress)

      /* the VALUE the new key carries: WYSIWYG — the live camera when there
         is one, else the group's current value at the playhead (a key that
         merely pins the interpolated value); nothing to draw from → no-op */
      let fields: Partial<Omit<Waypoint, 'id'>>
      if (group === 'position') {
        const src = seedPose ?? samplePose(route, routeProg)
        if (!src) return {}
        fields = { lon: src.lon, lat: src.lat, height: src.height }
      } else {
        const v = seedPose?.[group] ?? sampleAngleChannel(route, routeProg, group)
        if (v == null) return {}
        fields =
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
          ...fields,
          duration: DEFAULT_WAYPOINT_DURATION,
        })
        return { ...patch(s, { ...route, waypoints: [waypoint] }), selectedWaypointId: waypoint.id }
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
            ...patch(s, { ...route, waypoints: [withImplicit({ ...waypoints[0], ...fields })] }),
            selectedWaypointId: waypoints[0].id,
          }
        }
        const firstDur = round3(Math.max(0.1, tPlay))
        const waypoint: Waypoint = withImplicit({
          id: createWaypointId(),
          ...fields,
          duration: DEFAULT_WAYPOINT_DURATION,
        })
        return {
          ...patch(s, {
            ...route,
            waypoints: [{ ...waypoints[0], duration: firstDur }, waypoint],
          }),
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
        next[k] = withImplicit({ ...waypoints[k], ...fields })
        return { ...patch(s, { ...route, waypoints: next }), selectedWaypointId: waypoints[k].id }
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

      const waypoint: Waypoint = withImplicit({ id: createWaypointId(), ...fields, duration: nextDur })
      const next = [...waypoints]
      next[at - 1] = { ...waypoints[at - 1], duration: prevDur }
      next.splice(at, 0, waypoint)
      return {
        ...patch(s, { ...route, waypoints: next }),
        selectedWaypointId: waypoint.id,
      }
    }),
  setFps: (fps) => set((s) => (s.route ? patch(s, { ...s.route, fps }) : {})),
  setInsertStrategy: (insertStrategy) => set((s) => (s.route ? patch(s, { ...s.route, insertStrategy }) : {})),
  setTimelineLen: (len, scaleKeys) =>
    set((s) => {
      if (!s.route) return {}
      const prev = timelineDuration(s.route)
      const next = Math.max(MIN_TIMELINE_LEN, round3(len))
      if (!scaleKeys) return patch(s, { ...s.route, timelineLen: next })
      /* 等比缩放: re-time every segment by newLength/oldLength (GES semantics) */
      const factor = next / prev
      return patch(s, {
        ...s.route,
        timelineLen: next,
        waypoints: s.route.waypoints.map((w) => ({
          ...w,
          duration: Math.max(0.1, round3((w.duration || DEFAULT_WAYPOINT_DURATION) * factor)),
        })),
      })
    }),
  fitTimeline: () =>
    set((s) => {
      if (!s.route) return {}
      const content = totalDuration(s.route)
      if (content <= 0) return {}
      return patch(s, { ...s.route, timelineLen: round3(Math.max(MIN_TIMELINE_LEN, content)) })
    }),

  setActiveShot: (id) =>
    set((s) => {
      /* null = clear the edit target (nothing being edited) */
      if (id == null) {
        if (s.activeShotId == null) return {}
        useReveal.getState().setActiveShot(null)
        return { activeShotId: null, route: null, selectedWaypointId: null }
      }
      const shot = s.shots.find((sh) => sh.id === id)
      if (!shot || id === s.activeShotId) return {}
      /* growth keys are per-shot: the reveal mirror follows the switch */
      useReveal.getState().setActiveShot(id)
      /* 切镜联动 (the 🔗 toggle on the 主输出 header): OFF = activation is
         PURE edit-target switching — the program timeline stays untouched
         (browse/edit shots without polluting the cut). The 轨道锁 has the
         same effect: a locked lane refuses the cut too (the lock outranks
         the link — UI greys the chain out while locked). */
      if (!useUI.getState().cutLink || s.programLocked) {
        return { activeShotId: id, route: shot.route, selectedWaypointId: null }
      }
      /* ON (default): activating a shot IS the director's cut — from the
         CURRENT playhead the program switches to it. A boundary sitting
         exactly at the playhead is REPLACED; later boundaries survive (they
         keep shaping the rest of the program); a cut onto the shot already
         on air is a no-op. The cut COMMITS to the program history (one
         activation = one undo step). */
      const t = s.progress
      const eps = 1e-4
      const withoutAtT = s.program.filter((c) => Math.abs(c.t - t) >= eps)
      let onShot: string | null = null
      for (const c of withoutAtT) {
        if (c.t <= t + eps) onShot = c.shotId
      }
      if (onShot === id && withoutAtT.length === s.program.length) {
        return { activeShotId: id, route: shot.route, selectedWaypointId: null }
      }
      return {
        activeShotId: id,
        route: shot.route,
        selectedWaypointId: null,
        ...commit(s, mergeCuts([...withoutAtT, { t, shotId: id }])),
      }
    }),
  addShot: () =>
    set((s) => {
      const shot: Shot = {
        id: createShotId(),
        name: `机位 ${s.shots.length + 1}`,
        route: freshRoute(),
        freeCam: null,
      }
      const i = s.shots.findIndex((sh) => sh.id === s.activeShotId)
      const at = i === -1 ? s.shots.length : i + 1
      const shots = [...s.shots.slice(0, at), shot, ...s.shots.slice(at)]
      useReveal.getState().setActiveShot(shot.id)
      return { shots, activeShotId: shot.id, route: shot.route, selectedWaypointId: null }
    }),
  removeShot: (id) =>
    set((s) => {
      if (s.shots.length <= 1) return {}
      const i = s.shots.findIndex((sh) => sh.id === id)
      if (i === -1) return {}
      const shots = s.shots.filter((sh) => sh.id !== id)
      const wasActive = id === s.activeShotId
      const minimizedShotIds = s.minimizedShotIds.filter((mid) => mid !== id)
      useReveal.getState().dropShot(id)
      /* deleting the ACTIVE shot always hands the edit target to a neighbour
         (there is never a dangling edit) */
      if (wasActive) {
        const next = shots[i] ?? shots[shots.length - 1]
        useReveal.getState().setActiveShot(next.id)
        return {
          shots,
          activeShotId: next.id,
          route: next.route,
          selectedWaypointId: null,
          minimizedShotIds,
          /* the program loses the deleted shot's segments (undoable) */
          ...commit(s, mergeCuts(s.program.filter((c) => c.shotId !== id))),
          programSelection: null,
        }
      }
      /* deleting a NON-active shot: keep the current edit target AS-IS — it
         may legitimately be `null` (nothing being edited) */
      return {
        shots,
        activeShotId: s.activeShotId,
        route: s.route,
        selectedWaypointId: s.selectedWaypointId,
        minimizedShotIds,
        ...commit(s, mergeCuts(s.program.filter((c) => c.shotId !== id))),
        programSelection: null,
      }
    }),
  renameShot: (id, name) =>
    set((s) => ({ shots: s.shots.map((sh) => (sh.id === id ? { ...sh, name } : sh)) })),
  setFreeCam: (shotId, cam) =>
    set((s) => ({
      shots: s.shots.map((sh) => (sh.id === shotId ? { ...sh, freeCam: cam } : sh)),
    })),
  toggleMinimizedShot: (id) =>
    set((s) => {
      if (!s.shots.some((sh) => sh.id === id)) return {}
      const has = s.minimizedShotIds.includes(id)
      /* expanding a rail thumb just moves it back to the grid — never re-arms
         editing (activating is still an explicit click) */
      if (has) {
        return { minimizedShotIds: s.minimizedShotIds.filter((m) => m !== id) }
      }
      const collapsed = [...s.minimizedShotIds, id]
      /* collapsing the ACTIVE shot also clears the edit target (用户 A 方案):
         the shot leaves the main grid entirely and there is no longer a
         "正在编辑" 机位 — the appended editor slot must not linger */
      if (id === s.activeShotId) {
        useReveal.getState().setActiveShot(null)
        return { minimizedShotIds: collapsed, activeShotId: null, route: null, selectedWaypointId: null }
      }
      return { minimizedShotIds: collapsed }
    }),
  moveProgramCut: (index, t) =>
    set((s) => {
      if (s.programLocked) return {}
      const cuts = s.program
      const c = cuts[index]
      if (!c) return {}
      /* clamp between the neighbours so the order never breaks */
      const lo = index > 0 ? cuts[index - 1].t + 1e-3 : 0
      const hi = index < cuts.length - 1 ? cuts[index + 1].t - 1e-3 : 1
      const nt = Math.min(hi, Math.max(lo, t))
      if (Math.abs(nt - c.t) < 1e-6) return {}
      /* NO history push here — the UI wraps the gesture in beginProgramEdit
         (one drag = one undo step) */
      return { program: cuts.map((x, i) => (i === index ? { ...x, t: nt } : x)) }
    }),
  removeProgramCut: (index) =>
    set((s) => {
      if (s.programLocked) return {}
      const prev = s.program[index - 1]
      return {
        ...commit(s, mergeCuts(s.program.filter((_, i) => i !== index))),
        /* the merge lands on the LEFT neighbour — keep it selected */
        programSelection: prev ? index - 1 : null,
      }
    }),
  beginProgramEdit: () =>
    set((s) => {
      if (s.programLocked) return {}
      return { programPast: [...s.programPast.slice(-49), s.program], programFuture: [] }
    }),
  insertProgramCut: (shotId, t) =>
    set((s) => {
      if (s.programLocked) return {}
      if (!s.shots.some((sh) => sh.id === shotId)) return {}
      const tt = Math.min(1, Math.max(0, t))
      const eps = 1e-4
      const without = s.program.filter((c) => Math.abs(c.t - tt) >= eps)
      const next = mergeCuts([...without, { t: tt, shotId }])
      const at = next.findIndex((c) => c.shotId === shotId && Math.abs(c.t - tt) < eps)
      return { ...commit(s, next), programSelection: at === -1 ? null : at }
    }),
  splitProgramAt: (t) =>
    set((s) => {
      if (s.programLocked) return {}
      const tt = Math.min(1, Math.max(0, t))
      /* the owning segment = the last cut at/before tt (a leading gap has
         no segment — nothing to split there) */
      let owner = -1
      s.program.forEach((c, i) => {
        if (c.t <= tt + 1e-6) owner = i
      })
      if (owner === -1) return {}
      const eps = 1e-4
      if (s.program[owner].t > tt - eps) return {}
      /* deliberately NOT mergeCuts: the split point is a same-shot boundary
         (the visible marker for the tail about to be relinked). It folds
         away by itself once the tail gets another 机位 — or when the
         boundary is deleted / any later mergeCuts pass runs. */
      const next = [...s.program, { t: tt, shotId: s.program[owner].shotId }].sort(
        (a, b) => a.t - b.t,
      )
      const at = next.findIndex((c) => Math.abs(c.t - tt) < eps)
      return { ...commit(s, next), programSelection: at === -1 ? null : at }
    }),
  deleteProgramSeg: (index) =>
    set((s) => {
      if (s.programLocked) return {}
      const cuts = s.program
      const c = cuts[index]
      if (!c) return {}
      const end = index + 1 < cuts.length ? cuts[index + 1].t : 1
      const dur = end - c.t
      /* magnetic: the segment's cut goes AND every later cut shifts left by
         its duration — the program shrinks, the timeline never re-plays the
         deleted 机位 */
      const next = mergeCuts(
        cuts
          .filter((_, i) => i !== index)
          .map((x) => (x.t > c.t ? { ...x, t: x.t - dur } : x)),
      )
      return {
        ...commit(s, next),
        programSelection: next.length ? Math.min(index, next.length - 1) : null,
      }
    }),
  setProgramSegShot: (index, shotId) =>
    set((s) => {
      if (s.programLocked) return {}
      const c = s.program[index]
      if (!c || c.shotId === shotId) return {}
      if (!s.shots.some((sh) => sh.id === shotId)) return {}
      const next = mergeCuts(s.program.map((x, i) => (i === index ? { ...x, shotId } : x)))
      /* mergeCuts may fold this cut into a same-shot neighbour — re-locate
         the selection by TIME (the boundary the user clicked keeps meaning
         "this segment") */
      const at = next.findIndex((x) => Math.abs(x.t - c.t) < 1e-6)
      return { ...commit(s, next), programSelection: at === -1 ? null : at }
    }),
  reorderProgramSeg: (from, to) =>
    set((s) => {
      if (s.programLocked) return {}
      const cuts = s.program
      if (cuts.length < 2) return {}
      if (from < 0 || from >= cuts.length || to < 0 || to >= cuts.length) return {}
      if (from === to) return {}
      /* magnetic reorder: the SEGMENT SLOTS (boundary times) stay exactly
         where they are, the 机位 order swaps — each shot's DURATION travels
         with it (FCP-style clip move) */
      const ids = cuts.map((c) => c.shotId)
      const [movedId] = ids.splice(from, 1)
      ids.splice(to, 0, movedId)
      const next = mergeCuts(cuts.map((c, i) => ({ ...c, shotId: ids[i] })))
      const movedT = cuts[from].t
      const at = next.findIndex((c) => Math.abs(c.t - movedT) < 1e-6)
      return { ...commit(s, next), programSelection: at === -1 ? null : at }
    }),
  selectProgramSeg: (index) => set({ programSelection: index }),
  setProgramLocked: (on) =>
    set((s) => ({ programLocked: on ?? !s.programLocked, programSelection: null })),
  undoProgram: () =>
    set((s) => {
      if (s.programLocked) return {}
      const prev = s.programPast[s.programPast.length - 1]
      if (!prev) return {}
      return {
        program: prev,
        programPast: s.programPast.slice(0, -1),
        programFuture: [...s.programFuture, s.program],
        programSelection: null,
      }
    }),
  redoProgram: () =>
    set((s) => {
      if (s.programLocked) return {}
      const next = s.programFuture[s.programFuture.length - 1]
      if (!next) return {}
      return {
        program: next,
        programPast: [...s.programPast, s.program],
        programFuture: s.programFuture.slice(0, -1),
        programSelection: null,
      }
    }),
  }
})

/* reveal keys are PER-SHOT: hand the initial shot's id to the mirror store so
   both agree from the first render (reveal never imports back → no cycle). */
useReveal.getState().setActiveShot(useRoute.getState().activeShotId)
