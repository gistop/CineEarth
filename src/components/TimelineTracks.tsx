import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { useReveal } from '../features/route/revealStore'
import {
  angleDeltaDeg,
  normalizeAngleDeg,
  samplePose,
  timelineDuration,
  timelineProgressToRoute,
  totalDuration,
  waypointFractions,
} from '../features/route/pathMath'
import { DEFAULT_FOV, DEFAULT_WAYPOINT_DURATION, type InsertGroup, type Pose } from '../features/route/types'
import { PerspectiveFrustum } from 'cesium'
import { getViewer } from '../cesium/viewerRegistry'
import { cameraChannelKeys, formatChannelValue, type ChannelId, type ChannelKey } from '../features/route/cameraChannels'
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
    /* frustum.fov (radians) → deg; non-perspective fallback keeps the default */
    fov:
      cam.frustum instanceof PerspectiveFrustum
        ? cam.frustum.fov * deg
        : DEFAULT_FOV,
  }
}

/**
 * Expanded multi-track editor (GES-style).
 * - Track label = solo toggle (click = focus channel, again = show all)
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

type DragState = {
  kind: 'wp' | 'gr'
  startX: number
  startY: number
  laneW: number
  /** CONTENT length (seconds) — wp/growth base fractions are fractions of it */
  total: number
  /** TIMELINE length (seconds) — the domain the px→time delta rides */
  timeline: number
  /** visible span at drag start — px→time conversion depends on the zoom level */
  viewSpan: number
  /** waypoint time fractions at drag start (feedback-free snapshot) */
  baseFractions: number[]
  wpIds: string[]
  /** growth keys snapshot at drag start */
  growthBase: { id: string; t: number; value: number }[]
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
  const [solo, setSolo] = useState<TrackId | null>(null)
  const toggleSolo = (id: TrackId) => setSolo((cur) => (cur === id ? null : id))
  const show = (id: TrackId) => solo === null || solo === id

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
      dragRef.current = {
        kind: id.startsWith('wp:') ? 'wp' : 'gr',
        startX: e.clientX,
        startY: e.clientY,
        laneW: (lane?.getBoundingClientRect().width) || 1,
        /* wp/growth base fractions are fractions of the CONTENT, while the
           px→time delta rides the TIMELINE view span */
        total: content,
        timeline: DURATION,
        viewSpan,
        baseFractions: waypointFractions(route),
        wpIds: route.waypoints.map((w) => w.id),
        growthBase: revealKeys.map((k) => ({ id: k.id, t: k.t, value: k.value })),
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

    if (d.kind === 'wp') {
      const times = d.baseFractions.map((t) => t * d.total)
      sel.forEach((id) => {
        if (!id.startsWith('wp:')) return
        const i = Number(id.slice(3))
        if (i > 0) times[i] += ds // wp 0 anchors the route start
      })
      // keep ordering with 0.1s minimum segment length
      for (let i = 1; i < times.length; i += 1) times[i] = Math.max(times[i], times[i - 1] + 0.1)
      for (let i = times.length - 2; i >= 0; i -= 1) times[i] = Math.min(times[i], times[i + 1] - 0.1)
      route.waypoints.forEach((w, i) => {
        if (i >= times.length - 1) return
        const dur = Math.round((times[i + 1] - times[i]) * 1000) / 1000
        if (Math.abs((w.duration || DEFAULT_WAYPOINT_DURATION) - dur) > 1e-3) {
          updateWaypoint(d.wpIds[i], { duration: dur })
        }
      })
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
    >
      {/* NO ruler row here — the one ruler lives in the transport bar above;
          the lanes grid aligns to its measured edges via --ce-tl-axis-l/r. */}
      {/* lanes scroll vertically when the rows don't fit */}
      <div className="ce-lanes" ref={lanesRef}>
      {show('lon') && (
        <ChannelTrack
          id="lon"
          label="相机经度"
          value={pose ? formatChannelValue('lon', pose.lon) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.lon, 'lon', content, pct)}
          onInsert={() => insertFromCamera('position')}
        />
      )}
      {show('lat') && (
        <ChannelTrack
          id="lat"
          label="相机纬度"
          value={pose ? formatChannelValue('lat', pose.lat) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.lat, 'lat', content, pct)}
          onInsert={() => insertFromCamera('position')}
        />
      )}
      {show('height') && (
        <ChannelTrack
          id="height"
          label="相机海拔"
          value={pose ? formatChannelValue('height', pose.height) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.height, 'height', content, pct)}
          onInsert={() => insertFromCamera('position')}
        />
      )}
      {show('heading') && (
        <ChannelTrack
          id="heading"
          label="相机平移"
          value={pose ? formatChannelValue('heading', pose.heading) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.heading, 'heading', content, pct)}
          onInsert={() => insertFromCamera('heading')}
        />
      )}
      {show('pitch') && (
        <ChannelTrack
          id="pitch"
          label="相机倾斜"
          value={pose ? formatChannelValue('pitch', pose.pitch) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.pitch, 'pitch', content, pct)}
          onInsert={() => insertFromCamera('pitch')}
        />
      )}
      {show('roll') && (
        <ChannelTrack
          id="roll"
          label="相机翻滚"
          value={pose ? formatChannelValue('roll', pose.roll) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.roll, 'roll', content, pct)}
          onInsert={() => insertFromCamera('roll')}
        />
      )}
      {show('fov') && (
        <ChannelTrack
          id="fov"
          label="相机视野"
          value={pose ? formatChannelValue('fov', pose.fov) : undefined}
          solo={solo}
          onToggle={toggleSolo}
          selected={selected}
          keys={keySpans(channels.fov, 'fov', content, pct)}
          onInsert={() => insertFromCamera('fov')}
        />
      )}

      {/* growth line — dbl-click lane adds a key, dbl-click a key removes it.
          Selection & dragging are handled by the container (see onRootPointerDown). */}
      {show('growth') && (
        <div className="ce-track">
          <div className="ce-track-side">
            <SoloLabel
              id="growth"
              label="Growth"
              value={growthLine ? 'on' : undefined}
              solo={solo}
              onToggle={toggleSolo}
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
      )}

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
    </div>
  )
}

/** label doubles as the GES solo toggle: click = focus, click again = show all */
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
  solo: TrackId | null
  onToggle: (id: TrackId) => void
}) {
  return (
    <button
      type="button"
      className={`ce-track-label${solo === id ? ' is-solo' : ''}`}
      onClick={() => onToggle(id)}
      title={`${label} — 单击只显示此通道，再次单击显示全部`}
    >
      <span className="ce-track-name">{label}</span>
      {value != null && <span className="ce-track-value">{value}</span>}
    </button>
  )
}

/** insert-keyframe button (GES-style attribute row). Renders as a hollow
 *  keyframe diamond that fills on hover. Rows without a key action may
 *  still omit onInsert (renders DISABLED). */
function InsertKeyBtn({
  label,
  title,
  onInsert,
}: {
  label: string
  title?: string
  onInsert?: () => void
}) {
  return (
    <button
      type="button"
      className="ce-kf-add"
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
}: {
  id: TrackId
  label: string
  value?: string
  solo: TrackId | null
  onToggle: (id: TrackId) => void
  selected: Set<string>
  keys: { left: number; title: string; keyId: string }[]
  onInsert?: () => void
}) {
  return (
    <div className="ce-track">
      <div className="ce-track-side">
        <SoloLabel id={id} label={label} value={value} solo={solo} onToggle={onToggle} />
        <InsertKeyBtn
          label={label}
          title="在播放头处插入关键帧（航点键 · 相机通道同步落帧）"
          onInsert={onInsert}
        />
      </div>
      <div className="ce-track-lane">
        {keys.map((k, i) => (
          <span
            key={i}
            data-key={k.keyId}
            className={`ce-key${selected.has(k.keyId) ? ' is-selected' : ''}`}
            style={{ left: `${k.left}%` }}
            title={k.title}
          />
        ))}
      </div>
    </div>
  )
}

/** channel keys → lane spans (percent position + value tooltip + selection id) */
function keySpans(
  keys: ChannelKey[],
  id: ChannelId,
  duration: number,
  pct: (tSec: number) => number,
): { left: number; title: string; keyId: string }[] {
  return keys.map((k) => ({
    left: pct(k.t * duration),
    title: `${formatChannelValue(id, k.value)} @ ${(k.t * duration).toFixed(1)}s · Waypoint ${k.waypoint + 1}`,
    keyId: wpId(k.waypoint),
  }))
}

function buildTicks(duration: number): number[] {
  const step = duration > 40 ? 10 : 5
  const ticks: number[] = []
  for (let s = 0; s < duration - 0.01; s += step) ticks.push(Math.round(s))
  return ticks
}
