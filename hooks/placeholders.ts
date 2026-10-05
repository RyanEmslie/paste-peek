const PLACEHOLDER = /\[Image #([1-9]\d*)\]/g
const IMAGE_NAME = /[^/]\.(png|jpe?g|gif|webp|heic|tiff)$/i

/** The N of every `[Image #N]` in the text, in order of appearance, unique. */
export function placeholderNumbers(text: string): number[] {
  const seen: number[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    const n = Number(match[1])
    if (!seen.includes(n)) {
      seen.push(n)
    }
  }

  return seen
}

/** The Ns present in `after` but not in `before`. */
export function addedPlaceholders(before: string, after: string): number[] {
  const had = placeholderNumbers(before)

  return placeholderNumbers(after).filter(n => !had.includes(n))
}

/**
 * The absolute image paths in pasted text (a file dragged into the terminal):
 * `.png .jpg .jpeg .gif .webp .heic .tiff`, case-insensitive, unquoted with
 * backslash-escaped spaces, or wrapped in single or double quotes; `~/` kept
 * as written. Empty when there are none.
 */
export function pastedImagePaths(inputText: string): string[] {
  return words(inputText).filter(isImagePath)
}

function isImagePath(word: string): boolean {
  const isAbsolute = word.startsWith('/') || word.startsWith('~/')

  return isAbsolute && IMAGE_NAME.test(word)
}

// Splits as a shell would for a drag-in: whitespace separates, a backslash
// escapes the next character, and a quote opens only at the start of a word,
// so an apostrophe inside ordinary text stays literal.
function words(input: string): string[] {
  const out: string[] = []
  let word = ''
  let isInWord = false
  let quote: string | null = null

  for (let i = 0; i < input.length; i++) {
    const c = input[i] as string
    if (quote !== null) {
      if (c === quote) {
        quote = null
      } else {
        word += c
      }
      continue
    }
    if ((c === '"' || c === "'") && !isInWord) {
      quote = c
      isInWord = true
      continue
    }
    if (c === '\\' && i + 1 < input.length) {
      word += input[i + 1]
      i++
      isInWord = true
      continue
    }
    if (/\s/.test(c)) {
      if (isInWord) {
        out.push(word)
        word = ''
        isInWord = false
      }
      continue
    }
    word += c
    isInWord = true
  }
  if (isInWord) {
    out.push(word)
  }

  return out
}

/** How one thumbnail is sized in terminal cells. */
export type ThumbBox = { columns: number; rows: number }

/**
 * The cell box for an image of `width` x `height` pixels, `columns` wide at
 * most `maxColumns` (default 24) and `rows` at most `maxRows` (default 8),
 * keeping the aspect ratio given a cell twice as tall as wide; at least 1x1.
 * An unknown size (0) answers maxColumns x maxRows / 2.
 */
export function thumbBox(width: number, height: number, maxColumns = 24, maxRows = 8): ThumbBox {
  const columnCap = Math.max(1, Math.floor(maxColumns))
  const rowCap = Math.max(1, Math.floor(maxRows))
  if (!(width > 0) || !(height > 0)) {
    return { columns: columnCap, rows: Math.max(1, Math.floor(rowCap / 2)) }
  }

  let columns = columnCap
  let rows = (columns * height) / width / 2
  if (rows > rowCap) {
    rows = rowCap
    columns = (rows * 2 * width) / height
  }

  return { columns: clamp(Math.round(columns), 1, columnCap), rows: clamp(Math.round(rows), 1, rowCap) }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * How many thumbnails fit side by side in `bodyColumns`, each `thumbColumns`
 * wide with a 2-cell gap between, leaving room for a `+N` cell (4 columns)
 * when not all fit; at least 1 when count > 0.
 */
export function fitCount(count: number, bodyColumns: number, thumbColumns: number): number {
  if (!(count > 0)) {
    return 0
  }
  const step = Math.max(1, thumbColumns) + 2
  if (count * step - 2 <= bodyColumns) {
    return count
  }

  return clamp(Math.floor((bodyColumns - 4) / step), 1, count)
}
