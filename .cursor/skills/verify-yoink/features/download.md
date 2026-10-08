# Paste URL and download

Paste URL and download lets a user put a media URL on the main window, choose an output folder, start a download, watch progress, and find the finished file plus a history row.

## Sub-features

- `download-paste` accepts a URL in the main field or via document paste when focus is not in an input.
- `download-start` enables **Download** only when the URL and output folder are both non-empty.
- `download-progress` shows a **Downloads** card with Starting, Downloading, Done, or Error.
- `download-history-write` appends a history row when the job finishes or errors.
- `download-batch` starts one job per `http` line in batch mode.

## How to get to it (user POV)

- Open the main Yoink window (route `/`).
- Type or paste a URL into the field whose placeholder starts with `https://www.youtube.com/watch?v=`.
- Paste a URL while focus is outside an input or textarea.
- Choose **Batch mode** and put one URL per line.
- Choose **Download**.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- Isolated output folder is `/tmp/yoink-verify-<id>/Downloads`.
- `node scripts/fetch-ytdlp.mjs` has populated `electron/resources/` or `yt-dlp` is on `PATH`.
- Use only a public sample URL such as `https://www.youtube.com/watch?v=jNQXAC9IVRw`. Do not use private, age-gated, or cookie-gated URLs.

- **Fill URL.** Type the sample URL. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --placeholder "https://www.youtube.com/watch?v=…" --value "https://www.youtube.com/watch?v=jNQXAC9IVRw"`. The field holds that URL.
- **Wait for preview.** Wait up to 30s for metadata. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Me at the zoo" --timeout 30000`. The preview title appears, or the run records `Could not load video info` as unreachable if the host blocks YouTube.
- **Confirm output folder.** Read the output field. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs eval --js "document.querySelector('input[placeholder=\"C:\\\\Users\\\\you\\\\Downloads\"]').value"`. The value is the isolated Downloads path.
- **Start download.** Choose **Download**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Download" --exact`. A **Downloads** heading appears and a card shows Starting or Downloading.
- **Wait for Done.** Wait for completion. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Done" --timeout 120000`. The card status is Done, or Error with a visible message.
- **Confirm file.** List the isolated Downloads directory. A file matching the video title exists. The toast text starts with `Downloaded:`.
- **Confirm history.** Read history from disk. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs history-file`. The JSON array has one object whose `url` is the sample URL and whose `status` is `done`.
- **Batch entry.** Choose **Batch mode**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Batch mode"`. The heading `Batch / Queue` appears and the URL field is replaced by a textarea.
- **Proof.** Capture the Done card. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/download-done.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/download-done.ax.json`. Both artifacts show Yoink and Done.

## Gotchas

- **Download** stays disabled if Output Folder is empty. Isolated launch fills it from defaults. A window started without this helper may point at a real user Downloads folder. Abort rather than writing there.
- Metadata fetch waits 800 ms after the last URL change. Do not click **Download** during that debounce if you need the preview title.
- `npm run dev` without Electron cannot download. The renderer throws when `window.yoink` is missing.
- Linux fetch of yt-dlp does not bundle ffmpeg. Video remux and Audio (MP3) fail without ffmpeg on `PATH`. Record that as unreachable rather than changing product code.
- YouTube from a datacenter IP often fails. That is an unmet network precondition, not a passing skip.
- Cancel writes an Error card with `Cancelled` and still adds a history row.
