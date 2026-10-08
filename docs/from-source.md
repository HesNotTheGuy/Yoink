# From source

Node.js 18+. yt-dlp and FFmpeg are fetched at build time — they do not need to be on your PATH.

## Dev

```bash
npm install
node scripts/fetch-ytdlp.mjs
npm run dev:electron
```

`dev:electron` starts Next.js and launches the Electron shell. `npm run dev` only starts the Next.js server (no desktop backend), so downloads will not work.

The fetch script is a one-time step after a clone. It writes binaries into `electron/resources/`; on first launch the app copies them into its local data directory if they are not already there. Having `yt-dlp` and `ffmpeg` on PATH is a fallback. `npm run build:electron` runs the fetch automatically.

## Installer

```bash
npm install
npm run build:electron
```

Output: `dist/Yoink-Setup-x.y.z.exe`. The installer bundles yt-dlp and FFmpeg and seeds them into the app data directory on first launch (it will not overwrite copies already there).

The same [release page](https://github.com/HesNotTheGuy/Yoink/releases/latest) also has:

- `Yoink-Extension-*.zip` — browser extension ([extension/](../extension/))
- `Yoink-Premiere-Plugin-*.zip` — Premiere Pro panel ([premiere-plugin/](../premiere-plugin/))
