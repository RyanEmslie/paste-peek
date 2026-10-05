import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsStat, On, ProcessRunResult, PromptEditInput, PromptEditResult, RenderPropsOf } from 'claude-code'

import type { Thumb } from '../types'

const PLUGIN = 'paste-peek'
const CACHE = '/tmp/t/paste-peek/sess-1'
const CWD = '/Users/me/proj'
// Where Claude Code keeps its own copy of pasted image n for this session.
const engineCopy = (n: number) => `/tmp/claude-501/-Users-me-proj/sess-1/images/${n}.png`

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

type World = {
  /** Whether the clipboard holds image data (osascript PNGf succeeds). */
  hasClipboardImage?: boolean
  /** A Finder-copied file the clipboard references, if any. */
  furl?: string
  /** Files on disk that sips can convert, with their pixel size. */
  sources?: Record<string, { width: number; height: number }>
  /** Size of the image osascript writes from the clipboard. */
  clipboardSize?: { width: number; height: number }
  /** Paths `$.fs.stat` reports as regular files; every other stat rejects. */
  files?: string[]
  /** `mkdir -p` exits non-zero. */
  mkdirFails?: boolean
  /** `id -u` exits non-zero. */
  uidFails?: boolean
  /** `$.process.run` rejects for osascript (as on a timeout). */
  osascriptRejects?: boolean
  /** What `sips -g` prints in place of the size. */
  sizeOutput?: string
  /** osascript waits on this before answering. */
  gate?: Promise<void>
}

/**
 * Stands the engine and the machine beneath the plugin: a mocked clock and
 * env, a session id, a prompt box that applies each edit's splice, and a
 * process.run that fakes osascript, sips, mkdir and rm over an in-memory disk.
 */
function world(on: On, w: World = {}) {
  const clock = mock.clock(on)
  mock.env(on, { TMPDIR: '/tmp/t/', HOME: '/Users/me' })
  const runs: string[][] = []
  const disk = new Map<string, { width: number; height: number }>(Object.entries(w.sources ?? {}))
  const ok = (stdout = '', exitCode = 0): ProcessRunResult => ({
    exitCode,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  })

  const files = new Set(w.files ?? [])
  const stats: string[] = []
  const file: FsStat = { kind: 'file', size: 1024, mtimeMs: 0, isLink: false }
  // The prompt box as the engine holds it: what $.prompt.read answers, kept in
  // step with each edit and emptied by a submit.
  let box = { text: '', cursor: 0 }
  const setBox = (text: string) => {
    box = { text, cursor: text.length }
  }

  on('session.id', () => ({ value: 'sess-1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => {
    setBox('')
    return { text: e.text }
  })
  on('prompt.read', () => ({ value: { ...box } }))
  on('fs.stat', ($, e) => {
    stats.push(e.path)
    return files.has(e.path) ? { value: file } : { deny: `ENOENT: ${e.path}` }
  })
  // The engine's box: the splice applied; an image path pasted becomes the
  // next placeholder, as the engine attaches a dragged-in image.
  let nextImage = 1
  on('prompt.edit', ($, e) => {
    let input = e.inputText
    if (input.startsWith('[Image #')) {
      nextImage = Number(/\d+/.exec(input)?.[0]) + 1
    } else if (/^\/\S+\.png$/.test(input.trim())) {
      input = `[Image #${nextImage++}]`
    }
    const text = e.text.slice(0, e.start) + input + e.text.slice(e.end)
    setBox(text)

    return { text, cursor: e.start + input.length }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    if (argv[0] === 'osascript') {
      await w.gate
      if (w.osascriptRejects === true) {
        runs.push(argv)
        return { deny: 'the command did not finish in 10000 ms' }
      }
    }

    return { value: fake(argv) }
  })
  function fake(argv: string[]): ProcessRunResult {
    runs.push(argv)
    const [cmd] = argv
    const last = argv[argv.length - 1] ?? ''
    if (cmd === 'mkdir') {
      return w.mkdirFails === true ? ok('', 1) : ok()
    }
    if (cmd === 'id') {
      return w.uidFails === true ? ok('', 1) : ok('501\n')
    }
    if (cmd === 'rm') {
      disk.delete(last)
      return ok()
    }
    if (cmd === 'osascript') {
      const script = argv.join('\n')
      if (script.includes('PNGf')) {
        if (w.hasClipboardImage !== true) {
          return ok('', 1)
        }
        disk.set(last, w.clipboardSize ?? { width: 1440, height: 900 })
        return ok()
      }
      if (script.includes('furl')) {
        return w.furl === undefined ? ok('', 1) : ok(`${w.furl}\n`)
      }
    }
    if (cmd === 'sips') {
      if (argv[1] === '-s') {
        // sips -s format png src --out dest; exits 0 even on a missing source.
        const src = argv[4] ?? ''
        const size = disk.get(src)
        if (size !== undefined) {
          disk.set(last, size)
        }
        return ok()
      }
      if (argv[1] === '-g') {
        if (w.sizeOutput !== undefined) {
          return ok(w.sizeOutput)
        }
        const size = disk.get(last)
        return size === undefined ? ok('') : ok(`${last}\n  pixelWidth: ${size.width}\n  pixelHeight: ${size.height}\n`)
      }
      if (argv[1] === '-Z') {
        const max = Number(argv[2])
        const size = disk.get(last)
        if (size !== undefined) {
          const scale = max / Math.max(size.width, size.height)
          disk.set(last, { width: Math.round(size.width * scale), height: Math.round(size.height * scale) })
        }
        return ok()
      }
    }

    return ok('', 127)
  }

  return { clock, runs, stats, setBox }
}

const isClipboardRead = (argv: string[]) => argv[0] === 'osascript' && argv.join(' ').includes('PNGf')
const isConvert = (argv: string[]) => argv[0] === 'sips' && argv[1] === '-s'

async function start($: Engine) {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

// The kit serves prompt.edit on the test's $, though its prompt noun does not
// declare it (the editor raises it, no plugin calls it).
type PromptEditCall = (e: PromptEditInput) => Promise<PromptEditResult>

async function edit($: Engine, text: string, start: number, end: number, inputText: string) {
  const prompt = $.prompt as unknown as { edit: PromptEditCall }

  return prompt.edit({ origin: { kind: 'composer' }, text, cursor: start, start, end, inputText })
}

// Text takes no key, so the band's Texts are found by what they show.
// The test's $ has no state noun, so an inline plugin reads paste-peek's
// thumbs and answers them as a command's text.
const PROBE = {
  name: 'probe',
  register: (on: On) => {
    on('command.run', { command: 'probe-thumbs' }, async $ => {
      const { value } = await $.state.get({ plugin: 'paste-peek', key: 'thumbs' })

      return { text: JSON.stringify(value ?? []) }
    })
  },
}
const WITH_PROBE = { plugins: [PROBE] }

async function thumbsNow($: Engine): Promise<Thumb[]> {
  const r = await $.command.run({
    command: 'probe-thumbs',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

  return JSON.parse(r.text ?? '[]') as Thumb[]
}

function band($: Engine, props: Partial<RenderPropsOf['AbovePrompt']> = {}) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, ...props } })
}

describe('clipboard paste', () => {
  test('a pasted image shows loading, then its preview above the prompt', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { hasClipboardImage: true })

    const r = await edit($, 'look ', 5, 5, '[Image #1]')
    expect(r.text).toBe('look [Image #1]')
    expect(await thumbsNow($)).toEqual([
      { n: 1, status: 'loading', path: null, width: 0, height: 0, generation: 0 },
    ])
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: '…' })).toBeDefined()

    await clock.settle()
    const [thumb] = await thumbsNow($)
    // 1440x900 is shrunk to 600 on its longest side.
    expect(thumb).toMatchObject({ n: 1, status: 'ready', path: `${CACHE}/1.png`, width: 600, height: 375 })
    expect(runs.some(argv => argv[0] === 'osascript' && argv.join(' ').includes('PNGf'))).toBe(true)
    expect(runs.some(argv => argv[0] === 'sips' && argv[1] === '-Z')).toBe(true)

    const img = await ui.find({ key: 'img-1' })
    expect(img?.type).toBe('Image')
    expect(img?.props.source).toMatchObject({ file: `${CACHE}/1.png`, format: 'png' })
    expect(await ui.find({ type: 'Text', text: '[Image #1]' })).toBeDefined()
  })

  test('a small image is not enlarged', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { hasClipboardImage: true, clipboardSize: { width: 320, height: 200 } })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ status: 'ready', width: 320, height: 200 })
    expect(runs.some(argv => argv[0] === 'sips' && argv[1] === '-Z')).toBe(false)
  })

  test('no image on the clipboard and no file copied: no preview', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: false })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'failed', path: null })

    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: 'no preview' })).toBeDefined()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
  })

  test('a file copied in Finder is converted from its path', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, {
      hasClipboardImage: false,
      furl: '/Users/me/shot.png',
      sources: { '/Users/me/shot.png': { width: 500, height: 300 } },
    })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ status: 'ready', width: 500, height: 300 })
    expect(runs).toContainEqual(['sips', '-s', 'format', 'png', '/Users/me/shot.png', '--out', `${CACHE}/1.png`])
  })
})

describe('dragged-in path', () => {
  test('converts the pasted file with sips and never reads the clipboard', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { sources: { '/Users/me/a.png': { width: 800, height: 400 } } })

    const r = await edit($, '', 0, 0, '/Users/me/a.png')
    expect(r.text).toBe('[Image #1]')
    await clock.settle()

    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready', width: 600, height: 300 })
    expect(runs).toContainEqual(['sips', '-s', 'format', 'png', '/Users/me/a.png', '--out', `${CACHE}/1.png`])
    expect(runs.some(argv => argv[0] === 'osascript')).toBe(false)
  })

  test('a missing file fails rather than passing for a stale copy', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { sources: {} })

    await edit($, '', 0, 0, '/Users/me/gone.png')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ status: 'failed' })
  })
})

describe('keeping the band in step with the box', () => {
  test('deleting the placeholder removes its preview and the band defers', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    const r = await edit($, 'a ', 2, 2, '[Image #1]')
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(1)

    await edit($, r.text, 2, r.text.length, '')
    expect(await thumbsNow($)).toEqual([])

    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'band' })).toBeUndefined()
  })

  test('an edit with no placeholder change leaves the previews alone', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    const r = await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    const before = await thumbsNow($)
    await edit($, r.text, r.text.length, r.text.length, ' and more')
    expect(await thumbsNow($)).toEqual(before)
  })

  test('submitting the prompt clears the previews', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    const r = await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(1)

    await $.prompt.submit({ text: r.text, wait: false, origin: { kind: 'composer' } })
    expect(await thumbsNow($)).toEqual([])
  })
})

describe('/paste-peek', () => {
  test('turns previews off (clearing them) and back on', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })
    const run = () =>
      $.command.run({
        command: 'paste-peek',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 120 },
      })

    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    const r = await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(1)

    expect((await run()).text).toBe('Paste previews off.')
    expect(await thumbsNow($)).toEqual([])
    await edit($, r.text, r.text.length, r.text.length, '[Image #2]')
    await clock.settle()
    expect(await thumbsNow($)).toEqual([])

    expect((await run()).text).toBe('Paste previews on.')
    await edit($, '', 0, 0, '[Image #3]')
    expect((await thumbsNow($)).map(t => t.n)).toEqual([3])
  })
})

describe('where the band draws', () => {
  test('defers on the desktop surface and under a survey', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()

    const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect(await desktop.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await desktop.find({ type: 'Image' })).toBeUndefined()

    const survey = await band($, { hasSurvey: true })
    expect(await survey.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await survey.find({ type: 'Image' })).toBeUndefined()

    const plain = await band($)
    expect(await plain.find({ key: 'img-1' })).toBeDefined()
  })

  test('shows +N for the images that do not fit a narrow band', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    let text = ''
    for (const n of [1, 2, 3, 4, 5]) {
      text = (await edit($, text, text.length, text.length, `[Image #${n}]`)).text
    }
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(5)

    // 60 columns: two 24-wide thumbnails with their gap, then room for +N.
    const ui = await band($, { bodyColumns: 60 })
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: '+3' })).toBeDefined()
  })
})

describe('an image the engine inserts without an edit', () => {
  test('a placeholder already in the draft is captured on the next keystroke', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { hasClipboardImage: true })

    // Ctrl+V puts [Image #1] in the box without raising prompt.edit; the
    // next edit is a plain key whose draft already holds it.
    const r = await edit($, '[Image #1]', 10, 10, ' ')
    expect(r.text).toBe('[Image #1] ')
    expect((await thumbsNow($)).map(t => t.n)).toEqual([1])

    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready', path: `${CACHE}/1.png` })
    expect(runs.filter(isClipboardRead)).toHaveLength(1)
  })

  test('the poll finds a pasted image with no edit at all: loading, then ready', WITH_PROBE, async ($, on) => {
    let open = () => {}
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const { clock, setBox } = world(on, { hasClipboardImage: true, gate })
    await start($)

    setBox('[Image #1]')
    await clock.advance(250)
    await clock.settle()
    expect(await thumbsNow($)).toEqual([{ n: 1, status: 'loading', path: null, width: 0, height: 0, generation: 0 }])
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: '…' })).toBeDefined()

    open()
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready', path: `${CACHE}/1.png` })
    const img = await ui.find({ key: 'img-1' })
    expect(img?.type).toBe('Image')
  })

  test('an edit and the next poll seeing the same new image capture it once', WITH_PROBE, async ($, on) => {
    const { clock, runs, setBox } = world(on, { hasClipboardImage: true })
    await start($)

    setBox('[Image #1]')
    await Promise.all([edit($, '[Image #1]', 10, 10, ' '), clock.advance(250)])
    await clock.advance(1000)
    await clock.settle()

    expect((await thumbsNow($)).map(t => [t.n, t.status])).toEqual([[1, 'ready']])
    expect(runs.filter(isClipboardRead)).toHaveLength(1)
  })

  test('two syncs running at once claim a new image once', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { hasClipboardImage: true })

    // Two edits dispatched together interleave at their awaits, as a poll
    // and an edit can in a session: both read the thumbs before either writes.
    await Promise.all([edit($, '[Image #1]', 10, 10, ' '), edit($, '[Image #1]', 10, 10, 'x')])
    await clock.settle()

    expect((await thumbsNow($)).map(t => [t.n, t.status])).toEqual([[1, 'ready']])
    expect(runs.filter(isClipboardRead)).toHaveLength(1)
  })

  test('the poll drops the preview of a placeholder deleted from the box', WITH_PROBE, async ($, on) => {
    const { clock, setBox } = world(on, { hasClipboardImage: true })
    await start($)

    setBox('[Image #1]')
    await clock.advance(250)
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(1)

    setBox('')
    await clock.advance(250)
    await clock.settle()
    expect(await thumbsNow($)).toEqual([])
  })
})

describe("Claude Code's own copy of the image", () => {
  test('is converted from when present, and the clipboard is never read', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, {
      hasClipboardImage: true,
      files: [engineCopy(1)],
      sources: { [engineCopy(1)]: { width: 1200, height: 600 } },
    })
    await start($)

    await edit($, '[Image #1]', 10, 10, ' ')
    await clock.settle()

    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready', width: 600, height: 300 })
    expect(runs).toContainEqual(['sips', '-s', 'format', 'png', engineCopy(1), '--out', `${CACHE}/1.png`])
    expect(runs.some(argv => argv[0] === 'osascript')).toBe(false)
  })

  test('falls back to the clipboard when it is missing', WITH_PROBE, async ($, on) => {
    const { clock, runs, stats } = world(on, { hasClipboardImage: true })
    await start($)

    await edit($, '[Image #1]', 10, 10, ' ')
    await clock.settle()

    expect(stats).toContain(engineCopy(1))
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready' })
    expect(runs.filter(isClipboardRead)).toHaveLength(1)
  })

  test('a dragged-in path still wins over it', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, {
      files: [engineCopy(1)],
      sources: { '/Users/me/a.png': { width: 400, height: 200 }, [engineCopy(1)]: { width: 10, height: 10 } },
    })
    await start($)

    await edit($, '', 0, 0, '/Users/me/a.png')
    await clock.settle()

    expect((await thumbsNow($))[0]).toMatchObject({ status: 'ready', width: 400, height: 200 })
    expect(runs.filter(isConvert).map(argv => argv[4])).toEqual(['/Users/me/a.png'])
  })
})

describe('when a step fails', () => {
  test('a cache folder that cannot be made fails the preview', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true, mkdirFails: true })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'failed', path: null })
  })

  test('a command that rejects (a timeout) fails the preview and the edit still lands', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true, osascriptRejects: true })

    const r = await edit($, 'a', 1, 1, '[Image #1]')
    expect(r.text).toBe('a[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'failed' })

    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: 'no preview' })).toBeDefined()
  })

  test('a copy whose size sips cannot read fails the preview', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true, sizeOutput: 'Error: unrecognised image\n' })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'failed' })
  })

  test('without a uid the engine copy is skipped and the clipboard is read', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, {
      hasClipboardImage: true,
      uidFails: true,
      files: [engineCopy(1)],
      sources: { [engineCopy(1)]: { width: 10, height: 10 } },
    })
    await start($)

    await edit($, '[Image #1]', 10, 10, ' ')
    await clock.settle()

    expect((await thumbsNow($))[0]).toMatchObject({ n: 1, status: 'ready', width: 600, height: 375 })
    expect(runs.filter(isClipboardRead)).toHaveLength(1)
    expect(runs.some(argv => isConvert(argv) && (argv[4] ?? '').includes('/images/'))).toBe(false)
  })
})

describe('session and layout', () => {
  test('session.start clears the previews a reload finds', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect(await thumbsNow($)).toHaveLength(1)

    await start($)
    expect(await thumbsNow($)).toEqual([])
  })

  test('a short band limits the picture to its rows less two, and at least one', WITH_PROBE, async ($, on) => {
    const { clock } = world(on, { hasClipboardImage: true, clipboardSize: { width: 300, height: 900 } })

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()

    const short = await band($, { maxRows: 4 })
    const rows = (await short.find({ key: 'img-1' }))?.props.rows
    expect(rows).toBeGreaterThanOrEqual(1)
    expect(rows).toBeLessThanOrEqual(2)

    const tiny = await band($, { maxRows: 2 })
    expect((await tiny.find({ key: 'img-1' }))?.props.rows).toBe(1)
  })

  test('after a submit the same image number is captured afresh', WITH_PROBE, async ($, on) => {
    const { clock, runs } = world(on, { hasClipboardImage: true })

    const r = await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    await $.prompt.submit({ text: r.text, wait: false, origin: { kind: 'composer' } })
    expect(await thumbsNow($)).toEqual([])

    await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    expect((await thumbsNow($)).map(t => [t.n, t.status])).toEqual([[1, 'ready']])
    expect(runs.filter(isClipboardRead)).toHaveLength(2)
  })

  test('a submit while a capture still runs lets the same number be captured again', WITH_PROBE, async ($, on) => {
    let open = () => {}
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const { clock, runs } = world(on, { hasClipboardImage: true, gate })

    const r = await edit($, '', 0, 0, '[Image #1]')
    await clock.settle()
    await $.prompt.submit({ text: r.text, wait: false, origin: { kind: 'composer' } })

    // The first capture is still waiting on osascript; the next prompt's
    // [Image #1] is a new image all the same.
    await edit($, '', 0, 0, '[Image #1]')
    expect(await thumbsNow($)).toEqual([{ n: 1, status: 'loading', path: null, width: 0, height: 0, generation: 0 }])

    open()
    await clock.settle()
    expect((await thumbsNow($)).map(t => [t.n, t.status])).toEqual([[1, 'ready']])
    expect(runs.filter(isClipboardRead)).toHaveLength(2)
  })
})
