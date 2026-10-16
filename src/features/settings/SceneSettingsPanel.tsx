// Scene settings panel — global render switches, lives in the Props tab.

import { useT, type I18nKey } from '../../i18n'
import { useScene, type SceneSettings } from './sceneStore'
import { syncSceneSettings } from './sceneSettings'

const ROWS: { key: keyof SceneSettings; nameKey: I18nKey; hintKey: I18nKey }[] = [
  { key: 'depthTest', nameKey: 'scene.occlusion.name', hintKey: 'scene.occlusion.hint' },
  { key: 'groundAtmosphere', nameKey: 'scene.groundAtmo.name', hintKey: 'scene.groundAtmo.hint' },
  { key: 'skyAtmosphere', nameKey: 'scene.skyAtmo.name', hintKey: 'scene.skyAtmo.hint' },
  { key: 'fog', nameKey: 'scene.fog.name', hintKey: 'scene.fog.hint' },
]

export default function SceneSettingsPanel() {
  const t = useT()
  const scene = useScene()
  const setFlag = useScene((s) => s.setFlag)

  return (
    <section className="ce-stack" aria-label={t('set.scene')}>
      {ROWS.map(({ key, nameKey, hintKey }) => (
        <div key={key} className="ce-row" title={t(hintKey)}>
          <input
            type="checkbox"
            checked={scene[key]}
            aria-label={t(nameKey)}
            onChange={(e) => {
              setFlag(key, e.target.checked)
              syncSceneSettings()
            }}
          />
          <div className="ce-row-main">
            <span className="ce-row-name">{t(nameKey)}</span>
          </div>
          <span className="ce-row-val">{scene[key] ? t('scene.on') : t('scene.off')}</span>
        </div>
      ))}
    </section>
  )
}
