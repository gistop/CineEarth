import { useEffect, useRef } from 'react'
import {
  Viewer,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  createWorldImageryAsync,
  IonWorldImageryStyle,
  Cartographic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian3,
  defined,
} from 'cesium'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { setViewer } from '../cesium/viewerRegistry'
import { bootstrapIonSettings } from '../features/settings/ionTerrain'

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
        baseLayer: new ImageryLayer(
          new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
        ),
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

      /* Matterhorn opening view — framed on the demo fly-around (Swiss–Italian Alps) */
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(7.6586, 45.9763, 60_000),
      })

      /* user's own ion token (if stored) — verify quietly & enable world terrain */
      void bootstrapIonSettings()

      /* swap OSM placeholder for Cesium ion World Imagery (Bing aerial);
         keep OSM if ion is unreachable (bad token, network blocked) */
      void createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL })
        .then((provider) => {
          if (!viewer || viewer.isDestroyed()) return
          const layers = viewer.imageryLayers
          layers.removeAll()
          layers.addImageryProvider(provider)
        })
        .catch((err) => console.error('[CineEarth] ion World Imagery failed — keeping OSM', err))

      /* globe taps: target pick mode wins, otherwise click-empty closes drawers */
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
          ui.toggleDrawer(false)
          ui.toggleRightDrawer(false)
        }
      }, ScreenSpaceEventType.LEFT_CLICK)

      return () => {
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
      {/* attribution lives here so panels never cover it */}
      <div ref={creditRef} className="ce-credits" />
    </>
  )
}
