# Format picker

Format picker lets a user choose Video or Audio (MP3), a quality cap, and (after metadata loads) a specific yt-dlp format before starting a download.

## Sub-features

- `format-mode` switches Mode between Video and Audio (MP3).
- `format-quality` lists Best available, 1080p, 720p, 480p, and 360p while Mode is Video.
- `format-list` shows a Format select after `getFormats` returns rows.
- `format-auto` keeps `Best quality (auto)` as the default option.

## How to get to it (user POV)

- Stay on the main window with Batch mode off.
- Choose **Video** or **Audio (MP3)** under **Mode**.
- Choose a value under **Quality** when Mode is Video.
- After a URL preview loads, choose a row under **Format**.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- Batch mode is off. The main URL field is visible.
- A public sample URL can resolve. If info fails, stop and report unreachable.

- **Enter URL.** Fill the sample URL. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "URL" --value "https://www.youtube.com/watch?v=jNQXAC9IVRw"`.
- **Wait for Format.** Wait for the Format label. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Best quality (auto)" --timeout 30000`. The Format select is visible.
- **Select auto.** Confirm the default option. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs eval --js "document.querySelector('select').options[0].textContent"`. The first option is `Best quality (auto)`.
- **Switch to audio.** Choose **Audio (MP3)**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Audio (MP3)"`. Quality disappears. Mode stays Audio (MP3).
- **Switch to video.** Choose **Video**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Video" --exact`. Quality returns with `Best available`.
- **Proof.** Capture the Format select. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/format-picker.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/format-picker.ax.json`. The artifacts show Format and `Best quality (auto)`.

## Gotchas

- Format does not render until formats load. An invalid URL shows `Could not load video info` and no Format select. A site bot-check or `LOGIN_REQUIRED` is an environment limit; do not treat that skip as proof of the Format dropdown.
- Clicking **Video** can match the heading in history rows that contain the word video. Use `--exact` on the main window.
- Audio (MP3) needs ffmpeg. Proving a completed audio download is a download-feature concern, not this picker.
- Changing the URL resets the selected format to auto.
