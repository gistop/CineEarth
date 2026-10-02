// Waypoint list — one row per camera keyframe; click to select (syncs the mini views).

import { useRoute } from './routeStore'

const fmtDeg = (v: number, positive: string, negative: string) =>
  `${Math.abs(v).toFixed(2)}°${v >= 0 ? positive : negative}`

export default function WaypointList() {
  const waypoints = useRoute((s) => s.route.waypoints)
  const selectedId = useRoute((s) => s.selectedWaypointId)
  const select = useRoute((s) => s.selectWaypoint)

  if (waypoints.length === 0) {
    return <p className="ce-hint">No waypoints yet.</p>
  }

  return (
    <div className="ce-stack">
      {waypoints.map((w, i) => {
        const selected = w.id === selectedId
        return (
          <button
            key={w.id}
            type="button"
            className={`ce-wp-row${selected ? ' is-selected' : ''}`}
            onClick={() => select(selected ? null : w.id)}
            aria-pressed={selected}
          >
            <span className="ce-shot-idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="ce-wp-main">
              <span className="ce-row-name">
                {fmtDeg(w.lat, 'N', 'S')} · {fmtDeg(w.lon, 'E', 'W')}
              </span>
              <span className="ce-wp-sub">
                {Math.round(w.height)} m · {w.heading.toFixed(0)}° / {w.pitch.toFixed(0)}°
              </span>
            </span>
            <span className="ce-row-val">{w.duration.toFixed(1)}s</span>
          </button>
        )
      })}
    </div>
  )
}
