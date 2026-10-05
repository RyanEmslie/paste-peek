import { describe, expect, test } from 'claude-code/testing'

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

// What `sips -g pixelWidth -g pixelHeight` printed on macOS 15.
const SIPS_SIZE = '/tmp/x/1.png\n  pixelWidth: 1024\n  pixelHeight: 768\n'
// What it printed for a missing file: exit 0, no size.
const SIPS_MISSING = 'Warning: /tmp/x/nope.png not a valid file - skipping\n'

/** The AppleScript lines an osascript argv carries, and the arguments after them. */
function script(argv: string[]): { lines: string[]; args: string[] } {
  const lines: string[] = []
  let i = 1
  while (argv[i] === '-e') {
    lines.push(argv[i + 1] ?? '')
    i += 2
  }

  return { lines, args: argv.slice(i) }
}

describe('argv builders', () => {
  test('mkdir, rm, convert, shrink and size run the commands verified on macOS', () => {
    expect(mkdirArgv('/tmp/a b')).toEqual(['mkdir', '-p', '/tmp/a b'])
    expect(removeArgv('/tmp/a/1.png')).toEqual(['rm', '-f', '/tmp/a/1.png'])
    expect(convertArgv('/Users/me/Shot 1.jpg', '/tmp/a/1.png')).toEqual([
      'sips', '-s', 'format', 'png', '/Users/me/Shot 1.jpg', '--out', '/tmp/a/1.png',
    ])
    expect(shrinkArgv('/tmp/a/1.png', 480)).toEqual(['sips', '-Z', '480', '/tmp/a/1.png'])
    expect(sizeArgv('/tmp/a/1.png')).toEqual(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '/tmp/a/1.png'])
  })

  test('shrink defaults to DEFAULT_MAX_SIDE and keeps the side a whole positive number', () => {
    expect(DEFAULT_MAX_SIDE).toBe(600)
    expect(shrinkArgv('/p.png')).toEqual(['sips', '-Z', '600', '/p.png'])
    expect(shrinkArgv('/p.png', 299.6)[2]).toBe('300')
    expect(shrinkArgv('/p.png', 0)[2]).toBe('1')
  })

  test('the clipboard PNG script coerces to PNGf and takes dest as its one argument', () => {
    const argv = clipboardPngArgv('/tmp/a b/3.png')
    expect(argv[0]).toBe('osascript')
    const { lines, args } = script(argv)
    expect(args).toEqual(['/tmp/a b/3.png'])
    expect(lines[0]).toBe('on run argv')
    expect(lines[lines.length - 1]).toBe('end run')
    expect(lines).toContain('set png to the clipboard as «class PNGf»')
    // The clipboard is read before the file is opened, so no image leaves no file.
    const read = lines.indexOf('set png to the clipboard as «class PNGf»')
    const open = lines.findIndex(line => line.startsWith('set f to open for access'))
    expect(read).toBeLessThan(open)
    expect(lines.filter(line => line === 'close access f')).toHaveLength(2)
  })

  test('the clipboard file script refuses a clipboard holding no file URL', () => {
    const argv = clipboardFurlArgv()
    expect(argv[0]).toBe('osascript')
    const { lines, args } = script(argv)
    expect(args).toEqual([])
    expect(lines.some(line => line.includes('clipboard info for «class furl»') && line.includes('error'))).toBe(true)
    expect(lines).toContain('return POSIX path of (the clipboard as «class furl»)')
  })
})

describe('needsShrink', () => {
  test('only an image over maxSide on its longest side, since sips -Z also enlarges', () => {
    expect(needsShrink(1024, 768, 600)).toBe(true)
    expect(needsShrink(400, 900, 600)).toBe(true)
    expect(needsShrink(600, 600, 600)).toBe(false)
    expect(needsShrink(100, 100)).toBe(false)
    expect(needsShrink(601, 10)).toBe(true)
  })
})

describe('expandHome', () => {
  test('expands a leading ~/ and a bare ~', () => {
    expect(expandHome('~/Desktop/shot.png', '/Users/me')).toBe('/Users/me/Desktop/shot.png')
    expect(expandHome('~/a.png', '/Users/me/')).toBe('/Users/me/a.png')
    expect(expandHome('~', '/Users/me')).toBe('/Users/me')
  })

  test('leaves other paths, ~user and an unknown home as written', () => {
    expect(expandHome('/abs/shot.png', '/Users/me')).toBe('/abs/shot.png')
    expect(expandHome('~bob/shot.png', '/Users/me')).toBe('~bob/shot.png')
    expect(expandHome('a/~/b.png', '/Users/me')).toBe('a/~/b.png')
    expect(expandHome('~/a.png', undefined)).toBe('~/a.png')
    expect(expandHome('~/a.png', '')).toBe('~/a.png')
  })
})

describe('cacheDirPath', () => {
  test('one folder per session under TMPDIR, its trailing slash dropped', () => {
    expect(cacheDirPath('/var/folders/hq/x/T/', 'e2b1-77ef')).toBe('/var/folders/hq/x/T/paste-peek/e2b1-77ef')
    expect(cacheDirPath('/tmp/x', 'abc')).toBe('/tmp/x/paste-peek/abc')
  })

  test('falls back to /tmp when TMPDIR is missing, empty or only slashes', () => {
    expect(cacheDirPath(undefined, 'abc')).toBe('/tmp/paste-peek/abc')
    expect(cacheDirPath('', 'abc')).toBe('/tmp/paste-peek/abc')
    expect(cacheDirPath('/', 'abc')).toBe('/tmp/paste-peek/abc')
  })

  test('makes the session id one safe folder name', () => {
    expect(cacheDirPath('/t', '../../etc')).toBe('/t/paste-peek/.._.._etc')
    expect(cacheDirPath('/t', 'a b/c')).toBe('/t/paste-peek/a_b_c')
    expect(cacheDirPath('/t', '..')).toBe('/t/paste-peek/session')
    expect(cacheDirPath('/t', '')).toBe('/t/paste-peek/session')
  })
})

describe('uidArgv', () => {
  test('asks id for the uid', () => {
    expect(uidArgv()).toEqual(['id', '-u'])
  })
})

describe('engineImagePath', () => {
  test("names the file Claude Code writes for [Image #n]", () => {
    expect(engineImagePath('/tmp', '501\n', '/Users/alex/code', '1f0e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b', 2)).toBe(
      '/tmp/claude-501/-Users-alex-code/1f0e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b/images/2.png',
    )
  })

  test('turns every non-alphanumeric character of the cwd into a dash', () => {
    expect(engineImagePath('/tmp', '501', '/Users/me/my app.v2_x', 's', 10)).toBe(
      '/tmp/claude-501/-Users-me-my-app-v2-x/s/images/10.png',
    )
  })

  test('trims the uid as id printed it', () => {
    expect(engineImagePath('/tmp', '  0 \n', '/', 's', 1)).toBe('/tmp/claude-0/-/s/images/1.png')
  })
})

describe('parseSize', () => {
  test('reads the size sips printed', () => {
    expect(parseSize(SIPS_SIZE)).toEqual({ width: 1024, height: 768 })
  })

  test('null for a missing file, a half answer or a zero size', () => {
    expect(parseSize(SIPS_MISSING)).toBeNull()
    expect(parseSize('')).toBeNull()
    expect(parseSize('/x.png\n  pixelWidth: 10\n')).toBeNull()
    expect(parseSize('/x.png\n  pixelWidth: 0\n  pixelHeight: 10\n')).toBeNull()
  })
})

describe('parseFurl', () => {
  test('the absolute path osascript printed, its newline dropped', () => {
    expect(parseFurl('/Users/me/Desktop/Screenshot 2026-10-03 at 20.13.png\n')).toBe(
      '/Users/me/Desktop/Screenshot 2026-10-03 at 20.13.png',
    )
  })

  test('null for nothing, a relative path, the root or several lines', () => {
    expect(parseFurl('')).toBeNull()
    expect(parseFurl('\n')).toBeNull()
    expect(parseFurl('relative/a.png\n')).toBeNull()
    expect(parseFurl('/\n')).toBeNull()
    expect(parseFurl('/a.png\n/b.png\n')).toBeNull()
  })
})
