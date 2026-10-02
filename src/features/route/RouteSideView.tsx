// Side view — elevation profile along the route.
// x = cumulative along-track distance, y = altitude; ground shown as a base line.

import { useMemo } from 'react'
import { haversineM, samplePath, samplePose } from './pathMath'
import { useRoute } from './routeStore'
import type { Route } from './types'

const W = 300
const H = 110
const PAD_X = 10
const PAD_TOP = 12
const PAD_BOTTOM = 18

function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

export default function RouteSideView({ route }: { route: Route }) {
  const progress = useRoute((s) => s.progress)

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

    const maxH = Math.max(...pts.map((p) => p.h), 100)
    const sx = (d: number) => PAD_X + (d / Math.max(total, 1e-6)) * (W - PAD_X * 2)
    const sy = (h: number) => H - PAD_BOTTOM - (h / (maxH * 1.15)) * (H - PAD_BOTTOM - PAD_TOP)

    return { pts, total, maxH, sx, sy }
  }, [route])

  if (!geometry) return null
  const { pts, total, sx, sy } = geometry

  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.d).toFixed(1)} ${sy(p.h).toFixed(1)}`)
    .join(' ')

  const headPose = samplePose(route, progress)
  const headPt = headPose
    ? {
        x: sx(progress * total),
        y: sy(headPose.height),
      }
    : null

  return (
    <figure className="ce-minimap">
      <figcaption>Side view · elevation</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route elevation profile">
        <line className="ce-minimap-ground" x1={PAD_X} y1={H - PAD_BOTTOM} x2={W - PAD_X} y2={H - PAD_BOTTOM} />
        <path className="ce-minimap-path" d={d} />
        {headPt && <circle className="ce-minimap-head" cx={headPt.x} cy={headPt.y} r={4} />}
        {route.waypoints.map((w, i) => {
          const frac = fractionOfWaypoint(route, i, total)
          return <circle key={w.id} className="ce-minimap-wp-dot" cx={sx(frac * total)} cy={sy(w.height)} r={3} />
        })}
        <text className="ce-minimap-axis" x={PAD_X} y={H - 5}>{fmtKm(total)}</text>
      </svg>
    </figure>
  )
}

/** progress fraction where waypoint i sits (by segment durations) */
function fractionOfWaypoint(route: Route, index: number, _total: number): number {
  const durations = route.waypoints.map((w) => Math.max(0.1, w.duration || 3))
  const sum = durations.slice(0, -1).reduce((a, b) => a + b, 0)
  if (sum <= 0) return 0
  let acc = 0
  for (let i = 0; i < index; i += 1) acc += durations[i]
  return Math.min(1, acc / sum)
}
