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
  sampleTerrainMostDetailed,
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
  /** commit (≥2 points) or discard (null); heights are terrain samples.
      May return a promise that resolves once the committed asset is MOUNTED
      — the preview stays on screen until then (seamless handover) */
  onEnd: (
    positions: { lon: number; lat: number; height: number }[] | null,
  ) => Promise<void> | void
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

  const removeVisuals = () => {
    if (viewer.isDestroyed()) return /* entities die with the viewer anyway */
    viewer.entities.remove(previewLine)
  }

  const cleanup = () => {
    if (done) return
    done = true
    handler.destroy()
    window.removeEventListener('keydown', onKey)
    viewer.canvas.style.cursor = prevCursor
    /* vertex markers go the moment drawing ends ("finish = finish"); they are
       drafting aids the committed asset does not have — dropping them later,
       together with the preview, read as a visible jump several hundred ms
       after the double-click */
    markers.forEach((m) => viewer.entities.remove(m))
    /* double-click entity tracking stays suppressed (CTEarth behaves the
       same): its default action cannot be re-registered reliably */
  }

  /* hand the drawn geometry over WITHOUT a visual gap: committing samples
     terrain asynchronously, then the asset mounts through store→React→ds
     microtasks. Await the mount-completion signal, then swap preview for the
     real line in ONE render pass — rendering the mounted line while the
     preview is still up overlays two identical lines for a frame (the AA
     edges compound and the line visibly brightens before the preview is
     dropped). The entity is already in the collection at that point, so the
     same render() call builds and draws it. A timeout keeps the preview
     from leaking if a mount ever wedges. */
  const commit = (positions: { lon: number; lat: number; height: number }[]) => {
    void Promise.race([
      Promise.resolve(hooks.onEnd(positions)).catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, 1500)),
    ]).then(() => {
      removeVisuals()
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
    })
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
    if (points.length < 2) {
      removeVisuals()
      hooks.onEnd(null)
      return
    }
    /* Cartographic.fromCartesian gives ELLIPSOID heights (~0), not terrain
       heights — volumes cannot clamp to ground like polylines, so a chord
       built from those vertices would sink kilometres under real terrain.
       Sample the drawn positions properly before committing. */
    const cartos = points.map((p) => new Cartographic(p.longitude, p.latitude))
    void sampleTerrainMostDetailed(viewer.terrainProvider, cartos)
      .then((sampled) => {
        commit(
          sampled.map((c) => ({
            lon: toDegrees(c.longitude),
            lat: toDegrees(c.latitude),
            height: Number.isFinite(c.height) ? c.height : 0,
          })),
        )
      })
      .catch((err) => {
        console.warn('[CineEarth] terrain sampling on commit failed', err)
        commit(
          points.map((p) => ({
            lon: toDegrees(p.longitude),
            lat: toDegrees(p.latitude),
            height: Number.isFinite(p.height) ? p.height : 0,
          })),
        )
      })
  }

  const cancel = () => {
    cleanup()
    removeVisuals()
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
