// GES-style camera channels: the route's bundled waypoints split into
// single-attribute keyframe tracks (lon / lat / height / heading / pitch / roll / fov).
// Pure view-model derivation — no engine, no React.

import { waypointFractions } from './pathMath'
import {
  MAX_WAYPOINT_HEIGHT_M,
  hasPosition,
  type EaseChannel,
  type EaseSpec,
  type Route,
} from './types'

export type ChannelId = EaseChannel

export type ChannelKey = {
  /** time position, 0..1 of total route duration */
  t: number
  /** absolute attribute value at the key */
  value: number
  /** source waypoint index (tooltips / selection sync) */
  waypoint: number
  /** this key's easing on this channel (undefined = interpolation default) */
  ease?: EaseSpec
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
      channels.lon.push({ t, value: w.lon!, waypoint: i, ease: w.ease?.lon })
      channels.lat.push({ t, value: w.lat!, waypoint: i, ease: w.ease?.lat })
      channels.height.push({ t, value: w.height!, waypoint: i, ease: w.ease?.height })
    }
    if (w.heading != null) {
      channels.heading.push({ t, value: w.heading, waypoint: i, ease: w.ease?.heading })
    }
    if (w.pitch != null) channels.pitch.push({ t, value: w.pitch, waypoint: i, ease: w.ease?.pitch })
    if (w.roll != null) channels.roll.push({ t, value: w.roll, waypoint: i, ease: w.ease?.roll })
    if (w.fov != null) channels.fov.push({ t, value: w.fov, waypoint: i, ease: w.ease?.fov })
  })
  return channels
}

/** editor clamp per channel — keeps values physical while dragging the curve */
export function clampChannelValue(id: ChannelId, v: number): number {
  switch (id) {
    case 'lon':
      return Math.min(180, Math.max(-180, v))
    case 'lat':
      return Math.min(90, Math.max(-90, v))
    case 'height':
      return Math.min(MAX_WAYPOINT_HEIGHT_M, Math.max(0, v))
    case 'fov':
      return Math.min(170, Math.max(5, v))
    default:
      return v // angles ride free — sampling wraps them
  }
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
