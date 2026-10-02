import { useUI } from '../store/ui'
import { ExpandIcon } from './Icons'

/** Fullscreen preview: all chrome hidden, only a quiet exit affordance. */
export default function PreviewBadge() {
  const setPreviewMode = useUI((s) => s.setPreviewMode)

  return (
    <button
      type="button"
      className="ce-preview-badge"
      onClick={() => setPreviewMode(false)}
      title="Exit preview (Esc)"
    >
      <ExpandIcon size={14} />
      <span>Exit preview</span>
      <kbd>Esc</kbd>
    </button>
  )
}
