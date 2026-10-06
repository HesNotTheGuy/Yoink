# Settings and themes

Settings and themes let a user open the settings drawer, pick one of six color themes, edit download defaults, and save them so the main window and `settings.json` match.

## Sub-features

- `settings-open` opens the drawer from **⚙ Settings**.
- `settings-theme` applies Slate, Terminal, Glass, Minimal, Neon Noir, or Brutalist immediately and stores the key in `localStorage.theme`.
- `settings-output` edits Default Output Folder.
- `settings-defaults` edits Default Mode, Default Quality, embed checkboxes, Speed Limit, and Cookies File.
- `settings-save` writes isolated `settings.json` and shows a `Settings saved` toast.

## How to get to it (user POV)

- Choose **⚙ Settings** in the main header.
- Choose a theme button under **Color Theme**.
- Edit the default fields, then choose **Save Settings**.
- Close the drawer with ✕ or the dimmed overlay without saving to discard draft fields. Theme clicks still persist because they write `localStorage` immediately.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- Isolated data dir is `/tmp/yoink-verify-<id>/.yoink` on POSIX, or `/tmp/yoink-verify-<id>/AppData/Roaming/Yoink` on Windows.
- Evidence directory is `.cursor/skills/verify-yoink/evidence/<id>/`.

- **Open settings.** Choose **⚙ Settings**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "⚙ Settings" --exact`. A heading **Settings** appears with **Color Theme**.
- **Pick Terminal.** Choose **Terminal**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Terminal" --exact`. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs eval --js "localStorage.getItem('theme')"`. The value is `terminal`.
- **Set output default.** Change Default Output Folder to the isolated Downloads path. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs fill --label "Default Output Folder" --value "/tmp/yoink-verify-<id>/Downloads"`.
- **Set default mode.** Choose **Audio** inside the drawer. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Audio" --exact`. Default Mode is Audio.
- **Save.** Choose **Save Settings**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Save Settings" --exact`. Wait for the toast. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs wait --text "Settings saved"`. The drawer closes.
- **Confirm disk.** Read settings from disk. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs settings-file`. `defaultMode` is `audio`. `outputDir` is the isolated Downloads path. Theme is not in this file. Theme lives in `localStorage`.
- **Reopen.** Open settings again. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "⚙ Settings" --exact`. Terminal stays selected. Default Mode stays Audio.
- **Proof.** Capture the open drawer after Terminal is selected, then the disk JSON after save. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/settings-terminal.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/settings-terminal.ax.json`. Copy `settings-file` stdout to `.cursor/skills/verify-yoink/evidence/<id>/settings.json`.

## Gotchas

- **⚙ Settings** must use `--exact`. **Save Settings** also contains the word Settings.
- Theme applies on click, before **Save Settings**. A discarded draft still leaves the new theme.
- Cookies File and Speed Limit are free text. Use fake values such as `/tmp/yoink-verify-<id>/cookies.txt` and `500K`. Never paste a real cookies file.
- `settings-file` prints `null` until the first save. Defaults still apply in the UI.
- Do not screenshot a path that includes an operator home directory. If `outputDir` is not under `/tmp/yoink-verify-`, stop. The instance is not isolated.
