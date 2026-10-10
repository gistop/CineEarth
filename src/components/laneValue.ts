/** Channel value at an absolute second — the ONE sampler behind both the
 *  soloed curve pane and the lane value bars, so preview and editor can
 *  never disagree.
 *
 *  The value is the ATTRIBUTE's own interpolation: per segment
 *  a → a + (b − a)·easeFraction(local) — literally what the graph handles
 *  describe (hold=step shows up too). It deliberately does NOT re-sample
 *  through samplePose for the position group: that runs a Catmull-Rom over
 *  the keys, and there an overshooting handle sends the EASED PARAMETER past
 *  1 — the spline gets evaluated beyond its own segment and the drawing
 *  folds into an extra 谷-峰 the handles never describe. Heading/pitch are
 *  the exception: with a target the flight re-aims them every frame, so
 *  those keep the flown sample.
 *
 *  (Lifted verbatim from TimelineTracks' curve sampler when the value bars
 *  needed the same math — the comment above explains WHY, keep it.) */
import {
  angleDeltaDeg,
  easeFraction,
  samplePose,
  timelineProgressToRoute,
} from '../features/route/pathMath'
import type { ChannelId } from '../features/route/cameraChannels'
import type { EaseSpec, Route } from '../features/route/types'

/** the slice of a lane key the sampler reads — KeySpan satisfies it, so the
 *  curve pane and the bars both feed their own projection without importing
 *  the lane component (no cycles) */
export type LaneKey = { tSec: number; value: number; ease?: EaseSpec }

/** value at tSec (null = channel has no keys / pose unavailable). Keys MUST
 *  be sorted by tSec — keySpans() guarantees it. Outside first→last key the
 *  channel HOLDS, so the endpoint value is returned verbatim. */
export function laneValueAt(
  keys: LaneKey[],
  ch: ChannelId,
  route: Route,
  tSec: number,
  duration: number,
): number | null {
  const aimed = route.target != null && (ch === 'heading' || ch === 'pitch')
  if (aimed) {
    return samplePose(route, timelineProgressToRoute(route, tSec / duration))?.[ch] ?? null
  }
  if (keys.length === 0) return null
  if (tSec <= keys[0].tSec) return keys[0].value
  if (tSec >= keys[keys.length - 1].tSec) return keys[keys.length - 1].value
  let j = 1
  while (j < keys.length && keys[j].tSec < tSec) j += 1
  const a = keys[j - 1]
  const b = keys[j]
  const local = (tSec - a.tSec) / Math.max(b.tSec - a.tSec, 1e-9)
  const u = easeFraction(local, a.ease, b.ease)
  const delta = ch === 'heading' ? angleDeltaDeg(a.value, b.value) : b.value - a.value
  return a.value + delta * u
}
