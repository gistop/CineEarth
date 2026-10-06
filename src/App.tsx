import { useEffect } from 'react'
import GlobeViewport from './components/GlobeViewport'
import Drawer from './components/Drawer'
import Timeline from './components/Timeline'
import PreviewBadge from './components/PreviewBadge'
import RouteDrawer from './features/route/RouteDrawer'
import RouteSceneBridge from './features/route/RouteSceneBridge'
import SunPanel from './features/settings/SunPanel'
import { useReveal } from './features/route/revealStore'
import { useUI } from './store/ui'
import './styles/ui.css'

export default function App() {
  const previewMode = useUI((s) => s.previewMode)
  const timelineExpanded = useUI((s) => s.timelineExpanded)
  const tlHeight = useUI((s) => s.tlHeight)

  /* Kill in-page HTML5 drags (text-selection / image drags). Once one starts,
     the browser swallows every pointermove and flashes the native no-drop
     cursor — the minimap pan and other press-drag surfaces go dead. OS file
     drops on the dropzone are unaffected: those never fire dragstart inside
     this document. */
  useEffect(() => {
    const onDragStart = (e: DragEvent) => e.preventDefault()
    document.addEventListener('dragstart', onDragStart)
    return () => document.removeEventListener('dragstart', onDragStart)
  }, [])

  /* Esc: exit preview → close panels · T: tools · R: route · G: growth · C: camera lock · S: sun · Space: play/pause */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const s = useUI.getState()
      if (e.key === 'Escape') {
        if (s.targetPickMode) s.setTargetPickMode(false)
        else if (s.previewMode) s.setPreviewMode(false)
        else if (s.sunOpen) s.toggleSunPanel(false)
        else if (s.rightDrawerOpen) s.toggleRightDrawer(false)
        else if (s.drawerOpen) s.toggleDrawer(false)
      } else if (e.key.toLowerCase() === 't' && !s.previewMode) {
        s.toggleDrawer()
      } else if (e.key.toLowerCase() === 'r' && !s.previewMode) {
        s.toggleRightDrawer()
      } else if (e.key.toLowerCase() === 'g' && !s.previewMode) {
        const r = useReveal.getState()
        r.setGrowthLine(!r.growthLine)
      } else if (e.key.toLowerCase() === 'c' && !s.previewMode) {
        s.setCameraLocked(!s.cameraLocked)
      } else if (e.key.toLowerCase() === 's' && !s.previewMode) {
        s.toggleSunPanel()
      } else if (e.code === 'Space' && tag !== 'BUTTON') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="ce-app"
      style={{ '--ce-tl-h': timelineExpanded ? `${tlHeight}px` : 'var(--ce-tl-collapsed)' } as React.CSSProperties}
    >
      <GlobeViewport />

      {/* imperative bridge: playback loop + route entities (also active in preview) */}
      <RouteSceneBridge />

      {!previewMode && (
        <>
          <Drawer />
          <RouteDrawer />
          <SunPanel />
          <Timeline />
        </>
      )}

      {previewMode && <PreviewBadge />}
    </div>
  )
}
