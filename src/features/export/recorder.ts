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
  /** WARM-UP PASS: before encoding, walk the whole path once (progress
   *  applied + frame rendered + tiles awaited, nothing captured) so every
   *  tile along the route sits in the cache when the real pass runs — LOD
   *  seams and placeholder→refined swaps never reach the encoder. Recording
   *  is quality-over-wall-time, so the double walk is the cheap price. */
  warmup?: boolean
  onWarmup?: (progress: number) => void
  onProgress?: (frame: number, total: number) => void
  isCancelled?: () => boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** floor between the park render and the capture render: even with every
 *  tile already cached (tilesLoaded true immediately) the geometry Web
 *  Workers still need a beat to return the rebuilt volume/polyline — quality
 *  over wall time, so pay it unconditionally. */
const GEOMETRY_SETTLE_MS = 150

/** backpressure ceiling: never wait on a dead encoder's dequeue forever */
const DEQUEUE_TIMEOUT_MS = 4000

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

type AvcAttempt = {
  label: string
  config: VideoEncoderConfig
}

/** probe an encode configuration; software probing never falls through so
 *  the caller can use it as the last-resort retry path */
async function resolveAvcAttempt(
  w: number,
  h: number,
  bitrate: number,
  fps: number,
  hardware: boolean,
): Promise<AvcAttempt> {
  const candidates = ['avc1.640028', 'avc1.4D001F', 'avc1.42E01E']
  const base = {
    width: w,
    height: h,
    bitrate,
    framerate: fps,
    latencyMode: 'quality' as const,
    hardwareAcceleration: (hardware ? 'prefer-hardware' : 'prefer-software') as
      | 'prefer-hardware'
      | 'prefer-software',
  }
  for (const codec of candidates) {
    const config: VideoEncoderConfig = { codec, ...base }
    const support = await VideoEncoder.isConfigSupported(config).catch(() => null)
    if (support?.supported) return { label: hardware ? 'hardware' : 'software', config }
  }
  if (hardware) return resolveAvcAttempt(w, h, bitrate, fps, false)
  throw new Error('当前浏览器不支持 H.264 编码（需要 Chrome/Edge 的 WebCodecs）')
}

async function waitForDequeue(encoder: VideoEncoder): Promise<void> {
  /* an encoder that just died never fires ondequeue — race a timeout so the
     loop reaches the error check instead of hanging forever */
  await Promise.race([
    new Promise<void>((resolve) => {
      encoder.ondequeue = () => resolve()
    }),
    sleep(DEQUEUE_TIMEOUT_MS),
  ])
  encoder.ondequeue = null
}

/** Render the path offline and return an MP4 blob. Callers must freeze map interaction meanwhile. */
export async function recordVideo(options: RecordOptions): Promise<Blob> {
  const { canvas, path, waitTilesLoaded, renderFrame, onWarmup, onProgress, isCancelled } = options

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
  const usPerFrame = 1_000_000 / fps
  let cancelled = false

  /* ---- ONE encode attempt: muxer + encoder + the frame loop. Runs up to
     twice — the hardware path first, and a mid-render hardware crash (the
     8.7s 'close on VideoEncoder' failure) retries once on the far more
     stable software encoder. After the warm-up pass every tile is cached,
     so the retry walk is quick. */
  const runEncodePass = async (attempt: AvcAttempt, withWarmup: boolean): Promise<Blob> => {
    const target = new ArrayBufferTarget()
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' })
    let encoderError: unknown = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addVideoChunk(chunk, meta)
        } catch (err) {
          encoderError = encoderError ?? err
        }
      },
      error: (e) => {
        encoderError = encoderError ?? e
        console.error(`[CineEarth] 视频编码器出错（${attempt.label}）`, e)
      },
    })
    encoder.configure(attempt.config)

    try {
      path.begin()
      await waitTilesLoaded()

      /* warm-up walk: park the camera at every frame position and let the
         tiles load. Nothing is captured — this pass only fills the cache so
         the encode pass meets warm tiles and never bakes a placeholder. */
      if (withWarmup && options.warmup) {
        for (let frame = 0; frame < frameCount; frame += 1) {
          if (isCancelled?.()) { cancelled = true; break }
          if (encoderError !== null) break
          path.applyProgress(frame / (frameCount - 1))
          renderFrame()
          await waitTilesLoaded()
          onWarmup?.((frame + 1) / frameCount)
        }
      }

      for (let frame = 0; frame < frameCount; frame += 1) {
        if (isCancelled?.()) { cancelled = true; break }
        if (encoderError !== null) throw encoderError

        path.applyProgress(frame / (frameCount - 1))
        /* PARK render: this pass dispatches the async work — dynamic geometry
           rebuilds (the growth line's volume re-triangulates in a Web Worker)
           and any straggler tile loads. The captured frame is the NEXT render,
           after the workers have landed. A single render captured the stale
           geometry, and the worker's finish time varied against the tile
           queue — frame-to-frame lag jitter read as FLICKER. */
        renderFrame()
        await waitTilesLoaded()
        await sleep(GEOMETRY_SETTLE_MS)
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
        try {
          encoder.encode(videoFrame, { keyFrame: frame % 60 === 0 })
        } finally {
          /* ALWAYS close: if encode() throws (the encoder just died), a
             leaked VideoFrame drains GPU memory and logs "garbage collected
             without being closed" */
          videoFrame.close()
        }

        // backpressure: don't let the encode queue balloon
        if (encoder.encodeQueueSize > 8) await waitForDequeue(encoder)
        await sleep(0)
      }
    } finally {
      /* teardown must NEVER mask the real failure. An errored encoder is
         already 'closed' by the platform: flush() would reject and — on
         some Chrome versions — close() racing that rejection throws the
         InvalidStateError that used to REPLACE the encoder's true error. */
      if (encoder.state !== 'closed') {
        try {
          if (encoderError === null) await encoder.flush()
        } catch { /* flush can fail after a cancel — nothing to save */ }
        try { encoder.close() } catch { /* guarded, never mask */ }
      }
      try { muxer.finalize() } catch { /* only meaningful on the success path */ }
    }

    if (encoderError !== null) throw encoderError
    if (cancelled) throw new DOMException('录制已取消', 'AbortError')

    return new Blob([target.buffer], { type: 'video/mp4' })
  }

  const hardware = await resolveAvcAttempt(width, height, bitrate, fps, true)
  try {
    return await runEncodePass(hardware, true)
  } catch (err) {
    /* user cancels are final — no retry. Any other failure on the hardware
       path gets exactly ONE software retry (stability over speed; recording
       is quality-over-wall-time anyway) */
    if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) throw err
    console.warn('[CineEarth] 硬件编码失败，自动改用软件编码重试', err)
    const software = await resolveAvcAttempt(width, height, bitrate, fps, false)
    return await runEncodePass(software, false)
  }
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
