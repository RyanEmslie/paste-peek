import { describe, expect, test } from 'claude-code/testing'

import { addedPlaceholders, fitCount, pastedImagePaths, placeholderNumbers, thumbBox } from './placeholders'

describe('placeholderNumbers', () => {
  test('finds nothing in empty or plain text', async () => {
    expect(placeholderNumbers('')).toEqual([])
    expect(placeholderNumbers('fix the bug in the header')).toEqual([])
  })

  test('answers each N in order of appearance', async () => {
    expect(placeholderNumbers('see [Image #1] and [Image #2]')).toEqual([1, 2])
    expect(placeholderNumbers('[Image #3] before [Image #1]')).toEqual([3, 1])
  })

  test('answers a repeated N once, at its first place', async () => {
    expect(placeholderNumbers('[Image #2] [Image #1] [Image #2]')).toEqual([2, 1])
  })

  test('reads multi-digit Ns, adjacent placeholders and placeholders across lines', async () => {
    expect(placeholderNumbers('[Image #12][Image #345]')).toEqual([12, 345])
    expect(placeholderNumbers('one\n[Image #3]\ntwo')).toEqual([3])
  })

  test('skips anything that is not exactly [Image #N] with N positive', async () => {
    expect(placeholderNumbers('[Image #]')).toEqual([])
    expect(placeholderNumbers('[image #1]')).toEqual([])
    expect(placeholderNumbers('[Image 1]')).toEqual([])
    expect(placeholderNumbers('[Image #1 ]')).toEqual([])
    expect(placeholderNumbers('[Image #x]')).toEqual([])
    expect(placeholderNumbers('[Image #0]')).toEqual([])
    expect(placeholderNumbers('[Image #01]')).toEqual([])
    expect(placeholderNumbers('[Image #-1]')).toEqual([])
  })
})

describe('addedPlaceholders', () => {
  test('answers a placeholder pasted into an empty box', async () => {
    expect(addedPlaceholders('', '[Image #1]')).toEqual([1])
  })

  test('answers only the new placeholders, in the order they appear', async () => {
    expect(addedPlaceholders('[Image #1]', '[Image #1] [Image #2]')).toEqual([2])
    expect(addedPlaceholders('[Image #1]', '[Image #3] [Image #1] [Image #2]')).toEqual([3, 2])
  })

  test('answers nothing when a placeholder is removed or nothing changed', async () => {
    expect(addedPlaceholders('[Image #1] [Image #2]', '[Image #2]')).toEqual([])
    expect(addedPlaceholders('[Image #1]', '[Image #1] typed more')).toEqual([])
    expect(addedPlaceholders('', '')).toEqual([])
  })

  test('answers a placeholder that was deleted then pasted again', async () => {
    expect(addedPlaceholders('text', 'text [Image #4]')).toEqual([4])
  })
})

describe('pastedImagePaths', () => {
  test('finds nothing in empty text, plain text or a placeholder', async () => {
    expect(pastedImagePaths('')).toEqual([])
    expect(pastedImagePaths('   \n')).toEqual([])
    expect(pastedImagePaths('look at this')).toEqual([])
    expect(pastedImagePaths('[Image #1]')).toEqual([])
  })

  test('finds a plain absolute path', async () => {
    expect(pastedImagePaths('/Users/alex/Desktop/shot.png')).toEqual(['/Users/alex/Desktop/shot.png'])
  })

  test('unescapes backslash-escaped spaces', async () => {
    expect(pastedImagePaths('/Users/alex/Desktop/Screen\\ Shot\\ 2026-10-03\\ at\\ 9.41.02.png')).toEqual([
      '/Users/alex/Desktop/Screen Shot 2026-10-03 at 9.41.02.png',
    ])
  })

  test('strips single and double quotes', async () => {
    expect(pastedImagePaths("'/Users/alex/My Pics/a.JPG'")).toEqual(['/Users/alex/My Pics/a.JPG'])
    expect(pastedImagePaths('"/tmp/b c.jpeg"')).toEqual(['/tmp/b c.jpeg'])
  })

  test('finds several dragged-in files, in order', async () => {
    expect(pastedImagePaths('/a/one.png /b/two.webp')).toEqual(['/a/one.png', '/b/two.webp'])
    expect(pastedImagePaths("'/a/x y.gif' /b/Screen\\ Shot.png \"/c/z.tiff\"")).toEqual([
      '/a/x y.gif',
      '/b/Screen Shot.png',
      '/c/z.tiff',
    ])
  })

  test('keeps ~/ as written', async () => {
    expect(pastedImagePaths('~/Desktop/x.heic')).toEqual(['~/Desktop/x.heic'])
  })

  test('takes every listed extension in any case', async () => {
    const names = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tiff', 'PNG', 'JpEg', 'TIFF']
    for (const ext of names) {
      expect(pastedImagePaths(`/tmp/pic.${ext}`)).toEqual([`/tmp/pic.${ext}`])
    }
  })

  test('skips relative paths and ~user paths', async () => {
    expect(pastedImagePaths('shot.png')).toEqual([])
    expect(pastedImagePaths('./shot.png')).toEqual([])
    expect(pastedImagePaths('Desktop/shot.png')).toEqual([])
    expect(pastedImagePaths('~alex/shot.png')).toEqual([])
  })

  test('skips other file types and names that only contain an image extension', async () => {
    expect(pastedImagePaths('/tmp/notes.txt /tmp/a.pdf /tmp/b.bmp /tmp/c.svg')).toEqual([])
    expect(pastedImagePaths('/tmp/archive.png.zip')).toEqual([])
    expect(pastedImagePaths('/tmp/png')).toEqual([])
    expect(pastedImagePaths('/.png')).toEqual([])
    expect(pastedImagePaths('/tmp/')).toEqual([])
  })

  test('picks the paths out of surrounding text and whitespace', async () => {
    expect(pastedImagePaths('/tmp/a.png\n')).toEqual(['/tmp/a.png'])
    expect(pastedImagePaths("don't miss /tmp/a.png please")).toEqual(['/tmp/a.png'])
    expect(pastedImagePaths('compare\t/tmp/a.png\nwith /tmp/b.jpg')).toEqual(['/tmp/a.png', '/tmp/b.jpg'])
  })
})

describe('thumbBox', () => {
  test('fits a wide screenshot to the full width', async () => {
    expect(thumbBox(1920, 1080)).toEqual({ columns: 24, rows: 7 })
  })

  test('narrows a tall image when the rows hit the cap', async () => {
    expect(thumbBox(1080, 1920)).toEqual({ columns: 9, rows: 8 })
  })

  test('draws a square image twice as wide in cells as it is tall', async () => {
    expect(thumbBox(100, 100)).toEqual({ columns: 16, rows: 8 })
    expect(thumbBox(100, 100, 10, 8)).toEqual({ columns: 10, rows: 5 })
  })

  test('never goes below one cell either way', async () => {
    expect(thumbBox(4000, 100)).toEqual({ columns: 24, rows: 1 })
    expect(thumbBox(100, 4000)).toEqual({ columns: 1, rows: 8 })
  })

  test('answers maxColumns by half of maxRows for an unknown size', async () => {
    expect(thumbBox(0, 0)).toEqual({ columns: 24, rows: 4 })
    expect(thumbBox(0, 500)).toEqual({ columns: 24, rows: 4 })
    expect(thumbBox(500, 0)).toEqual({ columns: 24, rows: 4 })
    expect(thumbBox(0, 0, 30, 7)).toEqual({ columns: 30, rows: 3 })
    expect(thumbBox(0, 0, 30, 1)).toEqual({ columns: 30, rows: 1 })
  })

  test('respects custom caps', async () => {
    expect(thumbBox(1920, 1080, 40, 12)).toEqual({ columns: 40, rows: 11 })
    expect(thumbBox(800, 600, 10, 3)).toEqual({ columns: 8, rows: 3 })
  })

  test('uses 24 by 8 when no caps are given', async () => {
    expect(thumbBox(1440, 900)).toEqual(thumbBox(1440, 900, 24, 8))
  })

  test('keeps a cap below one at one cell', async () => {
    expect(thumbBox(1920, 1080, 0, 0)).toEqual({ columns: 1, rows: 1 })
  })
})

describe('fitCount', () => {
  test('answers 0 for no thumbnails', async () => {
    expect(fitCount(0, 100, 24)).toBe(0)
  })

  test('answers every thumbnail when they fit, gaps included', async () => {
    expect(fitCount(4, 200, 24)).toBe(4)
    expect(fitCount(10, 1000, 24)).toBe(10)
  })

  test('counts an exact fit as fitting', async () => {
    expect(fitCount(3, 76, 24)).toBe(3)
    expect(fitCount(2, 50, 24)).toBe(2)
  })

  test('leaves room for the +N cell when not all fit', async () => {
    expect(fitCount(3, 75, 24)).toBe(2)
    expect(fitCount(2, 49, 24)).toBe(1)
    expect(fitCount(5, 80, 24)).toBe(2)
    expect(fitCount(10, 133, 24)).toBe(4)
    expect(fitCount(10, 134, 24)).toBe(5)
  })

  test('answers at least one in a narrow or empty body', async () => {
    expect(fitCount(1, 10, 24)).toBe(1)
    expect(fitCount(3, 10, 24)).toBe(1)
    expect(fitCount(3, 0, 24)).toBe(1)
  })

  test('treats a thumbnail width below one as one', async () => {
    expect(fitCount(3, 7, 0)).toBe(3)
  })
})
