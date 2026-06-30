# Third-Party Notices

Yoink itself is released into the public domain (see [`UNLICENSE`](UNLICENSE)).
It bundles and redistributes the following third-party software. This file is
shipped with every installer (in the install directory) to satisfy the
attribution and license-text requirements of those components.

---

## yt-dlp

- **Role:** the download engine — Yoink is a GUI wrapper around yt-dlp.
- **License:** The Unlicense (public domain dedication — no attribution required).
- **Source / project:** https://github.com/yt-dlp/yt-dlp
- **Redistributed as:** the unmodified official `yt-dlp.exe` release binary,
  downloaded at build time by `scripts/fetch-ytdlp.mjs`.

yt-dlp imposes no licensing obligations; it is credited here and in the app
out of respect for the project.

```
This is free and unencumbered software released into the public domain.
For the full text, see https://unlicense.org
```

---

## FFmpeg

- **Role:** muxing, remuxing, and audio extraction (MP3) for downloads, plus the
  trim/cut/audio editor operations.
- **License:** FFmpeg is licensed under the **GNU Lesser General Public License
  (LGPL) v2.1 or later**. The specific build Yoink bundles is distributed under
  the **GNU LGPL v3** — its full text ships beside the binaries at
  `ffmpeg/LICENSE.txt` in the install directory.
- **Build:** BtbN's `ffmpeg-master-latest-win64-lgpl-shared` build
  (https://github.com/BtbN/FFmpeg-Builds). This is the **LGPL** build — it
  deliberately excludes the GPL-only components — used **unmodified**.
- **Dynamic linking / replaceability:** Yoink ships the **shared** build
  (`ffmpeg.exe` / `ffprobe.exe` plus their `av*`/`sw*` DLLs). Because the
  libraries are dynamically linked, a user may replace them with their own
  compatible build of FFmpeg, as the LGPL provides for.
- **FFmpeg source code:** https://ffmpeg.org/download.html — the corresponding
  source for this exact build can also be obtained via the BtbN builds project
  linked above.

Yoink does not modify FFmpeg and does not statically link it.

---

## Application framework

The desktop shell and renderer are built with Electron (MIT), Next.js (MIT),
React (MIT), and Tailwind CSS (MIT). Full per-dependency license texts are
available in each package's folder under `node_modules/`.
