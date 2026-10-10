import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useUI } from '../store/ui'
import { TagIcon } from './Icons'
import { useRoute } from '../features/route/routeStore'
import { useReveal } from '../features/route/revealStore'
import {
  angleDeltaDeg,
  easeFraction,
  normalizeAngleDeg,
  samplePose,
  timelineDuration,
  timelineProgressToRoute,
  totalDuration,
  waypointFractions,
} from '../features/route/pathMath'
import {
  DEFAULT_FOV,
  DEFAULT_WAYPOINT_DURATION,
  EASE_SEED,
  type EaseMode,
  type EaseSpec,
  type InsertGroup,
  type Pose,
  type Waypoint,
} from '../features/route/types'
import { PerspectiveFrustum } from 'cesium'
import { getViewer } from '../cesium/viewerRegistry'
import {
  cameraChannelKeys,
  clampChannelValue,
  formatChannelValue,
  type ChannelId,
  type ChannelKey,
} from '../features/route/cameraChannels'
import TimelineSettings from './TimelineSettings'

/** live 3D camera as a route Pose (degrees, north-clockwise heading) — the
 *  seed the insert-key buttons use when the route has no keys yet; null when
 *  the globe isn't mounted. */
function currentCameraPose(): Pose | null {
  const cam = getViewer()?.camera
  if (!cam) return null
  const deg = 180 / Math.PI
  const carto = cam.positionCartographic
  return {
    lon: carto.longitude * deg,
    lat: carto.latitude * deg,
    height: carto.height,
    heading: normalizeAngleDeg(cam.heading * deg),
    pitch: cam.pitch * deg,
    /* Cesium's roll getter returns [0, 2π): a LEVEL camera reads as
       2π-ε → 359.99°, not 0. Fold it into [-180, 180] (level = 0,
       ±180 = the same upside-down pose) — roll keys interpolate LINEARLY
       over the stored values, so a raw 359.99 next to a 0 key would spin
       the horizon through a full turn between the two. */
    roll: angleDeltaDeg(0, cam.roll * deg),
    /* frustum.fov (radians) → deg; Cesium types it optional (a frustum may be
       built from fovy instead) and non-perspective falls back to the default */
    fov:
      cam.frustum instanceof PerspectiveFrustum && cam.frustum.fov != null
        ? cam.frustum.fov * deg
        : DEFAULT_FOV,
  }
}

/**
 * Expanded multi-track editor (GES-style).
 * - Track label = row selection: click = the lane column shows THAT channel's
 *   detail (attribute rows: the value-mapped curve pane), click again = clear.
 *   The label column keeps every row — a selection never hides a track name.
 * - Keys are rubber-band selectable (drag on empty area) and selected keys
 *   drag horizontally in time: waypoint keys rewrite segment durations,
 *   growth keys move their t (single growth key keeps the y = % adjust).
 * All camera channels (incl. FOV) derive from waypoints.
 */


type TrackId = ChannelId | 'growth'

/** key ids: `wp:<index>` for waypoint-projected keys, `gr:<id>` for growth keys */
const wpId = (i: number) => `wp:${i}`

/** smallest zoomed-in view window (seconds) */
const MIN_VIEW = 0.2

type Marquee = { x0: number; y0: number; x1: number; y1: number }

/** one channel key projected for the lane (time span + value + easing) */
type KeySpan = {
  left: number
  title: string
  keyId: string
  tSec: number
  chip: string
  wp: number
  raw: string
  /** unformatted value — curve-mode y position + drag baseline */
  value: number
  ease?: EaseSpec
}

/** value range the soloed channel's curve is drawn over */
type CurveRange = { min: number; max: number }

/** GES 右键菜单 — modes whose name carries 缓 draw handles */
const EASE_ITEMS: { mode: EaseMode; label: string }[] = [
  { mode: 'linear', label: '线性' },
  { mode: 'both', label: '左右缓动' },
  { mode: 'in', label: '缓入 · 左手柄' },
  { mode: 'out', label: '缓出 · 右手柄' },
  { mode: 'hold', label: '跳跃' },
]

/** the seven GES attribute rows, in display order */const CHANNEL_ROWS: { id: ChannelId; label: string; group: InsertGroup }[] = [
  { id: 'lon', label: '相机经度', group: 'position' },
  { id: 'lat', label: '相机纬度', group: 'position' },
  { id: 'height', label: '相机海拔', group: 'position' },
  { id: 'heading', label: '相机平移', group: 'heading' },
  { id: 'pitch', label: '相机倾斜', group: 'pitch' },
  { id: 'roll', label: '相机翻滚', group: 'roll' },
  { id: 'fov', label: '相机视野', group: 'fov' },
]

type DragState = {
  kind: 'wp' | 'gr' | 'handle'
  startX: number
  startY: number
  laneW: number
  /** lane origin/frame at drag start — px → time/value conversion needs both */
  laneLeft: number
  /** CONTENT length (seconds) — wp/growth base fractions are fractions of it */
  total: number
  /** TIMELINE length (seconds) — the domain the px→time delta rides */
  timeline: number
  /** visible window at drag start — px→time conversion depends on the zoom */
  viewStart: number
  viewSpan: number
  /** waypoint time fractions at drag start (feedback-free snapshot) */
  baseFractions: number[]
  wpIds: string[]
  /** growth keys snapshot at drag start */
  growthBase: { id: string; t: number; value: number }[]
  /** curve mode: vertical (value) drag of one channel's keys */
  curve?: {
    ch: ChannelId
    vmin: number
    vmax: number
    laneTop: number
    laneH: number
    /** keyId → value at drag start */
    baseVals: Record<string, number>
  }
  /** ease specs at drag start, keyed by waypoint id — a wp drag re-projects
   *  every handle against this base (see the 手柄随关键点刚性 comment) */
  easeBase?: Record<string, Partial<Record<ChannelId, EaseSpec>>>
  /** ease-handle drag: the control point of segment a→b on one channel */
  handle?: {
    wp: number
    ch: ChannelId
    side: 'in' | 'out'
    aT: number
    bT: number
    aV: number
    bV: number
    /** the lane's value window — px→value must unwrap the SAME axis the lane
     *  drew with (the padded auto-fit), NOT the segment's own delta */
    vmin: number
    vmax: number
    laneTop: number
    laneH: number
    /** the key's OTHER segment (缓入/缓出 partner). GES 自动缓动 keeps the
     *  two controls collinear through the key, so dragging one mirrors the
     *  other; absent at the chain's ends (no neighbour to mirror into) */
    opp?: { aT: number; bT: number; aV: number; bV: number }
  }
}

/** visible window of the expanded timeline (seconds, already clamped) */
export type TlView = { start: number; span: number }

/** clamp a raw view against the current duration — shared by the tracks grid
 *  and the bar ruler so both always agree on the window (Timeline.tsx feeds
 *  the ruler; stale out-of-range windows can survive route duration edits) */
export function clampView(v: TlView, duration: number): TlView {
  const span = Math.min(Math.max(v.span, MIN_VIEW), duration)
  const start = Math.min(Math.max(v.start, 0), duration - span)
  return { start, span }
}

/** brush gesture on the overview ruler (focus–context, d3 style) */
type BrushDrag =
  | { kind: 'pan'; x0: number; start0: number }
  | { kind: 'resize-l'; end: number }
  | { kind: 'resize-r'; start: number }
  | { kind: 'new'; t0: number; x0: number; moved: boolean }
  | { kind: 'scrub' }

/** THE one ruler — lives in the transport bar in BOTH states and never moves.
 *  Focus–context (d3 style): it is ALWAYS the full 0→duration overview
 *  mini-map; expanded, the live view window rides on top as a gray brush —
 *  drag the brush to pan, drag its end handles to zoom, brush empty space to
 *  select a new window, plain-click to move the playhead, dbl-click to reset. */
export function TimelineRuler({ view }: { view?: TlView }) {
  const route = useRoute((s) => s.route)
  const progress = useRoute((s) => s.progress)
  const setProgress = useRoute((s) => s.setProgress)
  const setScrubbing = useUI((s) => s.setScrubbing)
  const setTlView = useUI((s) => s.setTlView)
  const resetTlView = useUI((s) => s.resetTlView)
  /* display unit — 'frame' re-labels ticks/readouts through route fps */
  const tlUnit = useUI((s) => s.tlUnit)

  const laneRef = useRef<HTMLDivElement>(null)
  /* active brush gesture (expanded only) */
  const brushRef = useRef<BrushDrag | null>(null)

  /* the TIMELINE domain (settings 长度) — authoritative, not the content end */
  const DURATION = timelineDuration(route)
  /* focus–context: ALWAYS the full-overview mapping — the window is drawn
   *  as the brush overlay, the ruler itself never re-scales */
  const pct = (tSec: number) => (tSec / DURATION) * 100
  const ticks = buildTicks(DURATION)
  /* the playhead flag itself carries the seconds readout; frame number
   *  feeds the a11y slider text */
  const frame = Math.floor(progress * DURATION * route.fps)
  const phLeft = pct(progress * DURATION)

  /* view/duration via refs for the native wheel handler (stale-closure guard) */
  const viewRef = useRef(view)
  viewRef.current = view
  const durRef = useRef(DURATION)
  durRef.current = DURATION
  const hasView = view != null

  /* wheel-zoom (expanded only): anchored at the OVERVIEW time under the
   *  cursor (the ruler is now the mini-map, so the anchor maps through 0..dur,
   *  not through the window). passive:false — React's onWheel can't preventDefault. */
  useEffect(() => {
    if (!hasView) return
    const el = laneRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      const v = viewRef.current
      if (!v) return
      zoomAtView(v, e.deltaY < 0 ? 1 / 1.18 : 1.18, ratio * durRef.current, durRef.current, setTlView)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasView, setTlView])

  /** collapsed: drag = playhead scrub through the full overview */
  const scrubRuler = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setProgress(ratio)
  }

  /** overview x → seconds (expanded brush math) */
  const timeAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * DURATION
  }

  return (
    <div
      ref={laneRef}
      className="ce-tl-ruler"
      title={
        view
          ? '拖灰色区域平移 · 拖两端缩放 · 空白处刷选窗口 · 单击定位播放头 · 双击复位全程'
          : '拖动刮擦播放头'
      }
      role="slider"
      aria-label="播放头"
      aria-valuemin={0}
      aria-valuemax={Math.round(DURATION * 10) / 10}
      aria-valuenow={Math.round(progress * DURATION * 10) / 10}
      aria-valuetext={`${(progress * DURATION).toFixed(1)} 秒，第 ${frame} 帧`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        if (e.button !== 0) return
        /* expanded: the gesture goes to the brush (pan / resize / new window);
           dragging the playhead flag always scrubs; collapsed: plain scrub */
        if (view) {
          const el = e.currentTarget
          const target = e.target as HTMLElement
          if (target.closest('.ce-ruler-ph')) {
            brushRef.current = { kind: 'scrub' }
            setScrubbing(true)
            return
          }
          const handle = target.closest<HTMLElement>('.ce-ruler-brush-h')
          if (handle) {
            brushRef.current =
              handle.dataset.side === 'l'
                ? { kind: 'resize-l', end: view.start + view.span }
                : { kind: 'resize-r', start: view.start }
          } else if (target.closest('.ce-ruler-brush')) {
            brushRef.current = { kind: 'pan', x0: e.clientX, start0: view.start }
          } else {
            brushRef.current = { kind: 'new', t0: timeAt(e.clientX, el), x0: e.clientX, moved: false }
          }
          return
        }
        setScrubbing(true)
        scrubRuler(e)
      }}
      onPointerMove={(e) => {
        const b = brushRef.current
        if (b && view && e.buttons === 1) {
          const el = e.currentTarget
          if (b.kind === 'scrub') {
            setProgress(timeAt(e.clientX, el) / DURATION)
          } else if (b.kind === 'pan') {
            const dt = ((e.clientX - b.x0) / el.getBoundingClientRect().width) * DURATION
            setTlView(clampView({ start: b.start0 + dt, span: view.span }, DURATION))
          } else if (b.kind === 'resize-l') {
            const t = Math.min(Math.max(timeAt(e.clientX, el), 0), b.end - MIN_VIEW)
            setTlView(clampView({ start: t, span: b.end - t }, DURATION))
          } else if (b.kind === 'resize-r') {
            const t = Math.min(Math.max(timeAt(e.clientX, el), b.start + MIN_VIEW), DURATION)
            setTlView(clampView({ start: b.start, span: t - b.start }, DURATION))
          } else {
            /* brush empty space → live new-window selection (d3 behaviour) */
            if (!b.moved && Math.abs(e.clientX - b.x0) < 4) return
            b.moved = true
            const t = timeAt(e.clientX, el)
            const a = Math.min(b.t0, t)
            const z = Math.max(b.t0, t)
            if (z - a >= MIN_VIEW) setTlView(clampView({ start: a, span: z - a }, DURATION))
          }
          return
        }
        if (!view && e.buttons === 1) scrubRuler(e)
      }}
      onPointerUp={(e) => {
        const b = brushRef.current
        brushRef.current = null
        setScrubbing(false)
        /* bare click on empty overview = park the playhead there */
        if (b?.kind === 'new' && !b.moved) setProgress(timeAt(e.clientX, e.currentTarget) / DURATION)
      }}
      onPointerCancel={() => {
        brushRef.current = null
        setScrubbing(false)
      }}
      onAuxClick={(e) => e.preventDefault()}
      /* double-click resets to fit-all (replaces the old scrollbar gesture) */
      onDoubleClick={() => {
        if (view) resetTlView()
      }}
      onKeyDown={(e) => {
        /* step: one frame in frame unit, else 0.5 s per keypress */
        const step = (tlUnit === 'frame' ? 1 / route.fps : 0.5) / DURATION
        if (e.key === 'ArrowLeft') setProgress(progress - step)
        else if (e.key === 'ArrowRight') setProgress(progress + step)
        else if (e.key === 'Home') setProgress(0)
        else if (e.key === 'End') setProgress(1)
        else return
        e.preventDefault()
      }}
    >
      {/* scrub-strip read: track + fill up to the playhead (full-overview mapping) */}
      <span className="ce-tl-ruler-track" aria-hidden="true" />
      <span className="ce-tl-ruler-fill" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      {/* focus–context brush: the live view window as a gray region on the
          overview (expanded only; full-extent = fit-all) — drag = pan,
          end handles = zoom. Sits UNDER ticks/badge/ph (labels stay readable,
          the ph flag stays directly draggable for scrubbing). */}
      {view && (
        <span
          className="ce-ruler-brush"
          aria-hidden="true"
          style={{ left: `${pct(view.start)}%`, width: `${(view.span / DURATION) * 100}%` }}
        >
          <span className="ce-ruler-brush-h" data-side="l" />
          <span className="ce-ruler-brush-h" data-side="r" />
        </span>
      )}
      {ticks.map((s) => (
        <span
          key={s}
          className={`ce-ruler-tick${s === 0 ? ' is-zero' : ''}`}
          style={{ left: `${pct(s)}%` }}
        >
          {formatTick(s, tlUnit, route.fps)}
        </span>
      ))}
      {/* GES-style playhead handle — wide head carries the time readout
          (seconds, or the frame number in frame unit), small pointer
          underneath marks the exact time. Draggable as before. */}
      <span className="ce-ruler-ph" style={{ left: `${phLeft}%` }} aria-hidden="true">
        {tlUnit === 'frame' ? Math.round(progress * DURATION * route.fps) : (progress * DURATION).toFixed(1)}
      </span>
    </div>
  )
}

/** nice-step ticks for a view window — step chosen so labels never collide.
 *  Frame unit picks steps in whole FRAMES (then maps back to seconds) so
 *  labels stay integers for any fps (e.g. 0.1 s × 25 fps = 2.5 would not). */
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const FRAME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3000]

type TlUnit = 'sec' | 'frame'

function ticksFor(view: TlView, laneW: number, duration: number, fps: number, unit: TlUnit): number[] {
  const pxPerSec = laneW > 0 ? laneW / view.span : view.span
  const minGap = 54 // px between label centres

  if (unit === 'frame') {
    const pxPerFrame = pxPerSec / fps
    let stepF = FRAME_STEPS[FRAME_STEPS.length - 1]
    for (const f of FRAME_STEPS) {
      if (f * pxPerFrame >= minGap) {
        stepF = f
        break
      }
    }
    const firstF = Math.ceil((view.start * fps) / stepF - 1e-6) * stepF
    const out: number[] = []
    for (
      let f = firstF;
      f <= (view.start + view.span) * fps + 1e-6 && f <= duration * fps + 1e-6;
      f += stepF
    ) {
      out.push(Math.round((f / fps) * 1000) / 1000)
    }
    return out
  }

  let step = TICK_STEPS[TICK_STEPS.length - 1]
  for (const s of TICK_STEPS) {
    if (s * pxPerSec >= minGap) {
      step = s
      break
    }
  }
  const first = Math.ceil(view.start / step - 1e-6) * step
  const out: number[] = []
  for (let t = first; t <= view.start + view.span + 1e-6 && t <= duration + 1e-6; t += step) {
    out.push(Math.round(t * 1000) / 1000)
  }
  return out
}

function formatTick(t: number, unit: TlUnit, fps: number): string {
  if (unit === 'frame') return String(Math.round(t * fps))
  return `${t % 1 === 0 ? t : t.toFixed(1)}s`
}

/** zoom around a fixed time anchor (the cursor's time), clamped to the route */
function zoomAtView(
  v: TlView,
  factor: number,
  anchorSec: number,
  duration: number,
  set: (x: TlView) => void,
): void {
  const span = Math.min(Math.max(v.span * factor, MIN_VIEW), duration)
  const start = Math.min(
    Math.max(anchorSec - (anchorSec - v.start) * (span / v.span), 0),
    duration - span,
  )
  set({ start, span })
}

export default function TimelineTracks() {
  /* ONE selected channel drives the LANE column only: the label column always
     renders every row (so the track list never re-flows), while the lanes area
     shows just the selected channel's detail — see .ce-lanes.is-detail. */
  const [solo, setSolo] = useState<TrackId | null>(null)
  const toggleSolo = (id: TrackId) => setSolo((cur) => (cur === id ? null : id))

  /** unified key selection (wp:<i> | gr:<id>) shared by every track */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<Marquee | null>(null)

  const route = useRoute((s) => s.route)
  const progress = useRoute((s) => s.progress)
  const updateWaypoint = useRoute((s) => s.updateWaypoint)
  const removeWaypoint = useRoute((s) => s.removeWaypoint)
  const insertKeyframe = useRoute((s) => s.insertKeyframeAtPlayhead)
  /* insert buttons always carry the live camera pose — WYSIWYG: the store
     prefers the seed whenever the globe is mounted (any key count), falling
     back to the route's interpolated value only without a viewer. Each row
     targets its own channel group: lon/lat/height share the bundled position
     group, the three angles are independent. */
  const insertFromCamera = (group: InsertGroup) => insertKeyframe(group, currentCameraPose())
  const tlView = useUI((s) => s.tlView)
  const setTlView = useUI((s) => s.setTlView)
  const tlUnit = useUI((s) => s.tlUnit)

  const growthLine = useReveal((s) => s.growthLine)
  const revealKeys = useReveal((s) => s.keys)
  const addRevealKey = useReveal((s) => s.addKey)
  const moveRevealKey = useReveal((s) => s.moveKey)
  const removeRevealKey = useReveal((s) => s.removeKey)

  /* TIMELINE domain (settings 长度) vs CONTENT end: camera keys live at their
   *  absolute seconds inside the content, everything is drawn in timeline
   *  seconds. Equal whenever 长度 == content length (the common case). */
  const DURATION = timelineDuration(route)
  const content = totalDuration(route)
  /* effective viewport — clamped on read so route edits (duration changes)
   * can never leave a stale out-of-range window */
  const { start: viewStart, span: viewSpan } = clampView(tlView, DURATION)
  const view: TlView = { start: viewStart, span: viewSpan }
  /** seconds → lane percent under the current window */
  const pct = (tSec: number) => ((tSec - viewStart) / viewSpan) * 100
  const channels = cameraChannelKeys(route)
  /* channel readouts follow the playhead pose — through the timeline mapping,
     so a longer timeline holds the final pose instead of stretching it */
  const pose = samplePose(route, timelineProgressToRoute(route, progress))
  const sortedRevealKeys = [...revealKeys].sort((a, b) => a.t - b.t)

  /* ----- GES solo curve editor ------------------------------------------
     Solo on an ATTRIBUTE row turns that lane into a value-mapped curve: the
     keys keep their time on x and take their value on y. */
  const curveId: ChannelId | null = solo && solo !== 'growth' ? solo : null
  const [dragRange, setDragRange] = useState<CurveRange | null>(null)
  const [menu, setMenu] = useState<{ wp: number; ch: ChannelId; x: number; y: number } | null>(null)
  const openKeyMenu = (wp: number, ch: ChannelId, x: number, y: number) => setMenu({ wp, ch, x, y })
  const applyEase = (wp: number, ch: ChannelId, mode: EaseMode | null) => {
    const w = route.waypoints[wp]
    if (w) {
      const cur = { ...(w.ease ?? {}) }
      if (mode === null) delete cur[ch]
      else cur[ch] = { mode, ...EASE_SEED[mode] }
      updateWaypoint(w.id, { ease: cur })
    }
    setMenu(null)
  }
  /* auto-fit the value axis around this channel's keys AND ease handles,
     padded 12%. Frozen while a drag runs (dragRange) — a live re-fit would
     rescale the axis under the cursor and the key would run away from the
     pointer. */
  const curveRange: CurveRange | null = (() => {
    if (!curveId) return null
    const ks = channels[curveId]
    if (ks.length === 0) return { min: 0, max: 1 }
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    ks.forEach((k) => {
      if (k.value < min) min = k.value
      if (k.value > max) max = k.value
    })
    /* GES: ease handles ride FREE in value, so the axis fits around them
       too — after the gesture the overshooting control comes back into
       view (拖完后坐标轴自适应). The flown curve stays in the hull of
       keys+handles, so covering the handles covers the sampled values. */
    const see = (v: number) => {
      if (Number.isFinite(v)) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    ks.forEach((k, i) => {
      const e = k.ease
      if (!e) return
      const prv = ks[i - 1]
      const nxt = ks[i + 1]
      if (e.out && nxt) see(k.value + e.out.y * (nxt.value - k.value))
      if (e.in && prv) see(prv.value + e.in.y * (k.value - prv.value))
    })
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
    if (max - min < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.05, 1)
      min -= pad
      max += pad
    }
    const pad = (max - min) * 0.12
    return { min: min - pad, max: max + pad }
  })()
  const range = dragRange ?? curveRange

  /* ----- rubber-band selection & key dragging (container-level) ----- */
  const rootRef = useRef<HTMLDivElement>(null)
  const marqueeStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  /* middle-drag pan state (Blender) */
  const panRef = useRef<{ x0: number; start0: number; span: number; laneW: number } | null>(null)
  /* latest view for the native wheel handler (avoids stale closures) */
  const viewRef = useRef(view)
  viewRef.current = view
  const durRef = useRef(DURATION)
  durRef.current = DURATION
  const axisRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  /* axis width feeds the focus-tick density (same rule as the bar ruler had) */
  const [axisW, setAxisW] = useState(0)
  useEffect(() => {
    const el = axisRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setAxisW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* The lane scroller reserves a right-hand gutter for its vertical bar
   * (scrollbar-gutter: stable) and the browser sizes that gutter itself —
   * `scrollbar-width: thin` makes Chrome ignore ::-webkit-scrollbar widths.
   * Measure it and publish it as --ce-lanes-gutter so the tracks padding and
   * the axis overlay both end exactly on the ruler's right edge.
   * Layout effect: this feeds the row-width math, so it must land in the same
   * frame as the expand (no one-frame short lane column). */
  useLayoutEffect(() => {
    const lanes = lanesRef.current
    const root = rootRef.current
    if (!lanes || !root) return
    const sync = () =>
      root.style.setProperty('--ce-lanes-gutter', `${lanes.offsetWidth - lanes.clientWidth}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(lanes)
    return () => ro.disconnect()
  }, [])

  /** Blender wheel-zoom: anchored at the time under the cursor (passive:false
   *  — React's onWheel is passive and can't preventDefault page scroll) */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      /* the settings column owns its own scroll/hover — never zoom through it */
      if ((e.target as HTMLElement).closest('.ce-tl-settings')) return
      const ax = axisRef.current
      if (!ax) return
      const r = ax.getBoundingClientRect()
      if (r.width < 2) return
      e.preventDefault()
      const v = viewRef.current
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      zoomAtView(v, e.deltaY < 0 ? 1 / 1.18 : 1.18, v.start + ratio * v.span, durRef.current, setTlView)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [setTlView])

  /** auto-follow (Blender behaviour): while playing, pan the window so the
   *  playhead that runs off the edge stays visible */
  useEffect(
    () =>
      useRoute.subscribe((s) => {
        const { playing, scrubbing, tlView: v } = useUI.getState()
        if (!playing || scrubbing) return
        const dur = timelineDuration(s.route)
        const span = Math.min(Math.max(v.span, MIN_VIEW), dur)
        if (span >= dur) return // fit-all — nothing to pan
        const t = s.progress * dur
        if (t > v.start + span) {
          useUI.getState().setTlView({ start: Math.min(t - span * 0.85, dur - span), span })
        } else if (t < v.start) {
          useUI.getState().setTlView({ start: Math.max(0, t - span * 0.15), span })
        }
      }),
    [],
  )

  const marqueeRect = (m: Marquee) =>
    new DOMRect(
      Math.min(m.x0, m.x1),
      Math.min(m.y0, m.y1),
      Math.abs(m.x1 - m.x0),
      Math.abs(m.y1 - m.y0),
    )

  /** every key whose rendered box intersects the marquee */
  const keysInMarquee = (m: Marquee): Set<string> => {
    const root = rootRef.current
    const ids = new Set<string>()
    if (!root) return ids
    const rect = marqueeRect(m)
    root.querySelectorAll<HTMLElement>('.ce-key[data-key]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) {
        ids.add(el.dataset.key as string)
      }
    })
    return ids
  }

  const onRootPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (!root) return

    /* middle-drag = pan the view window (Blender) */
    if (e.button === 1) {
      e.preventDefault()
      panRef.current = {
        x0: e.clientX,
        start0: viewStart,
        span: viewSpan,
        laneW: axisRef.current?.getBoundingClientRect().width || 1,
      }
      root.setPointerCapture(e.pointerId)
      return
    }

    if (e.button !== 0) return

    /* any click in the grid dismisses the ease menu (it stops its own) */
    if (menu) setMenu(null)

    /* ease handle (curve mode): drag the bezier control point of a segment */
    const hEl = (e.target as HTMLElement).closest<HTMLElement>('.ce-ease-h[data-h]')
    if (hEl) {
      e.preventDefault()
      const hLane = hEl.closest('.ce-track-lane') as HTMLElement | null
      const hr = hLane?.getBoundingClientRect()
      /* data-h = "wp序号:side" — the channel rides the separate data-ch
         attribute (the key id itself is "wp:N"; embedding it would split
         into three parts and poison wp with NaN) */
      const [hWp, hSide] = (hEl.dataset.h as string).split(':')
      const hd = hEl.dataset
      const laneVmin = Number(hd.vmin ?? hLane?.dataset.vmin)
      const laneVmax = Number(hd.vmax ?? hLane?.dataset.vmax)
      /* freeze the value axis for this gesture: curveRange now refits around
         HANDLE values too, so a live refit mid-drag would rescale the axis
         under the cursor and the handle would run away from the pointer —
         same reason key drags freeze. Cleared with the others on pointerup. */
      if (Number.isFinite(laneVmin) && Number.isFinite(laneVmax)) {
        setDragRange({ min: laneVmin, max: laneVmax })
      }
      dragRef.current = {
        kind: 'handle',
        startX: e.clientX,
        startY: e.clientY,
        laneW: hr?.width || 1,
        laneLeft: hr?.left ?? 0,
        total: content,
        timeline: DURATION,
        viewStart,
        viewSpan,
        baseFractions: [],
        wpIds: [],
        growthBase: [],
        handle: {
          wp: Number(hWp),
          ch: hd.ch as ChannelId,
          side: hSide === 'in' ? 'in' : 'out',
          aT: Number(hd.at),
          bT: Number(hd.bt),
          aV: Number(hd.av),
          bV: Number(hd.bv),
          /* the axis the lane is drawn on (data-vmin/vmax are published by the
             lane in curve mode); malformed values fall back to the segment */
          vmin: Number.isFinite(laneVmin) ? laneVmin : Number(hd.av),
          vmax: Number.isFinite(laneVmax) ? laneVmax : Number(hd.bv),
          laneTop: hr?.top ?? 0,
          laneH: hr?.height || 1,
          opp:
            hd.oat != null && hd.obt != null && hd.oav != null && hd.obv != null
              ? {
                  aT: Number(hd.oat),
                  bT: Number(hd.obt),
                  aV: Number(hd.oav),
                  bV: Number(hd.obv),
                }
              : undefined,
        },
      }
      root.setPointerCapture(e.pointerId)
      return
    }

    const keyEl = (e.target as HTMLElement).closest<HTMLElement>('.ce-key[data-key]')
    if (keyEl) {
      e.preventDefault()
      const id = keyEl.dataset.key as string
      let sel = selected
      if (e.shiftKey) {
        sel = new Set(selected)
        if (sel.has(id)) sel.delete(id)
        else sel.add(id)
        setSelected(sel)
        if (!sel.has(id)) return // shift-toggled off — no drag
      } else if (!selected.has(id)) {
        sel = new Set([id])
        setSelected(sel)
      }
      const lane = keyEl.closest('.ce-track-lane') as HTMLElement | null
      const laneRect = lane?.getBoundingClientRect()
      /* curve mode: the lane publishes its value window, and a key carrying
         data-ch adds the vertical (value) axis to the drag */
      const keyCh = keyEl.dataset.ch as ChannelId | undefined
      const curve =
        keyCh && lane?.dataset.vmin != null
          ? {
              ch: keyCh,
              vmin: Number(lane.dataset.vmin),
              vmax: Number(lane.dataset.vmax),
              laneTop: laneRect?.top ?? 0,
              laneH: laneRect?.height || 1,
              baseVals: Object.fromEntries(
                Array.from(root.querySelectorAll<HTMLElement>('.ce-key[data-ch]')).map((el) => [
                  el.dataset.key as string,
                  Number(el.dataset.val),
                ]),
              ) as Record<string, number>,
            }
          : undefined
      if (curve) setDragRange({ min: curve.vmin, max: curve.vmax })
      dragRef.current = {
        kind: id.startsWith('wp:') ? 'wp' : 'gr',
        startX: e.clientX,
        startY: e.clientY,
        laneW: laneRect?.width || 1,
        laneLeft: laneRect?.left ?? 0,
        /* wp/growth base fractions are fractions of the CONTENT, while the
           px→time delta rides the TIMELINE view span */
        total: content,
        timeline: DURATION,
        viewStart,
        viewSpan,
        baseFractions: waypointFractions(route),
        wpIds: route.waypoints.map((w) => w.id),
        growthBase: revealKeys.map((k) => ({ id: k.id, t: k.t, value: k.value })),
        curve,
        easeBase: Object.fromEntries(route.waypoints.map((w) => [w.id, w.ease ?? {}])),
      }
      root.setPointerCapture(e.pointerId)
      return
    }

    /* form controls (settings column) own their clicks — no marquee there */
    if ((e.target as HTMLElement).closest('button, input, select, .ce-tl-settings')) return
    // empty area → marquee (4px threshold keeps plain clicks / dblclick intact)
    marqueeStartRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
    root.setPointerCapture(e.pointerId)
  }

  const onRootPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current
    if (p && e.buttons === 4) {
      setTlView(
        clampView({ start: p.start0 + ((e.clientX - p.x0) / p.laneW) * p.span, span: p.span }, DURATION),
      )
      return
    }
    const ms = marqueeStartRef.current
    if (ms) {
      if (!ms.moved && Math.hypot(e.clientX - ms.x, e.clientY - ms.y) < 4) return
      ms.moved = true
      const m: Marquee = { x0: ms.x, y0: ms.y, x1: e.clientX, y1: e.clientY }
      setMarquee(m)
      setSelected(keysInMarquee(m))
      return
    }
    const d = dragRef.current
    if (d && e.buttons === 1) applyDrag(d, e.clientX, e.clientY)
  }

  const onRootPointerUp = () => {
    panRef.current = null
    const ms = marqueeStartRef.current
    if (ms) {
      marqueeStartRef.current = null
      if (!ms.moved) setSelected(new Set()) // plain click on empty area clears
      setMarquee(null)
      return
    }
    dragRef.current = null
    /* value axis un-freezes: the next render re-fits around the new values */
    setDragRange(null)
  }

  /* Delete/Backspace removes the selected keys: camera keys take their
     whole waypoint down (the time chain is shared — position trio and the
     angles ride the same waypoint), growth keys remove just their dot.
     Skipped while typing in a form field. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selected.size === 0) return
      const el = document.activeElement
      if (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return
      e.preventDefault()
      /* resolve indices → ids BEFORE deleting (ids stay stable while the
         array shrinks under multi-delete) */
      const wpIds = new Set<string>()
      selected.forEach((id) => {
        if (id.startsWith('wp:')) {
          const w = route.waypoints[Number(id.slice(3))]
          if (w) wpIds.add(w.id)
        } else if (id.startsWith('gr:')) {
          removeRevealKey(id.slice(3))
        }
      })
      wpIds.forEach(removeWaypoint)
      setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, route.waypoints, removeWaypoint, removeRevealKey])

  /** move all selected keys in time; wp keys commit as segment durations */
  const applyDrag = (d: DragState, cx: number, cy: number) => {
    /* px → SECONDS through the visible span (zoom-aware): clock seconds are
       the same unit in both domains, only the BASE values differ — waypoints
       sit at absolute content seconds, growth keys are timeline fractions */
    const ds = ((cx - d.startX) / d.laneW) * d.viewSpan
    const sel = [...selected]

    if (d.kind === 'handle' && d.handle) {
      const h = d.handle
      const tSec = d.viewStart + ((cx - d.laneLeft) / d.laneW) * d.viewSpan
      /* px → (time, value) through the lane's OWN windows: x is the zoom
         window as drawn, y is the padded value axis (unwrapping y against the
         SEGMENT delta instead used to make the point lag the mouse by the
         axis padding + the neighbour's scale) */
      /* GES rides the control FREE in value: no clamp keeps the mirror pair
         collinear through the key (a clamped partner was the fold at the
         lane edge), and overshoot past the keys' bracket is legitimate
         easing. The axis refits around the handle AFTER the drag
         (curveRange sees handle values); dragRange froze it for this
         gesture so the point tracks the cursor 1:1. */
      const value = h.vmax - ((cy - h.laneTop) / h.laneH) * (h.vmax - h.vmin)
      const tSpan = h.bT - h.aT
      const vSpan = h.bV - h.aV
      /* ---- index1.html "Aligned" ray model, in SCREEN PIXELS --------------
         index1.html's canvas is a UNIT SQUARE, so its fraction metric IS its
         screen metric and hypot(dx,dy) there is a perceptual length. A lane
         is strongly ANISOTROPIC (1s ≈ 50px while 1m ≈ 0.2px on height), so
         the same math in physical units preserved a meaningless
         hypot(seconds, units): whenever the dragged direction's axis mix
         differed from the partner's old one, the partner's SCREEN lever
         collapsed or exploded by the anisotropy ratio. All ray/length math
         therefore runs in px (kx = px/s, ky = px/unit — both frozen for the
         gesture by dragRange): the handle tracks the cursor 1:1, the partner
         keeps its exact screen length, and the pair stays collinear on
         screen (a linear map preserves ±u). A handle may never point
         backward in time: a mouse behind the key snaps the ray VERTICAL.
         Travel is the mouse's own projection on the ray, capped only where
         the tip would reach the NEIGHBOUR key. Value rides free — overshoot
         is legal easing and the axis refits after the drag (curveRange). */
      const kx = d.laneW / d.viewSpan
      const ky =
        Math.abs(h.vmax - h.vmin) > 1e-9 ? h.laneH / Math.abs(h.vmax - h.vmin) : 1e-9
      const kT = h.side === 'out' ? h.aT : h.bT
      const kV = h.side === 'out' ? h.aV : h.bV
      const pxT = (tSec - kT) * kx
      const pxV = (value - kV) * ky
      const mag = Math.hypot(pxT, pxV)
      if (mag < 1e-9) return
      let uT = pxT / mag
      let uV = pxV / mag
      if (h.side === 'out' && uT < 0) {
        uT = 0
        uV = pxV < 0 ? -1 : 1
      }
      if (h.side === 'in' && uT > 0) {
        uT = 0
        uV = pxV < 0 ? -1 : 1
      }
      const proj = pxT * uT + pxV * uV
      const capT =
        h.side === 'out'
          ? uT > 1e-9
            ? (tSpan * kx) / uT
            : Number.POSITIVE_INFINITY
          : uT < -1e-9
            ? (-tSpan * kx) / uT
            : Number.POSITIVE_INFINITY
      const L = Math.min(Math.max(0, proj), capT)
      const x =
        (h.side === 'out' ? 0 : 1) +
        (L * uT / kx) / (Math.abs(tSpan) > 1e-9 ? tSpan : 1e-9)
      const y =
        (h.side === 'out' ? 0 : 1) +
        (L * uV / ky) / (Math.abs(vSpan) > 1e-9 ? vSpan : 1e-9)
      const w = route.waypoints[h.wp]
      if (w) {
        const cur = { ...(w.ease ?? {}) }
        const spec: EaseSpec = { mode: 'both', ...cur[h.ch] }
        const next: EaseSpec = { ...spec, [h.side]: { x, y } }
        /* ---- Aligned partner (index1.html): the direction is EXACTLY the
           opposite ray (collinear by construction) and the length is the
           partner's OWN pre-drag lever, measured in the same px metric —
           its on-screen length survives the gesture untouched, shortened
           only where its tip would reach ITS neighbour key (the shortening
           scales the whole lever, so the shared line never bends). */
        if (spec.mode === 'both' && h.opp) {
          const o = h.opp
          const oSpanT = Math.abs(o.bT - o.aT) > 1e-9 ? o.bT - o.aT : 1e-9
          const oSpanV = Math.abs(o.bV - o.aV) > 1e-9 ? o.bV - o.aV : 1e-9
          const partnerIn = h.side === 'out'
          const base = partnerIn ? 1 : 0
          /* the partner's OWN handle — its own length survives the gesture */
          const stored = partnerIn ? spec.in : spec.out
          const seed = partnerIn
            ? (EASE_SEED.both.in ?? { x: 0.58, y: 1 })
            : (EASE_SEED.both.out ?? { x: 0.42, y: 0 })
          const ownX = Math.min(1, Math.max(0, stored?.x ?? seed.x))
          const ownY = stored?.y ?? seed.y
          const ownT = (partnerIn ? ownX - 1 : ownX) * oSpanT
          const ownV = (partnerIn ? ownY - 1 : ownY) * oSpanV
          /* its own lever, in px (the SAME metric the ray uses) */
          let ol = Math.max(Math.hypot(ownT * kx, ownV * ky), 1e-3)
          /* partner ray = −u, capped where it would reach ITS neighbour */
          const pT = -uT
          const pcapT = partnerIn
            ? pT > 1e-9
              ? (Math.abs(oSpanT) * kx) / pT
              : Number.POSITIVE_INFINITY
            : pT < -1e-9
              ? (Math.abs(oSpanT) * kx) / -pT
              : Number.POSITIVE_INFINITY
          ol = Math.min(ol, pcapT)
          next[partnerIn ? 'in' : 'out'] = {
            x: base + (ol * pT / kx) / oSpanT,
            y: base + (ol * -uV / ky) / oSpanV,
          }
        }
        cur[h.ch] = next
        updateWaypoint(w.id, { ease: cur })
      }
      return
    }

    if (d.kind === 'wp') {
      const times = d.baseFractions.map((t) => t * d.total)
      const base = [...times]
      sel.forEach((id) => {
        if (!id.startsWith('wp:')) return
        const i = Number(id.slice(3))
        /* wp 0 anchors the route start; a key's target never passes the
           TIMELINE end (settings 长度) — GES keys stop at the comp end too */
        if (i > 0) times[i] = Math.min(d.timeline, times[i] + ds)
      })
      // keep ordering with 0.1s minimum segment length
      for (let i = 1; i < times.length; i += 1) times[i] = Math.max(times[i], times[i - 1] + 0.1)
      /* walk back left keeping spacing, AND re-pin whatever the push-chain
         leaked past 长度 — capped at max(长度, 拖动前位置) so keys kept out
         of range by a deliberate 长度 shrink never get yanked back in */
      for (let i = times.length - 1; i >= 1; i -= 1) {
        times[i] = Math.min(times[i], Math.max(d.timeline, base[i]))
        times[i - 1] = Math.min(times[i - 1], times[i] - 0.1)
      }
      route.waypoints.forEach((w, i) => {
        if (i >= times.length - 1) return
        const dur = Math.round((times[i + 1] - times[i]) * 1000) / 1000
        if (Math.abs((w.duration || DEFAULT_WAYPOINT_DURATION) - dur) > 1e-3) {
          updateWaypoint(d.wpIds[i], { duration: dur })
        }
      })
      /* curve mode: the same gesture also rides the VALUE axis. Horizontal
         time stays shared per waypoint (经度/纬度/海拔 ride one slot), the
         vertical write touches only this channel. */
      const cv = d.curve
      const dv = cv ? -((cy - d.startY) / cv.laneH) * (cv.vmax - cv.vmin) : 0
      if (cv) {
        sel.forEach((id) => {
          if (!id.startsWith('wp:')) return
          const base = cv.baseVals[id]
          if (base == null) return
          const w = route.waypoints[Number(id.slice(3))]
          if (!w) return
          updateWaypoint(w.id, {
            [cv.ch]: clampChannelValue(cv.ch, base + dv),
          } as Partial<Omit<Waypoint, 'id'>>)
        })
      }
      /* ---- ease handles ride in GRAPH units (GES/AE) --------------------
         A handle is STORED normalized to its own segment, so moving a key
         re-maps every handle living in the segments around it: the pair
         through a key folds, and only the next handle drag rewrites it
         straight (图1 折 → 动一下手柄 → 图2 直). Re-project every handle from
         its drag-start spec, old span → new span. Collinearity is a relation
         between the two offsets, so keeping BOTH offsets keeps the line
         through the key straight, and the handle visibly rides its key. */
      const easeBase = d.easeBase
      if (easeBase) {
        const sameHandle = (
          a?: { x: number; y: number },
          b?: { x: number; y: number },
        ) =>
          a === b ||
          (!!a && !!b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6)
        /** channel value at a waypoint: the drag-start value for the soloed
         *  channel (its live value is already being rewritten), the current
         *  one for every other channel (they do not move in this gesture) */
        const keyVal = (wi: number, c: ChannelId, after: boolean): number | null => {
          const w = route.waypoints[wi]
          if (!w) return null
          const raw =
            c === cv?.ch
              ? cv.baseVals[w.id] ?? null
              : ((w[c] as number | undefined) ?? null)
          if (raw == null) return null
          if (!after || c !== cv?.ch) return raw
          return sel.includes(wpId(wi)) ? clampChannelValue(c, raw + dv) : raw
        }
        Object.keys(channels).forEach((cRaw) => {
          const c = cRaw as ChannelId
          const kidx = channels[c].map((k) => k.waypoint)
          kidx.forEach((wi, p) => {
            const w = route.waypoints[wi]
            const from = easeBase[w?.id ?? '']?.[c]
            if (!w || !from) return
            const prev = p > 0 ? kidx[p - 1] : undefined
            const nxt = p < kidx.length - 1 ? kidx[p + 1] : undefined
            /** x,y are SEGMENT fractions anchored at the side's own key
             *  (0 = segment start / 出, 1 = segment end / 入).
             *  index1.html's key-drag rule, in ABSOLUTE graph units: a lever
             *  RIDES its key with its (seconds, value) offset untouched — no
             *  re-angling, no span-proportional re-scaling — and is only
             *  SHORTENED along its own direction when the moved key squeezed
             *  the segment enough that the tip would cross the neighbour key
             *  (clampHB). Shortening scales both axes together, so every
             *  direction survives the gesture and the pair through each key
             *  stays straight. */
            const reproject = (
              h: { x: number; y: number },
              a: number,
              b: number,
              anchor: 0 | 1,
            ) => {
              const oT = base[b] - base[a]
              const nT = times[b] - times[a]
              const oA = keyVal(a, c, false)
              const oB = keyVal(b, c, false)
              const nA = keyVal(a, c, true)
              const nB = keyVal(b, c, true)
              const oV = oA != null && oB != null ? oB - oA : 0
              const nV = nA != null && nB != null ? nB - nA : 0
              let offT = (h.x - anchor) * oT
              let offV = (h.y - anchor) * oV
              /* clampHB: shrink along the lever's OWN direction only */
              if (Math.abs(offT) > Math.abs(nT) && Math.abs(offT) > 1e-9) {
                const s = Math.abs(nT) / Math.abs(offT)
                offT *= s
                offV *= s
              }
              return {
                x: anchor + (Math.abs(nT) > 1e-9 ? offT / nT : 0),
                y: anchor + (Math.abs(nV) > 1e-9 ? offV / nV : 0),
              }
            }
            const spec: EaseSpec = { ...from }
            if (from.out && nxt != null) spec.out = reproject(from.out, wi, nxt, 0)
            if (from.in && prev != null) spec.in = reproject(from.in, prev, wi, 1)
            const cur = w.ease?.[c]
            if (
              cur?.mode === spec.mode &&
              sameHandle(cur?.out, spec.out) &&
              sameHandle(cur?.in, spec.in)
            ) {
              return
            }
            updateWaypoint(w.id, { ease: { ...(w.ease ?? {}), [c]: spec } })
          })
        })
      }
      return
    }

    // growth keys: horizontal move for all, y=% adjust kept for single selection
    const single = sel.length === 1
    sel.forEach((id) => {
      if (!id.startsWith('gr:')) return
      const base = d.growthBase.find((g) => g.id === id.slice(3))
      if (!base) return
      /* growth keys ride the TIMELINE, not the content */
      const t = Math.min(1, Math.max(0, base.t + ds / d.timeline))
      const value = single
        ? Math.min(100, Math.max(0, base.value - (cy - d.startY) * 0.5))
        : base.value
      moveRevealKey(base.id, t, value)
    })
  }

  const marqueeBox = marquee && marqueeRect(marquee)
  const rootRect = rootRef.current?.getBoundingClientRect()

  return (
    <div
      ref={rootRef}
      className="ce-tracks"
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
      onAuxClick={(e) => e.preventDefault()}
      /* the ease menu is the only context menu; keys handle their own and
         stop propagation, everything else just suppresses the browser one */
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* NO ruler row here — the one ruler lives in the transport bar above;
          the lanes grid aligns to its measured edges via --ce-tl-axis-l/r. */}
      {/* lanes scroll vertically when the rows don't fit */}
      <div className={`ce-lanes${curveId ? ' is-detail' : ''}`} ref={lanesRef}>
      {/* every row is ALWAYS rendered — the label column is the stable list,
          the lanes area is what changes with the selection */}
      {CHANNEL_ROWS.map((row) => (
        <ChannelTrack
          key={row.id}
          id={row.id}
          label={row.label}
          value={pose ? formatChannelValue(row.id, pose[row.id]) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels[row.id], row.id, content, pct)}
          onInsert={() => insertFromCamera(row.group)}
          group={row.group}
          curve={curveId === row.id}
          range={range}
          onKeyMenu={openKeyMenu}
        />
      ))}

      {/* growth line — dbl-click lane adds a key, dbl-click a key removes it.
          Selection & dragging are handled by the container (see onRootPointerDown). */}
      {/* Growth has no detail pane, so its label is a plain read-only label
          (selecting it would blank every lane and show nothing). */}
        <div className="ce-track">
          <div className="ce-track-side">
            <SoloLabel
              id="growth"
              label="Growth"
              value={growthLine ? 'on' : undefined}
            />
            <InsertKeyBtn
              label="Growth"
              onInsert={() => {
                /* a key already sits at the playhead → nothing to add */
                if (revealKeys.some((k) => Math.abs(k.t - progress) < 0.005)) return
                addRevealKey(progress)
              }}
            />
          </div>
          <div
            className="ce-track-lane ce-reveal-lane"
            title="Growth % · dbl-click: add key · drag: time / % · dbl-click key: delete"
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest('.ce-reveal-key')) return
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
              /* px → fraction-of-total goes through the view window */
              addRevealKey(Math.min(1, Math.max(0, (viewStart + ratio * viewSpan) / DURATION)))
            }}
          >
            <svg className="ce-reveal-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={sortedRevealKeys.map((k) => `${pct(k.t * DURATION)},${100 - k.value}`).join(' ')}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {sortedRevealKeys.map((k) => (
              <span
                key={k.id}
                data-key={`gr:${k.id}`}
                className={`ce-key ce-reveal-key${selected.has(`gr:${k.id}`) ? ' is-selected' : ''}`}
                style={{ left: `${pct(k.t * DURATION)}%` }}
                title={`${Math.round(k.value)}% @ ${(k.t * DURATION).toFixed(1)}s`}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  removeRevealKey(k.id)
                }}
              />
            ))}
          </div>
        </div>

      </div>

      {/* project settings column — the free strip right of the lane grid
          (level with the track rows, under the bar's action group):
          长度 (秒/帧) · 帧率 · 尺寸. It borrows exactly the space the lanes'
          right padding reserves (--ce-tracks-pr), so the grid stays aligned.
          UI-only for now: edits stay local, no store wiring. */}
      <TimelineSettings />

      {/* axis overlay — spans exactly the lane column; --ph goes through the
          view window so zoom keeps the line pixel-true (clipped at edges).
          The top strip carries the FOCUS ticks: with the bar ruler now a
          full-overview mini-map, the fine (windowed) time labels live here. */}
      <div
        ref={axisRef}
        className="ce-axis"
        style={{ '--ph': (progress * DURATION - viewStart) / viewSpan } as CSSProperties}
        aria-hidden="true"
      >
        <div className="ce-axis-ticks">
          {ticksFor(view, axisW, DURATION, route.fps, tlUnit).map((s) => (
            <span key={s} style={{ left: `${((s - viewStart) / viewSpan) * 100}%` }}>
              {formatTick(s, tlUnit, route.fps)}
            </span>
          ))}
        </div>
        <div className="ce-axis-ph">
          <div className="ce-playhead" />
        </div>
      </div>

      {marqueeBox && rootRect && (
        <div
          className="ce-marquee"
          style={{
            left: marqueeBox.left - rootRect.left,
            top: marqueeBox.top - rootRect.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
        />
      )}

      {/* keyframe easing menu — rendered at the ROOT (the lane's clip-path
          would eat a fixed child) and positioned at the click point */}
      {menu && (
        <div
          className="ce-ease-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ce-ease-head">
            {(curveId ? CHANNEL_ROWS.find((r) => r.id === curveId)?.label : '关键帧') ?? ''} 缓动
          </div>
          {EASE_ITEMS.map((it) => (
            <button
              key={it.mode}
              type="button"
              className={`ce-ease-item${
                route.waypoints[menu.wp]?.ease?.[menu.ch]?.mode === it.mode ? ' is-on' : ''
              }`}
              onClick={() => applyEase(menu.wp, menu.ch, it.mode)}
            >
              {it.label}
            </button>
          ))}
          <button
            type="button"
            className="ce-ease-item is-quiet"
            onClick={() => applyEase(menu.wp, menu.ch, null)}
          >
            清除缓动
          </button>
        </div>
      )}
    </div>
  )
}

/** label doubles as the row selector: click = this channel's detail takes over
 *  the LANE column (attribute rows: the value-mapped curve pane), click again
 *  = clear. The label column itself never changes — no row is ever hidden — so
 *  rows without a detail view (growth) render a plain read-only label. */
function SoloLabel({
  id,
  label,
  value,
  solo,
  onToggle,
}: {
  id: TrackId
  label: string
  value?: string
  /** the row selection (only needed when the label is a toggle) */
  solo?: TrackId | null
  onToggle?: (id: TrackId) => void
}) {
  if (!onToggle) {
    return (
      <div className="ce-track-label" title={label}>
        <span className="ce-track-name">{label}</span>
        {value != null && <span className="ce-track-value">{value}</span>}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`ce-track-label${solo === id ? ' is-solo' : ''}`}
      onClick={() => onToggle(id)}
      title={`${label} — 单击选中：右侧显示该通道曲线，左侧列表保持全部；再次单击取消`}
    >
      <span className="ce-track-name">{label}</span>
      {value != null && <span className="ce-track-value">{value}</span>}
    </button>
  )
}

/** insert-keyframe button (GES-style attribute row). Renders as a hollow
 *  keyframe diamond that fills on hover. Rows without a key action may
 *  still omit onInsert (renders DISABLED). `group` tags the button with its
 *  insert-group: lon/lat/height share 'position', and CSS (:has) lights the
 *  WHOLE group on hover — one click keys all three, so the hover must read
 *  as one group action. */
function InsertKeyBtn({
  label,
  title,
  onInsert,
  group,
}: {
  label: string
  title?: string
  onInsert?: () => void
  group?: InsertGroup
}) {
  return (
    <button
      type="button"
      className="ce-kf-add"
      data-group={group}
      title={title ?? `在播放头处插入${label}关键帧`}
      aria-label={`插入${label}关键帧`}
      disabled={!onInsert}
      onClick={onInsert}
    >
      <span className="ce-kf-dot" aria-hidden="true" />
    </button>
  )
}

/** a simple channel row: solo label + kf button + lane of selectable keys */
function ChannelTrack({
  id,
  label,
  value,
  solo,
  onToggle,
  selected,
  keys,
  onInsert,
  group,
  curve,
  range,
  onKeyMenu,
}: {
  id: TrackId
  label: string
  value?: string
  solo: TrackId | null
  onToggle: (id: TrackId) => void
  selected: Set<string>
  keys: KeySpan[]
  onInsert?: () => void
  /** the row's insert-group: lon/lat/height share 'position' (one click keys
   *  all three) — rides along so the three ◇ buttons hover as ONE group */
  group: InsertGroup
  /** this row is the soloed attribute → GES value-mapped curve editor */
  curve?: boolean
  /** value window for the curve (frozen while a drag runs) */
  range?: CurveRange | null
  /** right-click a key → 缓动 menu (owned by the parent, which can escape
   *  the lane's clip-path) */
  onKeyMenu?: (wp: number, ch: ChannelId, x: number, y: number) => void
}) {
  /* playhead read — the whole grid re-renders on every progress tick already
     (the parent subscribes), so this costs no extra renders */
  const progress = useRoute((s) => s.progress)
  const route = useRoute((s) => s.route)
  const tlView = useUI((s) => s.tlView)
  /* keyframe value tags — PER-CHANNEL toggle (default off): each row's
     button controls only its own lane */
  const vals = useUI((s) => !!s.tlKeyValues[id])
  const toggleVals = useUI((s) => s.toggleTlKeyValues)
  /* click a value tag → inline edit. Commit writes the channel field back to
     the source waypoint — ChannelId names match Waypoint fields 1:1. */
  const [edit, setEdit] = useState<{ wp: number; keyId: string; draft: string } | null>(null)
  const updateWaypoint = useRoute((s) => s.updateWaypoint)
  const commitEdit = () => {
    if (!edit) return
    const v = parseFloat(edit.draft)
    const w = route.waypoints[edit.wp]
    if (w && Number.isFinite(v)) {
      updateWaypoint(w.id, { [id]: v } as Partial<Omit<Waypoint, 'id'>>)
    }
    setEdit(null)
  }
  const playT = progress * timelineDuration(route)
  /* A key reads as LIVE while the playhead line VISUALLY touches it (≈4px of
     time, converted through the zoom window). Scrubbing is continuous —
     setProgress never snaps to frames — so a fixed half-frame tolerance would
     make the highlight practically unreachable. */
  const laneRef = useRef<HTMLDivElement>(null)
  const [laneW, setLaneW] = useState(0)
  useEffect(() => {
    const el = laneRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLaneW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const liveSpan = clampView(tlView, timelineDuration(route)).span
  const liveTol = laneW > 0 ? (4 / laneW) * liveSpan : 0.5 / route.fps

  /* Connect ADJACENT keys — the span the channel interpolates over (GES draws
     exactly this line: 见 相机位置/经度 行的 ◆———◆). Before the first and
     after the last key the channel HOLDS, so no line is drawn there. The span
     is clamped (a zoomed-out pair could otherwise cover thousands of percent)
     and inset a few px so the diamonds stay crisp; keys paint over the ends
     because they come later in the DOM. */
  const links: { left: number; width: number }[] = []
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = Math.max(-12, Math.min(112, keys[i].left))
    const b = Math.max(-12, Math.min(112, keys[i + 1].left))
    if (b - a > 0.4) links.push({ left: a, width: b - a })
  }

  /* ----- GES curve mode: solo on one attribute maps VALUE to y ------------- */
  const DURATION = timelineDuration(route)
  const { start: viewStart, span: viewSpan } = clampView(tlView, DURATION)
  const ch = id as ChannelId
  const showCurve = curve === true && range != null
  /** lane percent for an absolute second (through the zoom window) */
  const leftPct = (tSec: number) => ((tSec - viewStart) / viewSpan) * 100
  /** lane percent top-down for a channel value */
  const yPct = (v: number) =>
    range ? 100 - ((v - range.min) / Math.max(range.max - range.min, 1e-9)) * 100 : 50
  /* The drawn curve is the ATTRIBUTE's own interpolation curve: per segment
     a → a + (b − a)·easeFraction(local) — literally what the graph handles
     describe, and what GES's graph editor shows (hold=step shows up too).
     It used to be re-sampled through samplePose; for the position group that
     runs a Catmull-Rom over the keys, and there an overshooting handle sends
     the EASED PARAMETER past 1 — the spline gets evaluated beyond its own
     segment and the drawing folds into an extra 谷-峰 the handles never
     describe. Heading/pitch are the exception: with a target the flight
     re-aims them every frame, so those keep the flown sample. */
  let curvePts = ''
  if (showCurve) {
    const N = 160
    const aimed = route.target != null && (ch === 'heading' || ch === 'pitch')
    const pts: string[] = []
    for (let i = 0; i <= N; i += 1) {
      const tSec = viewStart + (i / N) * viewSpan
      let v: number | null
      if (aimed) {
        v = samplePose(route, timelineProgressToRoute(route, tSec / DURATION))?.[ch] ?? null
      } else if (keys.length === 0) {
        v = null
      } else if (tSec <= keys[0].tSec) {
        v = keys[0].value
      } else if (tSec >= keys[keys.length - 1].tSec) {
        v = keys[keys.length - 1].value
      } else {
        let j = 1
        while (j < keys.length && keys[j].tSec < tSec) j += 1
        const a = keys[j - 1]
        const b = keys[j]
        const local = (tSec - a.tSec) / Math.max(b.tSec - a.tSec, 1e-9)
        const u = easeFraction(local, a.ease, b.ease)
        const delta = ch === 'heading' ? angleDeltaDeg(a.value, b.value) : b.value - a.value
        v = a.value + delta * u
      }
      if (v == null) continue
      pts.push(`${leftPct(tSec).toFixed(2)},${yPct(v).toFixed(2)}`)
    }
    curvePts = pts.join(' ')
  }
  const gridTicks =
    showCurve && range
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => ({
          top: f * 100,
          value: range.max - (range.max - range.min) * f,
        }))
      : []
  /* easing handles: 缓入 draws LEFT of the key (prev→key), 缓出 RIGHT
     (key→next), 左右缓动 both, 线性/跳跃 none */
  const handles: {
    id: string
    left: number
    top: number
    x1: number
    y1: number
    x2: number
    y2: number
    at: number
    bt: number
    av: number
    bv: number
    /** the key's OTHER segment bounds — the mirror source for GES 自动缓动
     *  (absent at a chain end: there is no neighbour to mirror into) */
    oat?: number
    obt?: number
    oav?: number
    obv?: number
  }[] = []
  if (showCurve) {
    keys.forEach((k, i) => {
      const mode = k.ease?.mode
      if (!mode || mode === 'linear' || mode === 'hold') return
      const nxt = keys[i + 1]
      const prv = keys[i - 1]
      if ((mode === 'both' || mode === 'out') && nxt && k.ease?.out) {
        const hp = k.ease.out
        const hx = leftPct(k.tSec + hp.x * (nxt.tSec - k.tSec))
        const hy = yPct(k.value + hp.y * (nxt.value - k.value))
        handles.push({
          id: `${k.wp}:out`,
          left: hx,
          top: hy,
          x1: k.left,
          y1: yPct(k.value),
          x2: hx,
          y2: hy,
          at: k.tSec,
          bt: nxt.tSec,
          av: k.value,
          bv: nxt.value,
          /* the partner is the 缓入 handle, normalized from prv → k (so the
             bounds MUST read prv → k, in that order) */
          oat: prv?.tSec,
          obt: prv ? k.tSec : undefined,
          oav: prv?.value,
          obv: prv ? k.value : undefined,
        })
      }
      if ((mode === 'both' || mode === 'in') && prv && k.ease?.in) {
        const hp = k.ease.in
        const hx = leftPct(prv.tSec + hp.x * (k.tSec - prv.tSec))
        const hy = yPct(prv.value + hp.y * (k.value - prv.value))
        handles.push({
          id: `${k.wp}:in`,
          left: hx,
          top: hy,
          x1: k.left,
          y1: yPct(k.value),
          x2: hx,
          y2: hy,
          at: prv.tSec,
          bt: k.tSec,
          av: prv.value,
          bv: k.value,
          oat: nxt ? k.tSec : undefined,
          obt: nxt?.tSec,
          oav: nxt ? k.value : undefined,
          obv: nxt?.value,
        })
      }
    })
  }

  /** the value tag under a key — click swaps it for the inline editor. In
   *  curve mode it hangs BELOW the key instead of off its right edge. */
  const valueTag = (k: KeySpan, curveMode: boolean) => {
    if (!vals) return null
    const pos = curveMode
      ? { left: `${k.left}%`, top: `calc(${yPct(k.value)}% + 7px)` }
      : { left: `${k.left}%` }
    const flip = curveMode ? '' : k.left > 82 ? ' is-flip' : ''
    if (edit?.keyId === k.keyId) {
      return (
        <input
          type="text"
          inputMode="decimal"
          className={`ce-key-val is-edit${flip}${curveMode ? ' is-curve' : ''}`}
          style={pos}
          value={edit.draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            else if (e.key === 'Escape') setEdit(null)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={`编辑${label}关键帧值`}
        />
      )
    }
    return (
      <button
        type="button"
        className={`ce-key-val${flip}${curveMode ? ' is-curve' : ''}`}
        style={pos}
        title="点击修改该值"
        onClick={() => setEdit({ wp: k.wp, keyId: k.keyId, draft: k.raw })}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {k.chip}
      </button>
    )
  }

  return (
    <div
      className={`ce-track${showCurve ? ' is-curve' : ''}${
        solo === id ? ' is-selected' : ''
      }`}
    >
      <div className="ce-track-side">
        <SoloLabel id={id} label={label} value={value} solo={solo} onToggle={onToggle} />
        <button
          type="button"
          className={`ce-kf-vals${vals ? ' is-on' : ''}`}
          title="显示/隐藏本通道关键帧右下角的值"
          aria-label="切换本通道关键帧值显示"
          aria-pressed={vals}
          onClick={() => toggleVals(id)}
        >
          <TagIcon size={11} />
        </button>
        <InsertKeyBtn
          label={label}
          group={group}
          title={
            group === 'position'
              ? '在播放头处插入关键帧（位置组：经度/纬度/海拔 同步落键）'
              : '在播放头处插入关键帧（仅本通道落键）'
          }
          onInsert={onInsert}
        />
      </div>
      <div
        className={`ce-track-lane${showCurve ? ' is-curve' : ''}`}
        ref={laneRef}
        data-ch={showCurve ? id : undefined}
        data-vmin={showCurve && range ? range.min : undefined}
        data-vmax={showCurve && range ? range.max : undefined}
      >
        {showCurve ? (
          <>
            <div className="ce-curve-grid" aria-hidden="true">
              {gridTicks.map((g) => (
                <span key={`g${g.top}`} className="ce-curve-gridline" style={{ top: `${g.top}%` }} />
              ))}
              {gridTicks.map((g) => (
                <i key={`t${g.top}`} className="ce-curve-tick" style={{ top: `${g.top}%` }}>
                  {formatChannelValue(ch, g.value)}
                </i>
              ))}
            </div>
            <svg
              className="ce-curve-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                className="ce-curve-line"
                points={curvePts}
                vectorEffect="non-scaling-stroke"
              />
              {handles.map((h) => (
                <line
                  key={h.id}
                  className="ce-ease-line"
                  x1={h.x1}
                  y1={h.y1}
                  x2={h.x2}
                  y2={h.y2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {keys.map((k, i) => (
              <Fragment key={i}>
                <span
                  data-key={k.keyId}
                  data-wp={k.wp}
                  data-ch={id}
                  data-val={k.value}
                  className={`ce-key is-curve-key${selected.has(k.keyId) ? ' is-selected' : ''}${
                    Math.abs(k.tSec - playT) <= liveTol ? ' is-live' : ''
                  }`}
                  style={{ left: `${k.left}%`, top: `${yPct(k.value)}%` }}
                  title={`${k.title} · 拖动改时间与值 · 右键设置缓动`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onKeyMenu?.(k.wp, ch, e.clientX, e.clientY)
                  }}
                />
                {valueTag(k, true)}
              </Fragment>
            ))}
            {handles.map((h) => (
              <span
                key={h.id}
                className="ce-ease-h"
                data-h={h.id}
                data-ch={id}
                data-at={h.at}
                data-bt={h.bt}
                data-av={h.av}
                data-bv={h.bv}
                /* the key's OTHER segment — the mirror source for GES
                   自动缓动 (omitted at a chain end: nothing to mirror into) */
                data-oat={h.oat}
                data-obt={h.obt}
                data-oav={h.oav}
                data-obv={h.obv}
                /* the axis the lane is drawn on, so the drag can unwrap px →
                   value against the SAME window (see handle drag in
                   onRootPointerDown) */
                data-vmin={range?.min}
                data-vmax={range?.max}
                style={{ left: `${h.left}%`, top: `${h.top}%` }}
                title="拖动缓动手柄"
              />
            ))}
          </>
        ) : (
          <>
            {links.map((l, i) => (
              <span
                key={`l${i}`}
                className="ce-key-link"
                aria-hidden="true"
                style={{ left: `calc(${l.left}% + 4px)`, width: `calc(${l.width}% - 8px)` }}
              />
            ))}
            {keys.map((k, i) => (
              <Fragment key={i}>
                <span
                  data-key={k.keyId}
                  className={`ce-key${selected.has(k.keyId) ? ' is-selected' : ''}${
                    Math.abs(k.tSec - playT) <= liveTol ? ' is-live' : ''
                  }`}
                  style={{ left: `${k.left}%` }}
                  title={k.title}
                />
                {valueTag(k, false)}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** channel keys → lane spans (percent position + absolute seconds + value
 *  tooltip + selection id). tSec feeds the playhead-hit highlight and the
 *  connectors between adjacent keys. */
function keySpans(
  keys: ChannelKey[],
  id: ChannelId,
  duration: number,
  pct: (tSec: number) => number,
): KeySpan[] {
  return keys.map((k) => ({
    left: pct(k.t * duration),
    tSec: k.t * duration,
    title: `${formatChannelValue(id, k.value)} @ ${(k.t * duration).toFixed(1)}s · Waypoint ${k.waypoint + 1}`,
    chip: formatChannelValue(id, k.value),
    keyId: wpId(k.waypoint),
    /* source waypoint index + unformatted seed for the inline editor */
    wp: k.waypoint,
    raw: String(+k.value.toFixed(6)),
    value: k.value,
    ease: k.ease,
  }))
}

function buildTicks(duration: number): number[] {
  const step = duration > 40 ? 10 : 5
  const ticks: number[] = []
  for (let s = 0; s < duration - 0.01; s += step) ticks.push(Math.round(s))
  return ticks
}
