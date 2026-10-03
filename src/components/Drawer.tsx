import { useUI, type DrawerTab } from '../store/ui'
import { LayersIcon, FilmIcon, TuneIcon, FolderIcon, CloseIcon } from './Icons'
import IonSettingsPanel from '../features/settings/IonSettingsPanel'
import SceneSettingsPanel from '../features/settings/SceneSettingsPanel'

const TABS: { id: DrawerTab; label: string; Icon: typeof LayersIcon }[] = [
  { id: 'layers', label: 'Layers', Icon: LayersIcon },
  { id: 'shots', label: 'Shots', Icon: FilmIcon },
  { id: 'properties', label: 'Props', Icon: TuneIcon },
  { id: 'assets', label: 'Files', Icon: FolderIcon },
]

const DEMO_LAYERS = [
  { name: 'Satellite imagery', opacity: 100, on: true },
  { name: 'Place labels', opacity: 70, on: true },
  { name: 'User KML overlays', opacity: 100, on: false },
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

  return (
    <aside id="ce-drawer" className="ce-drawer" data-open={open} aria-hidden={!open}>
      <header className="ce-drawer-head">
        <span className="ce-wordmark">
          Cine<i />Earth
        </span>
        <button type="button" className="ce-icon-btn" onClick={() => toggle(false)} title="Close (Esc)">
          <CloseIcon size={15} />
        </button>
      </header>

      <nav className="ce-tabs" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`ce-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="ce-drawer-body">
        {tab === 'layers' && <LayersPanel />}
        {tab === 'shots' && <ShotsPanel />}
        {tab === 'properties' && <PropsPanel />}
        {tab === 'assets' && <AssetsPanel />}
      </div>
    </aside>
  )
}

function LayersPanel() {
  return (
    <div className="ce-stack">
      {DEMO_LAYERS.map((l) => (
        <div key={l.name} className="ce-row">
          <input type="checkbox" defaultChecked={l.on} aria-label={l.name} />
          <div className="ce-row-main">
            <span className="ce-row-name">{l.name}</span>
            <input type="range" min={0} max={100} defaultValue={l.opacity} aria-label={`${l.name} opacity`} />
          </div>
          <span className="ce-row-val">{l.opacity}%</span>
        </div>
      ))}

      {/* real settings take over from here — user's own ion token & terrain */}
      <IonSettingsPanel />
    </div>
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

function PropsPanel() {
  return <SceneSettingsPanel />
}

function AssetsPanel() {
  return (
    <div className="ce-stack">
      <div className="ce-dropzone">
        <FolderIcon size={20} />
        <span>Drop images, KML / GeoJSON here</span>
      </div>
    </div>
  )
}
