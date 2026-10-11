import { useEffect, useRef } from 'react'
import {
  Viewer,
  ImageryLayer,
  Cartographic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
} from 'cesium'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { useExport } from '../features/export/exportStore'
import { applyFraming, currentCameraAsFreeCam, sameFraming } from '../features/route/framing'
import { setViewer } from '../cesium/viewerRegistry'
import { bindImagery, getImageryProvider } from '../cesium/imagerySource'
import { bootstrapIonSettings } from '../features/settings/ionTerrain'
import { syncSceneSettings } from '../features/settings/sceneSettings'

/**
 * The globe is an imperative island:
 * — created once in useEffect, held in a ref, NEVER re-rendered by React.
 * — its container is absolutely inset:0, so opening/closing any overlay
 *   panel never resizes it (camera & extent stay untouched).
 */
export default function GlobeViewport() {
  const hostRef = useRef<HTMLDivElement>(null)
  const creditRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let viewer: Viewer | undefined
    try {
      viewer = new Viewer(host, {
        /* the SHARED source (OSM placeholder until ion AERIAL resolves) —
           every viewport reads the same instance, so a pane created before
           ion lands still ends up on the same imagery as this globe */
        baseLayer: new ImageryLayer(getImageryProvider()),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        creditContainer: creditRef.current ?? undefined,
      })
      setViewer(viewer)

      /* imagery swaps (placeholder → ion AERIAL, or a token change) re-dial
         THIS globe through the shared source — same instance the panes use */
      const unsubImagery = bindImagery(viewer)

      /* scene render switches (depth test, atmosphere, fog) — store → viewer */
      syncSceneSettings()

      /* Matterhorn opening view — framed on the demo fly-around (Swiss–Italian
         Alps). Same framing rule every viewport uses (see framing.ts). */
      applyFraming(viewer, null)

      /* framing memory: whenever the user FINISHES moving the camera, the
         final framing is recorded onto the ACTIVE shot — switching 机位 away
         and back therefore returns to the exact view, instead of the old bug
         where the (single, shared) camera state silently drifted to
         whichever shot was active last. Skipped while the playhead or the
         offline renderer owns the camera (those framings belong to the route,
         not to free navigation), and while the camera is locked (viewpoint
         held on purpose). */
      const onMoveEnd = () => {
        if (!viewer) return
        if (useExport.getState().status === 'rendering') return
        const ui = useUI.getState()
        if (ui.playing || ui.scrubbing || ui.cameraLocked) return
        const r = useRoute.getState()
        const cam = currentCameraAsFreeCam(viewer)
        if (r.activeShotId == null) return
        const shot = r.shots.find((sh) => sh.id === r.activeShotId)
        if (!shot || sameFraming(shot.freeCam, cam)) return
        r.setFreeCam(r.activeShotId, cam)
      }
      viewer.camera.moveEnd.addEventListener(onMoveEnd)

      /* ion bridge: stored token → terrain → imagery. All three live in
         ionTerrain.ts so that changing the token rebuilds both the terrain
         provider and the imagery layer (credits are baked in at creation). */
      void bootstrapIonSettings()

      /* globe taps: target pick mode wins, otherwise click-empty closes the
         LEFT tools drawer (right route drawer keeps its own close methods) */
      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
      handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
        if (!viewer) return
        const ui = useUI.getState()

        if (ui.targetPickMode) {
          const ray = viewer.camera.getPickRay(click.position)
          const cart = (ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined)
            ?? viewer.camera.pickEllipsoid(click.position)
          if (cart) {
            const c = Cartographic.fromCartesian(cart)
            useRoute.getState().setTarget({
              lon: (c.longitude * 180) / Math.PI,
              lat: (c.latitude * 180) / Math.PI,
              height: c.height,
            })
          }
          ui.setTargetPickMode(false)
          return
        }

        const picked = defined(viewer.scene.pick(click.position))
        if (!picked) {
          // left tools drawer only — the route drawer (right) closes solely via
          // its × button / Esc / R so route editing survives globe interaction
          ui.toggleDrawer(false)
        }
      }, ScreenSpaceEventType.LEFT_CLICK)

      return () => {
        unsubImagery()
        viewer?.camera.moveEnd.removeEventListener(onMoveEnd)
        handler.destroy()
        setViewer(null)
        viewer?.destroy()
      }
    } catch (err) {
      console.error('[CineEarth] Cesium failed to initialise', err)
    }
  }, [])

  /* crosshair cursor while the camera-target pick mode is armed */
  useEffect(
    () =>
      useUI.subscribe((s, prev) => {
        if (s.targetPickMode !== prev.targetPickMode) {
          hostRef.current?.classList.toggle('is-targeting', s.targetPickMode)
        }
      }),
    [],
  )

  return (
    <>
      <div ref={hostRef} className="ce-globe" />
      {/* ion imagery/terrain attribution — native-style strip, left-aligned above the timeline */}
      <div ref={creditRef} className="ce-credits" />
    </>
  )
}
