// Side view — elevation profile along the route.
// x = cumulative along-track distance, y = altitude; ground shown as a base line.
// Waypoints are DRAGGABLE vertically — commits height to the route store
// (3D globe & top view update live).

import { useMemo, useRef, useState } from 'react'
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

export default function RouteSideView({ route }: { route: Route }) {
  const progress = useRoute((s) => s.progress)
  const selectedId = useRoute((s) => s.selectedWaypointId)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragIdRef = useRef<string | null>(null)
  /** y-scale frozen at drag start — see geometry memo below */
  const dragScaleRef = useRef<number | null>(null)
  /** drag-start height — anchors the ghost dot at the original position */
  const dragGhostHRef = useRef<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

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

    /* freeze the y-scale while dragging (captured at pointerdown). Recomputing
       it from live heights created a feedback loop: pointer offset × maxH →
       commit → maxH grows → same offset maps even higher → exponential runaway
       (heights hit billions of metres and broke Cesium geometry). */
    const maxH = dragScaleRef.current ?? Math.max(...pts.map((p) => p.h), 100)
    const sx = (d: number) => PAD_X + (d / Math.max(total, 1e-6)) * (W - PAD_X * 2)
    const sy = (h: number) => H - PAD_BOTTOM - (h / (maxH * 1.15)) * (H - PAD_BOTTOM - PAD_TOP)

    /* the x-axis is along-track DISTANCE, but waypoints & the playhead are keyed
       by progress fraction (time) — convert fraction → distance, otherwise dots
       float off the curve wherever time ≠ distance (i.e. on sloped parts) */
    const distanceAt = (fraction: number) => {
      const x = Math.min(Math.max(fraction, 0), 1) * (pts.length - 1)
      const i0 = Math.min(pts.length - 2, Math.floor(x))
      return pts[i0].d + (pts[i0 + 1].d - pts[i0].d) * (x - i0)
    }

    return { pts, total, maxH, sx, sy, distanceAt }
  }, [route])

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

  if (!geometry) return null
  const { pts, total, sx, sy, distanceAt } = geometry

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
    if (!best || best.dist > HIT_RADIUS) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    dragIdRef.current = best.id
    dragScaleRef.current = geometry.maxH
    dragGhostHRef.current = dots.find((dot) => dot.id === best.id)?.height ?? null
    setDragId(best.id)
    const { selectWaypoint, selectedWaypointId } = useRoute.getState()
    if (selectedWaypointId !== best.id) selectWaypoint(best.id)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const id = dragIdRef.current
    if (!id) return
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
    const innerH = H - PAD_BOTTOM - PAD_TOP
    const scaleMax = dragScaleRef.current ?? geometry.maxH
    const hRaw = ((H - PAD_BOTTOM - p.y) / innerH) * (scaleMax * 1.15)
    const height = Math.min(MAX_WAYPOINT_HEIGHT_M, Math.max(MIN_HEIGHT, Math.round(hRaw)))
    useRoute.getState().updateWaypoint(id, { height })
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragIdRef.current) return
    dragIdRef.current = null
    dragScaleRef.current = null
    dragGhostHRef.current = null
    setDragId(null)
    svgRef.current?.releasePointerCapture?.(e.pointerId)
  }

  const dragDot = dragId ? dots.find((dot) => dot.id === dragId) : null

  return (
    <figure className="ce-minimap">
      <figcaption>Side view · elevation</figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Route elevation profile — drag waypoints vertically to change altitude"
        className={dragId ? 'ce-minimap-side is-dragging' : 'ce-minimap-side'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <line className="ce-minimap-ground" x1={PAD_X} y1={H - PAD_BOTTOM} x2={W - PAD_X} y2={H - PAD_BOTTOM} />
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
