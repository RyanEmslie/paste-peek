// Pure argv builders and output parsers for copying a pasted image to a PNG
// the terminal can read. The `$.process.run` calls live in register.tsx: the
// engine follows `$` only into functions of the same file.
//
// The order that works (each step's argv from here):
//   removeArgv(dest)                      sips exits 0 on a missing source, so
//                                         no stale copy may pass for this one
//   clipboardPngArgv(dest)                exit 0: dest written; else no image
//     else clipboardFurlArgv()            parseFurl(stdout): a Finder copy
//       then convertArgv(src, dest)       src from expandHome(path, HOME)
//   sizeArgv(dest) -> parseSize(stdout)   null: nothing usable was written
//   needsShrink(...) ? shrinkArgv(dest, maxSide), then sizeArgv again
//
// Before the clipboard, register.tsx tries Claude Code's own copy of the
// image, engineImagePath(...) with the uid from uidArgv(), through convertArgv.

/** A PNG copy of a pasted image, written where the terminal can read it. */
export type Captured = { path: string; width: number; height: number }

export const DEFAULT_MAX_SIDE = 600

/** `mkdir -p dir`. */
export function mkdirArgv(dir: string): string[] {
  return ['mkdir', '-p', dir]
}

/** `rm -f path`. */
export function removeArgv(path: string): string[] {
  return ['rm', '-f', path]
}

/**
 * osascript writing the clipboard's image (a TIFF coerces) to `dest` as PNG;
 * exits non-zero, leaving no file, when the clipboard holds none.
 */
export function clipboardPngArgv(dest: string): string[] {
  return osascript(
    [
      'on run argv',
      'set dest to item 1 of argv',
      'set png to the clipboard as «class PNGf»',
      'set f to open for access (POSIX file dest) with write permission',
      'try',
      'set eof f to 0',
      'write png to f',
      'close access f',
      'on error m number n',
      'close access f',
      'error m number n',
      'end try',
      'end run',
    ],
    [dest],
  )
}

/**
 * osascript printing the POSIX path of a file copied in Finder; exits
 * non-zero when the clipboard holds no file.
 */
export function clipboardFurlArgv(): string[] {
  // Plain text coerces to a file URL too ("notes" reads as "/notes"), so the
  // clipboard must actually hold one.
  return osascript([
    'on run argv',
    'if (clipboard info for «class furl») is {} then error "no file on the clipboard" number -1700',
    'return POSIX path of (the clipboard as «class furl»)',
    'end run',
  ])
}

/** `sips` converting `src` to a PNG at `dest`. */
export function convertArgv(src: string, dest: string): string[] {
  return ['sips', '-s', 'format', 'png', src, '--out', dest]
}

/** `sips -Z`, in place; it enlarges a smaller image too, so see needsShrink. */
export function shrinkArgv(path: string, maxSide: number = DEFAULT_MAX_SIDE): string[] {
  return ['sips', '-Z', String(Math.max(1, Math.round(maxSide))), path]
}

/** `sips` printing the pixel size, for parseSize. */
export function sizeArgv(path: string): string[] {
  return ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path]
}

/** Whether an image this size is over `maxSide` on its longest side. */
export function needsShrink(width: number, height: number, maxSide: number = DEFAULT_MAX_SIDE): boolean {
  return Math.max(width, height) > maxSide
}

/** `~` or `~/x` under `home`; any other path, or no home, as written. */
export function expandHome(path: string, home: string | undefined): string {
  if (home === undefined || home === '' || (path !== '~' && !path.startsWith('~/'))) {
    return path
  }

  return (home.replace(/\/+$/, '') || '/') + path.slice(1)
}

/**
 * `<tmpdir>/paste-peek/<session>`: `/tmp` for a missing tmpdir, the session id
 * made one safe folder name.
 */
export function cacheDirPath(tmpdir: string | undefined, sessionId: string): string {
  const tmp = (tmpdir ?? '').replace(/\/+$/, '') || '/tmp'
  const name = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
  const folder = name === '' || name === '.' || name === '..' ? 'session' : name

  return `${tmp}/paste-peek/${folder}`
}

/** `id -u`, the uid in the folder Claude Code keeps a session's files under. */
export function uidArgv(): string[] {
  return ['id', '-u']
}

/**
 * Where Claude Code itself writes the image behind `[Image #n]` the moment it
 * is pasted: `<tmpRoot>/claude-<uid>/<cwd, each non-alphanumeric a dash>/
 * <session>/images/<n>.png`. Undocumented, so a capture falls back to the
 * clipboard when nothing is there.
 */
export function engineImagePath(tmpRoot: string, uid: string, cwd: string, sessionId: string, n: number): string {
  return `${tmpRoot}/claude-${uid.trim()}/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}/images/${n}.png`
}

/** The size sizeArgv printed; null when it printed none (a missing file). */
export function parseSize(stdout: string): { width: number; height: number } | null {
  const width = /pixelWidth:\s*(\d+)/.exec(stdout)?.[1]
  const height = /pixelHeight:\s*(\d+)/.exec(stdout)?.[1]
  if (width === undefined || height === undefined) {
    return null
  }
  const size = { width: Number(width), height: Number(height) }

  return size.width > 0 && size.height > 0 ? size : null
}

/** The absolute path clipboardFurlArgv printed; null for anything else. */
export function parseFurl(stdout: string): string | null {
  const path = stdout.replace(/[\r\n]+$/, '')

  return path.startsWith('/') && !path.includes('\n') && path.length > 1 ? path : null
}

function osascript(lines: readonly string[], args: readonly string[] = []): string[] {
  return ['osascript', ...lines.flatMap(line => ['-e', line]), ...args]
}
