// GES-style camera channels: the route's bundled waypoints split into
// single-attribute keyframe tracks (lon / lat / height / heading).
// Pure view-model derivation — no engine, no React.

import { waypointFractions } from './pathMath'
import type { Route } from './types'

export type ChannelId = 'lon' | 'lat' | 'height' | 'heading'

export type ChannelKey = {
  /** time position, 0..1 of total route duration */
  t: number
  /** absolute attribute value at the key */
  value: number
  /** source waypoint index (tooltips / selection sync) */
  waypoint: number
}

export type CameraChannels = Record<ChannelId, ChannelKey[]>

/**
 * One key per waypoint per channel. Key positions come from cumulative
 * waypoint durations (waypointFractions), so every channel shares the
 * same time layout as the Camera (bundled) track.
 */
export function cameraChannelKeys(route: Route): CameraChannels {
  const fractions = waypointFractions(route)
  const channels: CameraChannels = { lon: [], lat: [], height: [], heading: [] }
  route.waypoints.forEach((w, i) => {
    const t = fractions[i] ?? 0
    channels.lon.push({ t, value: w.lon, waypoint: i })
    channels.lat.push({ t, value: w.lat, waypoint: i })
    channels.height.push({ t, value: w.height, waypoint: i })
    channels.heading.push({ t, value: w.heading, waypoint: i })
  })
  return channels
}

/** display formatting per channel */
export function formatChannelValue(id: ChannelId, value: number): string {
  switch (id) {
    case 'lon':
    case 'lat':
      return `${value.toFixed(4)}°`
    case 'height':
      return `${Math.round(value)} m`
    case 'heading':
      return `${value.toFixed(0)}°`
  }
}
