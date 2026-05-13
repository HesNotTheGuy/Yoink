# Yoink Browser Extension

Right-click any page (or click the toolbar popup) to grab a video URL and send it to yt-dlp for download — sharing the same data directory as the Yoink desktop app.

## What it does

- Adds a **"Yoink this video"** context menu item on any page
- Toolbar popup lets you choose mode (Video/Audio) and quality, then shows live download progress
- **Advanced options** (collapsed by default in the popup):
  - **Custom filename template** — yt-dlp output template like `%(uploader)s - %(title)s` or `%(upload_date)s %(title)s`
  - **Subtitles** — download subtitles in a chosen language, either embedded into the video or saved as a separate `.srt` file
  - **Use site cookies** — pass the current page's cookies to yt-dlp for age-gated, members-only, or login-required videos
- Reads and writes the same `%APPDATA%\Yoink\` data directory as the Yoink app:
  - `history.json` — shared download history
  - `settings.json` — shared settings (outputDir, defaultMode, etc.)
  - `yt-dlp.exe` — shared yt-dlp binary

## Browser Support

Built on Manifest V3 — works in:

| Browser | Minimum version |
|---|---|
| Chrome | 88+ |
| Edge (Chromium) | 88+ |
| Brave | All current versions |
| Opera | 74+ |
| Vivaldi | All current versions |
| Firefox | 109+ |

Any Chromium-based browser will install it the same way as Chrome.

## Permissions

The extension requests the minimum permissions it needs. Here's exactly what each one does and what it can see:

### `nativeMessaging`
**What it does:** Lets the extension start the local helper script (`host.js`) and exchange JSON messages with it over stdin/stdout.

**What it accesses:** Only the `com.yoink.helper` host registered in your Windows registry — no other native programs. The browser enforces this matching.

**Why needed:** Browser extensions can't run shell commands. The helper is what actually runs `yt-dlp`. Without this permission, downloads cannot happen.

### `activeTab`
**What it does:** Grants temporary access to the current tab when you click the extension icon or use the context menu.

**What it accesses:** The URL and title of the tab you're actively interacting with — and only at the moment you click. Access is revoked as soon as you navigate away or close the popup.

**Why needed:** To know which video URL to send to yt-dlp. The extension does **not** read pages you haven't explicitly interacted with.

### `contextMenus`
**What it does:** Lets the extension add the "Yoink this video" item to your right-click menu.

**What it accesses:** Nothing on its own — it just registers the menu item. The actual URL is only read when you click the item (which then triggers `activeTab`).

**Why needed:** For the right-click → download flow.

### `cookies`
**What it does:** Lets the extension read browser cookies for a given URL.

**What it accesses:** Only the cookies for the **specific URL you're downloading from**, and only when you **explicitly check the "Use this site's cookies" box** in the popup. The extension calls `chrome.cookies.getAll({ url: currentPageUrl })`, which returns only cookies that the browser would actually send to that URL — not your entire cookie jar.

**How those cookies are used:**
1. Formatted as a Netscape cookie file (the format yt-dlp expects)
2. Sent to the local helper over native messaging
3. Helper writes the file to your system temp directory with mode `0600` (owner read/write only)
4. Helper passes `--cookies <tempfile>` to yt-dlp
5. **Temp file is deleted as soon as yt-dlp exits** (success or failure)

**Why needed:** Many sites — YouTube age-gated content, Twitch subscriber-only VODs, Vimeo private videos, Patreon-locked content — require authentication. Passing your existing browser session lets yt-dlp download these without you having to log in again or export cookies manually.

**Privacy notes:**
- The checkbox is opt-in. The default is OFF. Nothing happens with cookies unless you check it.
- Cookies never leave your machine — they go from browser → helper → yt-dlp → temp file → deleted
- You can verify the code path in `src/popup.js` (`getCookiesNetscape`) and `helper/host.js` (`writeCookiesFile` / `safeUnlink`)

### `host_permissions: ["<all_urls>"]`
**What it does:** Allows the extension's content script to be injected into pages so it can read the current URL.

**What it accesses:** `window.location.href` and `document.title` — that's all. The content script does **not** read page content, form data, cookies, localStorage, or any other page data. It only responds to two messages: `getVideoUrl` and `getPageTitle`.

**Why `<all_urls>` instead of just YouTube:** yt-dlp supports thousands of sites (Twitch, X/Twitter, Reddit, Vimeo, TikTok, etc.) — restricting to one domain would cripple the extension. You can verify in `src/content.js` (about 10 lines of code) that it only reads the URL and title.

### What the extension does NOT request

- ❌ `storage` — no preferences are saved by the extension itself; settings live in `%APPDATA%\Yoink\settings.json` and are managed by the helper
- ❌ `webRequest` — no network interception, no traffic monitoring
- ❌ `history` (browser history) — never accessed; download history is a separate file
- ❌ `downloads` — yt-dlp handles file writing directly, the browser's download manager is not used
- ❌ `tabs` — only `activeTab` is used (which is more restricted)

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

**Chrome / Edge / Brave / Opera / Vivaldi:**
1. Open `chrome://extensions` (or your browser's equivalent) → enable **Developer mode**
2. Click **Load unpacked** → select the `extension\src\` folder
3. Note the extension ID shown on the card

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `extension\src\manifest.json`

The extension's Firefox ID is fixed as `yoink@extension` (set in the manifest), so no further configuration is needed for Firefox.

### 3. Update the Chrome extension ID (Chromium browsers only)

After loading, copy the extension ID and paste it into `%APPDATA%\Yoink\helper\manifest.json`:

```json
"allowed_origins": ["chrome-extension://YOUR_ACTUAL_ID_HERE/"]
```

Then restart the browser (or reload the extension).

> Firefox does not need this step — its ID is set inside the manifest.

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
