// Top view — real 2D map (OpenLayers) for spatial route editing.
// Ported from CTEarth RoamTopView, adapted to CineEarth stores & palette:
//  · OSM basemap, muted to match the ink-on-paper look
//  · spline polyline + numbered waypoints, click to select
//  · click EMPTY map = append a waypoint (camera keyframe) at that spot
//  · waypoints are DRAGGABLE (Translate) — live-commits lon/lat while dragging,
//    so globe & side view follow in real time; spline refreshes in place mid-drag
//  · playhead marker follows the camera each frame (reads store, no re-render)

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import LineString from 'ol/geom/LineString.js'
import Point from 'ol/geom/Point.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OSM from 'ol/source/OSM.js'
import VectorSource from 'ol/source/Vector.js'
import Translate from 'ol/interaction/Translate.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js'
import type { TranslateEvent } from 'ol/interaction/Translate.js'
import { samplePath, samplePose } from './pathMath'
import { useRoute } from './routeStore'
import { useUI } from '../../store/ui'
import type { Pose, Route } from './types'

/* palette — mirrors tokens.css (canvas styles can't read CSS vars) */
const ACCENT = '#38618c'
const INK = '#fbfbfa'
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

const headStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(56, 97, 140, 0.30)' }),
    stroke: new Stroke({ color: ACCENT, width: 2 }),
  }),
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
  const fitTokenRef = useRef(0)
  const wpCountRef = useRef(-1)
  const draggingRef = useRef(false)

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

    const translate = new Translate({
      filter: (feature) => feature.get('kind') === 'waypoint',
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

    map.on('click', (event) => {
      const hit = map.forEachFeatureAtPixel(event.pixel, (f) => f)
      if (hit?.get('kind') === 'waypoint') {
        const id = hit.get('waypointId') as string | undefined
        const { selectedWaypointId, selectWaypoint } = useRoute.getState()
        selectWaypoint(id && id !== selectedWaypointId ? id : null)
        return
      }
      if (hit) return // clicked the path/ghost — ignore
      /* empty map click — append a camera keyframe here */
      const [lon, lat] = toLonLat(event.coordinate)
      useRoute.getState().addWaypoint(lon, lat)
    })

    const head = new Feature(new Point(fromLonLat([7, 61])))
    head.set('kind', 'head')
    headSource.addFeature(head)

    mapRef.current = map
    sourceRef.current = source
    headFeatureRef.current = head
    headLayerRef.current = map.getLayers().item(2) as VectorLayer

    const observer = new ResizeObserver(() => map.updateSize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.setTarget(undefined)
      mapRef.current = null
      sourceRef.current = null
      headFeatureRef.current = null
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

    if (wpCountRef.current !== route.waypoints.length) {
      wpCountRef.current = route.waypoints.length
      fitTokenRef.current += 1
      const token = fitTokenRef.current
      window.setTimeout(() => {
        if (token !== fitTokenRef.current || !mapRef.current) return
        const extent = source.getExtent()
        if (extent && extent.filter(Number.isFinite).length === 4) {
          mapRef.current.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 15 })
        }
      }, 30)
    }
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

  /* ---- playhead marker: frame-driven, never re-renders React ---- */
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const feature = headFeatureRef.current
      const layer = headLayerRef.current
      if (!feature || !layer) return
      const { progress, route: r } = useRoute.getState()
      layer.setVisible(progress > 0 || useUI.getState().playing)
      const pose = samplePose(r, progress)
      if (pose) feature.getGeometry()?.setCoordinates(fromLonLat([pose.lon, pose.lat]))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <figure className="ce-minimap">
      <figcaption>Top view</figcaption>
      <div className="ce-olmap-wrap">
        <div ref={containerRef} className="ce-olmap" role="img" aria-label="Route top view map" />
        <span className="ce-olmap-north" aria-hidden="true">N</span>
      </div>
    </figure>
  )
}
