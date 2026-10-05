// Side view — elevation profile along the route.
// x = cumulative along-track distance, y = altitude; ground shown as a base line.
// Waypoints are DRAGGABLE vertically — commits height to the route store
// (3D globe & top view update live).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { haversineM, samplePath, samplePose } from './pathMath'
import { useRoute } from './routeStore'
import { MAX_WAYPOINT_HEIGHT_M, type Route } from './types'

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
  /** viewport pan state — empty-area drag moves the visible height window */
  const panRef = useRef<{ y: number; min: number; max: number } | null>(null)
  const [view, setView] = useState<{ min: number; max: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)

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
       2. the user-panned viewport (empty-area drag).
       3. auto-fit: 0 .. maxH × 1.15. */
    const range =
      dragRangeRef.current ?? view ?? { min: 0, max: Math.max(...pts.map((p) => p.h), 100) * 1.15 }
    const { min: hMin, max: hMax } = range
    const sx = (d: number) => PAD_X + (d / Math.max(total, 1e-6)) * (W - PAD_X * 2)
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

    return { pts, total, hMin, hMax, sx, sy, distanceAt }
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
    if (!dragIdRef.current && !panRef.current) setView(null)
  }, [route])

  if (!geometry) return null
  const { pts, total, hMin, hMax, sx, sy, distanceAt } = geometry

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

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
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
    /* empty area — pan the height viewport: the curve follows the pointer,
       the axes stay put, the y-tick numbers re-label live */
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    panRef.current = { y: p.y, min: geometry.hMin, max: geometry.hMax }
    setPanning(true)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
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
      const span = pan.max - pan.min
      /* pointer down dy → curve follows down → sy(h) grows → min grows
         (viewport slides UP the height axis). Sign matters: content chases
         the pointer, exactly like panning a chart in Excel/Origin. */
      const dh = ((p.y - pan.y) / innerH) * span
      const min = Math.max(-span, Math.min(pan.min + dh, MAX_WAYPOINT_HEIGHT_M * 2 - span))
      setView({ min, max: min + span })
    }
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragIdRef.current && !panRef.current) return
    dragIdRef.current = null
    dragRangeRef.current = null
    dragGhostHRef.current = null
    setDragId(null)
    panRef.current = null
    setPanning(false)
    svgRef.current?.releasePointerCapture?.(e.pointerId)
  }

  const dragDot = dragId ? dots.find((dot) => dot.id === dragId) : null

  /* y grid ticks for the current viewport (nice 1/2/5 steps) */
  const tickStep = niceStep((hMax - hMin) / 4)
  const ticks: number[] = []
  for (let h = Math.ceil(hMin / tickStep) * tickStep; h <= hMax + 1e-6 && ticks.length < 8; h += tickStep) {
    ticks.push(h)
  }

  return (
    <figure className="ce-minimap">
      <figcaption>Side view · elevation</figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Route elevation profile — drag waypoints vertically to change altitude, drag empty space to pan, double-click to reset"
        title="Drag a waypoint vertically to set altitude · drag empty space to pan · double-click to reset view"
        className={[
          'ce-minimap-side',
          dragId ? 'is-dragging' : '',
          panning ? 'is-panning' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView(null)}
      >
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
        <text className="ce-minimap-axis" x={PAD_X} y={H - 5}>{fmtKm(total)}</text>
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
