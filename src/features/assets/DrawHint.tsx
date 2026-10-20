// Drawing-mode hint pill — floats above the timeline while a line is being
// drawn. Carries the finish / cancel affordances so touch users (no double-
// click, no Esc) can close a line, and echoes the live point count.

import { useT } from '../../i18n'
import { useDraw } from './drawStore'
import { CheckIcon, CloseIcon } from '../../components/Icons'

export default function DrawHint() {
  const t = useT()
  const drawing = useDraw((s) => s.drawing)
  const pointCount = useDraw((s) => s.pointCount)
  if (!drawing) return null

  return (
    <div className="ce-draw-hint" role="status">
      <span className="ce-draw-hint-text">{t('draw.hint')}</span>
      <span className="ce-draw-hint-pts">
        {pointCount} {t('draw.pts')}
      </span>
      <button
        type="button"
        className="ce-draw-hint-btn is-finish"
        disabled={pointCount < 2}
        title={t('draw.finish')}
        onClick={() => useDraw.getState().finishLine()}
      >
        <CheckIcon size={13} />
        <span>{t('draw.finish')}</span>
      </button>
      <button
        type="button"
        className="ce-draw-hint-btn"
        title={t('draw.cancel')}
        onClick={() => useDraw.getState().cancelLine()}
      >
        <CloseIcon size={12} />
        <span>{t('draw.cancel')}</span>
      </button>
    </div>
  )
}
