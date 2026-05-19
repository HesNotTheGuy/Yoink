# Yoink

A clean, local GUI for [yt-dlp](https://github.com/yt-dlp/yt-dlp). Runs as a local web app — no accounts, no cloud, just downloads.

Also includes a [**browser extension**](extension/) (Chrome / Firefox / Edge / Brave / Opera) and a [**Premiere Pro panel plugin**](premiere-plugin/), all sharing the same `%APPDATA%\Yoink\` data folder for unified history and a single shared yt-dlp binary.

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
- **Themes** — 6 themes: Slate, Terminal, Glass, Minimal, Neon Noir, Brutalist

| Downloading | History | Settings |
|---|---|---|
| ![Downloading](docs/screenshots/02-downloading.png) | ![History](docs/screenshots/03-history.png) | ![Settings](docs/screenshots/04-settings.png) |

### Themes

| Slate | Terminal | Glass |
|---|---|---|
| ![Slate](docs/theme-previews/slate.png) | ![Terminal](docs/theme-previews/terminal.png) | ![Glass](docs/theme-previews/glass.png) |

| Minimal | Neon Noir | Brutalist |
|---|---|---|
| ![Minimal](docs/theme-previews/minimal.png) | ![Neon Noir](docs/theme-previews/neon.png) | ![Brutalist](docs/theme-previews/brutalist.png) |

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

Then open [http://localhost:3000](http://localhost:3000).

---

## Installing

Download `Yoink-Setup-x.y.z.exe` from the [latest release](https://github.com/HesNotTheGuy/Yoink/releases/latest). Run the installer — it's per-user by default (no admin needed), creates a Start Menu shortcut, and shows up in Add/Remove Programs.

Companion downloads on the same release page:
- `Yoink-Extension-x.y.z.zip` — browser extension for Chrome / Firefox / Edge / Brave
- `Yoink-Premiere-Plugin-x.y.z.zip` — Adobe Premiere Pro panel

### Building from source

```bash
npm install
npm run build:electron
```

The installer is written to `dist/Yoink-Setup-x.y.z.exe`.

---

## Stack

- [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- yt-dlp via `child_process` — no wrappers, no abstractions

---

made by The Guy
