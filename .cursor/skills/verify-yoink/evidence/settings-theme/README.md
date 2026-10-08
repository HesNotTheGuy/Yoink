Live proof of `settings-theme` (settings drawer, Terminal theme, Audio default, isolated output dir).

Artifacts:

- `after-settings-click.png` is the drawer on Slate before the theme click.
- `settings-terminal.png` is Terminal selected and Default Mode Audio.
- `after-save.png` is the main window after Save Settings. Theme is Terminal. Mode is Audio (MP3). Output folder is under `/tmp/yoink-verify-settings-theme/`.
- `settings-terminal.ax.json` is the accessibility tree for the Terminal drawer.
- `doctor.json` is the pre-drive health check.
- `settings.json` is isolated `settings.json` after save (`defaultMode` is `audio`).
- `theme.json` is `localStorage.theme` after the Terminal click.

Cleanup must leave this directory in place.
