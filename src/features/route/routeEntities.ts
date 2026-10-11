// Per-机位 route decoration shared by the multi-view panes AND the exporter:
// the spline polyline, positioned waypoint dots and the target halo. A single
// source of truth keeps the Program Out monitor and the offline render pixel-
// identical (the exporter drives the SAME Viewer with the SAME entities).

import { Cartesian3, Color, type Entity, type Viewer } from 'cesium'
import { samplePath } from './pathMath'
import { hasPosition } from './types'
import type { Shot } from './routeStore'

export const ACCENT = Color.fromCssColorString('#38618c')
export const INK = Color.fromCssColorString('#fbfbfa')

/** create a shot's route entities (spline + waypoints + target) in `viewer`.
 *  Returns the created entities so the caller can remove them later. */
export function buildShotRouteEntities(viewer: Viewer, shot: Shot): Entity[] {
  const entities: Entity[] = []
  const poses = samplePath(shot.route, 120)
  if (poses.length > 1) {
    entities.push(
      viewer.entities.add({
        polyline: {
          positions: poses.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, p.height)),
          width: 2,
          material: ACCENT.withAlpha(0.9),
        },
      }),
    )
  }
  shot.route.waypoints.filter(hasPosition).forEach((w) => {
    entities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(w.lon, w.lat, w.height),
        point: { pixelSize: 5, color: INK, outlineColor: ACCENT, outlineWidth: 1 },
      }),
    )
  })
  const t = shot.route.target
  if (t) {
    entities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(t.lon, t.lat, t.height),
        point: { pixelSize: 10, color: ACCENT.withAlpha(0.25), outlineColor: ACCENT, outlineWidth: 2 },
      }),
    )
  }
  return entities
}
