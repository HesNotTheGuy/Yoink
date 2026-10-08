---
name: verify-yoink
description: "Drives the Yoink Electron desktop app (Next.js renderer plus yt-dlp via child_process) through control-yoink and Chrome DevTools Protocol. Use when proving paste-URL download, format picker, history, settings, themes, or trim, cut, or audio clipper behavior in this repo, or when a change needs runtime evidence from the real GUI rather than vitest."
---

# Verify Yoink

Drive the installed Electron desktop app the way a user does. Vitest covers IPC helpers only. A passing `npm test` is not GUI proof.

Do not open `http://localhost:3000` in a plain browser. `window.yoink` exists only inside Electron (`electron/preload.ts`, `lib/api-client.ts`). `npm run dev` starts Next.js without that backend.

The browser extension and Premiere plugin share the Yoink data directory. They are out of scope for this skill.

Read [features/README.md](features/README.md) before a proof. Drive the mapped feature file, not an improvised path.

## Launch

From the repo root, after `npm install`:

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs launch --run-id settings-theme
```

The helper does the following:

1. Refuses if `127.0.0.1:3000` is already taken by a process it did not start. `electron/main.ts` hardcodes `DEV_URL` to `http://localhost:3000`.
2. Builds an isolated home under `/tmp/yoink-verify-<run-id>/` and points `HOME` (and `APPDATA` on Windows) at it so settings land in that tree, not the operator's real Yoink data dir.
3. Starts `next dev --hostname 127.0.0.1 --port 3000`.
4. Runs `node electron/build.mjs`.
5. Starts Electron with `--user-data-dir` under the isolated home and `--remote-debugging-port`. On Linux it also passes `--no-sandbox --disable-gpu`. When `xvfb-run` exists, Linux wraps the binary in `xvfb-run -a` so the operator display is not required. Those flags are verification-only. The helper keeps `XAUTHORITY` pointing at the original cookie file so a real `DISPLAY` still works if xvfb is absent.
6. Waits until CDP sees the renderer page and the `h1` text is `Yoink`.

Ready means the helper printed JSON that includes `electronPid`, `dataDir`, `evidenceDir`, and `cdpPort`, and `doctor` exits 0.

Do not use `npm run dev:electron` for verification. That script skips isolated home, `--user-data-dir`, and CDP.

If `yt-dlp` is missing and the proof downloads, run `node scripts/fetch-ytdlp.mjs` once first. That script skips ffmpeg on non-Windows hosts. Audio (MP3) and editors need `ffmpeg` on `PATH` on Linux.

**Isolate.** `app.requestSingleInstanceLock()` in `electron/main.ts` plus the hardcoded Next port mean two verification instances cannot run at once. Never drive a Yoink window this helper did not start. Do not set `APPDATA` on Linux or macOS. `lib/ytdlp.ts` honors `APPDATA` on every platform while `electron/ipc/_data.ts` uses it only on Windows.

## Doctor

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs doctor --path .cursor/skills/verify-yoink/evidence/settings-theme/doctor.json
```

Require every check `ok: true` before any click:

- Next and Electron PIDs from the state file are alive.
- `http://127.0.0.1:3000` answers.
- CDP lists a page whose URL is the local Next origin, not DevTools.
- The rendered `h1` is `Yoink`.
- `homeDir` is under the process temp dir. `dataDir` is under that home.

If anything looks off after a failed drive, run doctor again. If doctor fails, run cleanup with `--keep-scratch`, then launch.

## Drive

All GUI actions go through `control-yoink`. Prefer visible names from `app/page.tsx`.

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "History"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "⚙ Settings" --exact
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "URL" --value "https://www.youtube.com/watch?v=jNQXAC9IVRw"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "Default Output Folder" --value "/tmp/yoink-verify-settings-theme/Downloads"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Download History"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs eval --js "localStorage.getItem('theme')"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs settings-file
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs history-file
```

Stable handles from the main window:

- Heading `Yoink`
- Buttons `History`, `⚙ Settings`, `Batch mode`, `Video`, `Audio (MP3)`, `Browse`, `Download`
- URL field: fill with `--label "URL"` (visible caption, or `input[type="url"]`). Do not fill by placeholder text; that string is not a stable handle.
- Labels `URL`, `Format`, `Mode`, `Quality`, `Output Folder`
- After a URL resolves, format option `Best quality (auto)`
- Short-path hint copy starting `YouTube Short detected` when the URL field holds a `/shorts/<id>` path
- Settings drawer heading `Settings`, theme buttons `Slate`, `Terminal`, `Glass`, `Minimal`, `Neon Noir`, `Brutalist`, then `Save Settings`
- History drawer heading `Download History`, empty copy `No downloads yet`, row actions `Re-use`, `Edit`, `Clear all`

The Download button stays disabled until the URL field is non-empty and Output Folder is non-empty. Default output is the isolated `Downloads` directory after launch because `electron/ipc/_data.ts` joins `os.homedir()` with `Downloads`.

Info and format lists wait 800 ms after the last URL change (`app/page.tsx`). Wait for the preview title or `Could not load video info` before asserting formats. A site bot-check or `LOGIN_REQUIRED` is an environment limit, not a failing proof — record it and use argv/unit-level proof for format selectors.

`wait --text` matches `document.body.innerText` and ignores letter case. Labels such as Color Theme render as COLOR THEME because of CSS `uppercase`.

## Evidence

Put artifacts under `.cursor/skills/verify-yoink/evidence/<run-id>/`. That directory is the named proof location. Cleanup must leave it in place.

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/settings-theme/after-save.png
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/settings-theme/after-save.ax.json
```

Proof standard:

- Exercise the real UI. Do not call `window.yoink.saveSettings` as a substitute for clicking **Save Settings**.
- Capture the action and the resulting state. A final screenshot alone is not enough.
- Confirm side effects. Theme proofs read `localStorage.theme`. Settings proofs read `settings-file` (isolated `settings.json`). Download proofs read `history-file` plus a file under the isolated output directory named `%(title)s.%(ext)s` (`electron/ipc/download.ts`).
- Do not use cookies files, operator home paths, emails, tokens, or private URLs. Use `/tmp/yoink-verify-*` and public sample URLs only.
- Do not treat `npm test` as this proof.

## Cleanup

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs cleanup
```

The helper kills the Next and Electron PIDs it recorded, then deletes the `/tmp/yoink-verify-<run-id>/` scratch tree. It does not delete `.cursor/skills/verify-yoink/evidence/`. After cleanup, confirm the evidence files still exist at the paths you wrote.

Do not `pkill electron` or `pkill next`. After a failed iteration, run cleanup before the next launch so port 3000 and the instance lock are free.

## Helpers

`scripts/control-yoink.mjs` is the only helper. Node 22+ (WebSocket is built in). No extra npm package.

```bash
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs launch --run-id settings-theme
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs doctor
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "URL" --value "https://www.youtube.com/watch?v=jNQXAC9IVRw"
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "⚙ Settings" --exact
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs argv --url "https://www.youtube.com/shorts/AAAAAAAAAAA" --quality 1080p
node .cursor/skills/verify-yoink/scripts/control-yoink.mjs cleanup
```

Launch twice with the same live run is a no-op when doctor still passes. A stale run is torn down, then started again.

Keep the map honest with `/maintain-verification-skill`.
