// ===========================================================================
//  Yoink for Premiere — ExtendScript host bridge
//  Runs inside Premiere Pro's ExtendScript engine. Exposes functions that
//  the panel JavaScript calls via CSInterface.evalScript().
//
//  Compatible with Premiere Pro 13.0 (2019) and later.
// ===========================================================================

/**
 * Returns the absolute path of the currently open .prproj, or an empty
 * string if no project is open / not yet saved.
 */
function yoinkGetProjectPath() {
  try {
    if (typeof app === 'undefined' || !app.project) return '';
    var p = app.project.path;
    if (!p || p === '') return '';
    return String(p);
  } catch (e) {
    return '';
  }
}

/**
 * Finds (or creates) a top-level bin with the given name and returns it.
 * Returns null if the operation fails.
 */
function yoinkFindOrCreateBin(name) {
  try {
    var root = app.project.rootItem;
    var n = root.children.numItems;
    for (var i = 0; i < n; i++) {
      var child = root.children[i];
      // Some Premiere versions expose .type, others expose .createBin only on bins
      if (child && child.name === name) {
        return child;
      }
    }
    return root.createBin(name);
  } catch (e) {
    return null;
  }
}

/**
 * Imports the given file into the "Yoink Downloads" bin in the active project.
 * Returns "ok" on success, otherwise a short error string.
 */
function yoinkImportToBin(filePath) {
  try {
    if (!filePath) return 'no path';
    if (typeof app === 'undefined' || !app.project) return 'no project';

    var bin = yoinkFindOrCreateBin('Yoink Downloads');
    if (!bin) return 'bin create failed';

    // app.project.importFiles(paths, suppressUI, targetBin, importAsNumberedStill)
    // Older Premiere versions may not accept the targetBin argument — fall back to
    // importing into root, then moving the new item into the bin.
    var success = false;
    try {
      success = app.project.importFiles([filePath], true, bin, false);
    } catch (eImport) {
      // Fallback for older builds: import to root and move
      var beforeCount = app.project.rootItem.children.numItems;
      success = app.project.importFiles([filePath]);
      if (success) {
        var afterCount = app.project.rootItem.children.numItems;
        if (afterCount > beforeCount) {
          var newItem = app.project.rootItem.children[afterCount - 1];
          if (newItem && newItem.moveBin) newItem.moveBin(bin);
        }
      }
    }

    return success ? 'ok' : 'import returned false';
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : 'unknown');
  }
}

/**
 * Returns Premiere host info as a JSON string. Useful for diagnostics.
 */
function yoinkHostInfo() {
  try {
    return JSON.stringify({
      name: app.appName || 'PPRO',
      version: app.version || 'unknown',
      projectOpen: !!(app.project && app.project.path)
    });
  } catch (e) {
    return '{}';
  }
}
