// Self-rolled i18n — deliberately no library (see en.ts for the contract).
// zustand-backed locale so every useT() component re-renders on switch;
// t() is the non-reactive twin for event handlers and module scope.
import { create } from 'zustand'
import { en, type I18nKey } from './en'
import { zh } from './zh'

export type Locale = 'en' | 'zh'
export type { I18nKey }

const DICTS = { en, zh } as const
const STORE_KEY = 'ce-locale'

function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (v === 'en' || v === 'zh') return v
  } catch {
    /* private mode — fall through to the default */
  }
  return 'en' /* product default, per decision — no browser-language sniffing */
}

interface I18nState {
  locale: Locale
  setLocale: (l: Locale) => void
}

export const useI18n = create<I18nState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORE_KEY, locale)
    } catch {
      /* ignore — next launch falls back to en */
    }
    document.documentElement.lang = locale
    set({ locale })
  },
}))

document.documentElement.lang = useI18n.getState().locale

/** non-reactive lookup — handlers, module scope, non-React code */
export function t(key: I18nKey): string {
  const dict = DICTS[useI18n.getState().locale] as Record<I18nKey, string>
  return dict[key] ?? en[key]
}

/** reactive hook for rendered text — re-renders on locale switch */
export function useT(): (key: I18nKey) => string {
  const locale = useI18n((s) => s.locale)
  return (key) => {
    const dict = DICTS[locale] as Record<I18nKey, string>
    return dict[key] ?? en[key]
  }
}
