// Scene settings glue — push store state → viewer. Safe to call at any time
// (called once after viewer creation, and on every Props-tab toggle).

import { getViewer } from '../../cesium/viewerRegistry'
import { useScene } from './sceneStore'

export function syncSceneSettings(): void {
  const viewer = getViewer()
  if (!viewer || viewer.isDestroyed()) return

  const { depthTest, groundAtmosphere, skyAtmosphere, fog } = useScene.getState()
  const scene = viewer.scene

  scene.globe.depthTestAgainstTerrain = depthTest
  scene.globe.showGroundAtmosphere = groundAtmosphere
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = skyAtmosphere
  scene.fog.enabled = fog
}
