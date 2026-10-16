# Trim, cut, and audio clipper

The editors let a user open a downloaded file, mark in and out points (or several kept ranges), and write a new file with ffmpeg.

## Sub-features

- `editor-trim` opens `/edit` (heading **Trim**) for a single in/out cut.
- `editor-cut` opens `/cut` (heading **Multi-cut**) for several kept ranges.
- `editor-audio` opens `/audio` (heading **Audio Clipper**) for an audio extract.
- `editor-pick` lists completed history rows under **Pick a file**.
- `editor-save` writes an output file and shows **Saved to** plus **Open folder**.

## How to get to it (user POV)

- From a successful history row, choose **Edit** (video goes to `/edit`, audio to `/audio`).
- Open `/edit`, `/cut`, or `/audio` directly in the Yoink window.
- From Trim, choose **Multi-cut →** or **Audio clipper →**.
- From each editor, choose **← Yoink** to return to the main window.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- A download proof has a done history row with a `filePath` under the isolated Downloads directory.
- `ffmpeg` is available to the Electron process. On Linux that usually means `ffmpeg` on `PATH`, because `scripts/fetch-ytdlp.mjs` skips ffmpeg on non-Windows hosts.

- **Open history.** Choose **History**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "History" --exact`.
- **Open trim.** Choose **Edit** on a video row. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Edit"`. The heading **Trim** appears. **Pick a file** lists the completed title.
- **Load from picker.** If the player is empty, click the history title in **Pick a file**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "<title from history>"`. The file path line is non-empty.
- **Set in and out.** Click **Set in [I]** then **Set out [O]** after seeking. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Set in [I]"` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Set out [O]"`. Both controls show timestamps.
- **Trim.** Choose **Trim**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Trim" --exact`. Wait with `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Saved to" --timeout 60000`. A new file exists next to the source under the isolated directory.
- **Multi-cut entry.** Choose **Multi-cut →**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Multi-cut →"`. The heading is **Multi-cut**. The save control is **Render cut**.
- **Audio entry.** Choose **Audio clipper →**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Audio clipper →"`. The heading is **Audio Clipper**. The save control is **Export**.
- **Proof.** Capture Trim with a loaded file. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/trim.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/trim.ax.json`. The artifacts show **Trim** and the source title.

## Gotchas

- These pages are not reachable in a useful way without a completed download. Empty history shows `No completed downloads in history.` That empty state is not a trim proof.
- Keyboard I, O, Space, and arrows do nothing while an input is focused.
- Missing ffmpeg fails the save with a red **Error:** line. Record unreachable on Linux if ffmpeg is absent.
- The `file` query carries an absolute path. Only open files under the isolated Downloads directory.
- Do not prove editors by calling `window.yoink.trim` from `eval`. Click the page controls.
