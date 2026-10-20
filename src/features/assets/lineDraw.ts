// Ground-line drawing engine — Cesium-side interaction only (no React).
// Click = add point, mouse move = rubber-band preview, double-click or
// finish() = commit, Esc or cancel() = discard. Points are picked on the
// GLOBE (ray + globe pick, ellipsoid fallback) so the committed line can be
// clamped to terrain. Pattern follows CTEarth's measure-line interaction.

import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'
import type { Entity, Viewer } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'

export interface DrawHandle {
  finish(): void
  cancel(): void
}

export interface LineDrawHooks {
  /** live count while drawing (drives the hint pill) */
  onPoints?: (count: number) => void
  /** commit (≥2 points) or discard (null); heights are terrain samples */
  onEnd: (positions: { lon: number; lat: number; height: number }[] | null) => void
}

const PREVIEW_COLOR = '#f2b544'

/** ground point under a screen position; ellipsoid fallback when off-terrain */
function pickGround(viewer: Viewer, screen: Cartesian2): Cartesian3 | null {
  const ray = viewer.camera.getPickRay(screen)
  const onGlobe = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null
  if (onGlobe) return onGlobe
  return viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid) ?? null
}

export function startLineDraw(hooks: LineDrawHooks): DrawHandle | null {
  const viewer = getViewer()
  if (!viewer) return null

  const points: Cartographic[] = []
  const cartesians: Cartesian3[] = []
  const markers: Entity[] = []
  let cursorPos: Cartesian3 | null = null
  let done = false

  /* crosshair + mute the default double-click entity tracking while drawing */
  const prevCursor = viewer.canvas.style.cursor
  viewer.canvas.style.cursor = 'crosshair'
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  /* rubber band: committed points + cursor position, re-evaluated per frame */
  const previewLine = viewer.entities.add({
    polyline: {
      positions: new CallbackProperty(() => {
        const arr = [...cartesians]
        if (cursorPos) arr.push(cursorPos)
        return arr
      }, false),
      width: 3,
      material: Color.fromCssColorString(PREVIEW_COLOR),
      clampToGround: true,
    },
  })

  const addMarker = (pos: Cartesian3) => {
    markers.push(
      viewer.entities.add({
        position: pos,
        point: {
          pixelSize: 6,
          color: Color.fromCssColorString(PREVIEW_COLOR),
          outlineColor: Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
  }

  const cleanup = () => {
    if (done) return
    done = true
    handler.destroy()
    window.removeEventListener('keydown', onKey)
    viewer.entities.remove(previewLine)
    markers.forEach((m) => viewer.entities.remove(m))
    viewer.canvas.style.cursor = prevCursor
    /* double-click entity tracking stays suppressed (CTEarth behaves the
       same): its default action cannot be re-registered reliably */
  }

  const finish = () => {
    cleanup()
    /* a double-click's first click already appended the hit twice — drop the
       duplicate before committing */
    if (points.length >= 2) {
      const a = points[points.length - 1]
      const b = points[points.length - 2]
      if (Math.abs(a.longitude - b.longitude) < 1e-9 && Math.abs(a.latitude - b.latitude) < 1e-9) {
        points.pop()
      }
    }
    hooks.onEnd(
      points.length >= 2
        ? points.map((p) => ({
            lon: toDegrees(p.longitude),
            lat: toDegrees(p.latitude),
            height: p.height,
          }))
        : null,
    )
  }

  const cancel = () => {
    cleanup()
    hooks.onEnd(null)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      cancel()
    }
  }
  window.addEventListener('keydown', onKey)

  const handler = new ScreenSpaceEventHandler(viewer.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    const pos = pickGround(viewer, event.position)
    if (!pos) return
    points.push(Cartographic.fromCartesian(pos))
    cartesians.push(pos)
    addMarker(pos)
    hooks.onPoints?.(points.length)
  }, ScreenSpaceEventType.LEFT_CLICK)

  handler.setInputAction((event: { endPosition: Cartesian2 }) => {
    cursorPos = pickGround(viewer, event.endPosition)
  }, ScreenSpaceEventType.MOUSE_MOVE)

  handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  return { finish, cancel }
}

/* Cartographic stores radians; assets speak degrees */
function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}
