import { useEffect } from 'react'
import GlobeViewport from './components/GlobeViewport'
import Drawer from './components/Drawer'
import Timeline from './components/Timeline'
import PreviewBadge from './components/PreviewBadge'
import RouteDrawer from './features/route/RouteDrawer'
import RouteSceneBridge from './features/route/RouteSceneBridge'
import { useUI } from './store/ui'
import './styles/ui.css'

export default function App() {
  const previewMode = useUI((s) => s.previewMode)
  const timelineExpanded = useUI((s) => s.timelineExpanded)

  /* Esc: exit preview → close drawers · T: tools · R: route · Space: play/pause */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const s = useUI.getState()
      if (e.key === 'Escape') {
        if (s.targetPickMode) s.setTargetPickMode(false)
        else if (s.previewMode) s.setPreviewMode(false)
        else if (s.rightDrawerOpen) s.toggleRightDrawer(false)
        else if (s.drawerOpen) s.toggleDrawer(false)
      } else if (e.key.toLowerCase() === 't' && !s.previewMode) {
        s.toggleDrawer()
      } else if (e.key.toLowerCase() === 'r' && !s.previewMode) {
        s.toggleRightDrawer()
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
      style={{ '--ce-tl-h': timelineExpanded ? 'var(--ce-tl-expanded)' : 'var(--ce-tl-collapsed)' } as React.CSSProperties}
    >
      <GlobeViewport />

      {/* imperative bridge: playback loop + route entities (also active in preview) */}
      <RouteSceneBridge />

      {!previewMode && (
        <>
          <Drawer />
          <RouteDrawer />
          <Timeline />
        </>
      )}

      {previewMode && <PreviewBadge />}
    </div>
  )
}
