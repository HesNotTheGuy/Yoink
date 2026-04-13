# Yoink

A clean, local GUI for [yt-dlp](https://github.com/yt-dlp/yt-dlp). Runs as a local web app — no accounts, no cloud, just downloads.

![Main UI](docs/screenshots/01-main.png)

---

## Features

- **Video & audio downloads** — MP4 or MP3, with quality selection (Best, 1080p, 720p, 480p, 360p)
- **Batch mode** — paste multiple URLs at once
- **Real-time progress** — live progress bar, speed, and ETA per download
- **Format picker** — inspect available formats before downloading
- **Download history** — browse past downloads with thumbnails
- **Metadata & thumbnail embedding** — toggle per download
- **Cookies support** — pass a cookies file for age-gated or private content
- **Speed limiter** — cap download speed
- **yt-dlp updater** — update yt-dlp from within the UI with a progress indicator
- **Themes** — Blue, Earthy, Cyberpunk, yt-dlp
- **Portable build** — ships as a self-contained Windows executable

| Downloading | History | Settings |
|---|---|---|
| ![Downloading](docs/screenshots/02-downloading.png) | ![History](docs/screenshots/03-history.png) | ![Settings](docs/screenshots/04-settings.png) |

| Cyberpunk theme | Earthy theme |
|---|---|
| ![Cyberpunk](docs/screenshots/05-cyberpunk-theme.png) | ![Earthy](docs/screenshots/06-earthy-theme.png) |

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) in your PATH
- [ffmpeg](https://ffmpeg.org/) in your PATH (for audio extraction and embedding)

---

## Getting Started

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) — or use `launch.cmd` to open it as a standalone app window.

---

## Portable Build

Run `build-portable.ps1` to produce a self-contained distribution under `dist/` that bundles Node.js, yt-dlp, and ffmpeg.

---

## Stack

- [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- yt-dlp via `child_process` — no wrappers, no abstractions

---

made by The Guy
