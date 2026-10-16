# Download history

Download history lets a user open a drawer of past jobs, re-use a URL, jump to the trim editor, open the output folder, and clear the list.

## Sub-features

- `history-open` opens the drawer from **History**.
- `history-empty` shows `No downloads yet` when `history.json` is empty.
- `history-row` shows title, URL, Done or Error, relative time, and mode.
- `history-reuse` copies the row URL into the main field and closes the drawer.
- `history-edit` links a successful row to `/edit` or `/audio` with a `file` query.
- `history-clear` removes every row via **Clear all**.

## How to get to it (user POV)

- Choose **History** in the main header.
- After a download, choose **History** again to see the new row.
- In a row, choose **Re-use**, **Edit**, or the folder button.
- Choose **Clear all**.

## Driving it with control-yoink

Preconditions:

- Yoink is healthy from `control-yoink doctor`.
- Isolated `history.json` starts empty unless the recipe says otherwise.

- **Open empty drawer.** Choose **History**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "History" --exact`. The heading **Download History** and the copy `No downloads yet` appear.
- **Seeded row.** Only after a download proof wrote history, reopen **History**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "History" --exact`. A row shows `✓ Done` or `✗ Error` and the original URL.
- **Re-use.** Choose **Re-use**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Re-use"`. The drawer closes and the main URL field equals that row's URL.
- **Clear all.** Reopen history and choose **Clear all**. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs click --text "Clear all"`. The drawer shows `No downloads yet`. `history-file` prints `[]`.
- **Proof.** Capture the empty drawer on a fresh launch. Run `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs screenshot --path .cursor/skills/verify-yoink/evidence/<id>/history-empty.png` and `node .cursor/skills/verify-yoink/scripts/control-yoink.mjs snapshot --path .cursor/skills/verify-yoink/evidence/<id>/history-empty.ax.json`. The artifacts show **Download History** and `No downloads yet`.

## Gotchas

- **Clear all** is irreversible for the isolated history file. Do not run it against a window using the operator's real data dir.
- **Edit** needs a `filePath` on a done row. Older rows without `filePath` still render **Edit** and can open the editor with a reconstructed path.
- The folder control's accessible name is `Open output folder`. Prefer that if `--text "📂"` is ambiguous.
- Empty-state proof does not prove a download wrote history. Use the download feature for that write.
- Close the drawer with the dimmed overlay on the left or the ✕ beside the heading. Several ✕ buttons exist. Prefer clicking the overlay via `eval --js "document.querySelector('.fixed.inset-0 .flex-1').click()"`.
