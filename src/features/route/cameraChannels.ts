// GES-style camera channels: the route's bundled waypoints split into
// single-attribute keyframe tracks (lon / lat / height / heading / pitch / roll / fov).
// Pure view-model derivation — no engine, no React.

import { waypointFractions } from './pathMath'
import { hasPosition, type Route } from './types'

export type ChannelId = 'lon' | 'lat' | 'height' | 'heading' | 'pitch' | 'roll' | 'fov'

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
 * One key per waypoint per channel — but only for the channel groups the
 * waypoint actually carries (fields are optional on the shared time chain:
 * position trio bundled, heading/pitch/roll independent). Key positions
 * come from cumulative waypoint durations (waypointFractions).
 */
export function cameraChannelKeys(route: Route): CameraChannels {
  const fractions = waypointFractions(route)
  const channels: CameraChannels = { lon: [], lat: [], height: [], heading: [], pitch: [], roll: [], fov: [] }
  route.waypoints.forEach((w, i) => {
    const t = fractions[i] ?? 0
    if (hasPosition(w)) {
      channels.lon.push({ t, value: w.lon!, waypoint: i })
      channels.lat.push({ t, value: w.lat!, waypoint: i })
      channels.height.push({ t, value: w.height!, waypoint: i })
    }
    if (w.heading != null) channels.heading.push({ t, value: w.heading, waypoint: i })
    if (w.pitch != null) channels.pitch.push({ t, value: w.pitch, waypoint: i })
    if (w.roll != null) channels.roll.push({ t, value: w.roll, waypoint: i })
    if (w.fov != null) channels.fov.push({ t, value: w.fov, waypoint: i })
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
    case 'pitch':
    case 'roll':
      /* Math.round first: toFixed(0) of a tiny negative (-0.02°) renders
         as "-0°" — round to kill the negative zero before formatting */
      return `${(Math.round(value) === 0 ? 0 : value).toFixed(0)}°`
    case 'fov':
      return `${value.toFixed(1)}°`
  }
}
