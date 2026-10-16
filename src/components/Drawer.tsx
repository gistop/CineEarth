import { useRef, useState } from 'react'
import { useUI, type DrawerTab } from '../store/ui'
import { useT, type I18nKey } from '../i18n'
import { FilmIcon, TuneIcon, FolderIcon, CloseIcon } from './Icons'
import SceneSettingsPanel from '../features/settings/SceneSettingsPanel'
import ThemePanel from '../features/settings/ThemePanel'
import LayoutPanel from '../features/settings/LayoutPanel'
import DataSourcePanel from '../features/settings/DataSourcePanel'
import { useAssets } from '../features/assets/assetStore'
import { importAssetFile, isSupportedAsset, removeAsset, setAssetVisible, zoomToAsset } from '../features/assets/assetScene'

const TABS: { id: DrawerTab; labelKey: I18nKey; Icon: typeof FilmIcon }[] = [
  { id: 'shots', labelKey: 'tab.shots', Icon: FilmIcon },
  { id: 'properties', labelKey: 'tab.settings', Icon: TuneIcon },
  { id: 'assets', labelKey: 'tab.assets', Icon: FolderIcon },
]

const DEMO_SHOTS = [
  { name: 'Orbit — Matterhorn east flank', dur: '0:08' },
  { name: 'Push-in — North face', dur: '0:06' },
  { name: 'Flyby — Zermatt valley', dur: '0:10' },
]



/**
 * Overlay drawer — floats on the globe, bottom stops above the timeline.
 * The globe never resizes: drawer is absolutely positioned.
 */
export default function Drawer() {
  const open = useUI((s) => s.drawerOpen)
  const tab = useUI((s) => s.drawerTab)
  const setTab = useUI((s) => s.setDrawerTab)
  const toggle = useUI((s) => s.toggleDrawer)
  const t = useT()

  return (
    <aside id="ce-drawer" className="ce-drawer" data-open={open} aria-hidden={!open}>
      <header className="ce-drawer-head">
        <span className="ce-wordmark">
          Cine<i />Earth
        </span>
        <button type="button" className="ce-icon-btn" onClick={() => toggle(false)} title={t('drawer.close')}>
          <CloseIcon size={15} />
        </button>
      </header>

      <nav className="ce-tabs" role="tablist">
        {TABS.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`ce-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="ce-drawer-body">
        {tab === 'shots' && <ShotsPanel />}
        {tab === 'properties' && <SettingsPanel />}
        {tab === 'assets' && <AssetsPanel />}
      </div>
    </aside>
  )
}

function ShotsPanel() {
  return (
    <div className="ce-stack">
      {DEMO_SHOTS.map((s, i) => (
        <div key={s.name} className="ce-row">
          <span className="ce-shot-idx">{String(i + 1).padStart(2, '0')}</span>
          <div className="ce-row-main">
            <span className="ce-row-name">{s.name}</span>
          </div>
          <span className="ce-row-val">{s.dur}</span>
        </div>
      ))}
    </div>
  )
}

/** Settings tab — three semantic sections: what feeds the globe (Imagery &
 *  Terrain), how the scene renders (Scene), how the shell looks (Interface). */
function SettingsPanel() {
  const t = useT()
  return (
    <div className="ce-settings">
      <section className="ce-set-group" aria-label={t('set.imageryTerrain')}>
        <h3 className="ce-set-title">{t('set.imageryTerrain')}</h3>
        <DataSourcePanel />
      </section>
      <section className="ce-set-group" aria-label={t('set.scene')}>
        <h3 className="ce-set-title">{t('set.scene')}</h3>
        <SceneSettingsPanel />
      </section>
      <section className="ce-set-group" aria-label={t('set.interface')}>
        <h3 className="ce-set-title">{t('set.interface')}</h3>
        <LayoutPanel />
        <ThemePanel />
      </section>
    </div>
  )
}

function AssetsPanel() {
  const assets = useAssets((s) => s.assets)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const importFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files)
      .filter(isSupportedAsset)
      .forEach((f) => void importAssetFile(f))
  }

  return (
    <div className="ce-stack">
      <div
        className={`ce-dropzone${dragOver ? ' is-over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          importFiles(e.dataTransfer.files)
        }}
      >
        <FolderIcon size={20} />
        <span>{t('assets.drop.main')}</span>
        <span className="ce-dropzone-sub">{t('assets.drop.sub')}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf,.kml,.kmz,.xlsx,.xls,.zip"
        multiple
        hidden
        onChange={(e) => {
          importFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {assets.map((a) => (
        <div
          key={a.id}
          className="ce-row ce-asset-row"
          title={a.status === 'error' ? (a.error ?? t('assets.loadFailed')) : t('assets.frame')}
          onDoubleClick={() => zoomToAsset(a.id)}
        >
          <input
            type="checkbox"
            checked={a.visible}
            aria-label={a.name}
            onChange={(e) => setAssetVisible(a.id, e.target.checked)}
          />
          <div className="ce-row-main">
            <span className="ce-row-name">
              <span className={`ce-asset-dot is-${a.status}`} />
              {a.name}
            </span>
          </div>
          <button
            type="button"
            className="ce-icon-btn"
            title={t('assets.remove')}
            onClick={() => removeAsset(a.id)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
