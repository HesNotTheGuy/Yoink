# Yoink for Premiere Pro

A panel plugin for Adobe Premiere Pro that downloads videos straight into your active project's folder and auto-imports them into a "Yoink Downloads" bin.

Shares the same `%APPDATA%\Yoink\` data folder as the Yoink desktop app and browser extension — so `yt-dlp.exe` and download history are unified across all three.

## What it does

- Adds a **Yoink** panel under `Window > Extensions > Yoink`
- Paste a video URL, pick mode/quality, click Download
- File is saved to `<your project folder>\Yoink Downloads\`
- File is auto-imported into a `Yoink Downloads` bin inside your project (optional, on by default)
- Full advanced options: filename templates, subtitles, cookies file

## Compatibility

| Premiere Pro | CEP version | Supported |
|---|---|---|
| 2019 (13.0) and later | CEP 9+ | ✅ Yes |
| 2018 (12.x) | CEP 8 | ⚠ Mostly works (older Node.js inside CEP, may have quirks) |
| Older | — | ❌ No |

Adobe is gradually moving to UXP for Premiere, but as of the current 2025 release CEP is still fully supported. This plugin will keep working until Adobe removes CEP entirely from Premiere — at which point a UXP port would be straightforward.

## Requirements

- **Premiere Pro 2019 or newer** (CEP 9+)
- **yt-dlp** — `install.ps1` downloads it to `%APPDATA%\Yoink\` if not already present
- Windows only for the installer script (the CEP plugin itself is cross-platform; macOS install is manual)

## Installation

From the `premiere-plugin/` folder, in PowerShell:

```powershell
.\install.ps1
```

This will:

1. Enable **PlayerDebugMode** in your user registry for CEP 9, 10, 11, and 12 (lets Premiere load unsigned panels — required for sideloaded plugins).
2. Copy the plugin to `%APPDATA%\Adobe\CEP\extensions\com.yoink.premiere\`.
3. Download `yt-dlp.exe` into `%APPDATA%\Yoink\` if it's not already there.

**Then fully restart Premiere Pro** (close all windows, not just the active project). Open Premiere and look under `Window > Extensions > Yoink`.

### Manual install (macOS or no PowerShell)

1. Enable PlayerDebugMode:
   - **macOS:** `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (repeat for `.9`, `.10`, `.12`)
   - **Windows:** create registry key `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode = "1"` (repeat for `.9`, `.10`, `.12`)
2. Copy the `premiere-plugin/` folder to:
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\com.yoink.premiere\`
   - **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/com.yoink.premiere/`
3. Place `yt-dlp` on your PATH or at `%APPDATA%\Yoink\yt-dlp.exe` (Windows) / `~/.yoink/yt-dlp` (macOS).
4. Restart Premiere.

## Usage

1. Open or save a project (the plugin needs to know where the `.prproj` lives so it can pick a folder for the downloads).
2. `Window > Extensions > Yoink`
3. Paste a URL, choose options, click **Download**.

The downloaded file appears in `<projectFolder>\Yoink Downloads\` and is automatically added to a `Yoink Downloads` bin in your Project panel — ready to drop on the timeline.

### Advanced options (collapsed by default)

- **Filename template** — yt-dlp output template. Default is `%(title)s`. Try `%(uploader)s - %(title)s` or `%(upload_date)s %(title)s`.
- **Subtitles** — checkbox + language code (`en`, `fr`, `all`, etc.) + Embed vs `.srt` sidecar. Embed only applies to video downloads in supported containers (mp4, mkv, webm).
- **Cookies file** — optional path to a Netscape-format cookies file for age-gated or login-required videos. Export one from your browser using an extension like "Get cookies.txt LOCALLY".

### Uninstalling

```powershell
.\uninstall.ps1
```

Removes the plugin folder. Leaves `PlayerDebugMode` registry keys and `%APPDATA%\Yoink\` intact (they may be used by other plugins or the Yoink desktop app).

## How it works

```
Premiere Pro
  └─ CEP Panel (HTML + Node.js + ExtendScript bridge)
       ├─ ExtendScript ──► reads app.project.path
       │                 └─ creates/finds "Yoink Downloads" bin
       │                 └─ calls app.project.importFiles()
       └─ Node.js ──────► spawns yt-dlp directly
                       └─ reads/writes %APPDATA%\Yoink\history.json
```

The panel uses CEP's `--enable-nodejs --mixed-context` flags, which let the panel JavaScript use Node.js APIs (`child_process`, `fs`, `path`) alongside normal browser APIs. yt-dlp's final output path is captured via the `--print after_move:[YOINK_PATH]%(filepath)s` flag, then passed to ExtendScript for auto-import.

## Files

```
premiere-plugin/
├── CSXS/
│   └── manifest.xml              CEP extension manifest
├── client/
│   ├── index.html                Panel UI
│   ├── main.js                   Panel logic (Node.js + CSInterface)
│   ├── styles.css                Slate theme
│   └── lib/CSInterface.js        Minimal Adobe CEP bridge
├── host/
│   └── premiere.jsx              ExtendScript: project path + bin import
├── icons/icon-normal.png         Panel menu icon
├── install.ps1                   Windows installer
├── uninstall.ps1                 Windows uninstaller
└── README.md
```
