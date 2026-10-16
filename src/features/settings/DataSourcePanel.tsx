// Data sources panel — imagery & terrain service pickers, Settings tab.
// One segmented control per service; a service that needs a key reveals its
// input right below it (Tianditu requires a free key; ion's token is optional
// and appears once when EITHER ion service is selected — one token serves
// both; both ArcGIS services are keyless). All copy goes through i18n.

import { useEffect, useState } from 'react'
import { useT, type I18nKey } from '../../i18n'
import { useIon } from './ionTokenStore'
import { useDataSource, type ImagerySource, type TerrainSource } from './dataSourceStore'
import { syncImagery, syncTerrain, saveTdtKey, saveIonToken, clearIonToken } from './ionTerrain'

const IMAGERY_SOURCES: { id: ImagerySource; nameKey: I18nKey; titleKey: I18nKey }[] = [
  { id: 'ion', nameKey: 'src.imagery.ion.name', titleKey: 'src.imagery.ion.title' },
  { id: 'esri', nameKey: 'src.imagery.esri.name', titleKey: 'src.imagery.esri.title' },
  { id: 'tdt', nameKey: 'src.imagery.tdt.name', titleKey: 'src.imagery.tdt.title' },
]

const TERRAIN_SOURCES: { id: TerrainSource; nameKey: I18nKey; titleKey: I18nKey }[] = [
  { id: 'ion', nameKey: 'src.terrain.ion.name', titleKey: 'src.terrain.ion.title' },
  { id: 'arcgis', nameKey: 'src.terrain.arcgis.name', titleKey: 'src.terrain.arcgis.title' },
  { id: 'ellipsoid', nameKey: 'src.terrain.ellipsoid.name', titleKey: 'src.terrain.ellipsoid.title' },
]

const IMAGERY_STATE_KEY: Record<string, I18nKey> = {
  loading: 'src.state.loading',
  'missing-key': 'src.state.missingKey',
  failed: 'src.state.imageryFailed',
}

const TERRAIN_STATE_KEY: Record<string, I18nKey> = {
  loading: 'src.state.terrainLoading',
  failed: 'src.state.terrainFailed',
}

const ION_STATUS_KEY: Record<string, I18nKey> = {
  none: 'src.ion.status.none',
  checking: 'src.ion.status.checking',
  valid: 'src.ion.status.valid',
  invalid: 'src.ion.status.invalid',
  unknown: 'src.ion.status.unknown',
}

export default function DataSourcePanel() {
  const t = useT()
  const imagery = useDataSource((s) => s.imagery)
  const terrain = useDataSource((s) => s.terrain)
  const tdtKey = useDataSource((s) => s.tdtKey)
  const imageryState = useDataSource((s) => s.imageryState)
  const terrainState = useDataSource((s) => s.terrainState)

  const token = useIon((s) => s.token)
  const status = useIon((s) => s.status)

  const [tdtDraft, setTdtDraft] = useState(tdtKey)
  useEffect(() => setTdtDraft(tdtKey), [tdtKey])
  const tdtDirty = tdtDraft.trim() !== tdtKey

  const [ionDraft, setIonDraft] = useState(token)
  useEffect(() => setIonDraft(token), [token])
  const ionDirty = ionDraft.trim() !== token

  const showIonToken = imagery === 'ion' || terrain === 'ion' /* one token serves both */

  return (
    <section className="ce-stack" aria-label={t('src.panelAria')}>
      <p className="ce-hint">{t('src.imagery.title')}</p>
      <div className="ce-src-modes" role="group" aria-label={t('src.imagery.title')}>
        {IMAGERY_SOURCES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`ce-src-mode${imagery === m.id ? ' is-on' : ''}`}
            title={t(m.titleKey)}
            aria-pressed={imagery === m.id}
            onClick={() => {
              useDataSource.getState().setImagery(m.id)
              void syncImagery()
            }}
          >
            {t(m.nameKey)}
          </button>
        ))}
      </div>

      {imagery === 'tdt' && (
        <>
          <div className="ce-src-key">
            <input
              className="ce-ion-input"
              type="password"
              value={tdtDraft}
              placeholder={t('src.imagery.keyPh')}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('src.imagery.keyPh')}
              onChange={(e) => setTdtDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTdtKey(tdtDraft)
              }}
            />
            <button
              type="button"
              className="ce-ion-btn"
              disabled={!tdtDirty}
              onClick={() => void saveTdtKey(tdtDraft)}
            >
              {t('src.apply')}
            </button>
          </div>
          <p className="ce-src-note">
            {t('src.tdt.note')}{' '}
            <a href="https://console.tianditu.gov.cn" target="_blank" rel="noreferrer">
              console.tianditu.gov.cn
            </a>
          </p>
        </>
      )}

      {imageryState !== 'idle' && imageryState !== 'loading' && (
        <p className={`ce-src-status${imageryState === 'failed' ? ' is-bad' : ''}`}>
          {t(IMAGERY_STATE_KEY[imageryState])}
        </p>
      )}

      <p className="ce-hint">{t('src.terrain.title')}</p>
      <div className="ce-src-modes" role="group" aria-label={t('src.terrain.title')}>
        {TERRAIN_SOURCES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`ce-src-mode${terrain === m.id ? ' is-on' : ''}`}
            title={t(m.titleKey)}
            aria-pressed={terrain === m.id}
            onClick={() => {
              useDataSource.getState().setTerrain(m.id)
              void syncTerrain()
            }}
          >
            {t(m.nameKey)}
          </button>
        ))}
      </div>

      {terrainState === 'failed' && <p className="ce-src-status is-bad">{t(TERRAIN_STATE_KEY.failed)}</p>}

      {showIonToken && (
        <>
          <p className="ce-hint">{t('src.ion.title')}</p>
          <div className="ce-ion-row">
            <input
              className="ce-ion-input"
              type="password"
              value={ionDraft}
              placeholder={t('src.ion.keyPh')}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('src.ion.title')}
              onChange={(e) => setIonDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveIonToken(ionDraft)
              }}
            />
            <span className={`ce-ion-dot is-${status}`} title={t(ION_STATUS_KEY[status])} />
          </div>

          <div className="ce-ion-actions">
            <button
              type="button"
              className="ce-ion-btn"
              disabled={!ionDirty && status !== 'unknown'}
              onClick={() => void saveIonToken(ionDraft)}
            >
              {t('src.ion.save')}
            </button>
            {token !== '' && (
              <button type="button" className="ce-ion-btn is-ghost" onClick={() => void clearIonToken()}>
                {t('src.ion.clear')}
              </button>
            )}
          </div>

          <p className={`ce-ion-status is-${status}`}>{t(ION_STATUS_KEY[status])}</p>

          <p className="ce-ion-note">
            {t('src.ion.note')} <span className="ce-ion-code">ion.cesium.com</span>. {t('src.ion.free')}{' '}
            <a href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">
              ion.cesium.com/tokens
            </a>
          </p>
        </>
      )}
    </section>
  )
}
