# Yoink Browser Extension

Right-click any page (or click the toolbar popup) to grab a video URL and send it to yt-dlp for download — sharing the same data directory as the Yoink desktop app.

## What it does

- Adds a **"Yoink this video"** context menu item on any page
- Toolbar popup lets you choose mode (Video/Audio) and quality, then shows live download progress
- Reads and writes the same `%APPDATA%\Yoink\` data directory as the Yoink app:
  - `history.json` — shared download history
  - `settings.json` — shared settings (outputDir, defaultMode, etc.)
  - `yt-dlp.exe` — shared yt-dlp binary

## Requirements

- **Node.js ≥ 18** must be on your PATH (the native messaging host runs as a Node.js script)
- yt-dlp is downloaded automatically by `install.ps1` if not already present
- The Yoink app (`http://localhost:3000`) is optional — the extension works standalone

## Installation

### 1. Register the native messaging host (one time)

Open PowerShell and run:

```powershell
.\helper\install.ps1
```

This will:
- Create `helper\run-host.cmd` (the NMH launcher)
- Write the manifest to `%APPDATA%\Yoink\helper\manifest.json`
- Register the manifest path for Chrome and Firefox in `HKCU` (no admin required)
- Download `yt-dlp.exe` to `%APPDATA%\Yoink\` if not already present

### 2. Load the extension

**Chrome / Edge:**
1. Open `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the `extension\src\` folder
3. Note the extension ID shown on the card

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `extension\src\manifest.json`

### 3. Update the Chrome extension ID (Chrome only)

After loading, copy the extension ID and paste it into `%APPDATA%\Yoink\helper\manifest.json`:

```json
"allowed_origins": ["chrome-extension://YOUR_ACTUAL_ID_HERE/"]
```

Then restart the browser (or reload the extension).

## Icons

Place `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` in `src\icons\`.  
Copy them from the Yoink app's `public\` folder.  
See `src\icons\README.txt` for details.

## How it works

```
Browser extension (MV3)
  └─ popup / context menu
       └─ chrome.runtime.connectNative  ──►  helper/host.js  (Node.js)
                                                 └─ spawns yt-dlp
                                                 └─ reads/writes %APPDATA%\Yoink\
```

The native messaging host (`host.js`) reads one JSON message from stdin, handles the action, sends one or more progress/result messages to stdout, then exits. Downloads stream progress in real time via a persistent `connectNative` port.

## Uninstall

```powershell
.\helper\uninstall.ps1
```

This removes the two registry keys. Helper files and `%APPDATA%\Yoink\` are left intact.
