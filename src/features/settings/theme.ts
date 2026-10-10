/** UI theme registry — backs the 界面主题 setting in the Props tab.
 *
 * A theme is STYLE-ONLY: it re-skins the chrome via the --ce-* design tokens
 * and never touches scene, route or timeline state. Adding one is exactly two
 * steps — append it to THEMES and add its token block to tokens.css; every
 * themed rule in ui.css keys off [data-theme='<id>'] on <html>.
 *
 * The family is "黑白 + accent": one shared near-black skeleton, the accent
 * being the only thing that changes between members. The original light
 * Nordic palette still lives in tokens.css :root, currently not exposed.
 */

export type ThemeId = 'bw' | 'bwo' | 'bwb'

export type ThemeDef = {
  id: ThemeId
  label: string
  hint: string
}

/** startup default — the black+orange studio look */
export const DEFAULT_THEME: ThemeId = 'bwo'

/** the options shown in the Props tab — order is display order */
export const THEMES: ThemeDef[] = [
  {
    id: 'bw',
    label: '黑白',
    hint: '近黑底 + 微白字（Linear 风）— 界面退成灰阶，颜色留给地图与数据',
  },
  {
    id: 'bwo',
    label: '黑白橙',
    hint: '近黑底 + 微白字 + 橙强调 — 橙只标“当前”（播放头/选中/关键帧），其余灰阶',
  },
  {
    id: 'bwb',
    label: '黑白蓝',
    hint: '近黑底 + 微白字 + 蓝强调（QGIS/ArcGIS 暗色观感）— 蓝与水体、阴影同色域，叠分类 mask 前留意',
  },
]

const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

/* v2 — bumped when 黑白橙 took over as the default, so machines holding an
 * older persisted pick get the new default once; later choices persist again.
 * The retired 'classic' id simply fails validation and falls back. */
const STORAGE_KEY = 'ce-theme.v2'

/** boot value: the persisted choice when it parses (a stale value can only
 *  ever fall back — theme carries no functional state, so nothing to break) */
export function loadTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(v)) return v
  } catch {
    /* storage unavailable (private mode…) — default theme */
  }
  return DEFAULT_THEME
}

/** paint + persist. One data-theme attribute on <html> is the entire switch:
 *  tokens.css re-declares the palette under [data-theme='bw'/'bwo'/'bwb']. */
export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore — theme just won't survive a reload */
  }
}
