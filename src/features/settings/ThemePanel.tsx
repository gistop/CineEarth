// Props tab blocks — 界面主题 picker + 轨道值柱 switch. Both are style /
// display toggles backed by the ui store. The theme options come from the
// THEMES registry, so future themes are data, not markup; each option carries
// a 3-chip swatch strip painted with THAT theme's fixed colors (not tokens —
// the preview must keep its look whatever the app currently wears).

import { useUI } from '../../store/ui'
import { THEMES } from './theme'

export default function ThemePanel() {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const laneBars = useUI((s) => s.laneBars)
  const setLaneBars = useUI((s) => s.setLaneBars)

  return (
    <>
      <section className="ce-stack" aria-label="界面主题">
        <p className="ce-hint">界面主题 — 仅样式，立即生效</p>
        <div className="ce-theme-row" role="radiogroup" aria-label="界面主题">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              className={`ce-theme-opt${theme === t.id ? ' is-on' : ''}`}
              title={t.hint}
              onClick={() => setTheme(t.id)}
            >
              <span className={`ce-theme-swatches is-${t.id}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="ce-theme-name">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ce-stack" aria-label="轨道值柱">
        <p className="ce-hint">轨道值柱 — 柱高表示该时刻通道值的高低</p>
        <div className="ce-switch-row">
          <button
            type="button"
            role="switch"
            aria-checked={laneBars}
            className={`ce-switch${laneBars ? ' is-on' : ''}`}
            title="轨道车道内用柱子高低表示值（含缓动形状，HOLD 段为平柱）。曲线模式不受影响"
            onClick={() => setLaneBars(!laneBars)}
          >
            <span className="ce-switch-knob" aria-hidden="true" />
          </button>
          <span className="ce-switch-text">{laneBars ? '显示' : '隐藏'}</span>
        </div>
      </section>
    </>
  )
}
