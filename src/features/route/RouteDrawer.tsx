// Route drawer — right-side overlay, symmetric to the tools drawer.
// Same shell rules: floats over the globe, bottom stops above the timeline.

import { useUI } from '../../store/ui'
import { CloseIcon, RouteIcon } from '../../components/Icons'
import { buildTrack, totalDuration } from './pathMath'
import { useRoute } from './routeStore'
import RouteTopView from './RouteTopView'
import RouteSideView from './RouteSideView'
import WaypointList from './WaypointList'

const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`

export default function RouteDrawer() {
  const open = useUI((s) => s.rightDrawerOpen)
  const toggle = useUI((s) => s.toggleRightDrawer)
  const route = useRoute((s) => s.route)

  const track = buildTrack(route)
  const distance = track.length > 0 ? track[track.length - 1].cumulative : 0

  return (
    <aside id="ce-route-drawer" className="ce-drawer" data-side="right" data-open={open} aria-hidden={!open}>
      <header className="ce-drawer-head">
        <span className="ce-drawer-title">
          <RouteIcon size={16} />
          Route
        </span>
        <button type="button" className="ce-icon-btn" onClick={() => toggle(false)} title="Close (Esc)">
          <CloseIcon size={15} />
        </button>
      </header>

      <div className="ce-drawer-body">
        <RouteTopView route={route} />
        <RouteSideView route={route} />

        <div className="ce-route-stats">
          <span>{route.name}</span>
          <span>
            {totalDuration(route).toFixed(0)} s · {fmtKm(distance)} · {route.waypoints.length} wp
          </span>
        </div>

        <p className="ce-hint">Waypoints — camera keyframes</p>
        <WaypointList />
      </div>
    </aside>
  )
}
