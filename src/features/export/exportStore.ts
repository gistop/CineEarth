// Export store — render/screenshot job status (idle → rendering → done/error).

import { create } from 'zustand'

export type ExportStatus = 'idle' | 'rendering' | 'error'

interface ExportState {
  status: ExportStatus
  /** 0..1 */
  progress: number
  error: string | null
  cancelRequested: boolean

  start: () => void
  setProgress: (p: number) => void
  cancel: () => void
  finish: (error?: string) => void
}

export const useExport = create<ExportState>((set) => ({
  status: 'idle',
  progress: 0,
  error: null,
  cancelRequested: false,

  start: () => set({ status: 'rendering', progress: 0, error: null, cancelRequested: false }),
  setProgress: (progress) => set({ progress: Math.min(1, Math.max(0, progress)) }),
  cancel: () => set({ cancelRequested: true }),
  finish: (error) =>
    set(
      error
        ? { status: 'error', error, cancelRequested: false }
        : { status: 'idle', progress: 0, error: null, cancelRequested: false },
    ),
}))
