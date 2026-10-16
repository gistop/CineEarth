// Data sources panel — imagery & terrain service pickers, Props tab.
// One segmented control per service; a service that needs a key reveals its
// input right below it (Tianditu requires a free key; ion's token is optional
// and managed on the Layers tab; both ArcGIS services are keyless).

import { useEffect, useState } from 'react'
import { useDataSource, type ImagerySource, type TerrainSource } from './dataSourceStore'
import { syncImagery, syncTerrain, saveTdtKey } from './ionTerrain'

const IMAGERY_SOURCES: { id: ImagerySource; name: string; title: string }[] = [
  {
    id: 'ion',
    name: 'Ion · Bing',
    title: 'Cesium World Imagery (Bing satellite) via ion — works on the shared token; a personal token lifts the quota (Layers ▸ Cesium ion)',
  },
  {
    id: 'esri',
    name: 'ArcGIS',
    title: 'Esri World Imagery — public service, no key',
  },
  {
    id: 'tdt',
    name: 'Tianditu',
    title: '天地图 satellite imagery + Chinese labels — free key required',
  },
]

const TERRAIN_SOURCES: { id: TerrainSource; name: string; title: string }[] = [
  {
    id: 'ion',
    name: 'World',
    title: 'Cesium World Terrain via ion — shared token works out of the box',
  },
  {
    id: 'arcgis',
    name: 'ArcGIS 3D',
    title: 'Esri WorldElevation3D / Terrain3D — public, no key, bathymetry included',
  },
  {
    id: 'ellipsoid',
    name: 'Ellipsoid',
    title: 'No terrain — a smooth sphere, zero network',
  },
]

const IMAGERY_STATE_LABEL: Record<string, string> = {
  loading: 'Switching imagery…',
  'missing-key': 'Tianditu needs its key — paste one below',
  failed: 'Imagery source failed — network or key; pick another',
}

const TERRAIN_STATE_LABEL: Record<string, string> = {
  loading: 'Switching terrain…',
  failed: 'Terrain source failed — network or key; pick another',
}

export default function DataSourcePanel() {
  const imagery = useDataSource((s) => s.imagery)
  const terrain = useDataSource((s) => s.terrain)
  const tdtKey = useDataSource((s) => s.tdtKey)
  const imageryState = useDataSource((s) => s.imageryState)
  const terrainState = useDataSource((s) => s.terrainState)

  const [draft, setDraft] = useState(tdtKey)
  useEffect(() => setDraft(tdtKey), [tdtKey])
  const keyDirty = draft.trim() !== tdtKey

  return (
    <section className="ce-stack" aria-label="Imagery and terrain services">
      <p className="ce-hint">Imagery service — applied immediately</p>
      <div className="ce-src-modes" role="group" aria-label="Imagery service">
        {IMAGERY_SOURCES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`ce-src-mode${imagery === m.id ? ' is-on' : ''}`}
            title={m.title}
            aria-pressed={imagery === m.id}
            onClick={() => {
              useDataSource.getState().setImagery(m.id)
              void syncImagery()
            }}
          >
            {m.name}
          </button>
        ))}
      </div>

      {imagery === 'tdt' && (
        <>
          <div className="ce-src-key">
            <input
              className="ce-ion-input"
              type="password"
              value={draft}
              placeholder="Paste your Tianditu key (free)"
              spellCheck={false}
              autoComplete="off"
              aria-label="Tianditu key"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTdtKey(draft)
              }}
            />
            <button
              type="button"
              className="ce-ion-btn"
              disabled={!keyDirty}
              onClick={() => void saveTdtKey(draft)}
            >
              Apply
            </button>
          </div>
          <p className="ce-src-note">
            Free key (browser-only storage):{' '}
            <a href="https://console.tianditu.gov.cn" target="_blank" rel="noreferrer">
              console.tianditu.gov.cn
            </a>
          </p>
        </>
      )}

      {imageryState !== 'idle' && imageryState !== 'loading' && (
        <p className={`ce-src-status${imageryState === 'failed' ? ' is-bad' : ''}`}>
          {IMAGERY_STATE_LABEL[imageryState]}
        </p>
      )}

      <p className="ce-hint">Terrain service</p>
      <div className="ce-src-modes" role="group" aria-label="Terrain service">
        {TERRAIN_SOURCES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`ce-src-mode${terrain === m.id ? ' is-on' : ''}`}
            title={m.title}
            aria-pressed={terrain === m.id}
            onClick={() => {
              useDataSource.getState().setTerrain(m.id)
              void syncTerrain()
            }}
          >
            {m.name}
          </button>
        ))}
      </div>

      {terrainState === 'failed' && <p className="ce-src-status is-bad">{TERRAIN_STATE_LABEL.failed}</p>}
    </section>
  )
}
