// Asset scene bridge — drops files into the Cesium scene.
// .glb/.gltf models: place at the ground point under the screen centre,
// clamp to the finest terrain, then press the model's bottom onto the
// ground once its bounding sphere becomes readable.
// .kml/.kmz overlays: Cesium's own KmlDataSource — styles, folders and
// embedded KMZ resources come along natively.
// .xlsx/.xls sheets: lon/lat columns become ground-clamped point entities.
// .zip shapefiles: shpjs (pure JS, bundled proj4 for .prj → WGS84) hands
// back GeoJSON, which Cesium drapes onto the terrain.
// Nothing is persisted: files live as in-memory blob URLs.

import {
  Model,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Matrix4,
  Transforms,
  BoundingSphere,
  HeadingPitchRange,
  ModelAnimationLoop,
  Math as CesiumMath,
  sampleTerrainMostDetailed,
  KmlDataSource,
  CustomDataSource,
  GeoJsonDataSource,
  Color,
  CallbackProperty,
  ColorMaterialProperty,
  ConstantProperty,
  HeightReference,
  PolylineDashMaterialProperty,
} from 'cesium'
import type { DataSource, Entity, MaterialProperty, Viewer } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { createAssetId, DEFAULT_LINE_STYLE, useAssets, type AssetKind, type LineStyle } from './assetStore'
import { evalAnim, useAnim } from './assetAnimStore'
import { useRoute } from '../route/routeStore'

const SUPPORTED_EXT = /\.(glb|gltf|kml|kmz|xlsx|xls|zip)$/i

interface LoadedModel {
  model: Model
  /** ENU frame at the placement point, origin clamped to the terrain */
  enu: Matrix4
  /** model-local correction putting the bounding-box bottom-centre at the origin */
  corr: Matrix4 | null
}

const loaded = new Map<string, LoadedModel>()
/** KML overlays, Excel point sheets & shapefile vectors live as data sources */
const loadedSources = new Map<string, DataSource>()
/** drawn lines: their single polyline entity (inside the data source above) */
const loadedLineEntities = new Map<string, Entity>()

export function assetKindOf(file: File): AssetKind | null {
  const m = SUPPORTED_EXT.exec(file.name)
  if (!m) return null
  switch (m[1].toLowerCase()) {
    case 'glb':
    case 'gltf':
      return 'model'
    case 'kml':
    case 'kmz':
      return 'kml'
    case 'zip':
      return 'shapefile'
    default:
      return 'points'
  }
}

export function isSupportedAsset(file: File): boolean {
  return assetKindOf(file) !== null
}

/** ground point under the screen centre; falls back to below-camera when facing sky */
function pickScreenCenterGround(viewer: Viewer): Cartesian3 {
  const canvas = viewer.canvas
  const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
  const ray = viewer.camera.getPickRay(center)
  const pos = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null
  if (pos) return pos
  const cam = viewer.camera.positionCartographic
  return Cartesian3.fromRadians(cam.longitude, cam.latitude)
}

/** the audience of the asset layer: every live Viewer that must SEE the
 *  assets — the editor globe plus every 机位 pane / Program Out monitor
 *  (ShotPane registers itself on mount; the exporter renders the Program
 *  Out Viewer). Assets used to live on the editor globe ONLY: pane monitors
 *  and the recorded video showed no growth line at all. ONE shared instance
 *  set now mounts on every registered Viewer — the growth line's
 *  CallbackProperty reads the stores (not the Viewer) and its position cache
 *  is shared, so N views cost ONE evaluation per progress, not N. */
const assetViewers = new Set<Viewer>()

/** every registered viewer, or just the editor globe before any pane mounted */
function assetViewerList(): Viewer[] {
  if (assetViewers.size > 0) return [...assetViewers]
  const main = getViewer()
  return main ? [main] : []
}

const pendingSourceAdds = new WeakMap<Viewer, Map<DataSource, Promise<DataSource>>>()

function addSourceToViewer(v: Viewer, ds: DataSource): Promise<void> {
  try {
    if (v.dataSources.contains(ds)) return Promise.resolve()
    let pending = pendingSourceAdds.get(v)
    if (!pending) {
      pending = new Map()
      pendingSourceAdds.set(v, pending)
    }
    const existing = pending.get(ds)
    if (existing) return existing.then(() => undefined)

    const add = v.dataSources.add(ds)
    pending.set(ds, add)
    return add.then(() => undefined).finally(() => {
      if (pending?.get(ds) === add) pending.delete(ds)
    })
  } catch (err) {
    console.error('[CineEarth] asset mount failed', err)
    return Promise.resolve()
  }
}

/** mount a data source on every asset viewer (idempotent per viewer) */
function addSourceToAll(ds: DataSource): void {
  for (const v of assetViewerList()) {
    void addSourceToViewer(v, ds)
  }
}

/** mount a GLB model primitive on every asset viewer (idempotent) */
function addModelToAll(model: Model): void {
  for (const v of assetViewerList()) {
    try {
      if (!v.scene.primitives.contains(model)) v.scene.primitives.add(model)
    } catch (err) {
      console.error('[CineEarth] model mount failed', err)
    }
  }
}

/** a live Viewer joined (editor globe / a 机位 pane / the Program Out
 *  monitor) — mount everything already loaded onto it, so no view exists
 *  without the assets */
export function registerAssetViewer(v: Viewer): void {
  assetViewers.add(v)
  void prepareAssetViewer(v)
}

/** Ensure the recorder's Viewer has finished registering every asset before
 * its first frame is rendered. React mounts use the fire-and-forget wrapper
 * above, but offline export must await DataSourceCollection.add(): otherwise
 * the first render can run before Cesium creates the data-source visualizers. */
export async function prepareAssetViewer(v: Viewer): Promise<void> {
  assetViewers.add(v)
  await Promise.all([...loadedSources.values()].map((ds) => addSourceToViewer(v, ds)))
  for (const entry of loaded.values()) {
    try {
      if (!v.scene.primitives.contains(entry.model)) v.scene.primitives.add(entry.model)
    } catch { /* viewer racing teardown */ }
  }
  if (!v.isDestroyed()) v.scene.requestRender()
}

/** a live Viewer left — detach every asset BEFORE v.destroy(): destroying a
 *  Viewer DESTROYS the data sources it still holds, which would take the
 *  shared assets down for every other view */
export function unregisterAssetViewer(v: Viewer): void {
  assetViewers.delete(v)
  if (v.isDestroyed()) return
  for (const ds of loadedSources.values()) {
    try {
      if (v.dataSources.contains(ds)) v.dataSources.remove(ds, false)
    } catch { /* racing teardown */ }
  }
  for (const entry of loaded.values()) {
    try {
      if (v.scene.primitives.contains(entry.model)) {
        ;(v.scene.primitives.remove as (p: Model, destroy?: boolean) => boolean)(entry.model, false)
      }
    } catch { /* racing teardown */ }
  }
}

export async function importAssetFile(file: File): Promise<void> {
  const viewer = getViewer()
  if (!viewer) return

  const kind = assetKindOf(file)
  if (!kind) return

  const id = createAssetId()
  const url = URL.createObjectURL(file)
  useAssets.getState().addAsset({ id, name: file.name, kind, url, visible: true, status: 'loading' })

  if (kind === 'model') return importGltfModel(viewer, id, url)
  if (kind === 'kml') return importKmlOverlay(viewer, id, url)
  if (kind === 'shapefile') return importShapefileZip(viewer, id, url, file)
  return importXlsxPoints(viewer, id, url, file)
}

async function importGltfModel(viewer: Viewer, id: string, url: string): Promise<void> {
  try {
    const model = await Model.fromGltfAsync({ url })

    // 1) placement: ground under the screen centre, clamped to the finest terrain
    const carto = Cartographic.fromCartesian(pickScreenCenterGround(viewer))
    let groundHeight = carto.height
    try {
      const samples = await sampleTerrainMostDetailed(viewer.terrainProvider, [carto.clone()])
      if (Number.isFinite(samples?.[0]?.height)) groundHeight = samples[0].height
    } catch (err) {
      console.warn('[CineEarth] terrain sampling failed — using pick height', err)
    }

    // 2) land at the placement origin (bottom correction follows one frame later)
    const enu = Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromRadians(carto.longitude, carto.latitude, groundHeight),
    )
    model.modelMatrix = enu
    addModelToAll(model)
    loaded.set(id, { model, enu, corr: null })

    // 3) baked glTF animation clips (collapse etc.) loop out of the box
    // (availableAnimations was dropped from Cesium 1.146 typings — runtime-optional access)
    const anims = (model as unknown as { availableAnimations?: string[] }).availableAnimations
    if (Array.isArray(anims) && anims.length > 0) {
      model.activeAnimations.addAll({ loop: ModelAnimationLoop.REPEAT })
    }

    useAssets.getState().setAssetStatus(id, 'ready')
    scheduleBottomFix(viewer, id, model, enu)
  } catch (err) {
    console.error('[CineEarth] glTF load failed:', err)
    URL.revokeObjectURL(url)
    useAssets.getState().setAssetStatus(id, 'error', 'glTF 2.0 parse failed (see console)')
  }
}

/** KML / KMZ — parsed by Cesium itself (KMZ zip + embedded styles natively) */
async function importKmlOverlay(viewer: Viewer, id: string, url: string): Promise<void> {
  try {
    // camera/canvas let network-linked KMLs refresh against the live view;
    // clampToGround: true is Cesium's official switch — KML features whose
    // altitudeMode is clampToGround (the KML default) then drape on the
    // terrain instead of being drawn at their literal ellipsoid heights
    const ds = await KmlDataSource.load(url, {
      camera: viewer.camera,
      canvas: viewer.canvas,
      clampToGround: true,
    })
    addSourceToAll(ds)
    loadedSources.set(id, ds)
    useAssets.getState().setAssetStatus(id, 'ready')
    // overlays can be anywhere on Earth — bring them into frame
    void viewer.flyTo(ds, { duration: 1.5 }).catch(() => {})
  } catch (err) {
    console.error('[CineEarth] KML load failed:', err)
    URL.revokeObjectURL(url)
    useAssets.getState().setAssetStatus(id, 'error', 'KML/KMZ parse failed (see console)')
  }
}

/**
 * Shapefile zip — shpjs (pure JS; its bundled proj4 converts the .prj to
 * WGS84 automatically) returns GeoJSON, which Cesium drapes onto the
 * terrain with clampToGround. Multiple shapefile sets inside one zip are
 * merged into a single data source.
 */
async function importShapefileZip(viewer: Viewer, id: string, url: string, file: File): Promise<void> {
  try {
    const { default: parseShp } = await import('shpjs')
    const parsed = await parseShp(await file.arrayBuffer())
    const collections = Array.isArray(parsed) ? parsed : [parsed]
    const features = collections.flatMap((c) => (Array.isArray(c?.features) ? c.features : []))
    if (features.length === 0) {
      throw new Error('no features found — zip must contain .shp + .dbf')
    }

    const ds = await GeoJsonDataSource.load({ type: 'FeatureCollection', features } as object, {
      clampToGround: true,
    })
    addSourceToAll(ds)
    loadedSources.set(id, ds)
    useAssets.getState().setAssetStatus(id, 'ready')
    void viewer.flyTo(ds, { duration: 1.5 }).catch(() => {})
  } catch (err) {
    console.error('[CineEarth] shapefile load failed:', err)
    URL.revokeObjectURL(url)
    useAssets.getState().setAssetStatus(id, 'error', err instanceof Error ? err.message : 'shapefile parse failed')
  }
}

/** lon/lat column matchers for Excel sheets (中文表头一并照顾) */
const LON_COL = /^(x|lon|lng|long|longitude|经度|东经)$/i
const LAT_COL = /^(y|lat|latitude|纬度|北纬)$/i
const NAME_COL = /^(name|title|label|名称|名字|标题|编号|地名)$/i

/** Excel sheet — first worksheet, lon/lat columns → ground-clamped points */
async function importXlsxPoints(
  viewer: Viewer,
  id: string,
  url: string,
  file: File,
): Promise<void> {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer())
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) throw new Error('empty workbook — no sheet to read')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

    const cols = Object.keys(rows[0] ?? {})
    const lonCol = cols.find((c) => LON_COL.test(String(c).trim()))
    const latCol = cols.find((c) => LAT_COL.test(String(c).trim()))
    if (!lonCol || !latCol) {
      throw new Error('no lon/lat columns (want x/lon/lng/longitude + y/lat/latitude)')
    }
    const nameCol = cols.find((c) => NAME_COL.test(String(c).trim()))

    const ds = new CustomDataSource(file.name)
    let count = 0
    for (const row of rows) {
      const lon = Number(row[lonCol])
      const lat = Number(row[latCol])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue
      const label = nameCol ? String(row[nameCol] ?? '').trim() : ''
      count += 1
      ds.entities.add({
        name: label || undefined,
        position: Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 7,
          color: Color.YELLOW.withAlpha(0.95),
          outlineColor: Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        // labels only on small sheets — a 10k-row wall of text is pure noise
        ...(label && rows.length <= 60
          ? {
              label: {
                text: label,
                font: '13px sans-serif',
                fillColor: Color.WHITE,
                pixelOffset: new Cartesian2(0, -14),
                showBackground: true,
                backgroundColor: Color.BLACK.withAlpha(0.55),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }
          : {}),
      })
    }
    if (count === 0) throw new Error('no rows with numeric lon/lat values')

    addSourceToAll(ds)
    loadedSources.set(id, ds)
    useAssets.getState().setAssetStatus(id, 'ready')
    void viewer.flyTo(ds, { duration: 1.5 }).catch(() => {})
  } catch (err) {
    console.error('[CineEarth] xlsx load failed:', err)
    URL.revokeObjectURL(url)
    useAssets.getState().setAssetStatus(id, 'error', err instanceof Error ? err.message : 'Excel parse failed')
  }
}

/**
 * The bounding sphere is only readable after the scene graph builds (first
 * rendered frame). Retry in postRender; on success translate the model so its
 * bounding-box bottom-centre sits exactly on the placement origin.
 */
function scheduleBottomFix(viewer: Viewer, id: string, model: Model, enu: Matrix4): void {
  let frames = 0

  const listener = () => {
    frames += 1

    let bs: BoundingSphere | null = null
    try {
      // read in model-local space: temporarily restore the identity matrix
      const restore = Matrix4.clone(model.modelMatrix, new Matrix4())
      model.modelMatrix = Matrix4.IDENTITY
      bs = model.boundingSphere
      model.modelMatrix = restore
    } catch {
      bs = null
    }

    if (!bs || !Number.isFinite(bs.radius) || bs.radius <= 0) {
      if (frames < 120 && loaded.get(id)?.model === model) return // keep waiting
      viewer.scene.postRender.removeEventListener(listener)
      return
    }

    viewer.scene.postRender.removeEventListener(listener)
    const entry = loaded.get(id)
    if (!entry || entry.model !== model) return // removed meanwhile

    const corr = Matrix4.fromTranslation(
      new Cartesian3(-bs.center.x, -bs.center.y, -(bs.center.z - bs.radius)),
    )
    entry.corr = corr
    const m = Matrix4.clone(enu, new Matrix4())
    model.modelMatrix = Matrix4.multiply(m, corr, m)

    // reframe when the model turns out much larger than expected
    if (bs.radius > 120) {
      const origin = Matrix4.getTranslation(enu, new Cartesian3())
      viewer.camera.flyToBoundingSphere(new BoundingSphere(origin, bs.radius), {
        duration: 1.5,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-25), Math.max(bs.radius * 5, 200)),
      })
    }
  }

  viewer.scene.postRender.addEventListener(listener)
}

export function setAssetVisible(id: string, visible: boolean): void {
  useAssets.getState().setAssetVisible(id, visible)
  const entry = loaded.get(id)
  if (entry) entry.model.show = visible
  const src = loadedSources.get(id)
  if (src) src.show = visible
}

/** fly the camera to frame this asset (double-click in the asset list) */
export function zoomToAsset(id: string): void {
  const viewer = getViewer()
  if (!viewer) return

  const entry = loaded.get(id)
  if (entry) {
    let bs: BoundingSphere | null = null
    try {
      bs = entry.model.boundingSphere
    } catch {
      bs = null
    }

    // world-space sphere once readable; otherwise fall back to the placement origin
    if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
      viewer.camera.flyToBoundingSphere(bs, {
        duration: 1.5,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-25), Math.max(bs.radius * 5, 200)),
      })
    } else {
      const origin = Matrix4.getTranslation(entry.enu, new Cartesian3())
      viewer.camera.flyToBoundingSphere(new BoundingSphere(origin, 80), {
        duration: 1.5,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-25), 600),
      })
    }
    return
  }

  const src = loadedSources.get(id)
  if (src) void viewer.flyTo(src, { duration: 1.5 }).catch(() => {})
}

/* ---------- drawn ground lines (native assets, no file behind them) ------- */

function lineMaterial(style: LineStyle): MaterialProperty {
  const color = Color.fromCssColorString(style.color).withAlpha(style.opacity)
  return style.dashed
    ? new PolylineDashMaterialProperty({ color, dashLength: 18 })
    : new ColorMaterialProperty(color)
}

/** path at sampled terrain height + lift; clamped polylines ignore heights */
function pathPositions(
  positions: { lon: number; lat: number; height: number }[],
  lift: number,
): Cartesian3[] {
  const flat: number[] = []
  for (const p of positions) flat.push(p.lon, p.lat, p.height + lift)
  return Cartesian3.fromDegreesArrayHeights(flat)
}

/**
 * Cross-section outline swept along the path (Cesium polyline volumes).
 * Local 2D frame per segment: x = sideways, y = up; points wind
 * counter-clockwise so the surface normals face outward. sectionSize is
 * the main dimension in metres; sectionAspect widens x for
 * rectangle/ellipse.
 */
function sectionShape(style: LineStyle): Cartesian2[] {
  const h = Math.max(style.sectionSize, 0.5) / 2
  const stretch = style.section === 'rectangle' || style.section === 'ellipse' ? style.sectionAspect : 1
  const w = h * Math.max(stretch, 1)
  switch (style.section) {
    case 'circle':
    case 'ellipse': {
      const pts: Cartesian2[] = []
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * CesiumMath.TWO_PI - CesiumMath.PI_OVER_TWO
        pts.push(new Cartesian2(Math.cos(a) * w, Math.sin(a) * h))
      }
      return pts
    }
    case 'rectangle':
      return [
        new Cartesian2(-w, -h),
        new Cartesian2(w, -h),
        new Cartesian2(w, h),
        new Cartesian2(-w, h),
      ]
    case 'diamond':
      return [
        new Cartesian2(0, -h),
        new Cartesian2(h, 0),
        new Cartesian2(0, h),
        new Cartesian2(-h, 0),
      ]
    case 'triangle':
      return [
        new Cartesian2(-h * 0.87, -h * 0.5),
        new Cartesian2(h * 0.87, -h * 0.5),
        new Cartesian2(0, h),
      ]
    // square
    default:
      return [
        new Cartesian2(-h, -h),
        new Cartesian2(h, -h),
        new Cartesian2(h, h),
        new Cartesian2(-h, h),
      ]
  }
}

function volumeColor(style: LineStyle): Color {
  return Color.fromCssColorString(style.color).withAlpha(style.opacity)
}

/** darker opaque edge — the outline is what sells the 3D read */
function volumeOutlineColor(style: LineStyle): Color {
  return Color.fromCssColorString(style.color).darken(0.35, new Color())
}

function buildFlatEntity(
  ds: CustomDataSource,
  id: string,
  positions: { lon: number; lat: number; height: number }[],
  style: LineStyle,
  animated: boolean,
): Entity {
  return ds.entities.add({
    polyline: {
      // animated: a per-frame Callback trims the path by Growth% / offsets Lift
      positions: animated
        ? new CallbackProperty(() => animatedFlatPositions(id), false)
        : pathPositions(positions, 0),
      width: style.width,
      material: lineMaterial(style),
      clampToGround: style.clamped,
    },
  })
}

function buildVolumeEntity(
  ds: CustomDataSource,
  id: string,
  positions: { lon: number; lat: number; height: number }[],
  style: LineStyle,
  animated: boolean,
): Entity {
  return ds.entities.add({
    polylineVolume: {
      positions: animated
        ? new CallbackProperty(() => animatedVolumePositions(id), false)
        : pathPositions(positions, style.lift),
      shape: sectionShape(style),
      material: new ColorMaterialProperty(volumeColor(style)),
      outline: true,
      outlineColor: volumeOutlineColor(style),
    },
  })
}

/** last-applied volume geometry params — rebuild only when these change
    (lift deliberately excluded: it just re-offsets the cached terrain path) */
const lineVolumeKeys = new Map<string, string>()

function volumeKeyOf(style: LineStyle): string {
  return `${style.section}|${style.sectionSize}|${style.sectionAspect}`
}

/* ---- terrain-following volume paths --------------------------------------
   Volumes cannot clamp to ground like polylines, and the drawn vertices
   alone chord straight through terrain. Instead the path is splined and
   resampled to a FIXED vertex budget, each sample reads the terrain height
   (sampleTerrainMostDetailed), and heights get a 3-tap smoothing pass.
   Budget-based spacing scales with the line: a 30 m research-area line
   resolves to ~5 cm hops, a 300 km line to ~500 m hops invisible at range. */

const VOLUME_PATH_BUDGET = 600

/** terrain-following path per line id (flat lon,lat,height; lift-less, so
    style edits reuse the sample) + stale-guard tokens for async jobs */
const lineVolumePaths = new Map<string, number[]>()
const lineVolumeJobs = new Map<string, number>()

/** centripetal Catmull-Rom point on the k1→k2 span at fraction t∈[0,1) */
function splinePoint(k0: number[], k1: number[], k2: number[], k3: number[], t: number): number[] {
  const dist = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const d0 = Math.max(dist(k0, k1), 1e-9)
  const d1 = Math.max(dist(k1, k2), 1e-9)
  const d2 = Math.max(dist(k2, k3), 1e-9)
  const t1 = d0
  const t2 = t1 + d1
  const t3 = t2 + d2
  const time = t1 + t * d1
  const at = (a: number, b: number, ta: number, tb: number) =>
    tb - ta < 1e-12 ? a : a + ((time - ta) / (tb - ta)) * (b - a)
  const a1 = [at(k0[0], k1[0], 0, t1), at(k0[1], k1[1], 0, t1)]
  const a2 = [at(k1[0], k2[0], t1, t2), at(k1[1], k2[1], t1, t2)]
  const a3 = [at(k2[0], k3[0], t2, t3), at(k2[1], k3[1], t2, t3)]
  const b1 = [at(a1[0], a2[0], 0, t2), at(a1[1], a2[1], 0, t2)]
  const b2 = [at(a2[0], a3[0], t1, t3), at(a2[1], a3[1], t1, t3)]
  return [at(b1[0], b2[0], t1, t2), at(b1[1], b2[1], t1, t2)]
}

/** smooth the drawn polyline horizontally (through its own vertices) and
    spread the sampling budget across spans — flat [lon, lat, ...] degrees */
function splinePath(positions: { lon: number; lat: number }[]): number[] {
  const n = positions.length
  if (n < 2) return []
  if (n === 2) {
    // nothing to bend through — plain linear densify
    const out: number[] = []
    for (let i = 0; i <= VOLUME_PATH_BUDGET; i++) {
      const f = i / VOLUME_PATH_BUDGET
      out.push(
        positions[0].lon + (positions[1].lon - positions[0].lon) * f,
        positions[0].lat + (positions[1].lat - positions[0].lat) * f,
      )
    }
    return out
  }
  const pt = (i: number) => {
    const c = positions[Math.min(Math.max(i, 0), n - 1)]
    return [c.lon, c.lat]
  }
  // budget per span ∝ span length (degree-proxy distance is enough here)
  const spanLen: number[] = []
  let total = 0
  for (let i = 0; i < n - 1; i++) {
    const l = Math.hypot(positions[i + 1].lon - positions[i].lon, positions[i + 1].lat - positions[i].lat)
    spanLen.push(l)
    total += l
  }
  const out: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const count = Math.max(2, Math.round((VOLUME_PATH_BUDGET * spanLen[i]) / Math.max(total, 1e-9)))
    for (let j = 0; j < count; j++) {
      const p = splinePoint(pt(i - 1), pt(i), pt(i + 1), pt(i + 2), j / count)
      out.push(p[0], p[1])
    }
  }
  out.push(positions[n - 1].lon, positions[n - 1].lat)
  return out
}

/** terrain heights along a flat [lon,lat,...] path, then a 3-point moving
    average to shave DEM quantisation stairsteps */
async function groundPath(viewer: Viewer, flat: number[]): Promise<number[]> {
  const cartos: Cartographic[] = []
  for (let i = 0; i < flat.length; i += 2) {
    cartos.push(new Cartographic(CesiumMath.toRadians(flat[i]), CesiumMath.toRadians(flat[i + 1])))
  }
  let sampled = cartos
  try {
    sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, cartos)
  } catch (err) {
    console.warn('[CineEarth] terrain sampling failed — volume falls back to ellipsoid height', err)
  }
  const hs = sampled.map((c) => (Number.isFinite(c.height) ? c.height : 0))
  for (let i = 1; i < hs.length - 1; i++) hs[i] = (hs[i - 1] + hs[i] + hs[i + 1]) / 3
  const out: number[] = []
  for (let i = 0; i < flat.length; i += 2) out.push(flat[i], flat[i + 1], hs[i / 2])
  return out
}

/** hot-swap a volume's positions for the (cached) terrain-following path */
function applyVolumePath(id: string, flat: number[], lift: number): void {
  const vol = loadedLineEntities.get(id)?.polylineVolume
  if (!vol) return
  const withLift: number[] = []
  for (let i = 0; i < flat.length; i += 3) withLift.push(flat[i], flat[i + 1], flat[i + 2] + lift)
  vol.positions = new ConstantProperty(Cartesian3.fromDegreesArrayHeights(withLift))
}

/* ---- per-frame animation callbacks ----------------------------------------
   Lines with an anim track get a dynamic CallbackProperty: every render
   frame it evaluates Growth% / Lift at the playhead (useRoute.progress —
   the same clock the camera obeys) and trims the path by ARC LENGTH so the
   growth reads uniform. Signature-memoized: paused frames return the same
   Cartesian3[] without rebuilding. */

const lineVolumeCums = new Map<string, number[]>()
const lineAnimCache = new Map<string, { sig: string; arr: Cartesian3[] }>()

/** cumulative 3D arc length of a flat [lon,lat,height,...] path */
function cumulativeLengths(flat: number[]): number[] {
  const n = flat.length / 3
  const cum = new Array<number>(n)
  cum[0] = 0
  let prev = Cartesian3.fromDegrees(flat[0], flat[1], flat[2])
  for (let i = 1; i < n; i++) {
    const cur = Cartesian3.fromDegrees(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2])
    cum[i] = cum[i - 1] + Cartesian3.distance(prev, cur)
    prev = cur
  }
  return cum
}

/** trim a flat [lon,lat,height,...] path to the first `frac` of total arc
    length (same rule as the route growth line's cutPathByLength) */
function cutFlatPath(flat: number[], cum: number[], frac: number): number[] {
  const n = cum.length
  if (frac <= 0.001) {
    // degenerate two-point segment at the start — invisible but Cesium-safe
    return [flat[0], flat[1], flat[2], flat[0], flat[1], flat[2]]
  }
  if (frac >= 0.999) return flat
  const target = cum[n - 1] * frac
  let i = 1
  while (i < n - 1 && cum[i] < target) i += 1
  const span = cum[i] - cum[i - 1]
  const local = span > 0 ? (target - cum[i - 1]) / span : 1
  const out = flat.slice(0, i * 3)
  const j = i * 3
  out.push(
    flat[j - 3] + (flat[j] - flat[j - 3]) * local,
    flat[j - 2] + (flat[j + 1] - flat[j - 2]) * local,
    flat[j - 1] + (flat[j + 2] - flat[j - 1]) * local,
  )
  return out
}

/** animated flat polyline: Growth% trims the drawn vertices (clamped) or the
    height path (+ Lift when a key track exists) */
function animatedFlatPositions(id: string): Cartesian3[] {
  const line = useAssets.getState().assets.find((a) => a.id === id)?.line
  if (!line) return []
  const style = line.style
  const track = useAnim.getState().tracks[id]
  const progress = useRoute.getState().progress
  const growth = (evalAnim(track, 'growth', progress) ?? 100) / 100
  const lift = style.clamped ? 0 : (evalAnim(track, 'lift', progress) ?? 0)

  const flat: number[] = []
  for (const p of line.positions) flat.push(p.lon, p.lat, p.height + lift)
  const cut = cutFlatPath(flat, cumulativeLengths(flat), growth)
  if (style.clamped) {
    const pts: number[] = []
    for (let i = 0; i < cut.length; i += 3) pts.push(cut[i], cut[i + 1])
    return Cartesian3.fromDegreesArray(pts)
  }
  return Cartesian3.fromDegreesArrayHeights(cut)
}

/** animated volume: Growth% trims the cached terrain-following path, Lift
    offsets it (falling back to the static style value with no lift keys) */
function animatedVolumePositions(id: string): Cartesian3[] {
  const line = useAssets.getState().assets.find((a) => a.id === id)?.line
  if (!line) return []
  const track = useAnim.getState().tracks[id]
  const progress = useRoute.getState().progress

  const cached = lineVolumePaths.get(id)
  // before the async sample resolves: ride the drawn vertices as-is
  const flat = cached ?? line.positions.flatMap((p) => [p.lon, p.lat, p.height])
  const cum = cached ? lineVolumeCums.get(id) ?? cumulativeLengths(cached) : cumulativeLengths(flat)

  const growth = (evalAnim(track, 'growth', progress) ?? 100) / 100
  const lift = evalAnim(track, 'lift', progress) ?? line.style.lift

  const sig = `${cached ? 'c' : 's'}|${growth.toFixed(4)}|${lift.toFixed(2)}`
  const hit = lineAnimCache.get(id)
  if (hit && hit.sig === sig) return hit.arr

  const cut = cutFlatPath(flat, cum, growth)
  const arr = new Array<Cartesian3>(cut.length / 3)
  for (let i = 0, j = 0; i < cut.length; i += 3, j++) {
    arr[j] = Cartesian3.fromDegrees(cut[i], cut[i + 1], cut[i + 2] + lift)
  }
  lineAnimCache.set(id, { sig, arr })
  return arr
}

/** make the volume follow the terrain: spline → sample → smooth → swap in.
    Results are cached per line, so later edits (colour, lift) apply instantly.
    ANIMATED lines never swap a ConstantProperty in — their Callback reads
    the cache directly each frame. */
function refreshVolumePath(id: string): void {
  const viewer = getViewer()
  const asset = useAssets.getState().assets.find((a) => a.id === id)
  if (!viewer || !asset?.line) return

  const animated = Boolean(useAnim.getState().tracks[id])
  const apply = (flat: number[]) => {
    if (animated) return
    const fresh = useAssets.getState().assets.find((a) => a.id === id)
    if (fresh?.line) applyVolumePath(id, flat, fresh.line.style.lift)
  }

  const cached = lineVolumePaths.get(id)
  if (cached) {
    apply(cached)
    return
  }

  const job = (lineVolumeJobs.get(id) ?? 0) + 1
  lineVolumeJobs.set(id, job)
  const spline = splinePath(asset.line.positions)
  void groundPath(viewer, spline).then((flat) => {
    if (lineVolumeJobs.get(id) !== job) return // superseded or removed meanwhile
    lineVolumePaths.set(id, flat)
    lineVolumeCums.set(id, cumulativeLengths(flat))
    const fresh = useAssets.getState().assets.find((a) => a.id === id)
    if (!fresh?.line) return
    apply(flat)
  })
}

/** commit a finished drawing as a line asset + ground-clamped polyline */
export async function createLineAsset(
  positions: { lon: number; lat: number; height: number }[],
): Promise<void> {
  const viewer = getViewer()
  if (!viewer || positions.length < 2) return

  const n = useAssets.getState().assets.filter((a) => a.kind === 'line').length + 1
  const id = createAssetId()
  const name = `Line ${n}`
  const style = { ...DEFAULT_LINE_STYLE }

  const ds = new CustomDataSource(name)
  const entity = buildFlatEntity(ds, id, positions, style, false)
  addSourceToAll(ds)
  loadedSources.set(id, ds)
  loadedLineEntities.set(id, entity)

  useAssets.getState().addAsset({
    id,
    name,
    kind: 'line',
    url: '',
    visible: true,
    status: 'ready',
    line: { positions, style },
  })
  // no camera fly-to after finishing — keep the user's framing (asked for)
}

/** push style edits from the assets panel onto the entity (live preview) */
export function applyLineStyle(id: string): void {
  const asset = useAssets.getState().assets.find((a) => a.id === id)
  if (!asset?.line) return
  const style = asset.line.style

  const ds = loadedSources.get(id)
  let entity = loadedLineEntities.get(id)
  if (!ds || !entity) return

  const wantVolume = style.section !== 'none'
  const animated = Boolean(useAnim.getState().tracks[id])

  /* ---- extruded mode: colour hot-swaps, geometry params rebuild ---- */
  if (wantVolume) {
    if (entity.polylineVolume) {
      const vol = entity.polylineVolume
      vol.material = new ColorMaterialProperty(volumeColor(style))
      vol.outlineColor = new ConstantProperty(volumeOutlineColor(style))
      const sameGeom = lineVolumeKeys.get(id) === volumeKeyOf(style)
      const sameAnim = entity.polylineVolume.positions instanceof CallbackProperty === animated
      if (sameGeom && sameAnim) {
        // colour- or lift-only edit: re-offset the cached terrain path
        refreshVolumePath(id)
        return
      }
    }
    ds.entities.remove(entity)
    entity = buildVolumeEntity(ds, id, asset.line.positions, style, animated)
    loadedLineEntities.set(id, entity)
    lineVolumeKeys.set(id, volumeKeyOf(style))
    refreshVolumePath(id)
    return
  }

  /* ---- flat mode ---- */
  if (entity.polylineVolume) {
    ds.entities.remove(entity)
    entity = buildFlatEntity(ds, id, asset.line.positions, style, animated)
    loadedLineEntities.set(id, entity)
    lineVolumeKeys.delete(id)
    return
  }

  // clampToGround switches the render path (ground vs regular geometry) —
  // Cesium won't rebuild it from a property change, so re-add the entity.
  // Same for animation toggling: positions move between Constant & Callback.
  const isAnim = entity.polyline?.positions instanceof CallbackProperty
  if (Boolean(entity.polyline?.clampToGround?.getValue()) !== style.clamped || isAnim !== animated) {
    ds.entities.remove(entity)
    entity = buildFlatEntity(ds, id, asset.line.positions, style, animated)
    loadedLineEntities.set(id, entity)
    return
  }

  const poly = entity.polyline
  if (!poly) return
  poly.width = new ConstantProperty(style.width)
  poly.material = lineMaterial(style)
}

export function removeAsset(id: string): void {
  /* an asset leaves EVERY view; the shared instance is destroyed exactly
     once, AFTER the last viewer has let go of it */
  const entry = loaded.get(id)
  if (entry) {
    for (const v of assetViewerList()) {
      try {
        if (v.scene.primitives.contains(entry.model)) {
          ;(v.scene.primitives.remove as (p: Model, destroy?: boolean) => boolean)(entry.model, false)
        }
      } catch { /* racing teardown */ }
    }
    try { entry.model.destroy() } catch { /* already destroyed */ }
  }
  loaded.delete(id)

  const src = loadedSources.get(id)
  if (src) {
    for (const v of assetViewerList()) {
      try {
        if (v.dataSources.contains(src)) v.dataSources.remove(src, false)
      } catch { /* racing teardown */ }
    }
    /* the DataSource INTERFACE hides destroy (the concrete classes all have
       it) — optional-call the runtime method */
    try { (src as unknown as { destroy?: () => void }).destroy?.() } catch { /* already destroyed */ }
  }
  loadedSources.delete(id)
  loadedLineEntities.delete(id)
  lineVolumeKeys.delete(id)
  lineVolumePaths.delete(id)
  lineVolumeJobs.delete(id)
  lineVolumeCums.delete(id)
  lineAnimCache.delete(id)
  useAnim.getState().removeTrack(id)

  const asset = useAssets.getState().assets.find((a) => a.id === id)
  if (asset?.url) {
    // grace period so an in-flight load can finish reading the blob
    window.setTimeout(() => URL.revokeObjectURL(asset.url), 15_000)
  }
  useAssets.getState().dropAsset(id)
}
