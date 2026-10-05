/** One pasted image the band previews, keyed by the N of its `[Image #N]`. */
export type Thumb = {
  n: number
  status: 'loading' | 'ready' | 'failed'
  /** Absolute path of the PNG copy the terminal reads; null until ready. */
  path: string | null
  /** Pixel size of that copy; 0 until ready. */
  width: number
  height: number
  /** Bumped whenever the file under `path` is rewritten. */
  generation: number
}

declare module 'claude-code' {
  interface PluginState {
    'paste-peek': { thumbs: Thumb[]; isOff: boolean }
  }
}
