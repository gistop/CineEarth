// Props tab block — 布局模式: 挤压 / 覆盖. A layout toggle backed by the ui
// store (default: 挤压). Both modes keep the OUTPUT aspect on every monitor;
// the mode only decides whether the chrome floats above the stage (overlay:
// 窗口即画幅) or takes its space out of it (push: 挤压窗口，不挤压画幅 —
// monitors letterbox to the output ratio; the editor window goes GES-style
// with a darkened surround outside the frame).

import { useUI, type LayoutMode } from '../../store/ui'
import { useT, type I18nKey } from '../../i18n'

const MODES: { id: LayoutMode; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { id: 'push', labelKey: 'layout.push', hintKey: 'layout.push.hint' },
  { id: 'overlay', labelKey: 'layout.overlay', hintKey: 'layout.overlay.hint' },
]

export default function LayoutPanel() {
  const t = useT()
  const layoutMode = useUI((s) => s.layoutMode)
  const setLayoutMode = useUI((s) => s.setLayoutMode)
  const active = MODES.find((m) => m.id === layoutMode)

  return (
    <section className="ce-stack" aria-label={t('layout.title')}>
      <p className="ce-hint">{t('layout.title')}</p>
      <div className="ce-seg" role="radiogroup" aria-label={t('layout.title')}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={layoutMode === m.id}
            className={`ce-seg-btn${layoutMode === m.id ? ' is-on' : ''}`}
            title={t(m.hintKey)}
            onClick={() => setLayoutMode(m.id)}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      {active && <p className="ce-hint">{t(active.hintKey)}</p>}
    </section>
  )
}
