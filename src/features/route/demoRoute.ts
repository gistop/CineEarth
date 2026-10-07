// Demo route — a fly-around of the Matterhorn (45.9763N, 7.6586E, 4478m),
// matching the opening view. Replace with user-authored routes once the editor lands.

import { createWaypointId, type Route, type Waypoint } from './types'

function wp(lon: number, lat: number, height: number, heading: number, pitch: number, duration: number): Waypoint {
  return { id: createWaypointId(), lon, lat, height, heading, pitch, roll: 0, duration }
}

export function createDemoRoute(): Route {
  const waypoints = [
    wp(7.50, 45.890, 8000, 55, -15, 6),  // high approach from the south (Breuil-Cervinia side)
    wp(7.62, 45.925, 6400, 70, -20, 5),  // descend toward the south face
    wp(7.70, 45.955, 5400, 306, -18, 5), // slide past the SE ridge, swing the lens north
    wp(7.72, 45.995, 5000, 240, -10, 5), // closest pass — east flank above Zermatt
    wp(7.66, 46.030, 5600, 195, -12, 5), // frame the north face head-on
    wp(7.52, 46.060, 7200, 160, -15, 0), // pull up & away to the NNW
  ]
  /* the timeline length is authoritative and does NOT follow the keys — a
     loaded route fits its own content so nothing lands out of range */
  const content = waypoints.slice(0, -1).reduce((sum, w) => sum + w.duration, 0)
  return {
    name: 'Matterhorn fly-around — demo',
    fps: 30,
    loopMode: 'once',
    target: null,
    timelineLen: content,
    insertStrategy: 'fixed',
    waypoints,
  }
}
