// Offline frame-by-frame recorder — WebCodecs H.264 + mp4-muxer.
// Ported from CTEarth roamRecorder (proven pipeline):
//   advance path → wait tiles → scene.render() → VideoFrame(canvas)
//   → VideoEncoder → mp4-muxer → Blob → caller downloads .mp4
// Engine-agnostic: takes a canvas + callbacks, knows nothing of Cesium.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

export type RecordPath = {
  /** place camera at the starting pose */
  begin: () => void
  /** advance camera to progress ∈ [0,1] WITHOUT rendering */
  applyProgress: (progress: number) => void
  frameCount: number
  fps: number
}

export type RecordOptions = {
  canvas: HTMLCanvasElement
  /** target ENCODED size (px) — from the project 尺寸 setting. The canvas may
   *  differ (window size × DPR × quality scale): each frame is rescaled to
   *  fit, aspect-preserving and centred on black. In push layout the canvas
   *  ratio already equals this ratio (same source of truth), so it is a pure
   *  resize with no bars. Absent → encode at the canvas' own size (legacy). */
  outputSize?: { width: number; height: number }
  path: RecordPath
  waitTilesLoaded: () => Promise<void>
  renderFrame: () => void
  onProgress?: (frame: number, total: number) => void
  isCancelled?: () => boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

export function createStamp(): string {
  const n = new Date()
  return `${n.getFullYear()}${pad2(n.getMonth() + 1)}${pad2(n.getDate())}-${pad2(n.getHours())}${pad2(n.getMinutes())}${pad2(n.getSeconds())}`
}

function pickBitrate(w: number, h: number, fps: number): number {
  return Math.max(2_000_000, Math.round(w * h * fps * 0.12))
}

async function resolveAvcCodec(w: number, h: number, bitrate: number, fps: number): Promise<string> {
  const candidates = ['avc1.640028', 'avc1.4D001F', 'avc1.42E01E']
  for (const codec of candidates) {
    const support = await VideoEncoder.isConfigSupported({
      codec, width: w, height: h, bitrate, framerate: fps,
    }).catch(() => null)
    if (support?.supported) return codec
  }
  throw new Error('当前浏览器不支持 H.264 编码（需要 Chrome/Edge 的 WebCodecs）')
}

function waitForDequeue(encoder: VideoEncoder): Promise<void> {
  return new Promise<void>((resolve) => {
    const previous = encoder.ondequeue
    encoder.ondequeue = (event) => {
      previous?.call(encoder, event)
      resolve()
    }
  })
}

/** Render the path offline and return an MP4 blob. Callers must freeze map interaction meanwhile. */
export async function recordVideo(options: RecordOptions): Promise<Blob> {
  const { canvas, path, waitTilesLoaded, renderFrame, onProgress, isCancelled } = options

  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('当前浏览器不支持 WebCodecs，无法录制视频')
  }

  // H.264 needs even dimensions
  const out = options.outputSize
  const width = Math.floor((out?.width ?? canvas.width) / 2) * 2
  const height = Math.floor((out?.height ?? canvas.height) / 2) * 2
  if (width < 2 || height < 2) throw new Error('画布尺寸无效，无法录制')

  /* rescale stage — created only when the canvas isn't already the encode
     size (push layout usually lands exactly on it via the 尺寸 setting) */
  let frameSource: HTMLCanvasElement = canvas
  let fx: CanvasRenderingContext2D | null = null
  if (width !== canvas.width || height !== canvas.height) {
    frameSource = document.createElement('canvas')
    frameSource.width = width
    frameSource.height = height
    fx = frameSource.getContext('2d')
    if (!fx) throw new Error('无法创建缩放画布，无法录制')
    fx.fillStyle = '#000'
  }

  const fps = Math.max(1, Math.round(path.fps))
  const frameCount = Math.max(2, Math.round(path.frameCount))
  const bitrate = pickBitrate(width, height, fps)
  const codec = await resolveAvcCodec(width, height, bitrate, fps)

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' })

  let encodeError: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e },
  })
  encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' })

  const usPerFrame = 1_000_000 / fps
  let cancelled = false

  try {
    path.begin()
    await waitTilesLoaded()

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (isCancelled?.()) { cancelled = true; break }
      if (encodeError !== null) throw encodeError

      path.applyProgress(frame / (frameCount - 1))
      // wait per-frame: never bake blurry tiles into the video
      await waitTilesLoaded()
      renderFrame()
      onProgress?.(frame + 1, frameCount)

      if (fx) {
        /* aspect-preserving fit, centred on black — never stretch the frame.
           Push layout makes this stretch-to-fill (canvas ratio == output) */
        const s = Math.min(width / canvas.width, height / canvas.height)
        const dw = canvas.width * s
        const dh = canvas.height * s
        fx.fillRect(0, 0, width, height)
        fx.drawImage(canvas, (width - dw) / 2, (height - dh) / 2, dw, dh)
      }

      const videoFrame = new VideoFrame(frameSource, {
        timestamp: Math.round(frame * usPerFrame),
        duration: Math.round(usPerFrame),
      })
      encoder.encode(videoFrame, { keyFrame: frame % 60 === 0 })
      videoFrame.close()

      // backpressure: don't let the encode queue balloon
      if (encoder.encodeQueueSize > 8) await waitForDequeue(encoder)
      await sleep(0)
    }
  } finally {
    try { await encoder.flush() } catch { /* flush may fail after cancel */ }
    encoder.close()
    muxer.finalize()
  }

  if (encodeError !== null) throw encodeError
  if (cancelled) throw new DOMException('录制已取消', 'AbortError')

  return new Blob([target.buffer], { type: 'video/mp4' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
