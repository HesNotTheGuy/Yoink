# Vertical short-path URL

A short-path media URL on the main window shows a hint, uses a width-capped yt-dlp format selector, and only adds `--js-runtimes` when the installed yt-dlp help lists that flag.

## Sub-features

- `vertical-hint` shows the short-path hint for a `/shorts/<id>` URL and hides it for a normal watch URL.
- `vertical-format` uses a width-capped format selector for short-path URLs and keeps the height cap for watch URLs.
- `vertical-js-runtimes` includes `--js-runtimes` only when `yt-dlp --help` documents `--js-runtimes`.

## How to get to it (user POV)

- Stay on the main window with Batch mode off.
- Paste a short-path URL into the **URL** field.
- Replace it with a normal watch URL.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- Batch mode is off. The main URL field is visible.
- Use only public sample URLs. Dummy 11-character ids are enough for argv. Do not use private, age-gated, or cookie-gated URLs.

- **Fill short-path URL.** Type a short-path sample. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "URL" --value "https://www.youtube.com/shorts/jNQXAC9IVRw"`. The field holds that URL.
- **Hint on.** Wait for the on-screen hint. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "YouTube Short detected" --timeout 5000`. The hint is visible.
- **Argv short-path.** Build download args (no network). Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs argv --url "https://www.youtube.com/shorts/AAAAAAAAAAA" --quality 1080p`. `widthCapped` is true. `hasJsRuntimesWhenRuntimeNull` is false. `hasJsRuntimesWhenRuntimePassed` is true. `hasProgress` and `hasPrint` are true. If `helpListsJsRuntimes` is true, the installed binary's help lists `--js-runtimes`; if false, the product must omit the flag; if null, help could not be read — report that as unreachable for the installed-binary check, not a failure.
- **Fill watch URL.** Type a watch sample. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "URL" --value "https://www.youtube.com/watch?v=jNQXAC9IVRw"`. The field holds that URL.
- **Hint off.** Confirm the hint is gone. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs eval --js "document.body.innerText.includes('YouTube Short detected')"`. The value is `false`.
- **Argv watch.** Build download args for a watch URL. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs argv --url "https://www.youtube.com/watch?v=AAAAAAAAAAA" --quality 1080p`. `heightCapped` is true. `widthCapped` is false. `--js-runtimes` / `--progress` / `--print` follow the same rules as the short-path argv.
- **Metadata (optional).** Wait for a preview title or `Could not load video info`. A site bot-check or `LOGIN_REQUIRED` is an environment limit, not a failing proof. Do not treat that skip as proof of the Format dropdown.
- **Proof.** Capture the hint. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/vertical-short-path.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/vertical-short-path.ax.json` while the short-path URL is in the field. Repeat with `vertical-watch.png` / `vertical-watch.ax.json` after the watch URL. Short-path artifacts show the hint; watch artifacts do not.

## Gotchas

- Fill with `--label "URL"`, not placeholder text. The placeholder string is not a stable handle.
- The on-screen hint copy is the UI string `YouTube Short detected`. Wait for that text; do not invent a different label.
- The Format dropdown still requires metadata. Bot-check means unreachable for that dropdown; argv still proves the width cap and `--js-runtimes` gating.
- `fill --label "URL"` matches the visible **URL** caption (a span, not a `<label>`) or `input[type="url"]`.
