// 界面主题 picker — first block in the Props tab. Segmented options come from
// the THEMES registry, so future themes are data, not markup. Each option
// carries a 3-chip swatch strip painted with THAT theme's fixed colors (not
// tokens — the preview must keep its look whatever the app currently wears).

import { useUI } from '../../store/ui'
import { THEMES } from './theme'

export default function ThemePanel() {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)

  return (
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
  )
}
