# paste-peek

A Claude Code mod that shows a small preview of each image you paste into the prompt.

When you paste a screenshot, Claude Code only puts a placeholder like `[Image #1]` in the prompt box. paste-peek draws a thumbnail of that image just above the prompt, so you can see what you're about to send. The preview goes away when you delete the placeholder or submit the prompt.

## Requirements

- **macOS.** The mod copies images with `osascript` and resizes them with `sips`, both built into macOS.
- **A terminal that can draw images** with the kitty graphics protocol, such as Ghostty or kitty. Other terminals show the placeholder name as text instead of the picture. Inside tmux, previews also fall back to text.
- **A Claude Code build with function-hook mods.** This API is early access and may change between releases. paste-peek was built and tested against Claude Code 2.1.289.

## Install

Clone the repository:

```sh
git clone <repo-url> ~/code/paste-peek
```

Then load it in one of two ways:

- **For one session:** `claude --plugin-dir ~/code/paste-peek`
- **For every session:** add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Separate several folders with `:`.

  ```json
  {
    "env": {
      "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/code/paste-peek"
    }
  }
  ```

## Usage

Paste an image with Ctrl+V as usual. A thumbnail labelled `[Image #N]` appears above the prompt within about a quarter of a second.

- **Delete a placeholder** and its thumbnail disappears.
- **Submit the prompt** and all thumbnails clear.
- **`/paste-peek`** turns previews off or back on.

If there are more images than fit across the terminal, the row ends in `+N`.

## How it works

- **Spotting pastes.** Claude Code doesn't report image pastes as prompt edits. So the mod reads the prompt box every 250 ms, and also on every edit, and compares the `[Image #N]` placeholders against the ones it's already showing.
- **Finding the image.** For each new placeholder, the mod tries these sources in order:
  1. a file path you dragged into the prompt
  2. the copy Claude Code saves when you paste, at `/tmp/claude-<uid>/<project>/<session>/images/N.png`
  3. the clipboard, or the file a Finder copy refers to
- **Making the thumbnail.** The image is converted to PNG and shrunk so its longest side is at most 600 pixels. The copy goes in `$TMPDIR/paste-peek/<session>/`, and the terminal reads it from there directly.

## Limitations

- **Undocumented file location.** The location of Claude Code's own copy of a pasted image isn't documented, and a future release could move it. If it does, the mod falls back to the clipboard. In that case, recalling an old prompt from history previews whatever is on the clipboard now, not the original image.
- **Terminal only.** The desktop app and IDE extensions don't draw the image element this mod uses, so it does nothing there.

## Development

```sh
claude plugin validate .   # what the engine will load, and anything it would refuse
claude plugin test .       # the unit and hook tests in hooks/*.test.ts(x)
npx -p typescript tsc -p . --noEmit
```

Claude Code writes the type declarations into `.claude-plugin/types/` each time it loads the mod, so run the mod once before type-checking. That folder is git-ignored.

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | The hooks, the thumbnail row, and the commands that copy each image |
| `hooks/capture.ts` | Pure helpers that build the `osascript`/`sips` commands and parse their output |
| `hooks/placeholders.ts` | Finding `[Image #N]` placeholders and image paths, and sizing thumbnails |
| `types/index.d.ts` | The state the mod keeps |

## License

[MIT](LICENSE)
