// Interface-theme picker + track value bars + language switch — all style /
// display toggles backed by the ui & i18n stores. The theme options come from
// the THEMES registry (data, not markup); each option carries a 3-chip swatch
// strip painted with THAT theme's fixed colors (not tokens — the preview must
// keep its look whatever the app currently wears). Language names render in
// their own tongue (English / 中文) by convention, so the picker reads the
// same in both locales.

import { useUI } from '../../store/ui'
import { useI18n, useT, type Locale } from '../../i18n'
import { THEMES } from './theme'

const LOCALES: { id: Locale; labelKey: 'lang.en' | 'lang.zh' }[] = [
  { id: 'en', labelKey: 'lang.en' },
  { id: 'zh', labelKey: 'lang.zh' },
]

export default function ThemePanel() {
  const t = useT()
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const laneBars = useUI((s) => s.laneBars)
  const setLaneBars = useUI((s) => s.setLaneBars)
  const locale = useI18n((s) => s.locale)
  const setLocale = useI18n((s) => s.setLocale)

  return (
    <>
      <section className="ce-stack" aria-label={t('theme.title')}>
        <p className="ce-hint">{t('theme.title')}</p>
        <div className="ce-theme-row" role="radiogroup" aria-label={t('theme.title')}>
          {THEMES.map((tm) => (
            <button
              key={tm.id}
              type="button"
              role="radio"
              aria-checked={theme === tm.id}
              className={`ce-theme-opt${theme === tm.id ? ' is-on' : ''}`}
              title={t(tm.hint)}
              onClick={() => setTheme(tm.id)}
            >
              <span className={`ce-theme-swatches is-${tm.id}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="ce-theme-name">{t(tm.label)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ce-stack" aria-label={t('theme.bars.title')}>
        <p className="ce-hint">{t('theme.bars.title')}</p>
        <div className="ce-switch-row">
          <button
            type="button"
            role="switch"
            aria-checked={laneBars}
            className={`ce-switch${laneBars ? ' is-on' : ''}`}
            title={t('theme.bars.hint')}
            onClick={() => setLaneBars(!laneBars)}
          >
            <span className="ce-switch-knob" aria-hidden="true" />
          </button>
          <span className="ce-switch-text">{laneBars ? t('theme.bars.shown') : t('theme.bars.hidden')}</span>
        </div>
      </section>

      <section className="ce-stack" aria-label={t('lang.title')}>
        <p className="ce-hint">{t('lang.title')}</p>
        <div className="ce-seg" role="radiogroup" aria-label={t('lang.title')}>
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={locale === l.id}
              className={`ce-seg-btn${locale === l.id ? ' is-on' : ''}`}
              onClick={() => setLocale(l.id)}
            >
              {t(l.labelKey)}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
