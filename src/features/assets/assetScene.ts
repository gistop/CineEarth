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
  HeightReference,
} from 'cesium'
import type { DataSource, Viewer } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { createAssetId, useAssets, type AssetKind } from './assetStore'

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
    viewer.scene.primitives.add(model)
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
    await viewer.dataSources.add(ds)
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
    await viewer.dataSources.add(ds)
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

    await viewer.dataSources.add(ds)
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

export function removeAsset(id: string): void {
  const viewer = getViewer()
  const entry = loaded.get(id)
  if (viewer && entry) viewer.scene.primitives.remove(entry.model)
  loaded.delete(id)

  const src = loadedSources.get(id)
  if (viewer && src) viewer.dataSources.remove(src, true)
  loadedSources.delete(id)

  const asset = useAssets.getState().assets.find((a) => a.id === id)
  if (asset) {
    // grace period so an in-flight load can finish reading the blob
    window.setTimeout(() => URL.revokeObjectURL(asset.url), 15_000)
  }
  useAssets.getState().dropAsset(id)
}
