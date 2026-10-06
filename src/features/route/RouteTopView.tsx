// Top view — real 2D map (OpenLayers) for spatial route editing.
// Ported from CTEarth RoamTopView, adapted to CineEarth stores & palette:
//  · OSM basemap, muted to match the ink-on-paper look
//  · spline polyline + numbered waypoints, click to select
//  · click EMPTY map = append a waypoint (camera keyframe) at that spot —
//    only while the toolbar's add-mode toggle is ON (off = browse/select)
//  · waypoints are DRAGGABLE (Translate) — live-commits lon/lat while dragging,
//    so globe & side view follow in real time; spline refreshes in place mid-drag
//  · RED camera marker + ground footprint follow the MAIN VIEWPORT camera
//    every frame (Earth Studio top-view style; reads the viewer, no re-render)

import { useEffect, useRef, useState } from 'react'
import { Cartesian2, Cartesian3, Cartographic, Math as CesiumMath } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import Feature from 'ol/Feature.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import LineString from 'ol/geom/LineString.js'
import Point from 'ol/geom/Point.js'
import Polygon from 'ol/geom/Polygon.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OSM from 'ol/source/OSM.js'
import VectorSource from 'ol/source/Vector.js'
import Translate from 'ol/interaction/Translate.js'
import DragPan from 'ol/interaction/DragPan.js'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style.js'
import type { TranslateEvent } from 'ol/interaction/Translate.js'
import type { MapBrowserEvent } from 'ol'
import { samplePath } from './pathMath'
import { useRoute } from './routeStore'
import { useUI } from '../../store/ui'
import { MinusIcon, PlusIcon, TargetIcon, PinIcon } from '../../components/Icons'
import type { Pose, Route } from './types'

/* palette — mirrors tokens.css (canvas styles can't read CSS vars) */
const ACCENT = '#38618c'
const INK = '#fbfbfa'
const DANGER = '#b3563d'
const FONT_MONO = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace'

const waypointStyle = (index: number, selected: boolean) =>
  new Style({
    image: new CircleStyle({
      radius: selected ? 6.5 : 5,
      fill: new Fill({ color: selected ? ACCENT : INK }),
      stroke: new Stroke({ color: ACCENT, width: 2 }),
    }),
    text: new Text({
      text: String(index + 1),
      offsetY: -12,
      font: FONT_MONO,
      fill: new Fill({ color: INK }),
      stroke: new Stroke({ color: ACCENT, width: 3 }),
    }),
  })

const pathStyle = new Style({
  stroke: new Stroke({ color: ACCENT, width: 2.2, lineCap: 'round', lineJoin: 'round' }),
})

/* red live-camera marker — triangle rotated to the camera heading (positive
   OL rotation = clockwise, same handedness as Cesium heading). Rebuilt only
   when heading moves past a small threshold (see the rAF loop below). */
const headStyle = (headingRad: number) =>
  new Style({
    image: new RegularShape({
      points: 3,
      radius: 9,
      rotation: headingRad,
      fill: new Fill({ color: 'rgba(179, 86, 61, 0.35)' }),
      stroke: new Stroke({ color: DANGER, width: 2 }),
    }),
  })

/* camera footprint — the main viewport's frustum projected on the ground */
const footprintStyle = new Style({
  stroke: new Stroke({ color: 'rgba(251, 251, 250, 0.9)', width: 1.5 }),
})

/* original-position ghost ring shown while dragging a waypoint */
const ghostStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(0, 0, 0, 0)' }),
    stroke: new Stroke({ color: 'rgba(56, 97, 140, 0.55)', width: 1.5, lineDash: [3, 3] }),
  }),
})

export default function RouteTopView({ route }: { route: Route }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)
  const headLayerRef = useRef<VectorLayer | null>(null)
  const headFeatureRef = useRef<Feature<Point> | null>(null)
  const fovFeatureRef = useRef<Feature<Polygon> | null>(null)
  const draggingRef = useRef(false)
  const syncToGlobeRef = useRef<(() => void) | null>(null)

  /* add-mode toggle — click empty map appends waypoints only while ON.
     The OL click handler closes over a ref (its effect never re-runs);
     the state exists purely to re-render the button's pressed look. */
  const [addMode, setAddMode] = useState(true)
  const addModeRef = useRef(true)
  const toggleAddMode = () => {
    addModeRef.current = !addModeRef.current
    setAddMode(addModeRef.current)
  }

  const nudgeZoom = (delta: number) => {
    const view = mapRef.current?.getView()
    const zoom = view?.getZoom()
    if (view && Number.isFinite(zoom)) view.animate({ zoom: (zoom ?? 0) + delta, duration: 180 })
  }

  /* the mount-time fitToGlobe() ran at APP START against the boot camera —
     the drawer hides via visibility (layout kept), so opening it never
     resizes the container and the resize-retry never fires. Refit exactly
     ONCE on the first drawer open; later opens keep the user's manual pan. */
  const rightDrawerOpen = useUI((s) => s.rightDrawerOpen)
  const firstOpenFit = useRef(false)
  useEffect(() => {
    if (rightDrawerOpen && !firstOpenFit.current) {
      firstOpenFit.current = true
      syncToGlobeRef.current?.()
    }
  }, [rightDrawerOpen])

  /* ---- init the map once: layers, drag interaction, click-select ---- */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const source = new VectorSource()
    const headSource = new VectorSource()
    const map = new Map({
      target: container,
      layers: [
        new TileLayer({ source: new OSM(), className: 'ce-ol-basemap' }),
        new VectorLayer({
          source,
          style: (feature) => {
            if (feature.get('kind') === 'path') return pathStyle
            if (feature.get('kind') === 'ghost') return ghostStyle
            const index = Number(feature.get('index') ?? 0)
            return waypointStyle(Number.isFinite(index) ? index : 0, feature.get('selected') === true)
          },
        }),
        new VectorLayer({ source: headSource, style: headStyle }),
      ],
      view: new View({ center: fromLonLat([7, 61]), zoom: 5 }),
      controls: [],
    })

    /* drop the default double-click zoom — an editing canvas, not a browsing
       map; accidental double-clicks jumping the zoom level is pure annoyance */
    map
      .getInteractions()
      .getArray()
      .filter((i) => i instanceof DoubleClickZoom)
      .forEach((i) => map.getInteractions().remove(i))

    /* generous grab radius — the dots are only 5px, exact hits are frustrating */
    const HIT_TOLERANCE = 6
    const translate = new Translate({
      filter: (feature) => feature.get('kind') === 'waypoint',
      hitTolerance: HIT_TOLERANCE,
    })
    /* live-sync: commit on every translating frame so globe & side view follow
       the drag in real time; translateend re-commits the final position */
    const commitDragged = (event: TranslateEvent) => {
      const feature = event.features.item(0)
      const id = feature.get('waypointId') as string | undefined
      const geometry = feature.getGeometry()
      const coords = geometry instanceof Point ? geometry.getCoordinates() : null
      if (id && coords) {
        const [lon, lat] = toLonLat(coords)
        useRoute.getState().updateWaypoint(id, { lon, lat })
      }
    }
    /* original-position ghost: appears at drag start, removed on release */
    const ghost = new Feature(new Point(fromLonLat([7, 61])))
    ghost.set('kind', 'ghost')
    translate.on('translatestart', (event: TranslateEvent) => {
      draggingRef.current = true
      const feature = event.features.item(0)
      const geometry = feature.getGeometry()
      const coords = geometry instanceof Point ? geometry.getCoordinates() : null
      const ghostGeom = ghost.getGeometry()
      if (coords && ghostGeom instanceof Point) {
        ghostGeom.setCoordinates(coords)
        if (!source.getFeatures().includes(ghost)) source.addFeature(ghost)
      }
    })
    translate.on('translating', (event: TranslateEvent) => {
      draggingRef.current = true
      commitDragged(event)
    })
    translate.on('translateend', (event: TranslateEvent) => {
      draggingRef.current = false
      if (source.getFeatures().includes(ghost)) source.removeFeature(ghost)
      commitDragged(event)
    })
    map.addInteraction(translate)

    /* waypoint dragging must not fight the map's DragPan — both would answer
       the same pointer gesture (feature AND map move together). Suppress pan
       for the duration of any pointer-down that lands on a waypoint. */
    const dragPan =
      map.getInteractions().getArray().find((i): i is DragPan => i instanceof DragPan) ?? null
    let panSuppressed = false
    /* pointerdown/up/cancel are missing from ol's Map.on() type union —
       addEventListener is the runtime-identical, loosely-typed escape hatch */
    map.addEventListener('pointerdown', (event) => {
      const e = event as MapBrowserEvent<PointerEvent>
      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f, { hitTolerance: HIT_TOLERANCE })
      panSuppressed = hit?.get('kind') === 'waypoint'
      if (panSuppressed) dragPan?.setActive(false)
    })
    const restorePan = () => {
      if (panSuppressed) {
        dragPan?.setActive(true)
        panSuppressed = false
      }
    }
    map.addEventListener('pointerup', restorePan)
    map.addEventListener('pointercancel', restorePan)

    map.on('click', (event) => {
      const hit = map.forEachFeatureAtPixel(event.pixel, (f) => f, { hitTolerance: HIT_TOLERANCE })
      if (hit?.get('kind') === 'waypoint') {
        const id = hit.get('waypointId') as string | undefined
        const { selectedWaypointId, selectWaypoint } = useRoute.getState()
        selectWaypoint(id && id !== selectedWaypointId ? id : null)
        return
      }
      if (hit) return // clicked the path/ghost — ignore
      if (!addModeRef.current) return // add mode off — browse/select only
      /* empty map click — append a camera keyframe here */
      const [lon, lat] = toLonLat(event.coordinate)
      useRoute.getState().addWaypoint(lon, lat)
    })

    /* camera footprint FIRST (under), red live-camera marker on top */
    const footprint = new Feature(new Polygon([[]]))
    footprint.set('kind', 'footprint')
    footprint.setStyle(footprintStyle)
    headSource.addFeature(footprint)

    const head = new Feature(new Point(fromLonLat([7, 61])))
    head.set('kind', 'head')
    head.setStyle(headStyle(0))
    headSource.addFeature(head)

    mapRef.current = map
    sourceRef.current = source
    headFeatureRef.current = head
    fovFeatureRef.current = footprint
    headLayerRef.current = map.getLayers().item(2) as VectorLayer

    const observer = new ResizeObserver(() => map.updateSize())
    observer.observe(container)

    /* sync extent to the main globe — pick the ground under the screen centre
       and measure the near-field span. computeViewRectangle() would stretch a
       tilted cinematic camera's frustum all the way to the horizon. */
    const fitToGlobe = (): boolean => {
      const size = map.getSize()
      if (!size || size[0] < 10 || size[1] < 10) return false
      const viewer = getViewer()
      if (!viewer) return true

      const canvas = viewer.canvas
      const pick = (x: number, y: number) => {
        const ray = viewer.camera.getPickRay(new Cartesian2(x, y))
        return ray ? viewer.scene.globe.pick(ray, viewer.scene) : null
      }
      const centre = pick(canvas.clientWidth / 2, canvas.clientHeight / 2)
      const foot = pick(canvas.clientWidth / 2, canvas.clientHeight * 0.85)

      if (centre) {
        const carto = Cartographic.fromCartesian(centre)
        const c = fromLonLat([
          CesiumMath.toDegrees(carto.longitude),
          CesiumMath.toDegrees(carto.latitude),
        ])
        let radius = foot ? Cartesian3.distance(centre, foot) : 0
        if (!Number.isFinite(radius) || radius < 1) {
          radius = viewer.camera.positionCartographic.height // near top-down fallback
        }
        radius = Math.min(Math.max(radius, 40), 2_000_000)
        map.getView().fit([c[0] - radius, c[1] - radius, c[0] + radius, c[1] + radius], {
          padding: [12, 12, 12, 12],
          maxZoom: 17,
        })
        return true
      }

      /* camera facing the sky — fall back to the frustum/ellipsoid rectangle */
      const rect = viewer.camera.computeViewRectangle()
      if (rect) {
        const sw = fromLonLat([CesiumMath.toDegrees(rect.west), CesiumMath.toDegrees(rect.south)])
        const ne = fromLonLat([CesiumMath.toDegrees(rect.east), CesiumMath.toDegrees(rect.north)])
        if ([...sw, ...ne].every(Number.isFinite)) {
          map.getView().fit([sw[0], sw[1], ne[0], ne[1]], { padding: [12, 12, 12, 12] })
        }
      }
      return true
    }

    let initialFitDone = fitToGlobe()
    syncToGlobeRef.current = fitToGlobe
    const fitObserver = new ResizeObserver(() => {
      if (!initialFitDone) initialFitDone = fitToGlobe()
    })
    fitObserver.observe(container)

    return () => {
      observer.disconnect()
      fitObserver.disconnect()
      syncToGlobeRef.current = null
      map.setTarget(undefined)
      mapRef.current = null
      sourceRef.current = null
      headFeatureRef.current = null
      fovFeatureRef.current = null
      headLayerRef.current = null
    }
  }, [])

  /* ---- route changed → rebuild features; refit only when count changes ---- */
  useEffect(() => {
    const source = sourceRef.current
    const map = mapRef.current
    if (!source || !map) return

    const selectedId = useRoute.getState().selectedWaypointId

    /* mid-drag: refresh only the spline in place. A full clear()/rebuild would
       orphan the feature Translate is holding and break the drag. */
    if (draggingRef.current) {
      const poses: Pose[] = samplePath(route, 160)
      if (poses.length > 1) {
        const coords = poses.map((p) => fromLonLat([p.lon, p.lat]))
        const path = source.getFeatures().find((f) => f.get('kind') === 'path')
        const geom = path?.getGeometry()
        if (geom instanceof LineString) {
          geom.setCoordinates(coords)
        } else {
          const created = new Feature(new LineString(coords))
          created.set('kind', 'path')
          source.addFeature(created)
        }
      }
      return
    }

    source.clear()

    const poses: Pose[] = samplePath(route, 160)
    if (poses.length > 1) {
      const path = new Feature(new LineString(poses.map((p) => fromLonLat([p.lon, p.lat]))))
      path.set('kind', 'path')
      source.addFeature(path)
    }
    route.waypoints.forEach((w, index) => {
      const f = new Feature(new Point(fromLonLat([w.lon, w.lat])))
      f.set('kind', 'waypoint')
      f.set('waypointId', w.id)
      f.set('index', index)
      f.set('selected', w.id === selectedId)
      source.addFeature(f)
    })

    /* never refit on data changes — the map stays where the user put it.
       Initial positioning is handled by the globe-sync fit at mount. */
  }, [route.waypoints, route.name])

  /* keep `selected` flag fresh without rebuilding geometry */
  useEffect(
    () =>
      useRoute.subscribe((s) => {
        const id = s.selectedWaypointId
        sourceRef.current?.getFeatures().forEach((f) => {
          if (f.get('kind') === 'waypoint') f.set('selected', f.get('waypointId') === id)
        })
      }),
    [],
  )

  /* ---- live camera marker: red position/heading triangle + ground
     footprint, both driven by the MAIN VIEWPORT camera (Earth Studio
     top-view style). While the route plays, the globe camera IS the route
     camera, so the marker follows the playhead for free; free-roaming
     shows where you actually look. rAF loop, never re-renders React. ---- */
  useEffect(() => {
    let raf = 0
    let lastHeading = Number.NaN
    let lastX = Number.NaN
    let lastY = Number.NaN
    let lastRing: number[] | null = null
    const EMPTY: number[][] = []

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const head = headFeatureRef.current
      const fov = fovFeatureRef.current
      if (!head || !fov) return
      const viewer = getViewer()
      if (!viewer || viewer.isDestroyed()) return
      const cam = viewer.camera

      /* red marker = live camera position, rotated to heading */
      const carto = cam.positionCartographic
      const x = CesiumMath.toDegrees(carto.longitude)
      const y = CesiumMath.toDegrees(carto.latitude)
      if (Math.abs(x - lastX) > 1e-9 || Math.abs(y - lastY) > 1e-9) {
        lastX = x
        lastY = y
        head.getGeometry()?.setCoordinates(fromLonLat([x, y]))
      }
      if (Math.abs(cam.heading - lastHeading) > 0.002) {
        lastHeading = cam.heading
        head.setStyle(headStyle(cam.heading))
      }

      /* footprint: the 4 canvas corner rays projected onto the ground
         (pure ellipsoid pick — cheap enough to run every frame; the ES
         version draws to the horizon, we simply hide when a corner
         faces the sky). All writes are dirty-checked so a still camera
         never triggers a redraw. */
      const c = viewer.canvas
      const w = c.clientWidth
      const h = c.clientHeight
      const ring: number[] = []
      for (const [px, py] of [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ] as const) {
        const hit = cam.pickEllipsoid(new Cartesian2(px, py), viewer.scene.globe.ellipsoid)
        if (!hit) {
          if (lastRing !== null) {
            lastRing = null
            fov.getGeometry()?.setCoordinates([EMPTY])
          }
          return
        }
        const hc = Cartographic.fromCartesian(hit)
        const p = fromLonLat([CesiumMath.toDegrees(hc.longitude), CesiumMath.toDegrees(hc.latitude)])
        ring.push(p[0], p[1])
      }
      if (lastRing === null || ring.some((v, i) => Math.abs(v - lastRing![i]) > 1e-9)) {
        lastRing = ring
        fov
          .getGeometry()
          ?.setCoordinates([
            [ring.slice(0, 2), ring.slice(2, 4), ring.slice(4, 6), ring.slice(6, 8), ring.slice(0, 2)],
          ])
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <figure className="ce-minimap">
      <figcaption>
        <span>Top view</span>
        <span className="ce-minimap-tools">
          <button
            type="button"
            className={addMode ? 'is-on' : ''}
            title={
              addMode
                ? 'Add mode ON — click empty map to append waypoints. Click to pause.'
                : 'Add mode OFF — clicking the map adds nothing. Click to enable.'
            }
            aria-label="Toggle click-to-add waypoints"
            aria-pressed={addMode}
            onClick={toggleAddMode}
          >
            <PinIcon size={12} />
          </button>
          <button
            type="button"
            title="Sync — match the main globe view"
            aria-label="Sync minimap to main view"
            onClick={() => syncToGlobeRef.current?.()}
          >
            <TargetIcon size={12} />
          </button>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => nudgeZoom(1)}>
            <PlusIcon size={12} />
          </button>
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => nudgeZoom(-1)}>
            <MinusIcon size={12} />
          </button>
        </span>
      </figcaption>
      <div className="ce-olmap-wrap">
        <div ref={containerRef} className="ce-olmap" role="img" aria-label="Route top view map" />
        <span className="ce-olmap-north" aria-hidden="true">N</span>
      </div>
    </figure>
  )
}
