import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Thumb } from '../types'
import type { Captured } from './capture'
import {
  cacheDirPath,
  clipboardFurlArgv,
  clipboardPngArgv,
  convertArgv,
  DEFAULT_MAX_SIDE,
  engineImagePath,
  expandHome,
  mkdirArgv,
  needsShrink,
  parseFurl,
  parseSize,
  removeArgv,
  shrinkArgv,
  sizeArgv,
  uidArgv,
} from './capture'
import { fitCount, pastedImagePaths, placeholderNumbers, thumbBox } from './placeholders'

const thumbs = atom({ plugin: 'paste-peek', key: 'thumbs' } as const, [] as Thumb[])
const isOff = atom({ plugin: 'paste-peek', key: 'isOff' } as const, false)

const THUMB_COLUMNS = 24
const THUMB_ROWS = 8
const POLL_MS = 250

// Module state a reload starts over: the session's cwd and the uid, which
// name Claude Code's own copy of a pasted image, and the Ns whose capture is
// scheduled or running, so the poll and an edit never capture one twice.
let cwd: string | null = null
let uid: string | null | undefined
let poller: Timer | null = null
const inFlight = new Set<number>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'paste-peek',
      description: 'Turn the previews of pasted images on or off',
    })
    await update($, thumbs, () => [])
    cwd = e.cwd
    inFlight.clear()
    // A Ctrl+V image paste fires no prompt.edit, so the box is read on a
    // timer for the preview to show without waiting for a keystroke.
    poller?.cancel()
    poller = $.clock.every(POLL_MS, () => void poll($))

    return next(e)
  })

  on('command.run', { command: 'paste-peek' }, async $ => {
    const off = !(await read($, isOff))
    await update($, isOff, () => off)
    if (off) {
      await update($, thumbs, () => [])
    }

    return { text: off ? 'Paste previews off.' : 'Paste previews on.' }
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    await sync($, r.text, e.inputText)

    return r
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, thumbs, () => [])
    inFlight.clear()

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const list = await read($, thumbs)
    if (list.length === 0 || (await read($, isOff))) {
      return next(e)
    }

    const { Box, Image, Text } = $.ui.resolve(e)
    const shown = fitCount(list.length, e.props.bodyColumns, THUMB_COLUMNS)
    const maxRows = Math.max(1, Math.min(THUMB_ROWS, e.props.maxRows - 2))

    return (
      <Box key="band" flexDirection="row" alignItems="flex-end">
        {list.slice(0, shown).map(t => {
          const box = thumbBox(t.width, t.height, THUMB_COLUMNS, maxRows)
          const name = `[Image #${t.n}]`

          return (
            <Box key={`thumb-${t.n}`} flexDirection="column" marginRight={2}>
              {t.status === 'ready' && t.path !== null ? (
                <Image
                  key={`img-${t.n}`}
                  source={{ file: t.path, format: 'png', generation: t.generation }}
                  columns={box.columns}
                  rows={box.rows}
                  alt={name}
                />
              ) : (
                <Box width={box.columns} height={box.rows} justifyContent="center" alignItems="center">
                  <Text key={`status-${t.n}`} dimColor>
                    {t.status === 'loading' ? '…' : 'no preview'}
                  </Text>
                </Box>
              )}
              <Text key={`label-${t.n}`} dimColor wrap="truncate">
                {name}
              </Text>
            </Box>
          )
        })}
        {shown < list.length && (
          <Text key="more" dimColor>
            +{list.length - shown}
          </Text>
        )}
      </Box>
    )
  })
}

function loading(n: number): Thumb {
  return { n, status: 'loading', path: null, width: 0, height: 0, generation: 0 }
}

async function poll($: EngineInterface) {
  try {
    const box = await $.prompt.read()
    await sync($, box.text, '')
  } catch {}
}

// Keeps the thumbs in step with the `[Image #N]`s in the box: drops the ones
// gone, adds a loading one for each new N and schedules its capture. Writes
// nothing when the set is unchanged, as the poll calls it four times a second.
async function sync($: EngineInterface, text: string, inputText: string) {
  if (await read($, isOff)) {
    return
  }

  const present = placeholderNumbers(text)
  const known = (await read($, thumbs)).map(t => t.n)
  const added = present.filter(n => !known.includes(n) && !inFlight.has(n))
  const isRemoved = known.some(n => !present.includes(n))
  if (added.length === 0 && !isRemoved) {
    return
  }
  // Claimed before the next await, so a sync running beside this one skips them.
  for (const n of added) {
    inFlight.add(n)
  }

  await update($, thumbs, list => [
    ...list.filter(t => present.includes(t.n)),
    ...added.map(n => loading(n)),
  ])
  if (added.length > 0) {
    const paths = pastedImagePaths(inputText)
    $.clock.after(0, () => void captureAll($, added, paths))
  }
}

async function captureAll($: EngineInterface, ns: number[], paths: string[]) {
  const dir = await cacheDir($)
  if (dir === null) {
    await update($, thumbs, list => list.map(t => (ns.includes(t.n) ? { ...t, status: 'failed' } : t)))
    for (const n of ns) {
      inFlight.delete(n)
    }
    return
  }

  for (const [i, n] of ns.entries()) {
    try {
      const dest = `${dir}/${n}.png`
      const got = await captureOne($, n, paths[i], dest)
      const generation = await $.clock.now()
      await update($, thumbs, list =>
        list.map(t => {
          if (t.n !== n) {
            return t
          }
          if (got === null) {
            return { ...t, status: 'failed' }
          }

          return { ...t, status: 'ready', path: got.path, width: got.width, height: got.height, generation }
        }),
      )
    } finally {
      inFlight.delete(n)
    }
  }
}

// The image behind `[Image #n]`, from the first source there is: a path
// dragged in, Claude Code's own copy of the paste, then the clipboard.
async function captureOne($: EngineInterface, n: number, src: string | undefined, dest: string): Promise<Captured | null> {
  if (src !== undefined) {
    return captureFile($, src, dest)
  }
  const own = await engineImage($, n)
  if (own !== null) {
    return captureFile($, own, dest)
  }

  return captureClipboard($, dest)
}

// The $.process.run calls behind capture.ts's argv builders; they live here
// because the engine follows $ only into functions of this file.

async function cacheDir($: EngineInterface): Promise<string | null> {
  try {
    const dir = cacheDirPath(await $.env.get('TMPDIR'), await $.session.id())
    const made = await $.process.run(mkdirArgv(dir))

    return made.exitCode === 0 ? dir : null
  } catch {
    return null
  }
}

async function userId($: EngineInterface): Promise<string | null> {
  if (uid === undefined) {
    try {
      const ran = await $.process.run(uidArgv())
      uid = ran.exitCode === 0 && ran.stdout.trim() !== '' ? ran.stdout.trim() : null
    } catch {
      uid = null
    }
  }

  return uid
}

async function engineImage($: EngineInterface, n: number): Promise<string | null> {
  try {
    const id = await userId($)
    if (id === null || cwd === null) {
      return null
    }
    const path = engineImagePath('/tmp', id, cwd, await $.session.id(), n)

    return (await $.fs.stat(path)).kind === 'file' ? path : null
  } catch {
    return null
  }
}

async function captureClipboard($: EngineInterface, dest: string): Promise<Captured | null> {
  try {
    await $.process.run(removeArgv(dest))
    const png = await $.process.run(clipboardPngArgv(dest), { timeoutMs: 10_000 })
    if (png.exitCode !== 0) {
      const furl = await $.process.run(clipboardFurlArgv(), { timeoutMs: 10_000 })
      const src = furl.exitCode === 0 ? parseFurl(furl.stdout) : null
      if (src === null) {
        return null
      }
      await $.process.run(convertArgv(expandHome(src, await $.env.get('HOME')), dest))
    }

    return await measure($, dest)
  } catch {
    return null
  }
}

async function captureFile($: EngineInterface, src: string, dest: string): Promise<Captured | null> {
  try {
    await $.process.run(removeArgv(dest))
    await $.process.run(convertArgv(expandHome(src, await $.env.get('HOME')), dest))

    return await measure($, dest)
  } catch {
    return null
  }
}

// sips exits 0 on a missing source, so reading the size back is the check
// that a copy was written.
async function measure($: EngineInterface, dest: string): Promise<Captured | null> {
  let size = parseSize((await $.process.run(sizeArgv(dest))).stdout)
  if (size !== null && needsShrink(size.width, size.height, DEFAULT_MAX_SIDE)) {
    await $.process.run(shrinkArgv(dest, DEFAULT_MAX_SIDE))
    size = parseSize((await $.process.run(sizeArgv(dest))).stdout)
  }

  return size === null ? null : { path: dest, ...size }
}
