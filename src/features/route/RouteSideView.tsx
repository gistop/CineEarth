// Side view — elevation profile along the route.
// x = cumulative along-track distance, y = altitude; ground shown as a base line.
// Waypoints are DRAGGABLE vertically — commits height to the route store
// (3D globe & top view update live).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { haversineM, samplePath, samplePose } from './pathMath'
import { useRoute } from './routeStore'
import { MAX_WAYPOINT_HEIGHT_M, type Route } from './types'
import { ExpandIcon, MinusIcon, PlusIcon } from '../../components/Icons'

const W = 300
const H = 110
const PAD_X = 10
const PAD_TOP = 12
const PAD_BOTTOM = 18

/** grab radius (svg px) around a waypoint dot */
const HIT_RADIUS = 13
const MIN_HEIGHT = 0
function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function fmtAlt(m: number): string {
  return `${Math.round(m)} m`
}
/** round to a 1/2/5 × 10ⁿ "nice" grid step */
function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

export default function RouteSideView({ route }: { route: Route }) {
  const progress = useRoute((s) => s.progress)
  const selectedId = useRoute((s) => s.selectedWaypointId)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragIdRef = useRef<string | null>(null)
  /** y-range frozen at height-drag start — see geometry memo below */
  const dragRangeRef = useRef<{ min: number; max: number } | null>(null)
  /** drag-start height — anchors the ghost dot at the original position */
  const dragGhostHRef = useRef<number | null>(null)
  /** viewport pan state — empty-area drag pans BOTH axes:
      x = along-track distance window, y = altitude window */
  const panRef = useRef<{
    px: number
    py: number
    dMin: number
    dMax: number
    hMin: number
    hMax: number
  } | null>(null)
  const [view, setView] = useState<{
    dMin: number
    dMax: number
    hMin: number
    hMax: number
  } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  /** true while a two-pointer pinch zoom is active (cursor hint) */
  const [zooming, setZooming] = useState(false)
  /** two-pointer pinch (tablet) — distance ratio zooms, midpoint drift pans */
  const pinchRef = useRef<{ dist: number; cx: number; dMin: number; dMax: number } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  /** stays true until the user pans y explicitly — while true, y auto-fits
      the VISIBLE stretch, so zooming into a local segment gains vertical
      resolution instead of squashing the dots into a band */
  const yAutoRef = useRef(true)

  const geometry = useMemo(() => {
    const poses = samplePath(route, 140)
    if (poses.length < 2) return null

    // cumulative along-track distance for every sample
    let total = 0
    const pts = poses.map((p, i) => {
      if (i > 0) {
        const prev = poses[i - 1]
        total += haversineM(prev.lon, prev.lat, p.lon, p.lat)
      }
      return { d: total, h: p.height }
    })

    /* effective y-range, in priority order:
       1. while dragging a waypoint's height — the range frozen at pointerdown.
          Recomputing from live heights created a feedback loop: pointer offset
          × maxH → commit → maxH grows → same offset maps even higher → runaway
          (heights hit billions of metres and broke Cesium geometry).
       2. the user-panned y window (only once the user panned y explicitly).
       3. auto-fit — of the VISIBLE stretch once zoomed/panned, so local
          editing gains full vertical resolution; the full track otherwise.
       The x-axis (along-track window) is either the panned/zoomed viewport or
       the full track — waypoints & the playhead map through the same windows. */
    const xRange = view ? { min: view.dMin, max: view.dMax } : { min: 0, max: total }
    let yRange = dragRangeRef.current ?? null
    if (!yRange && view && !yAutoRef.current) yRange = { min: view.hMin, max: view.hMax }
    if (!yRange) {
      const vis = pts.filter((p) => p.d >= xRange.min && p.d <= xRange.max)
      const src = vis.length >= 2 ? vis : pts
      let lo = Math.min(...src.map((p) => p.h))
      let hi = Math.max(...src.map((p) => p.h))
      if (hi - lo < 50) {
        const mid = (hi + lo) / 2
        lo = mid - 25
        hi = mid + 25
      }
      const pad = (hi - lo) * 0.15
      yRange = { min: Math.max(0, lo - pad), max: hi + pad }
    }
    const { min: hMin, max: hMax } = yRange
    const sx = (d: number) =>
      PAD_X + ((d - xRange.min) / Math.max(xRange.max - xRange.min, 1e-6)) * (W - PAD_X * 2)
    const sy = (h: number) =>
      H - PAD_BOTTOM - ((h - hMin) / (hMax - hMin)) * (H - PAD_BOTTOM - PAD_TOP)

    /* the x-axis is along-track DISTANCE, but waypoints & the playhead are keyed
       by progress fraction (time) — convert fraction → distance, otherwise dots
       float off the curve wherever time ≠ distance (i.e. on sloped parts) */
    const distanceAt = (fraction: number) => {
      const x = Math.min(Math.max(fraction, 0), 1) * (pts.length - 1)
      const i0 = Math.min(pts.length - 2, Math.floor(x))
      return pts[i0].d + (pts[i0 + 1].d - pts[i0].d) * (x - i0)
    }

    /* zoom clamps: stop zooming in once waypoints average ≥ 40 px apart on
       screen (nothing left to gain), allow a little overscroll out */
    const n = route.waypoints.length
    const minSpan =
      n > 1
        ? Math.min(Math.max(((total / (n - 1)) * (W - PAD_X * 2)) / 40, 1), total)
        : Math.max(total / 50, 1)
    const maxSpan = total * 1.6

    return { pts, total, hMin, hMax, xRange, minSpan, maxSpan, sx, sy, distanceAt }
  }, [route, view])

  /* waypoint dot positions in svg space (x by along-track distance, y by height) */
  const dots = useMemo(() => {
    if (!geometry) return []
    const { sx, sy, distanceAt } = geometry
    return route.waypoints.map((w, i) => ({
      id: w.id,
      height: w.height,
      x: sx(distanceAt(fractionOfWaypoint(route, i))),
      y: sy(w.height),
    }))
  }, [geometry, route])

  /* data changed (not mid-drag) — drop the panned viewport, auto-fit again.
     Must run before the early return below (hooks-order rule). */
  useEffect(() => {
    if (!dragIdRef.current && !panRef.current) {
      setView(null)
      yAutoRef.current = true
    }
  }, [route])

  if (!geometry) return null
  const { pts, total, hMin, hMax, xRange, minSpan, maxSpan, sx, sy, distanceAt } = geometry

  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.d).toFixed(1)} ${sy(p.h).toFixed(1)}`)
    .join(' ')

  const headPose = samplePose(route, progress)
  const headPt = headPose
    ? {
        x: sx(distanceAt(progress)),
        y: sy(headPose.height),
      }
    : null

  /* ---- vertical waypoint dragging ---- */

  const toSvgPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  /** zoom the along-track window around anchorD — the anchor's data position
      stays at the same screen x after the zoom. factor < 1 = zoom in. */
  const zoomX = (anchorD: number, factor: number, dMin0: number, dMax0: number) => {
    const span0 = Math.max(dMax0 - dMin0, 1e-6)
    const span = Math.min(Math.max(span0 * factor, minSpan), maxSpan)
    const s = span / span0
    let dMin = anchorD - (anchorD - dMin0) * s
    dMin = Math.max(-span / 2, Math.min(dMin, total - span / 2))
    return { dMin, dMax: dMin + span }
  }

  /** y window to persist through a zoom/pan: the user-panned one if any,
      otherwise the auto-fitted current one (re-fit happens in the memo) */
  const yWindow = () =>
    view && !yAutoRef.current
      ? { min: view.hMin, max: view.hMax }
      : { min: geometry.hMin, max: geometry.hMax }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
    pointersRef.current.set(e.pointerId, p)

    /* second finger lands → pinch zoom (tablet); cancel any drag/pan in flight */
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      dragIdRef.current = null
      dragRangeRef.current = null
      dragGhostHRef.current = null
      setDragId(null)
      panRef.current = null
      setPanning(false)
      pinchRef.current = {
        dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1e-3),
        cx: (a.x + b.x) / 2,
        dMin: xRange.min,
        dMax: xRange.max,
      }
      setZooming(true)
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    let best: { id: string; dist: number } | null = null
    for (const dot of dots) {
      const dist = Math.hypot(dot.x - p.x, dot.y - p.y)
      if (!best || dist < best.dist) best = { id: dot.id, dist }
    }
    if (best && best.dist <= HIT_RADIUS) {
      /* grabbed a waypoint — vertical height drag */
      e.preventDefault()
      svgRef.current?.setPointerCapture(e.pointerId)
      dragIdRef.current = best.id
      dragRangeRef.current = { min: geometry.hMin, max: geometry.hMax }
      dragGhostHRef.current = dots.find((dot) => dot.id === best.id)?.height ?? null
      setDragId(best.id)
      const { selectWaypoint, selectedWaypointId } = useRoute.getState()
      if (selectedWaypointId !== best.id) selectWaypoint(best.id)
      return
    }
    /* empty area — pan the viewport on BOTH axes: the curve follows the
       pointer in any direction, the axes stay put, ticks re-label live */
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    panRef.current = {
      px: p.x,
      py: p.y,
      dMin: xRange.min,
      dMax: xRange.max,
      hMin: geometry.hMin,
      hMax: geometry.hMax,
    }
    setPanning(true)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p)

    /* ---- pinch zoom (two pointers) ---- */
    const pinch = pinchRef.current
    if (pinch) {
      const [a, b] = [...pointersRef.current.values()]
      if (a && b) {
        const innerW = W - PAD_X * 2
        const dist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1e-3)
        const cx = (a.x + b.x) / 2
        /* anchor = midpoint's data position; spread fingers = zoom in */
        const anchorD = pinch.dMin + ((pinch.cx - PAD_X) / innerW) * (pinch.dMax - pinch.dMin)
        const { dMin, dMax } = zoomX(anchorD, pinch.dist / dist, pinch.dMin, pinch.dMax)
        /* midpoint drift pans alongside the zoom, like a map pinch */
        const span = dMax - dMin
        const dd = (-(cx - pinch.cx) / innerW) * span
        const dMinP = Math.max(-span / 2, Math.min(dMin + dd, total - span / 2))
        const y = yWindow()
        setView({ dMin: dMinP, dMax: dMinP + span, hMin: y.min, hMax: y.max })
      }
      return
    }

    const id = dragIdRef.current
    if (id) {
      const innerH = H - PAD_BOTTOM - PAD_TOP
      const r = dragRangeRef.current ?? { min: geometry.hMin, max: geometry.hMax }
      const hRaw = ((H - PAD_BOTTOM - p.y) / innerH) * (r.max - r.min) + r.min
      const height = Math.min(MAX_WAYPOINT_HEIGHT_M, Math.max(MIN_HEIGHT, Math.round(hRaw)))
      useRoute.getState().updateWaypoint(id, { height })
      return
    }
    const pan = panRef.current
    if (pan) {
      const innerH = H - PAD_BOTTOM - PAD_TOP
      const innerW = W - PAD_X * 2
      const hSpan = pan.hMax - pan.hMin
      const dSpan = pan.dMax - pan.dMin
      /* content chases the pointer, both axes (Excel/Origin chart panning):
         dy down → y window slides up; dx right → x window slides left */
      const dh = ((p.y - pan.py) / innerH) * hSpan
      /* an intentional vertical pan takes y out of auto-fit; until then y
         re-fits the visible stretch automatically */
      if (Math.abs(p.y - pan.py) > 3) yAutoRef.current = false
      const hMin = Math.max(-hSpan, Math.min(pan.hMin + dh, MAX_WAYPOINT_HEIGHT_M * 2 - hSpan))
      const dd = (-(p.x - pan.px) / innerW) * dSpan
      /* allow half a window of overscroll on each side of the track */
      const dMin = Math.max(-dSpan / 2, Math.min(pan.dMin + dd, total - dSpan / 2))
      setView({ dMin, dMax: dMin + dSpan, hMin, hMax: hMin + hSpan })
    }
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2 && pinchRef.current) {
      pinchRef.current = null
      setZooming(false)
    }
    if (!dragIdRef.current && !panRef.current) {
      svgRef.current?.releasePointerCapture?.(e.pointerId)
      return
    }
    dragIdRef.current = null
    dragRangeRef.current = null
    dragGhostHRef.current = null
    setDragId(null)
    panRef.current = null
    setPanning(false)
    svgRef.current?.releasePointerCapture?.(e.pointerId)
  }

  /* ---- toolbar zoom buttons ---- */

  /** zoom by factor around the SELECTED waypoint (centred in the window) or
      the viewport centre when nothing is selected; factor < 1 = zoom in */
  const zoomBy = (factor: number) => {
    let anchorD = (xRange.min + xRange.max) / 2
    const selIdx = route.waypoints.findIndex((w) => w.id === selectedId)
    if (selIdx >= 0) anchorD = distanceAt(fractionOfWaypoint(route, selIdx))
    const { dMin, dMax } = zoomX(anchorD, factor, xRange.min, xRange.max)
    const span = dMax - dMin
    /* re-centre on the anchor, clamped to the overscroll bounds */
    let dm = anchorD - span / 2
    dm = Math.max(-span / 2, Math.min(dm, total - span / 2))
    const y = yWindow()
    setView({ dMin: dm, dMax: dm + span, hMin: y.min, hMax: y.max })
  }

  const fitView = () => {
    setView(null)
    yAutoRef.current = true
  }

  const spanNow = xRange.max - xRange.min
  const zoomInMaxed = spanNow <= minSpan * 1.001
  const zoomOutMaxed = spanNow >= maxSpan * 0.999

  const dragDot = dragId ? dots.find((dot) => dot.id === dragId) : null

  /* y grid ticks for the current viewport (nice 1/2/5 steps) */
  const tickStep = niceStep((hMax - hMin) / 4)
  const ticks: number[] = []
  for (let h = Math.ceil(hMin / tickStep) * tickStep; h <= hMax + 1e-6 && ticks.length < 8; h += tickStep) {
    ticks.push(h)
  }

  return (
    <figure className="ce-minimap">
      <figcaption>
        <span>Side view · elevation</span>
        <span className="ce-minimap-tools">
          <button
            type="button"
            title="Fit route (reset zoom and pan)"
            aria-label="Fit route"
            disabled={!view}
            onClick={fitView}
          >
            <ExpandIcon size={12} />
          </button>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={zoomInMaxed}
            onClick={() => zoomBy(0.5)}
          >
            <PlusIcon size={12} />
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={zoomOutMaxed}
            onClick={() => zoomBy(2)}
          >
            <MinusIcon size={12} />
          </button>
        </span>
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Route elevation profile — drag waypoints vertically to change altitude, drag empty space to pan, zoom with the toolbar buttons or pinch, double-click to reset"
        className={[
          'ce-minimap-side',
          dragId ? 'is-dragging' : '',
          panning ? 'is-panning' : '',
          zooming || pinchRef.current ? 'is-zooming' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={fitView}
      >
        <title>
          Drag a waypoint vertically to set altitude · drag empty space to pan (left/right =
          along-track, up/down = altitude) · zoom with the toolbar buttons or pinch · double-click
          to reset
        </title>
        <line className="ce-minimap-ground" x1={PAD_X} y1={sy(0)} x2={W - PAD_X} y2={sy(0)} />
        {ticks.map((h) => (
          <g key={h}>
            <line className="ce-minimap-grid" x1={PAD_X} y1={sy(h)} x2={W - PAD_X} y2={sy(h)} />
            <text className="ce-minimap-ylabel" x={PAD_X + 1} y={sy(h) - 2}>
              {fmtAlt(h)}
            </text>
          </g>
        ))}
        <path className="ce-minimap-path" d={d} />
        {dragDot && dragGhostHRef.current != null && (
          <circle className="ce-minimap-ghost" cx={dragDot.x} cy={sy(dragGhostHRef.current)} r={5} />
        )}
        {headPt && <circle className="ce-minimap-head" cx={headPt.x} cy={headPt.y} r={4} />}
        {dots.map((dot, i) => {
          const active = dot.id === selectedId || dot.id === dragId
          return (
            <g key={dot.id} className={active ? 'ce-minimap-wp is-selected' : 'ce-minimap-wp'}>
              <circle className="ce-minimap-hit" cx={dot.x} cy={dot.y} r={HIT_RADIUS} />
              <circle cx={dot.x} cy={dot.y} r={active ? 3.6 : 2.8} />
              <text x={dot.x} y={dot.y - 6}>{i + 1}</text>
            </g>
          )
        })}
        {dragDot && (
          <text
            className="ce-minimap-drag-tip"
            x={Math.min(Math.max(dragDot.x, PAD_X + 24), W - PAD_X - 24)}
            y={Math.max(dragDot.y - 12, PAD_TOP)}
          >
            {fmtAlt(dragDot.height)}
          </text>
        )}
        <text className="ce-minimap-axis" x={PAD_X} y={H - 5}>
          {fmtKm(Math.max(0, xRange.min))} – {fmtKm(Math.min(total, xRange.max))}
        </text>
      </svg>
    </figure>
  )
}

/** progress fraction where waypoint i sits (by segment durations) */
function fractionOfWaypoint(route: Route, index: number): number {
  const durations = route.waypoints.map((w) => Math.max(0.1, w.duration || 3))
  const sum = durations.slice(0, -1).reduce((a, b) => a + b, 0)
  if (sum <= 0) return 0
  let acc = 0
  for (let i = 0; i < index; i += 1) acc += durations[i]
  return Math.min(1, acc / sum)
}
