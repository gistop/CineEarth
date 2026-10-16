// Route drawer — right-side overlay, symmetric to the tools drawer.
// Same shell rules: floats over the globe, bottom stops above the timeline.

import { useMemo } from 'react'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { CloseIcon, RouteIcon } from '../../components/Icons'
import { buildTrack, totalDuration } from './pathMath'
import { useRoute } from './routeStore'
import { createDemoRoute } from './demoRoute'
import RouteTopView from './RouteTopView'
import RouteSideView from './RouteSideView'
import WaypointList from './WaypointList'

const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`

export default function RouteDrawer() {
  const t = useT()
  const open = useUI((s) => s.rightDrawerOpen)
  const toggle = useUI((s) => s.toggleRightDrawer)
  const route = useRoute((s) => s.route)
  const setRoute = useRoute((s) => s.setRoute)

  const track = useMemo(() => (route ? buildTrack(route) : []), [route])
  const distance = track.length > 0 ? track[track.length - 1].cumulative : 0

  return (
    <aside id="ce-route-drawer" className="ce-drawer" data-side="right" data-open={open} aria-hidden={!open}>
      <header className="ce-drawer-head">
        <span className="ce-drawer-title">
          <RouteIcon size={16} />
          {t('route.title')}
        </span>
        <span className="ce-drawer-tools">
          <button
            type="button"
            className="ce-ghost-btn"
            disabled={!route}
            onClick={() => setRoute(createDemoRoute())}
            title={route ? t('route.demoTitle') : t('route.demoDisabled')}
          >
            {t('route.demo')}
          </button>
          <button type="button" className="ce-icon-btn" onClick={() => toggle(false)} title={t('drawer.close')}>
            <CloseIcon size={15} />
          </button>
        </span>
      </header>

      {!route ? (
        /* no shot being edited — the route editor has nothing to show */
        <div className="ce-drawer-body ce-route-body">
          <p className="ce-hint">{t('route.empty')}</p>
        </div>
      ) : (
        /* charts and stats stay pinned; only the waypoint list scrolls */
        <div className="ce-drawer-body ce-route-body">
          <div className="ce-route-fixed">
            <RouteTopView route={route} />
            <RouteSideView route={route} />

            <div className="ce-route-stats">
              <span>{route.name}</span>
              <span>
                {totalDuration(route).toFixed(0)} s · {fmtKm(distance)} · {route.waypoints.length} wp
              </span>
            </div>

            <p className="ce-hint">{route.waypoints.length === 0 ? t('route.addHint') : t('route.wpHint')}</p>
          </div>
          <div className="ce-route-list">
            <WaypointList />
          </div>
        </div>
      )}
    </aside>
  )
}
