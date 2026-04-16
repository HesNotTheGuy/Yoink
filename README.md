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
- **Themes** — 9 themes: Blue, Earthy, Cyberpunk, yt-dlp, Terminal, Glass, Minimal, Neon Noir, Brutalist
- **Portable build** — ships as a self-contained Windows executable

| Downloading | History | Settings |
|---|---|---|
| ![Downloading](docs/screenshots/02-downloading.png) | ![History](docs/screenshots/03-history.png) | ![Settings](docs/screenshots/04-settings.png) |

### Themes

| Blue | Earthy | Cyberpunk | yt-dlp |
|---|---|---|---|
| ![Blue](docs/theme-previews/blue.png) | ![Earthy](docs/theme-previews/earthy.png) | ![Cyberpunk](docs/theme-previews/cyberpunk.png) | ![yt-dlp](docs/theme-previews/ytdlp.png) |

| Terminal | Glass | Minimal | Neon Noir | Brutalist |
|---|---|---|---|---|
| ![Terminal](docs/theme-previews/terminal.png) | ![Glass](docs/theme-previews/glass.png) | ![Minimal](docs/theme-previews/minimal.png) | ![Neon Noir](docs/theme-previews/neon.png) | ![Brutalist](docs/theme-previews/brutalist.png) |

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
