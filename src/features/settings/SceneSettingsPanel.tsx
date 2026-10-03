// Scene settings panel — global render switches, lives in the Props tab.

import { useScene, type SceneSettings } from './sceneStore'
import { syncSceneSettings } from './sceneSettings'

const ROWS: { key: keyof SceneSettings; name: string; hint: string }[] = [
  {
    key: 'depthTest',
    name: 'Terrain occlusion',
    hint: 'Depth test — lines & models are hidden behind mountains (needs world terrain)',
  },
  {
    key: 'groundAtmosphere',
    name: 'Ground atmosphere',
    hint: 'Haze painted on the globe surface',
  },
  {
    key: 'skyAtmosphere',
    name: 'Sky atmosphere',
    hint: 'Atmosphere shell around the planet',
  },
  {
    key: 'fog',
    name: 'Distance fog',
    hint: 'Fades far terrain into the horizon',
  },
]

export default function SceneSettingsPanel() {
  const scene = useScene()
  const setFlag = useScene((s) => s.setFlag)

  return (
    <section className="ce-stack" aria-label="Scene render settings">
      <p className="ce-hint">Global scene look — applied immediately</p>
      {ROWS.map(({ key, name, hint }) => (
        <div key={key} className="ce-row" title={hint}>
          <input
            type="checkbox"
            checked={scene[key]}
            aria-label={name}
            onChange={(e) => {
              setFlag(key, e.target.checked)
              syncSceneSettings()
            }}
          />
          <div className="ce-row-main">
            <span className="ce-row-name">{name}</span>
          </div>
          <span className="ce-row-val">{scene[key] ? 'on' : 'off'}</span>
        </div>
      ))}
    </section>
  )
}
