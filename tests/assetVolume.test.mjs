import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import {
  Cartographic,
  DataSourceCollection,
  GeographicTilingScheme,
  JulianDate,
  PolylineVolumeGeometry,
} from 'cesium'

// Load the real stores and scene bridge without starting the app or a WebGL viewer.
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-volume-tests',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
})
const scene = await server.ssrLoadModule('/src/features/assets/assetScene.ts')
const { useAssets } = await server.ssrLoadModule('/src/features/assets/assetStore.ts')
const { useAnim } = await server.ssrLoadModule('/src/features/assets/assetAnimStore.ts')
const { useRoute } = await server.ssrLoadModule('/src/features/route/routeStore.ts')
const { setViewer } = await server.ssrLoadModule('/src/cesium/viewerRegistry.ts')
const oldWindow = globalThis.window
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms).unref() }
after(async () => {
  setViewer(null)
  globalThis.window = oldWindow
  await server.close()
})

function makeViewer() {
  return {
    isDestroyed: () => false,
    dataSources: new DataSourceCollection(),
    terrainProvider: {
      availability: { computeMaximumLevelAtPosition: () => 1 },
      tilingScheme: new GeographicTilingScheme(),
      requestTileGeometry: async () => ({ interpolateHeight: () => 250 }),
    },
    scene: { requestRender() {}, primitives: { length: 0 } },
  }
}

const time = JulianDate.now()
const settle = () => new Promise((resolve) => setImmediate(resolve))
const heightOf = (point) => Cartographic.fromCartesian(point).height

test('volume sections retain elevation and animate growth/lift across frames and viewers', async () => {
  const viewer = makeViewer()
  const otherViewer = makeViewer()
  setViewer(viewer)
  await scene.createLineAsset([
    { lon: 116, lat: 40, height: 0 },
    { lon: 116.01, lat: 40.01, height: 0 },
  ])
  const id = useAssets.getState().assets.at(-1).id
  try {
    useAssets.getState().updateLineStyle(id, { section: 'square', sectionSize: 10, lift: 100 })
    scene.applyLineStyle(id)
    await settle()
    useAnim.getState().addTrack(id)
    useRoute.setState({ progress: 0.5 })
    scene.applyLineStyle(id)
    await settle()
    await scene.prepareAssetViewer(otherViewer)
    const volume = viewer.dataSources.get(0).entities.values[0].polylineVolume
    const otherVolume = otherViewer.dataSources.get(0).entities.values[0].polylineVolume
    const positions = volume.positions.getValue(time)
    const expectedHeight = heightOf(positions[0])
    assert.ok(Math.abs(expectedHeight - 357) < 0.001, 'terrain + lift + half-section + margin')

    // This is Cesium's real synchronous dynamic-geometry path. It projects
    // the supplied Cartesian3 objects onto the ellipsoid IN PLACE.
    const geometry = PolylineVolumeGeometry.createGeometry(new PolylineVolumeGeometry({
      polylinePositions: positions,
      shapePositions: volume.shape.getValue(time),
    }))
    assert.ok(geometry?.indices.length > 0)
    assert.ok(Math.abs(heightOf(positions[0])) < 0.001, 'exercise Cesium input mutation')

    for (const next of [volume, otherVolume]) {
      const nextPositions = next.positions.getValue(time)
      assert.ok(Math.abs(heightOf(nextPositions[0]) - expectedHeight) < 0.001,
        'a subsequent evaluation must retain terrain height and lift')
      assert.notEqual(nextPositions[0], positions[0], 'Cartesian objects must not be shared')
    }

    // All non-flat sections use this geometry pipeline. Exercise seeking
    // forward/backward, including the intentionally invisible zero-growth state.
    for (const section of ['square', 'circle', 'rectangle', 'ellipse', 'diamond', 'triangle']) {
      useAssets.getState().updateLineStyle(id, { section })
      scene.applyLineStyle(id)
      for (const progress of [0, 0.25, 1, 0.5]) {
        useRoute.setState({ progress })
        const path = volume.positions.getValue(time)
        const end = Cartographic.fromCartesian(path.at(-1))
        const endLon = end.longitude * 180 / Math.PI
        assert.ok(Math.abs(endLon - (116 + 0.01 * progress)) < 0.00001,
          `${section}: the endpoint follows timeline growth`)
        const mesh = PolylineVolumeGeometry.createGeometry(new PolylineVolumeGeometry({
          polylinePositions: path,
          shapePositions: volume.shape.getValue(time),
        }))
        assert.equal(Boolean(mesh?.indices.length), progress > 0,
          `${section}: only zero growth should have no geometry`)
        assert.ok(Math.abs(heightOf(otherVolume.positions.getValue(time)[0]) - 357) < 0.001)
      }
    }

    useAnim.getState().addKey(id, 'lift', 0)
    useAnim.getState().addKey(id, 'lift', 1)
    const liftKeys = useAnim.getState().tracks[id].lift
    useAnim.getState().moveKey(id, 'lift', liftKeys[1].id, 1, 200)
    for (const [progress, lift] of [[0, 0], [0.5, 100], [1, 200]]) {
      useRoute.setState({ progress })
      assert.ok(Math.abs(heightOf(volume.positions.getValue(time)[0]) - (257 + lift)) < 0.001,
        'lift keyframes must override the static style lift')
    }

    useAssets.getState().updateLineStyle(id, { section: 'none' })
    scene.applyLineStyle(id)
    await settle()
    assert.ok(viewer.dataSources.get(0).entities.values[0].polyline)
    useAssets.getState().updateLineStyle(id, { section: 'square' })
    scene.applyLineStyle(id)
    await settle()
    const restored = viewer.dataSources.get(0).entities.values[0].polylineVolume
    assert.ok(Math.abs(heightOf(restored.positions.getValue(time)[0]) - 457) < 0.001,
      'switching flat back to square retains animated height')
    useAnim.getState().removeTrack(id)
    scene.applyLineStyle(id)
    await settle()
    const staticVolume = viewer.dataSources.get(0).entities.values[0].polylineVolume
    assert.equal(staticVolume.positions.isConstant, true)
    assert.ok(Math.abs(heightOf(staticVolume.positions.getValue(time)[0]) - 357) < 0.001,
      'removing the timeline track restores static lift')
  } finally {
    scene.removeAsset(id)
    scene.unregisterAssetViewer(otherViewer)
    await settle()
    setViewer(null)
  }
})
