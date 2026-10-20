// Line style panel — expands under a drawn-line row in the assets list
// (CTEarth's expandable layer-style pattern). Every knob applies live:
// state patch → assetStore, entity refresh → applyLineStyle.

import { useT } from '../../i18n'
import { useAssets, type LineSection, type SceneAsset } from './assetStore'
import { applyLineStyle } from './assetScene'

const SWATCHES = ['#f2b544', '#4c9aff', '#38618c', '#e05e5e', '#57ab4c', '#9c6ade', '#f4f5f7', '#2a2e33']

/** cross-section choices, in palette order — 'none' reverts to the flat line */
const SECTIONS: LineSection[] = ['none', 'circle', 'square', 'rectangle', 'ellipse', 'diamond', 'triangle']
const STRETCHED: LineSection[] = ['rectangle', 'ellipse']

export default function LineStylePanel({ asset }: { asset: SceneAsset }) {
  const t = useT()
  if (!asset.line) return null
  const s = asset.line.style
  const volumized = s.section !== 'none'
  const flatCls = volumized ? ' is-disabled' : ''

  const patch = (p: Partial<typeof s>) => {
    useAssets.getState().updateLineStyle(asset.id, p)
    applyLineStyle(asset.id)
  }

  return (
    <div className="ce-line-style" onClick={(e) => e.stopPropagation()}>
      {/* colour: preset swatches + native picker */}
      <div className="ce-line-style-row">
        <span className="ce-line-style-label">{t('assets.lineColor')}</span>
        <div className="ce-line-style-swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`ce-swatch${s.color.toLowerCase() === c.toLowerCase() ? ' is-active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`${t('assets.lineColor')} ${c}`}
              onClick={() => patch({ color: c })}
            />
          ))}
          <input
            type="color"
            className="ce-line-style-picker"
            value={s.color}
            aria-label={t('assets.lineColor')}
            onChange={(e) => patch({ color: e.target.value })}
          />
        </div>
      </div>

      {/* extrusion: flat line ↔ swept volume (circle/square/… cross-section) */}
      <div className="ce-line-style-row">
        <span className="ce-line-style-label">{t('assets.lineSection')}</span>
        <div className="ce-line-style-shapes">
          {SECTIONS.map((sec) => (
            <button
              key={sec}
              type="button"
              className={`ce-shape-btn ce-shape-${sec}${s.section === sec ? ' is-active' : ''}`}
              title={t(`assets.shape.${sec}`)}
              aria-label={t(`assets.shape.${sec}`)}
              aria-pressed={s.section === sec}
              onClick={() => patch({ section: sec })}
            >
              <span className="ce-shape-glyph" />
            </button>
          ))}
        </div>
      </div>

      {volumized && (
        <>
          {/* cross-section size */}
          <div className="ce-line-style-row">
            <span className="ce-line-style-label">{t('assets.sectionSize')}</span>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={s.sectionSize}
              aria-label={t('assets.sectionSize')}
              onChange={(e) => patch({ sectionSize: Number(e.target.value) })}
            />
            <span className="ce-line-style-val">{s.sectionSize} m</span>
          </div>

          {/* width : height ratio — rectangles & ellipses only */}
          {STRETCHED.includes(s.section) && (
            <div className="ce-line-style-row">
              <span className="ce-line-style-label">{t('assets.sectionAspect')}</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.5}
                value={s.sectionAspect}
                aria-label={t('assets.sectionAspect')}
                onChange={(e) => patch({ sectionAspect: Number(e.target.value) })}
              />
              <span className="ce-line-style-val">×{s.sectionAspect}</span>
            </div>
          )}

          {/* lift above the sampled ground */}
          <div className="ce-line-style-row">
            <span className="ce-line-style-label">{t('assets.lineLift')}</span>
            <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={s.lift}
              aria-label={t('assets.lineLift')}
              onChange={(e) => patch({ lift: Number(e.target.value) })}
            />
            <span className="ce-line-style-val">{s.lift} m</span>
          </div>
        </>
      )}

      {/* width — flat lines only (volumes size in metres above) */}
      <div className={`ce-line-style-row${flatCls}`}>
        <span className="ce-line-style-label">{t('assets.lineWidth')}</span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={s.width}
          disabled={volumized}
          aria-label={t('assets.lineWidth')}
          onChange={(e) => patch({ width: Number(e.target.value) })}
        />
        <span className="ce-line-style-val">{s.width}px</span>
      </div>

      {/* opacity */}
      <div className="ce-line-style-row">
        <span className="ce-line-style-label">{t('assets.lineOpacity')}</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={s.opacity}
          aria-label={t('assets.lineOpacity')}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
        />
        <span className="ce-line-style-val">{Math.round(s.opacity * 100)}%</span>
      </div>

      {/* dashed / clamp toggles — flat-line concepts */}
      <div className={`ce-line-style-row${flatCls}`}>
        <label className="ce-line-style-check">
          <input
            type="checkbox"
            checked={s.dashed}
            disabled={volumized}
            onChange={(e) => patch({ dashed: e.target.checked })}
          />
          <span>{t('assets.lineDashed')}</span>
        </label>
        <label className="ce-line-style-check">
          <input
            type="checkbox"
            checked={s.clamped}
            disabled={volumized}
            onChange={(e) => patch({ clamped: e.target.checked })}
          />
          <span>{t('assets.lineClamped')}</span>
        </label>
      </div>

      <div className="ce-line-style-meta">
        {asset.line.positions.length} {t('assets.vertices')}
      </div>
    </div>
  )
}
