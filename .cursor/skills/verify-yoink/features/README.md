# Yoink verification map

This directory is the maintained source for verifying the user-facing behavior of the Yoink Electron desktop app. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs launch --run-id <id>`.
- Isolated home is `/tmp/yoink-verify-<id>/`. Settings and history must live under that tree.
- Default output folder is `/tmp/yoink-verify-<id>/Downloads`.
- Run `control-yoink doctor` and require heading `Yoink`, Next on port 3000, and an isolated data dir.
- Never drive a Yoink window this helper did not start.
- Do not start a second instance. The app takes a single-instance lock and always loads `http://localhost:3000` in dev.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Click by visible name. Use `--exact` when several controls share a substring (`Settings` vs `Save Settings`).
- Treat every command as literal. Keep quoted names and flags unchanged.
- Restore scratch state with `cleanup`. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an accessibility snapshot or HTML fallback and a screenshot that shows the Yoink heading.
- Mutation proof includes a second read of `settings-file` or `history-file`.
- Record the feature id and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-yoink` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Paste URL and download](./download.md) covers single URL download, batch mode, progress, and history write.
- [Format picker](./format-picker.md) covers quality, mode, and the per-URL format list.
- [Vertical short-path URL](./vertical-url.md) covers the short-path hint, width-capped format selector, and conditional `--js-runtimes`.
- [Download history](./history.md) covers the history drawer, empty state, re-use, and clear.
- [Settings and themes](./settings.md) covers the settings drawer, theme buttons, and persisted defaults.
- [Trim, cut, and audio clipper](./editors.md) covers `/edit`, `/cut`, and `/audio` after a completed download.
